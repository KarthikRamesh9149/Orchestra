import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
const types:Record<string,string>={'.txt':'text/plain','.md':'text/markdown','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.csv':'text/csv','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
const limit=50*1024*1024;
export class Selections {
 private entries=new Map<string,{path:string;size:number;mtimeMs:number;ino:number;expires:number}>();
 async add(path:string){
  for(const [id,value] of this.entries)if(value.expires<Date.now())this.entries.delete(id);
  if(this.entries.size>=116||!types[extname(path).toLowerCase()])throw new Error('Unsupported selection');
  if(await realpath(path)!==path)throw new Error('Symbolic links are not supported');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>limit)throw new Error('Select a regular file smaller than 50 MiB');
   const id=randomUUID();this.entries.set(id,{path,size:stat.size,mtimeMs:stat.mtimeMs,ino:stat.ino,expires:Date.now()+300000});return {selectionId:id,name:basename(path),size:stat.size};
  }finally{await file.close();}
 }
 async consume(id:string){
  const entry=this.entries.get(id);this.entries.delete(id);if(!entry||entry.expires<Date.now())throw new Error('Select the file again');
  if(await realpath(entry.path)!==entry.path)throw new Error('Selected file path changed');
  const file=await open(entry.path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
   const stat=await file.stat();if(!stat.isFile()||stat.size!==entry.size||stat.mtimeMs!==entry.mtimeMs||stat.ino!==entry.ino)throw new Error('Selected file changed');
   // Bounded allocation/read even if a different process grows the file.
   const buffer=Buffer.alloc(entry.size);let offset=0;
   while(offset<buffer.length){const {bytesRead}=await file.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)throw new Error('Selected file changed');offset+=bytesRead;}
   const after=await file.stat();if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new Error('Selected file changed');
   return {fileName:basename(entry.path),contentType:types[extname(entry.path).toLowerCase()]!,base64:buffer.toString('base64')};
  }finally{await file.close();}
 }
}
