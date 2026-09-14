// Main-process only. Downloads are staged, never executed or installed here.
import {constants} from 'node:fs';
import {mkdir,lstat,mkdtemp,open,rename,rm} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {z} from 'zod';
import {verifyUpdateManifest,verifyUpdateBytes} from './update-verification.js';

type Input={root:string;manifest:Buffer;signature:string;policy:Parameters<typeof verifyUpdateManifest>[2];signal?:AbortSignal};
type Network=(url:string,init:RequestInit)=>Promise<Response>;
export async function stageVerifiedUpdate(input:Input,network:Network=fetch){
 const manifest=verifyUpdateManifest(input.manifest,input.signature,input.policy);
 input.signal?.throwIfAborted();
 await mkdir(input.root,{recursive:true,mode:0o700});
 const root=await lstat(input.root);
 if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&0o077)!==0)throw new Error('Private update directory required');
 const stage=await mkdtemp(join(input.root,'stage-'));
 const signal=AbortSignal.any([AbortSignal.timeout(120000),...(input.signal?[input.signal]:[])]);
 let complete=false;
 try{
  const response=await network(manifest.artifact.url,{method:'GET',redirect:'error',credentials:'omit',signal,headers:{accept:'application/octet-stream','accept-encoding':'identity'}});
  if(response.status!==200||response.redirected||!response.body)throw new Error('Update download failed');
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)!==manifest.artifact.bytes))throw new Error('Unexpected update length');
  const encoding=response.headers.get('content-encoding');
  if(encoding&&encoding!=='identity')throw new Error('Encoded update transport rejected');
  const partial=join(stage,'artifact.partial'),artifactPath=join(stage,'artifact.bin'),receiptPath=join(stage,'receipt.json');
  const file=await open(partial,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  const reader=response.body.getReader();
  const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
  try{
   async function* chunks(){
    let received=0;
    for(;;){
     signal.throwIfAborted();const {value,done}=await reader.read();signal.throwIfAborted();if(done)break;
     received+=value.byteLength;if(received>manifest.artifact.bytes)throw new Error('Update exceeds expected size');
     await file.writeFile(value);yield value;
    }
   }
   await verifyUpdateBytes(chunks(),manifest.artifact);signal.throwIfAborted();
   // A manifest that expired during download must not become an install candidate.
   verifyUpdateManifest(input.manifest,input.signature,{...input.policy,now:Date.now()});
   await file.sync();
  }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();await file.close();}
  await rename(partial,artifactPath);
  const receipt=await open(receiptPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await receipt.writeFile(JSON.stringify({formatVersion:1,version:manifest.version,manifestBase64:input.manifest.toString('base64'),signature:input.signature,installed:false}));await receipt.sync();}finally{await receipt.close();}
  const directory=await open(stage,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
  complete=true;
  return {stageId:basename(stage),artifactPath,receiptPath,version:manifest.version,installed:false as const};
 }finally{
  // Only this attempt's newly created stage is eligible for cleanup. A process
  // kill may leave an orphan; consumers must reverify, never auto-install it.
  if(!complete)await rm(stage,{recursive:true,force:true});
 }
}

const receiptSchema=z.object({formatVersion:z.literal(1),version:z.string(),manifestBase64:z.string().max(87384),signature:z.string().max(128),installed:z.literal(false)}).strict();
/** Startup recovery trusts neither filenames nor a previous successful receipt. */
export async function verifyStagedUpdate(root:string,stageId:string,policy:Input['policy']){
 if(!/^stage-[A-Za-z0-9]+$/.test(stageId))throw new Error('Invalid update stage');
 const stage=join(root,stageId);
 for(const path of [root,stage]){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error('Private update stage required');}
 const receiptFile=await open(join(stage,'receipt.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
 let receipt;
 try{
  const stat=await receiptFile.stat();if(!stat.isFile()||stat.size>100000||(stat.mode&0o077)!==0)throw new Error('Unsafe update receipt');
  const buffer=Buffer.alloc(100001),{bytesRead}=await receiptFile.read(buffer,0,buffer.length,0);if(bytesRead>100000)throw new Error('Oversized update receipt');
  receipt=receiptSchema.parse(JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')));
 }finally{await receiptFile.close();}
 const bytes=Buffer.from(receipt.manifestBase64,'base64');if(bytes.toString('base64')!==receipt.manifestBase64)throw new Error('Invalid saved manifest');
 const manifest=verifyUpdateManifest(bytes,receipt.signature,policy);if(receipt.version!==manifest.version)throw new Error('Mismatched update receipt');
 const artifactPath=join(stage,'artifact.bin'),artifact=await open(artifactPath,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await artifact.stat();if(!stat.isFile()||stat.size!==manifest.artifact.bytes||(stat.mode&0o077)!==0)throw new Error('Unsafe staged artifact');
  async function* chunks(){const buffer=Buffer.alloc(65536);for(;;){const {bytesRead}=await artifact.read(buffer,0,buffer.length,null);if(!bytesRead)break;yield buffer.subarray(0,bytesRead);}}
  await verifyUpdateBytes(chunks(),manifest.artifact);
 }finally{await artifact.close();}
 return {stageId,artifactPath,version:manifest.version,installed:false as const};
}
