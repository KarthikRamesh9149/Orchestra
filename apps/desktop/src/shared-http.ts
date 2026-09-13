import {z} from 'zod';
import {assertSharedCompatibility,sharedConnectionSchema} from '../../../src/desktop/shared-contract.js';
import {isLocalRoute} from './local-http.js';
import {createHash} from 'node:crypto';
import {SharedReadCache} from './shared-cache.js';
import {isNativeTransferRoute} from '../../../src/desktop/transfer-contract.js';

export const sharedGrantSchema=z.object({accessToken:z.string().min(1).max(16384),refreshToken:z.string().min(1).max(16384)}).strict();
export type SharedGrant=z.infer<typeof sharedGrantSchema>;
export const savedConnectionSchema=sharedConnectionSchema.extend({serverId:z.string().uuid()});
export type SavedConnection=z.infer<typeof savedConnectionSchema>;
type GrantStore={read():Promise<SharedGrant|null>;write(value:SharedGrant|null):Promise<void>};
type Network=(url:string,init:RequestInit)=>Promise<Response>;
class SharedNetworkUnavailable extends Error{}
type CacheEvents={invalidateView():void;onOffline(value:boolean):void};
const failure=(status:number,code:string,message:string)=>Response.json({data:null,error:{code,message}},{status,headers:{'cache-control':'no-store'}});
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const loginPaths=new Set(['/v1/auth/login','/v1/auth/signup','/v1/auth/invitations/redeem','/v1/auth/join-workspace']);
const publicPosts=new Set([...loginPaths,'/v1/auth/email-verification/confirm']);
const authorityPaths=new Set([...loginPaths,'/v1/auth/refresh','/v1/auth/logout','/v1/me/workspaces/switch','/v1/me/sessions/revoke-all']);
const authPosts=new Set([...publicPosts,'/v1/auth/bootstrap','/v1/auth/refresh','/v1/auth/logout','/v1/auth/email-verification/request','/v1/auth/password/change']);
const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// Deliberately no generic URL proxy, OAuth callbacks, native ingestion or token administration.
export function isSharedRoute(method:string,path:string){
 if(path.includes('\\'))return false;
 if(path.includes('%')){
  // The UI encodes the colon in typed Inbox IDs. Permit only that reviewed
  // segment; never encoded separators, authority routes or double encoding.
  const encoded=path.split('/').filter(part=>part.includes('%'));
  if(encoded.length!==1||! /^(suggestion|proposal|fde|agent_drift|connector):[A-Za-z0-9_.:-]{1,280}$/.test(encoded[0]!.replace(/%3a/gi,':')))return false;
  return isLocalRoute(method,path);
 }
 if(/^\/v1\/mcp\/tokens(?:\/|$)/.test(path))return false;
 if(isLocalRoute(method,path))return true;
 if(method==='POST'&&authPosts.has(path))return true;
 if(method==='GET'&&['/v1/auth/csrf','/v1/auth/me','/v1/me/workspaces','/v1/me/sessions'].includes(path))return true;
 if(method==='POST'&&['/v1/me/workspaces/switch','/v1/me/sessions/revoke-all','/v1/me/web-vitals'].includes(path))return true;
 if(method==='DELETE'&&new RegExp(`^/v1/me/sessions/${uuid}$`).test(path))return true;
 // Shared provider setup is server-authorized. Local native provider routes
 // intentionally omit these; never widen local mode or forward OAuth callbacks.
 if(method==='GET'&&['/v1/github/install-url','/v1/github/installations'].includes(path))return true;
 if(method==='GET'&&new RegExp(`^/v1/github/installations/${uuid}/repositories$`).test(path))return true;
 if(method==='GET'&&new RegExp(`^/v1/projects/${uuid}/github(?:/status)?$`).test(path))return true;
 if(method==='POST'&&new RegExp(`^/v1/projects/${uuid}/github/(?:backfill|repositories/link|repositories/${uuid}/archive)$`).test(path))return true;
 if(method==='POST'&&new RegExp(`^/v1/projects/${uuid}/connectors/(?:slack|gmail|google-drive)/connect$`).test(path))return true;
 if(method==='POST'&&new RegExp(`^/v1/projects/${uuid}/connectors/(?:${uuid}/(?:sync|revoke)|google-drive/(?:sync|disconnect))$`).test(path))return true;
 if(method==='GET'&&new RegExp(`^/v1/projects/${uuid}/connectors/google-drive/(?:status|files|sync-roots(?:/candidates)?)$`).test(path))return true;
 if(method==='PATCH'&&new RegExp(`^/v1/projects/${uuid}/connectors/google-drive/sync-roots$`).test(path))return true;
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
 const result=await network(safe+'/v1/desktop/manifest',{method:'GET',headers:{accept:'application/json'},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000)}).catch(()=>{throw new SharedNetworkUnavailable();});
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
 private offline=false;
 private readonly cache:SharedReadCache;
 private readonly connection:SavedConnection;
 constructor(connection:SavedConnection,private readonly grants:GrantStore,private readonly network:Network=fetch,private readonly cacheEvents?:CacheEvents){
  this.connection=savedConnectionSchema.parse(connection);
  this.cache=new SharedReadCache(()=>{this.offline=false;this.cacheEvents?.onOffline(false);if(!this.closed)this.cacheEvents?.invalidateView();});
 }
 close(){this.closed=true;this.generation++;this.requests.abort();this.cache.close();}
 revalidate(){this.generation++;this.requests.abort();this.requests=new AbortController();this.handshake=undefined;this.cache.clear();}
 private async ready(){
  if(this.closed)throw new Error('Shared window closed');
  if(!this.handshake)this.handshake=inspectSharedServer(this.connection.origin,this.network).then(value=>{
   const manifest=assertSharedCompatibility(value,this.connection.serverId);
   this.cache.configure(this.cacheEvents?manifest.offlineCache:{enabled:false});return manifest;
  }).catch(error=>{this.handshake=undefined;throw error;});
  await this.handshake;
 }
 private async send(path:string,method:string,body:Uint8Array|string|undefined,source:Request,grant:SharedGrant|null,signal:AbortSignal){
  const headers=new Headers({accept:source.headers.get('accept')??'application/json','user-agent':'Orchestra-Desktop/1'});
  for(const name of ['content-type','x-idempotency-key']){const value=source.headers.get(name);if(value)headers.set(name,value);}
  if(grant)headers.set('authorization','Bearer '+grant.accessToken);
  return this.network(this.connection.origin+path,{method,headers,body:body as RequestInit['body'],credentials:'omit',redirect:'error',signal:AbortSignal.any([source.signal,signal,AbortSignal.timeout(180000)])}).catch(()=>{throw new SharedNetworkUnavailable();});
 }
 async handle(request:Request,nativeTransfer=false):Promise<Response>{
  const url=new URL(request.url),path=url.pathname;
  if(url.protocol!=='orchestra:'||url.host!=='app'||url.username||url.password||!(isSharedRoute(request.method,path)||(nativeTransfer&&isNativeTransferRoute(request.method,path))))return failure(403,'shared_scope_denied','This operation is outside the shared desktop contract.');
  if(path==='/v1/auth/csrf')return json({data:{csrfToken:'native-shared-no-cookie'},error:null});
  // Authority changes are serialized. They invalidate previous in-flight reads and streams.
  const authority=authorityPaths.has(path)&&request.method==='POST';
  const run=()=>this.perform(request,url,authority);
  if(!authority&&path!=='/v1/auth/bootstrap'){await this.authorityTail.catch(()=>{});return run();}
  const pending=this.authorityTail.catch(()=>{}).then(run);this.authorityTail=pending;return pending;
 }
 private async perform(request:Request,url:URL,authority:boolean):Promise<Response>{
  const startedGeneration=this.generation;
  if(this.offline&&request.method!=='GET'&&url.pathname!=='/v1/auth/bootstrap')return failure(503,'shared_offline_read_only','Cached evidence is read-only. Reconnect and reload before making changes.');
  try{
   const currentGrant=await this.grants.read();
   this.cache.bind(currentGrant?createHash('sha256').update(currentGrant.accessToken).digest('hex'):null);
   if(authority)this.cache.clear();
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
   if([401,403].includes(response.status))this.cache.clear();
   if(this.offline&&response.ok){
    // Do not mix an offline snapshot with reconnected data. Reload after live authorization.
    await response.body?.cancel();this.cache.clear();
    return failure(409,'shared_reconnected','Connection restored. Reloading authorised server data.');
   }
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
   if(response.ok&&request.method!=='GET'&&!['/v1/auth/bootstrap','/v1/me/web-vitals'].includes(path))this.cache.clear();
   const length=Number(response.headers.get('content-length'));
   if(request.method==='GET'&&response.status===200&&this.cache.canStore(path+url.search)&&response.headers.get('content-type')?.startsWith('application/json')&&length>0&&length<=1024*1024){
    const bytes=await boundedBody(response.body,1024*1024);
    if(this.closed||generation!==this.generation)return failure(409,'shared_session_changed','Session changed. Reload the current view.');
    const text=new TextDecoder().decode(bytes);this.cache.put(path+url.search,text);
    return new Response(text,{status:200,headers});
   }
   return new Response(response.body,{status:response.status,headers});
  }catch(error){
   this.handshake=undefined;
   if(error instanceof SharedNetworkUnavailable&&!this.closed&&!request.signal.aborted&&startedGeneration===this.generation&&request.method==='GET'){
    const cached=this.cache.get(url.pathname+url.search);
    if(cached){this.offline=true;this.cacheEvents?.onOffline(true);return new Response(cached.body,{headers:{'content-type':'application/json','cache-control':'no-store','x-orchestra-offline':'read-only'}});}
   }else if(!(error instanceof SharedNetworkUnavailable))this.cache.clear();
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
