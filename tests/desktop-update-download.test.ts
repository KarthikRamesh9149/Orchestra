import {it,expect} from 'vitest';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,symlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageVerifiedUpdate,verifyStagedUpdate} from '../apps/desktop/src/update-download.js';
import {createServer,request} from 'node:https';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {Readable} from 'node:stream';
import {writeFile,stat} from 'node:fs/promises';
const keys=generateKeyPairSync('ed25519'),payload=Buffer.from('synthetic non-executable update bytes');
const now=Date.now();
const manifest=Buffer.from(JSON.stringify({formatVersion:1,channel:'beta',version:'0.0.5',platform:'darwin-arm64',issuedAt:now-1000,expiresAt:now+60000,schema:{min:83,max:83},artifact:{url:'https://updates.example.test/app.zip',bytes:payload.length,sha256:createHash('sha256').update(payload).digest('hex')}}));
const signature=sign(null,manifest,keys.privateKey).toString('base64');
const policy={publicKey:keys.publicKey,origin:'https://updates.example.test',channel:'beta',currentVersion:'0.0.4',schemaVersion:83,now};
async function fixture(run:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'orchestra-update-test-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}
it('stages exact signed bytes privately without installing or executing',()=>fixture(async root=>{
 const result=await stageVerifiedUpdate({root,manifest,signature,policy},async(url,init)=>{expect(url).toBe('https://updates.example.test/app.zip');expect(init?.redirect).toBe('error');expect(init?.credentials).toBe('omit');return new Response(payload);});
 expect(await readFile(result.artifactPath)).toEqual(payload);
 expect(JSON.parse(await readFile(result.receiptPath,'utf8')).version).toBe('0.0.5');
 expect(result.installed).toBe(false);
}));
for(const [name,response] of Object.entries({tampered:()=>new Response(Buffer.alloc(payload.length)),truncated:()=>new Response(payload.subarray(0,3)),oversized:()=>new Response(Buffer.concat([payload,payload])),redirect:()=>new Response(null,{status:302}),httpFailure:()=>new Response(null,{status:503})})){
 it(`rejects ${name} and removes only its partial stage`,()=>fixture(async root=>{
  await expect(stageVerifiedUpdate({root,manifest,signature,policy},async()=>response())).rejects.toThrow();expect(await readdir(root)).toEqual([]);
 }));
}
it('does not access the network for invalid signatures or pre-cancellation',()=>fixture(async root=>{
 let called=false;const network=async()=>{called=true;return new Response(payload);};
 await expect(stageVerifiedUpdate({root,manifest,signature:'invalid',policy},network)).rejects.toThrow();
 const abort=new AbortController();abort.abort();await expect(stageVerifiedUpdate({root,manifest,signature,policy,signal:abort.signal},network)).rejects.toThrow();expect(called).toBe(false);
}));
it('rejects symlink and non-private staging roots',()=>fixture(async root=>{
 const link=join(root,'link');await symlink(root,link);
 await expect(stageVerifiedUpdate({root:link,manifest,signature,policy},async()=>new Response(payload))).rejects.toThrow();
 await chmod(root,0o755);await expect(stageVerifiedUpdate({root,manifest,signature,policy},async()=>new Response(payload))).rejects.toThrow();
}));
it('preserves a completed stage when a later attempt fails',()=>fixture(async root=>{
 const first=await stageVerifiedUpdate({root,manifest,signature,policy},async()=>new Response(payload));
 await expect(stageVerifiedUpdate({root,manifest,signature,policy},async()=>{throw Error('offline');})).rejects.toThrow();
 expect(await readFile(first.artifactPath)).toEqual(payload);expect(await readdir(root)).toHaveLength(1);
}));
it('reverifies persisted bytes after restart and rejects altered artifacts or partial stages',()=>fixture(async root=>{
 const staged=await stageVerifiedUpdate({root,manifest,signature,policy},async()=>new Response(payload));
 expect((await verifyStagedUpdate(root,staged.stageId,policy)).version).toBe('0.0.5');
 await writeFile(staged.artifactPath,Buffer.alloc(payload.length));
 await expect(verifyStagedUpdate(root,staged.stageId,policy)).rejects.toThrow();
 await expect(verifyStagedUpdate(root,'../elsewhere',policy)).rejects.toThrow();
 await expect(verifyStagedUpdate(root,'stage-missing',policy)).rejects.toThrow();
}));
it('cancels a partially received stream without leaving a ready artifact',()=>fixture(async root=>{
 const abort=new AbortController();
 await expect(stageVerifiedUpdate({root,manifest,signature,policy,signal:abort.signal},async()=>new Response(new ReadableStream({start(controller){controller.enqueue(payload.subarray(0,4));setTimeout(()=>abort.abort(),10);}})))).rejects.toThrow();
 expect(await readdir(root)).toEqual([]);
}));
it('downloads signed fixture bytes over real TLS with a scoped test CA',()=>fixture(async root=>{
 const key=join(root,'test-key.pem'),cert=join(root,'test-cert.pem');
 execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const ca=await readFile(cert),server=createServer({key:await readFile(key),cert:ca},(_req,res)=>{res.writeHead(200,{'content-length':String(payload.length)});res.end(payload);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('No test port');
  const origin=`https://127.0.0.1:${address.port}`,value=JSON.parse(manifest.toString());value.artifact.url=origin+'/fixture.zip';
  const bytes=Buffer.from(JSON.stringify(value)),sig=sign(null,bytes,keys.privateKey).toString('base64');
  const result=await stageVerifiedUpdate({root:join(root,'staging'),manifest:bytes,signature:sig,policy:{...policy,origin}},(url,init)=>new Promise((resolve,reject)=>{
   const req=request(url,{ca,method:'GET',signal:init.signal??undefined},res=>resolve(new Response(Readable.toWeb(res) as ReadableStream,{status:res.statusCode,headers:{'content-length':String(res.headers['content-length'])}})));req.on('error',reject);req.end();
  }));
  expect(await readFile(result.artifactPath)).toEqual(payload);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}));
it('rejects an actual killed downloader partial stage and preserves it during a fresh retry',()=>fixture(async root=>{
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`
  import {stageVerifiedUpdate} from './apps/desktop/src/update-download.ts';
  import {createPublicKey} from 'node:crypto';
  const value=JSON.parse(process.argv[2]);value.policy.publicKey=createPublicKey(value.policy.publicKey);value.root=process.argv[1];value.manifest=Buffer.from(value.manifest,'base64');
  const keep=setInterval(()=>{},1000);
  await stageVerifiedUpdate(value,async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));process.send('stream-started');}})));
  clearInterval(keep);
 `,root,JSON.stringify({manifest:manifest.toString('base64'),signature,policy:{...policy,publicKey:keys.publicKey.export({type:'spki',format:'pem'})}})],{stdio:['ignore','ignore','ignore','ipc']});
 try{
  await once(child,'message');let stage='';
  for(let n=0;n<100;n++){stage=(await readdir(root))[0]??'';if(stage&&(await stat(join(root,stage,'artifact.partial')).catch(()=>null))?.size===3)break;await new Promise(r=>setTimeout(r,10));}
  expect((await stat(join(root,stage,'artifact.partial'))).size).toBe(3);
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  await expect(verifyStagedUpdate(root,stage,policy)).rejects.toThrow();
  const retry=await stageVerifiedUpdate({root,manifest,signature,policy},async()=>new Response(payload));expect(await readFile(retry.artifactPath)).toEqual(payload);
  expect(await readdir(root)).toHaveLength(2);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
}));
