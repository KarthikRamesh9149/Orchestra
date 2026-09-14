import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

export const SLACK_CALLBACK_SCHEME='orchestra-desktop';
export const SLACK_NATIVE_REDIRECT='orchestra-desktop://oauth/slack/callback';

/** Main-process only. Unsolicited launches never create or restore authorization. */
export class SlackNativeCallback {
 private receive:((url:string)=>boolean)|undefined;
 begin(signal?:AbortSignal,timeoutMs=180000){
  if(this.receive)throw new Error('Slack authorization already pending');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>180000)throw new Error('Invalid callback deadline');
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  let resolve!:(value:string)=>void,reject!:(error:Error)=>void;
  const code=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});void code.catch(()=>{});
  let settled=false;
  const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);this.receive=undefined;};
  const cancel=()=>{if(settled)return;settled=true;clean();reject(new Error('Slack authorization cancelled or expired'));};
  const timer=setTimeout(cancel,timeoutMs);timer.unref();
  this.receive=(raw:string)=>{
   if(settled||raw.length>4096)return false;
   let url:URL;try{url=new URL(raw);}catch{return false;}
   if(url.protocol!==`${SLACK_CALLBACK_SCHEME}:`||url.hostname!=='oauth'||url.pathname!=='/slack/callback'||url.port||url.username||url.password||url.hash)return false;
   const received=Buffer.from(url.searchParams.get('state')??''),expected=Buffer.from(state);
   if(url.searchParams.getAll('state').length!==1||received.length!==expected.length||!timingSafeEqual(received,expected))return false;
   const value=url.searchParams.get('code');
   if(url.searchParams.has('error')){
    if(url.searchParams.getAll('error').length!==1||url.searchParams.has('code'))return false;
    settled=true;clean();reject(new Error('Slack authorization declined'));return true;
   }
   if(url.searchParams.getAll('code').length!==1||!value||value.length>2048||!/^[\x21-\x7e]+$/.test(value))return false;
   settled=true;clean();resolve(value);return true;
  };
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  return {redirectUri:SLACK_NATIVE_REDIRECT,state,verifier,challenge,code,cancel};
 }
 accept(url:string){return this.receive?.(url)??false;}
}
export const slackNativeCallback=new SlackNativeCallback();
