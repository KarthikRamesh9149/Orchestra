import {createServer} from 'node:https';
import {request as send} from 'node:http';
import {readFile} from 'node:fs/promises';
const origin=new URL(process.env.ORCHESTRA_HTTPS_ORIGIN??'');
if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Explicit public HTTPS origin required');
const hop=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const server=createServer({key:await readFile('/run/secrets/tls_key'),cert:await readFile('/run/secrets/tls_certificate'),minVersion:'TLSv1.2',maxHeaderSize:16384},(request,response)=>{
 if(request.headers.host?.toLowerCase()!==origin.host.toLowerCase()||!request.url?.startsWith('/')||request.url.startsWith('//')||request.url.includes('\\')){response.writeHead(400);response.end('Invalid request target');return;}
 const headers={};
 for(const [name,value] of Object.entries(request.headers))if(!hop.has(name)&&!name.startsWith('x-forwarded-')&&!name.startsWith('x-orchestra-proxy-')&&name!=='forwarded')headers[name]=value;
 headers['x-forwarded-for']=request.socket.remoteAddress?.replace(/^::ffff:/,'')??'';headers['x-forwarded-proto']='https';
 const upstream=send({hostname:'web',port:4173,path:request.url,method:request.method,headers},result=>{
  if(response.destroyed){result.destroy();return;}
  const outgoing={};for(const [name,value] of Object.entries(result.headers))if(!hop.has(name))outgoing[name]=value;
  response.writeHead(result.statusCode??502,outgoing);result.pipe(response);response.on('close',()=>result.destroy());result.on('error',()=>response.destroy());
 });
 upstream.on('error',()=>{if(!response.headersSent){response.writeHead(502,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({data:null,error:{code:'shared_upstream_unavailable',message:'The team server is unavailable.'}}));}else response.destroy();});
 request.on('aborted',()=>upstream.destroy());response.on('close',()=>upstream.destroy());request.pipe(upstream);
});
server.headersTimeout=15000;server.requestTimeout=300000;server.keepAliveTimeout=5000;
server.on('clientError',(_error,socket)=>socket.destroy());server.listen(4443,'0.0.0.0');
console.log('TLS proxy listening. Request contents and credentials are not logged.');
