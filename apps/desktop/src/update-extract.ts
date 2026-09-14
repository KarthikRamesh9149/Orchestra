/// <reference path="./yauzl.d.ts" />
// Privileged helper only. Never execute an extracted artifact in this module.
import {constants,open as openFd,close as closeFd,read as readFd,fstat} from 'node:fs';
import {mkdir,mkdtemp,lstat,open,symlink,realpath,rm} from 'node:fs/promises';
import {join,dirname,resolve,sep,isAbsolute} from 'node:path';
import {promisify} from 'node:util';
import {fromFdPromise,type ZipFile} from 'yauzl';
import {verifyUpdateBytes} from './update-verification.js';
const appName='Orchestra Desktop Internal.app';
const maxExpanded=2*1024**3,maxEntries=50000;
export async function extractVerifiedUpdate(input:{artifactPath:string;sha256:string;bytes:number;root:string;signal?:AbortSignal}){
 // The full native runtime has thousands of files that must be durably synced.
 // Keep a finite deadline without using the smaller network-download budget.
 const signal=AbortSignal.any([AbortSignal.timeout(600000),...(input.signal?[input.signal]:[])]);
 signal.throwIfAborted();
 await mkdir(input.root,{recursive:true,mode:0o700});
 const root=await lstat(input.root);if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&0o077)!==0)throw new Error('Private extraction root required');
 const stage=await mkdtemp(join(input.root,'unpack-'));
 let fd:number|undefined,zip:ZipFile|undefined,success=false;
 try{
  fd=await promisify(openFd)(input.artifactPath,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=await promisify(fstat)(fd);if(!stat.isFile()||stat.size!==input.bytes)throw new Error('Invalid artifact file');
  const read=promisify(readFd),descriptor=fd;
  async function* chunks(){let position=0;for(;;){signal.throwIfAborted();const buffer=Buffer.alloc(65536);const {bytesRead}=await read(descriptor,buffer,0,buffer.length,position);if(!bytesRead)break;position+=bytesRead;yield buffer.subarray(0,bytesRead);}}
  await verifyUpdateBytes(chunks(),{url:'https://local-verification.invalid/artifact',bytes:input.bytes,sha256:input.sha256});
  zip=await fromFdPromise(fd,{autoClose:false,strictFileNames:true,validateEntrySizes:true});
  const seen=new Set<string>(),directories=new Set<string>([stage]);
  const links:Array<{path:string;target:string}>=[];let expanded=0;
  for await(const entry of zip.eachEntry()){
   signal.throwIfAborted();
   const name=entry.fileName.replace(/\/$/,'');
   const parts=name.split('/');
   if(parts[0]!==appName||parts.some(p=>!p||p==='.'||p==='..'||p.length>255)||name.includes('\\')||name.includes('\0')||name.length>2048)throw new Error('Unsafe update path');
   const canonical=name.normalize('NFC').toLowerCase();
   if(seen.has(canonical)||seen.size>=maxEntries)throw new Error('Duplicate or excessive update entries');seen.add(canonical);
   if((entry.generalPurposeBitFlag&1)!==0||!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0||(expanded+=entry.uncompressedSize)>maxExpanded)throw new Error('Unsupported or oversized update entry');
   const mode=entry.externalFileAttributes>>>16,type=mode&0o170000;
   const path=join(stage,name);
   if(entry.fileName.endsWith('/')){if(type&&type!==0o040000)throw new Error('Invalid directory entry');await mkdir(path,{recursive:true,mode:0o700});directories.add(path);continue;}
   if(type&&type!==0o100000&&type!==0o120000)throw new Error('Special update files forbidden');
   await mkdir(dirname(path),{recursive:true,mode:0o700});
   for(let parent=dirname(path);parent.startsWith(stage+sep);parent=dirname(parent))directories.add(parent);
   const stream=await zip.openReadStreamPromise(entry);let bytes=0;
   const abort=()=>stream.destroy(new Error('Update extraction cancelled'));signal.addEventListener('abort',abort,{once:true});
   try{
    if(type===0o120000){
     if(entry.uncompressedSize>4096)throw new Error('Oversized update symlink');
     const values:Buffer[]=[];for await(const value of stream){bytes+=value.length;if(bytes>4096)throw new Error('Oversized update symlink');values.push(Buffer.from(value));}
     const target=Buffer.concat(values).toString('utf8');
     const targetPath=resolve(dirname(path),target),appRoot=join(stage,appName);
     if(!target||isAbsolute(target)||target.includes('\0')||target.includes('\\')||!(targetPath===appRoot||targetPath.startsWith(appRoot+sep)))throw new Error('Update symlink escapes application');
     links.push({path,target});
    }else{
     const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,(mode&0o111)?0o700:0o600);
     try{for await(const value of stream){signal.throwIfAborted();bytes+=value.length;if(bytes>entry.uncompressedSize)throw new Error('Update entry exceeds bound');await file.writeFile(value);}await file.sync();}finally{await file.close();}
    }
    if(bytes!==entry.uncompressedSize)throw new Error('Incomplete update entry');
   }finally{signal.removeEventListener('abort',abort);stream.destroy();}
  }
  if(!seen.size)throw new Error('Empty update archive');
  // Defer all symlinks until regular writes finish: no archive entry can write
  // through a symlink installed by an earlier entry.
  for(const link of links)await symlink(link.target,link.path);
  const appRoot=join(stage,appName);
  if(!(await lstat(appRoot)).isDirectory())throw new Error('Application directory required');
  for(const link of links){const target=await realpath(link.path);if(!(target===appRoot||target.startsWith(appRoot+sep)))throw new Error('Invalid update symlink target');}
  for(const path of directories){const directory=await open(path,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}}
  signal.throwIfAborted();success=true;
  return {stage,appPath:appRoot,expandedBytes:expanded,entries:seen.size,installed:false as const};
 }finally{
  try{
   if(zip){await new Promise<void>((resolve,reject)=>{zip!.once('close',resolve);zip!.once('error',reject);zip!.close();});}
   else if(fd!==undefined)await promisify(closeFd)(fd);
  }finally{if(!success)await rm(stage,{recursive:true,force:true});}
 }
}
