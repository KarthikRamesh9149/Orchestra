import {constants} from 'node:fs';
import {mkdir,lstat,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {CredentialProtection} from './vault.js';
import {savedConnectionSchema,sharedGrantSchema,type SharedGrant,type SavedConnection} from './shared-http.js';

const schema=z.object({version:z.literal(1),connections:z.array(z.object({connection:savedConnectionSchema,grant:sharedGrantSchema.nullable()}).strict()).max(8)}).strict();
type Registry=z.infer<typeof schema>;
const maxEnvelope=512*1024;

/** Dedicated encrypted registry. Never shares the local provider credential file. */
export class SharedConnectionStore{
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private readonly root:string,private readonly protection:CredentialProtection){}
 private async directory(){
  if(!this.protection.isEncryptionAvailable())throw new Error('OS credential protection unavailable');
  await mkdir(this.root,{recursive:true,mode:0o700});const stat=await lstat(this.root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Private shared settings directory required');
 }
 private async read():Promise<Registry>{
  await this.directory();let file;
  try{file=await open(join(this.root,'connections.enc'),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,connections:[]};throw error;}
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>maxEnvelope||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Unsafe shared envelope');
   const bytes=Buffer.alloc(maxEnvelope+1),result=await file.read(bytes,0,bytes.length,0);if(result.bytesRead>maxEnvelope)throw new Error('Shared envelope too large');
   return schema.parse(JSON.parse(this.protection.decryptString(bytes.subarray(0,result.bytesRead))));
  }finally{await file.close();}
 }
 private update(change:(state:Registry)=>void):Promise<void>{
  const pending=this.tail.catch(()=>{}).then(async()=>{
   const state=await this.read();change(state);const encrypted=this.protection.encryptString(JSON.stringify(schema.parse(state)));if(encrypted.length>maxEnvelope)throw new Error('Shared envelope too large');
   const destination=join(this.root,'connections.enc');
   try{const stat=await lstat(destination);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Unsafe shared destination');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const temporary=join(this.root,'.shared-'+randomUUID()),file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await file.writeFile(encrypted);await file.sync();await file.close();await rename(temporary,destination);const dir=await open(this.root,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}}
   finally{await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  });this.tail=pending;return pending;
 }
 async list(){await this.tail.catch(()=>{});return (await this.read()).connections.map(row=>row.connection);}
 async add(value:SavedConnection){const connection=savedConnectionSchema.parse(value);await this.update(state=>{if(state.connections.some(row=>row.connection.id===connection.id||row.connection.origin===connection.origin))throw new Error('Server already saved');state.connections.push({connection,grant:null});});}
 async remove(id:string){z.string().uuid().parse(id);await this.update(state=>{state.connections=state.connections.filter(row=>row.connection.id!==id);});}
 grants(id:string){
  z.string().uuid().parse(id);
  return {
   read:async()=>{await this.tail.catch(()=>{});const row=(await this.read()).connections.find(item=>item.connection.id===id);if(!row)throw new Error('Connection removed');return row.grant;},
   write:async(value:SharedGrant|null)=>{const grant=value===null?null:sharedGrantSchema.parse(value);await this.update(state=>{const row=state.connections.find(item=>item.connection.id===id);if(!row)throw new Error('Connection removed');row.grant=grant;});}
  };
 }
}
