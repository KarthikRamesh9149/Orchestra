import {app,safeStorage} from 'electron';
import {connect} from 'node:net';
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {ProtectedSettingsStore} from './protected-settings.js';
import {authorizePairedRpc,pairedRpcSchema} from './mcp-relay-policy.js';
const limit=1024*1024;
export async function runMcpRelay(pairingId:string){
 try{
  z.string().uuid().parse(pairingId);await app.whenReady();
  const root=join(app.getPath('userData'),'local-runtime');
  const store=new ProtectedSettingsStore(root,safeStorage);
  let input=Buffer.alloc(0),pending=Promise.resolve(),queued=0;
  async function request(line:Buffer){
   let id:unknown=null,replyRequired=true;
   try{
    const rpc=pairedRpcSchema.parse(JSON.parse(line.toString('utf8')));id=rpc.id??null;replyRequired=rpc.id!==undefined;
    const pairing=(await store.read()).mcp?.find(value=>value.id===pairingId);
    if(!pairing||Date.parse(pairing.expiresAt)<=Date.now())throw new Error('Pairing unavailable');
    // The stdio capability is tied to the selected Preflight, not arbitrary
    // renderer-supplied data or another project's context.
    authorizePairedRpc(rpc,pairing);
    const path=join(root,'mcp.sock'),stat=await lstat(path);
    if(!stat.isSocket()||(stat.mode&0o077)!==0)throw new Error('Private runtime unavailable');
    const reply=await new Promise<string>((resolve,reject)=>{
     const socket=connect(path);let data=Buffer.alloc(0);socket.setTimeout(15000,()=>{socket.destroy();reject(new Error('Runtime timeout'));});
     socket.on('connect',()=>socket.write(JSON.stringify({token:pairing.token,request:rpc})+'\n'));
     socket.on('error',()=>reject(new Error('Runtime unavailable')));
     socket.on('data',chunk=>{if(data.length+chunk.length>4*limit){socket.destroy();reject(new Error('Response too large'));return;}data=Buffer.concat([data,chunk]);});
     socket.on('end',()=>resolve(data.toString('utf8')));
    });
    const result=JSON.parse(reply);if(rpc.id!==undefined&&result.response)process.stdout.write(JSON.stringify(result.response)+'\n');
   }catch{if(replyRequired)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code:-32000,message:'Orchestra pairing or local runtime unavailable. Open Orchestra and check this pairing.'}})+'\n');}
  }
  process.stdin.on('data',chunk=>{
   if(input.length+chunk.length>limit||queued>=8){app.exit(1);return;}input=Buffer.concat([input,chunk]);
   let newline;while((newline=input.indexOf(10))>=0){const line=input.subarray(0,newline);input=input.subarray(newline+1);if(!line.length)continue;if(++queued>8){app.exit(1);return;}pending=pending.then(()=>request(line)).finally(()=>{queued--;});}
  });
  process.stdin.on('end',()=>{void pending.finally(()=>app.exit(0));});process.stdin.resume();
 }catch{process.stderr.write('Orchestra MCP pairing unavailable.\n');app.exit(1);}
}
