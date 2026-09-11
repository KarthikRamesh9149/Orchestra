import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

/** Native main only. No renderer-supplied destinations, codes or verifier. */
export async function startOAuthCallback(input:{port:number;signal?:AbortSignal;timeoutMs?:number}){
 if(!Number.isInteger(input.port)||input.port<0||input.port>65535)throw new Error('Invalid callback port');
 const timeoutMs=input.timeoutMs??180000;
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>180000)throw new Error('Invalid callback deadline');
 const state=randomBytes(32).toString('base64url');
 const verifier=randomBytes(32).toString('base64url');
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 let settled=false;
 let complete!:(code:string)=>void,fail!:(error:Error)=>void;
 const code=new Promise<string>((resolve,reject)=>{complete=resolve;fail=reject;});
 // Cancellation may happen before the caller starts awaiting the code.
 void code.catch(()=>{});
 let timer:NodeJS.Timeout|undefined;
 let expectedHost='';
 const close=()=>{clearTimeout(timer);input.signal?.removeEventListener('abort',abort);server.close();server.closeAllConnections();};
 const abort=()=>{if(settled)return;settled=true;fail(new Error('OAuth cancelled or expired'));close();};
 const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','text/plain; charset=utf-8');
  const reject=(status:number)=>{res.writeHead(status);res.end('Invalid authorization callback.');};
  if(settled||req.method!=='GET'||req.headers.host!==expectedHost||!req.url||req.url.length>4096)return reject(400);
  let url:URL;try{url=new URL(req.url,`http://${expectedHost}`);}catch{return reject(400);}
  if(url.origin!==`http://${expectedHost}`||url.pathname!=='/oauth/slack/callback')return reject(404);
  const received=Buffer.from(url.searchParams.get('state')??'');const expected=Buffer.from(state);
  if(url.searchParams.getAll('state').length!==1||received.length!==expected.length||!timingSafeEqual(received,expected))return reject(400);
  const value=url.searchParams.get('code');
  if(url.searchParams.has('error')){
   settled=true;res.end('Authorization was declined. Return to Orchestra.');fail(new Error('OAuth declined'));res.on('finish',close);return;
  }
  if(url.searchParams.getAll('code').length!==1||!value||value.length>2048||!/^[\x21-\x7e]+$/.test(value))return reject(400);
  settled=true;res.end('Authorization received. Return to Orchestra to check connection status.');
  complete(value);res.on('finish',close);
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.maxConnections=8;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(input.port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string'){close();throw new Error('Callback unavailable');}
 // Slack treats localhost redirects as public-client redirects with PKCE.
 expectedHost=`localhost:${address.port}`;
 server.on('error',abort);timer=setTimeout(abort,timeoutMs);timer.unref();
 input.signal?.addEventListener('abort',abort,{once:true});if(input.signal?.aborted)abort();
 return {redirectUri:`http://${expectedHost}/oauth/slack/callback`,state,verifier,challenge,code,cancel:abort};
}
