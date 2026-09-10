import {z} from 'zod';
import {open,rename,unlink,lstat} from 'node:fs/promises';
import {dirname,join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {localHttp} from './local-http.js';
import type {HostClient} from './host-client.js';
export const downloadSchema=z.object({projectId:z.string().uuid(),documentId:z.string().uuid()}).strict();
export async function downloadDocument(input:unknown,host:HostClient,selectPath:(name:string)=>Promise<string|undefined>){
 const {projectId,documentId}=downloadSchema.parse(input);
 const response=await localHttp(new Request(`orchestra://app/v1/projects/${projectId}/documents/${documentId}/file`),host);
 if(!response.ok)throw new Error('The authorized original document is unavailable.');
 const type=response.headers.get('content-type')??'';
 const extension=type.includes('pdf')?'.pdf':type.includes('wordprocessingml')?'.docx':type.includes('spreadsheetml')?'.xlsx':type.includes('csv')?'.csv':'.txt';
 try {
 const path=await selectPath(`Orchestra-document-${documentId}${extension}`);if(!path){return {cancelled:true};}
 try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Choose a regular destination file.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const temporary=join(dirname(path),'.orchestra-download-'+randomUUID());
 const file=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 const reader=response.body?.getReader();
 try{let size=0;if(!reader)throw new Error('No document bytes returned');for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>55*1024*1024)throw new Error('Document exceeds download limit');await file.writeFile(value);}await file.sync();await file.close();await rename(temporary,path);return {cancelled:false,fileName:basename(path)};}
 finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
 } finally {await response.body?.cancel().catch(()=>{});}
}
