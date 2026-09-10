import { constants } from "node:fs";
import { mkdir, lstat, open, rename, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
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
    try {await handle.writeFile(input.body);await handle.sync();await handle.close();await rename(temporary,destination);}
    catch(error){await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
    return {key:input.key,size:input.body.length};
  }
  private async readHandle(key:string){
    const handle=await open(await this.file(key),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const stat=await handle.stat();if(!stat.isFile()||stat.size>this.maxBytes)throw new Error('Invalid storage object');return {handle,size:stat.size};}
    catch(error){await handle.close();throw error;}
  }
  async getObject(key:string){const {handle}=await this.readHandle(key);try{return await handle.readFile();}finally{await handle.close();}}
  async getObjectStream(key:string){const {handle,size}=await this.readHandle(key);return {stream:handle.createReadStream({autoClose:true}),size};}
  async getSignedUrl(_key:string):Promise<string>{throw new Error('Local objects require an authenticated API read');}
  async deleteObject(key:string){try{await unlink(await this.file(key));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
}
