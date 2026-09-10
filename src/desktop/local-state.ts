import {open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {z} from 'zod';
const schema=z.object({version:z.literal(1),projectId:z.string().uuid().nullable(),onboarded:z.boolean().default(false)}).strict();
export async function readLocalState(root:string){
 try{const file=await open(join(root,'workspace-state.json'),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();if(!stat.isFile()||stat.size>4096)throw new Error('Invalid workspace state');return schema.parse(JSON.parse(await file.readFile('utf8')));}finally{await file.close();}}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1 as const,projectId:null,onboarded:false};throw error;}
}
const writes=new Map<string,Promise<void>>();
export async function saveLocalState(root:string,projectId:string|null|undefined,onboarded?:boolean){
 const pending=(writes.get(root)??Promise.resolve()).catch(()=>{}).then(()=>writeState(root,projectId,onboarded));writes.set(root,pending);
 try{await pending;}finally{if(writes.get(root)===pending)writes.delete(root);}
}
async function writeState(root:string,projectId:string|null|undefined,onboarded?:boolean){
 const previous=await readLocalState(root);
 const data=schema.parse({...previous,projectId:projectId===undefined?previous.projectId:projectId,onboarded:onboarded??previous.onboarded}),temporary=join(root,'.workspace-'+randomUUID());const file=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 try{await file.writeFile(JSON.stringify(data));await file.sync();await file.close();await rename(temporary,join(root,'workspace-state.json'));}finally{await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
