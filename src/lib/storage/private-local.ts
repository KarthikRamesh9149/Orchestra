import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { Readable } from 'node:stream';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from "node:crypto";
import type { StorageDriver, UploadInput } from "./types.js";

/** Application-owned directory only. API services remain the authorization
 * boundary; no public file URLs or renderer filesystem access are provided. */
export class PrivateLocalStorageDriver implements StorageDriver {
  private readonly root: string;
  constructor(root: string, private readonly maxBytes=100*1024*1024) { this.root=resolve(root); }

  private async file(key:string, create=false) {
    if(key.length>1024||key.includes('\\')||key.includes(':')||key.includes('\0'))throw new Error('Invalid storage key');
    const parts=key.split('/');
    if(parts.some(p=>!p||p==='.'||p==='..'||p.length>200))throw new Error('Invalid storage key');
    if(create)await mkdir(this.root,{recursive:true,mode:0o700});
    let cursor=this.root;
    for(const part of ['',...parts.slice(0,-1)]){
      cursor=part?join(cursor,part):cursor;
      if(create)await mkdir(cursor,{recursive:true,mode:0o700});
      const info=await lstat(cursor);
      if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe storage directory');
      if(process.platform!=='win32'&&(info.mode&0o077)!==0)throw new Error('Storage directory must be private');
    }
    return join(cursor,parts.at(-1)!);
  }
  async putObject(input:UploadInput){
    if(input.body.length>this.maxBytes)throw new Error('Storage object exceeds limit');
    const destination=await this.file(input.key,true);
    const temporary=`${destination}.${randomUUID()}.pending`;
    const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try {await handle.writeFile(input.body);await handle.sync();await handle.close();await rename(temporary,destination);
      const directory=await open(dirname(destination),constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
    }
    catch(error){await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
    return {key:input.key,size:input.body.length};
  }
  private async readHandle(key:string){
    const handle=await open(await this.file(key),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const stat=await handle.stat();if(!stat.isFile()||stat.size>this.maxBytes||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Invalid private storage object');return {handle,size:stat.size};}
    catch(error){await handle.close();throw error;}
  }
  private async *boundedChunks(handle:FileHandle,size:number){
    let received=0;
    try{
      for(;;){
        const buffer=Buffer.alloc(Math.min(65536,size-received+1));
        const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
        if(!bytesRead)break;
        received+=bytesRead;if(received>size)throw new Error('Storage object changed during read');
        yield buffer.subarray(0,bytesRead);
      }
      if(received!==size)throw new Error('Storage object changed during read');
    }finally{await handle.close();}
  }
  async getObject(key:string){const {handle,size}=await this.readHandle(key);const chunks:Buffer[]=[];for await(const chunk of this.boundedChunks(handle,size))chunks.push(chunk);return Buffer.concat(chunks,size);}
  async getObjectStream(key:string){
    const {handle,size}=await this.readHandle(key),stream=Readable.from(this.boundedChunks(handle,size));
    // An async generator's finally does not run if it is never started. A
    // cancelled HTTP read must still release its already-open file descriptor.
    stream.once('close',()=>{void handle.close().catch(()=>{});});
    return {stream,size};
  }
  async getSignedUrl(_key:string):Promise<string>{throw new Error('Local objects require an authenticated API read');}
  async deleteObject(key:string){try{await unlink(await this.file(key));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
}
