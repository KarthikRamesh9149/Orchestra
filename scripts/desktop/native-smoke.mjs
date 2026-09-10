import {spawn} from 'node:child_process';
import {mkdtemp,readFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),bundle=join(root,'.desktop/runtime');
const data=await mkdtemp(join(root,'.desktop/native-smoke-'));
const fresh=()=>randomBytes(32).toString('hex');
const vault={version:1,admin:fresh(),runtime:fresh(),installation:{version:1,loopback:fresh(),access:fresh(),refresh:fresh(),connectorEncryption:fresh(),oauthState:fresh(),clientShare:fresh()}};
async function launch(){
 const child=spawn(join(bundle,'native/node/bin/node'),[join(bundle,'backend/dist/src/desktop/native-host.js')],{env:{PATH:'',TMPDIR:process.env.TMPDIR??'',NODE_ENV:'production'},stdio:['ignore','ignore','ignore','ipc']});
 await new Promise((ok,fail)=>{
  const timer=setTimeout(()=>fail(new Error('Readiness timeout')),180000);
  child.on('message',event=>{if(event.type==='ready'){clearTimeout(timer);child.localPort=event.port;ok();}if(event.type==='failed'){clearTimeout(timer);fail(new Error('Failed at '+event.stage));}});
  child.on('error',fail);child.on('exit',()=>{clearTimeout(timer);fail(new Error('Host exited before readiness'));});
  child.send({type:'initialize',config:{root:data,bundle,vault}});
 });
 return child;
}
async function request(child,command){const id=randomUUID();return new Promise((ok,fail)=>{
 const timer=setTimeout(()=>fail(new Error('Command timeout')),30000);
 const listener=event=>{if(event.type==='result'&&event.id===id){clearTimeout(timer);child.off('message',listener);ok(event.result);}};child.on('message',listener);child.send({type:'command',id,command});
});}
async function stop(child,disconnect=false){const stopped=once(child,'exit');if(disconnect)child.disconnect();else child.send({type:'shutdown'});await stopped;}
let child;
try{
 child=await launch();console.log('Fresh native launch passed with empty PATH');
 assert.equal((await fetch(`http://127.0.0.1:${child.localPort}/health`)).status,401);
 assert.equal((await fetch(`http://127.0.0.1:${child.localPort}/health`,{headers:{'x-orchestra-local-token':'invalid'}})).status,401);
 console.log('Loopback rejects missing and incorrect installation authority');
 const created=await request(child,{operation:'workspace.create',name:'Synthetic native lifecycle proof'});assert.equal(created.ok,true);
 const projectId=created.data.id;
 assert.equal((await request(child,{operation:'workspace.select',projectId:randomUUID()})).ok,false);
 await stop(child);child=await launch();
 const listed=await request(child,{operation:'workspace.list'});assert.equal(listed.ok,true);assert(listed.data.some(project=>project.id===projectId));
 console.log('Save, quit, reopen, authorization passed');
 await stop(child,true);child=await launch();
 assert((await request(child,{operation:'workspace.list'})).data.some(project=>project.id===projectId));
 await assert.rejects(access(join(data,'credentials/installation.json')));
 await stop(child);child=undefined;
 console.log('Parent IPC loss recovery and no plaintext engine-secret duplicate passed');
 console.log('Synthetic test data retained privately: '+data);
}finally{if(child?.connected)await stop(child);}
