import {createServer,type Socket} from 'node:net';
import {chmod,lstat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {mcpJsonRpcRequestSchema} from '../modules/mcp/schemas.js';
import {AppError} from '../app/errors.js';
const envelope=z.object({token:z.string().regex(/^mcp_[A-Za-z0-9_-]{43}$/),request:mcpJsonRpcRequestSchema}).strict();
const maxBytes=1024*1024;
/** Private Unix socket; no TCP port or installation-wide HTTP credential is
 * given to agent clients. Every RPC still authenticates its scoped MCP token. */
export async function startMcpSocket(root:string,handle:(authorization:string,request:z.infer<typeof mcpJsonRpcRequestSchema>)=>Promise<unknown>){
 const directory=await lstat(root);
 if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o077)!==0)throw new Error('Private MCP directory required');
 const path=join(root,'mcp.sock');if(Buffer.byteLength(path)>100)throw new Error('MCP socket path exceeds supported length');
 try{const old=await lstat(path);if(!old.isSocket())throw new Error('Unexpected MCP socket path');await unlink(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const clients=new Set<Socket>();
 const server=createServer(socket=>{
  if(clients.size>=8){socket.destroy();return;}clients.add(socket);socket.on('close',()=>clients.delete(socket));socket.on('error',()=>{});socket.setTimeout(15000,()=>socket.destroy());
  let buffer=Buffer.alloc(0),processing=false;
  socket.on('data',chunk=>{
   if(processing){socket.destroy();return;}
   if(buffer.length+chunk.length>maxBytes){socket.destroy();return;}buffer=Buffer.concat([buffer,chunk]);
   const newline=buffer.indexOf(10);if(newline<0)return;processing=true;socket.pause();
   if(newline!==buffer.length-1){socket.destroy();return;}
   void(async()=>{
    let id:unknown=null;
    try{
     const input=envelope.parse(JSON.parse(buffer.subarray(0,newline).toString('utf8')));id=input.request.id??null;
     const result=await handle(`Bearer ${input.token}`,input.request);
     const reply=input.request.id===undefined?{notification:true}:{response:result};
     const encoded=JSON.stringify(reply);if(Buffer.byteLength(encoded)>4*maxBytes)throw new Error('MCP response too large');socket.end(encoded+'\n');
    }catch(error){socket.end(JSON.stringify({response:{jsonrpc:'2.0',id,error:{code:-32000,message:error instanceof AppError?error.message:'MCP request rejected'}}})+'\n');}
   })();
  });
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,()=>{server.off('error',reject);resolve();});});
 await chmod(path,0o600);const identity=await lstat(path);
 return {async close(){for(const socket of clients)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));try{const current=await lstat(path);if(current.isSocket()&&current.ino===identity.ino)await unlink(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}};
}
