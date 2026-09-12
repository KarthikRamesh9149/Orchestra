import {z} from 'zod';
import {assertSharedCompatibility,sharedConnectionSchema} from '../../../src/desktop/shared-contract.js';
import {isLocalRoute} from './local-http.js';

export const sharedGrantSchema=z.object({accessToken:z.string().min(1).max(16384),refreshToken:z.string().min(1).max(16384)}).strict();
export type SharedGrant=z.infer<typeof sharedGrantSchema>;
export const savedConnectionSchema=sharedConnectionSchema.extend({serverId:z.string().uuid()});
export type SavedConnection=z.infer<typeof savedConnectionSchema>;
type GrantStore={read():Promise<SharedGrant|null>;write(value:SharedGrant|null):Promise<void>};
type Network=(url:string,init:RequestInit)=>Promise<Response>;
const failure=(status:number,code:string,message:string)=>Response.json({data:null,error:{code,message}},{status,headers:{'cache-control':'no-store'}});
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const loginPaths=new Set(['/v1/auth/login','/v1/auth/signup','/v1/auth/invitations/redeem','/v1/auth/join-workspace']);
const publicPosts=new Set([...loginPaths,'/v1/auth/email-verification/confirm']);
const authorityPaths=new Set([...loginPaths,'/v1/auth/refresh','/v1/auth/logout','/v1/me/workspaces/switch','/v1/me/sessions/revoke-all']);
const authPosts=new Set([...publicPosts,'/v1/auth/bootstrap','/v1/auth/refresh','/v1/auth/logout','/v1/auth/email-verification/request','/v1/auth/password/change']);
const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// Deliberately no generic URL proxy, OAuth callbacks, native ingestion or token administration.
export function isSharedRoute(method:string,path:string){
 if(path.includes('%')||path.includes('\\'))return false;
 if(/^\/v1\/mcp\/tokens(?:\/|$)/.test(path))return false;
 if(isLocalRoute(method,path))return true;
 if(method==='POST'&&authPosts.has(path))return true;
 if(method==='GET'&&['/v1/auth/csrf','/v1/auth/me','/v1/me/workspaces','/v1/me/sessions'].includes(path))return true;
 if(method==='POST'&&['/v1/me/workspaces/switch','/v1/me/sessions/revoke-all','/v1/me/web-vitals'].includes(path))return true;
 if(method==='DELETE'&&new RegExp(`^/v1/me/sessions/${uuid}$`).test(path))return true;
 if(new RegExp(`^/v1/projects/${uuid}/members(?:/${uuid})?$`).test(path))return ['GET','POST','PATCH','DELETE'].includes(method);
 if(new RegExp(`^/v1/projects/${uuid}/join-codes(?:/${uuid}/revoke)?$`).test(path))return ['GET','POST'].includes(method);
 if(new RegExp(`^/v1/projects/${uuid}/truth-approvers(?:/${uuid})?$`).test(path))return ['GET','POST','DELETE'].includes(method);
 return false;
}
async function boundedBody(body:ReadableStream<Uint8Array>|null,max:number){
 if(!body)return new Uint8Array();
 const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new Error('Body limit');chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const result=new Uint8Array(size);let at=0;for(const part of chunks){result.set(part,at);at+=part.length;}return result;
}
async function responseJson(response:Response){return JSON.parse(new TextDecoder().decode(await boundedBody(response.body,1024*1024))) as Record<string,unknown>;}

export async function inspectSharedServer(origin:string,network:Network=fetch){
 const safe=sharedConnectionSchema.shape.origin.parse(origin);
 const result=await network(safe+'/v1/desktop/manifest',{method:'GET',headers:{accept:'application/json'},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000)});
 if(!result.ok)throw new Error('Server compatibility could not be confirmed');
 return assertSharedCompatibility((await responseJson(result)).data);
}

/** One instance per native shared window. Grants never leave Electron main. */
export class SharedHttp{
 private handshake:Promise<unknown>|undefined;
 private authorityTail:Promise<unknown>=Promise.resolve();
 private generation=0;
 private requests=new AbortController();
 private closed=false;
 private readonly connection:SavedConnection;
 constructor(connection:SavedConnection,private readonly grants:GrantStore,private readonly network:Network=fetch){this.connection=savedConnectionSchema.parse(connection);}
 close(){this.closed=true;this.generation++;this.requests.abort();}
 private async ready(){
  if(this.closed)throw new Error('Shared window closed');
  if(!this.handshake)this.handshake=inspectSharedServer(this.connection.origin,this.network).then(value=>assertSharedCompatibility(value,this.connection.serverId)).catch(error=>{this.handshake=undefined;throw error;});
  await this.handshake;
 }
 private async send(path:string,method:string,body:Uint8Array|string|undefined,source:Request,grant:SharedGrant|null,signal:AbortSignal){
  const headers=new Headers({accept:source.headers.get('accept')??'application/json','user-agent':'Orchestra-Desktop/1'});
  for(const name of ['content-type','x-idempotency-key']){const value=source.headers.get(name);if(value)headers.set(name,value);}
  if(grant)headers.set('authorization','Bearer '+grant.accessToken);
  return this.network(this.connection.origin+path,{method,headers,body:body as RequestInit['body'],credentials:'omit',redirect:'error',signal:AbortSignal.any([source.signal,signal,AbortSignal.timeout(180000)])});
 }
 async handle(request:Request):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  if(url.protocol!=='orchestra:'||url.host!=='app'||url.username||url.password||!isSharedRoute(request.method,path))return failure(403,'shared_scope_denied','This operation is outside the shared desktop contract.');
  if(path==='/v1/auth/csrf')return json({data:{csrfToken:'native-shared-no-cookie'},error:null});
  // Authority changes are serialized. They invalidate previous in-flight reads and streams.
  const authority=authorityPaths.has(path)&&request.method==='POST';
  const run=()=>this.perform(request,url,authority);
  if(!authority&&path!=='/v1/auth/bootstrap'){await this.authorityTail.catch(()=>{});return run();}
  const pending=this.authorityTail.catch(()=>{}).then(run);this.authorityTail=pending;return pending;
 }
 private async perform(request:Request,url:URL,authority:boolean):Promise<Response>{
  try{
   await this.ready();
   if(authority){this.generation++;this.requests.abort();this.requests=new AbortController();}
   const generation=this.generation,signal=this.requests.signal,path=url.pathname;
   let grant=await this.grants.read();
   if(!grant&&!publicPosts.has(path))return failure(401,'shared_session_required','Sign in to this team server.');
   let body:Uint8Array|string|undefined=request.body?await boundedBody(request.body,55*1024*1024):undefined;
   const revokeCurrent=path==='/v1/me/sessions/revoke-all'&&body!==undefined&&JSON.parse(new TextDecoder().decode(body as Uint8Array)).includeCurrent===true;
   if(loginPaths.has(path)){
    const value=JSON.parse(new TextDecoder().decode(body as Uint8Array));
    if(!value||typeof value!=='object'||Array.isArray(value))return failure(400,'invalid_login','Enter valid account details.');
    body=JSON.stringify({...value,sessionMode:'bearer'});grant=null;
   }
   if(path==='/v1/auth/refresh'||path==='/v1/auth/logout')body=JSON.stringify({refreshToken:grant!.refreshToken});
   const bootstrap=path==='/v1/auth/bootstrap';
   let response=await this.send(bootstrap?'/v1/desktop/session/bootstrap':path+url.search,bootstrap?'GET':request.method,bootstrap?undefined:body,request,grant,signal);
   // Retry bootstrap or an explicitly rejected logout only. Never replay a write after a network error.
   if((bootstrap||path==='/v1/auth/logout')&&response.status===401&&grant){
    await response.body?.cancel();
    const refreshed=await this.refreshForBootstrap(grant,request,signal,generation);
    if(!refreshed)return failure(401,'shared_session_expired','Sign in again to this team server.');
    response=bootstrap
     ?await this.send('/v1/desktop/session/bootstrap','GET',undefined,request,refreshed,signal)
     :await this.send('/v1/auth/logout','POST',JSON.stringify({refreshToken:refreshed.refreshToken}),request,refreshed,signal);
   }
   if(this.closed||generation!==this.generation){await response.body?.cancel();return failure(409,'shared_session_changed','Workspace or session changed. Reload the current view.');}
   if(authority){
    const payload=await responseJson(response);
    if(this.closed||generation!==this.generation)return failure(409,'shared_session_changed','Workspace or session changed. Reload the current view.');
    if(response.ok&&(loginPaths.has(path)||path==='/v1/auth/refresh'||path==='/v1/me/workspaces/switch')){
     const data=z.object({accessToken:z.string(),refreshToken:z.string()}).passthrough().parse(payload.data);
     await this.grants.write(sharedGrantSchema.parse({accessToken:data.accessToken,refreshToken:data.refreshToken}));
     const {accessToken:_a,refreshToken:_r,...publicData}=data;payload.data=publicData;
    }else if((response.ok&&(path==='/v1/auth/logout'||revokeCurrent))||(path==='/v1/auth/refresh'&&[401,403].includes(response.status)))await this.grants.write(null);
    return json(payload,response.status);
   }
   const headers=new Headers({'cache-control':'no-store'});for(const name of ['content-type','content-disposition','retry-after']){const value=response.headers.get(name);if(value)headers.set(name,value);}
   return new Response(response.body,{status:response.status,headers});
  }catch{
   this.handshake=undefined;
   return failure(503,'shared_request_failed','The team server request was not confirmed. Check the connection and saved state before retrying.');
  }
 }
 private async refreshForBootstrap(grant:SharedGrant,request:Request,signal:AbortSignal,generation:number){
  const response=await this.send('/v1/auth/refresh','POST',JSON.stringify({refreshToken:grant.refreshToken}),request,null,signal);
  if(this.closed||generation!==this.generation){await response.body?.cancel();throw new Error('Session changed');}
  if([401,403].includes(response.status)){await this.grants.write(null);await response.body?.cancel();return null;}
  if(!response.ok)throw new Error('Refresh unavailable');
  const data=z.object({accessToken:z.string(),refreshToken:z.string()}).passthrough().parse((await responseJson(response)).data);
  if(this.closed||generation!==this.generation)throw new Error('Session changed');
  const next=sharedGrantSchema.parse({accessToken:data.accessToken,refreshToken:data.refreshToken});await this.grants.write(next);return next;
 }
}
