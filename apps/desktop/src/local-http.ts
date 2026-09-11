import routes from '../../../src/desktop/local-routes.json' with {type:'json'};
import type {HostClient} from './host-client.js';
import {z} from 'zod';
const uuid=/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const patterns=routes.map(route=>({method:route.method,segments:route.path.split('/')}));
function validParameter(key:string,value:string){
 if(value.includes('%')||value.includes('\\')||value.includes('\0'))return false;
 if(key===':itemId')return /^(suggestion|proposal|fde|agent_drift|connector):[A-Za-z0-9_.:-]{1,280}$/.test(value);
 if(key===':filePath')return value.length<=1024&&!value.startsWith('/')&&value.split('/').every(part=>part!=='.'&&part!=='..'&&/^[A-Za-z0-9_. -]+$/.test(part));
 if([':sectionKey',':anchorId',':action'].includes(key))return /^[A-Za-z0-9_ .:-]{1,200}$/.test(value)&&value!=='.'&&value!=='..';
 return uuid.test(value);
}
export function isLocalRoute(method:string,path:string){
 let segments:string[];try{segments=path.split('/').map(decodeURIComponent);}catch{return false;}
 return patterns.some(route=>route.method===method&&route.segments.length===segments.length&&route.segments.every((segment,index)=>segment.startsWith(':')?validParameter(segment,segments[index]!):segment===segments[index]));
}
const failure=(status:number,code:string,message:string)=>Response.json({data:null,error:{code,message}},{status});
export async function localHttp(request:Request,host:HostClient,nativeCredentials=false):Promise<Response>{
 const url=new URL(request.url);
 if(url.protocol!=='orchestra:'||url.host!=='app'||url.username||url.password)return failure(403,'invalid_origin','Invalid application origin');
 let decodedPath:string;try{decodedPath=decodeURIComponent(url.pathname);}catch{return failure(403,'invalid_path','Invalid application path');}
 if(/^\/v1\/mcp\/tokens(?:\/|$)/.test(decodedPath)&&!nativeCredentials)return failure(403,'native_pairing_required','Use the native scoped MCP pairing control.');
 if(url.pathname==='/v1/auth/csrf'&&request.method==='GET')return Response.json({data:{csrfToken:'native-transport-no-browser-cookie'},error:null});
 const special=url.pathname==='/v1/auth/bootstrap'||url.pathname==='/v1/auth/me'||url.pathname==='/v1/me/workspaces'||url.pathname==='/v1/me/workspaces/switch';
 if(special){
  const method=url.pathname.endsWith('/bootstrap')||url.pathname.endsWith('/switch')?'POST':'GET';if(request.method!==method)return failure(405,'method_not_allowed','Unsupported operation');
  let command:Parameters<HostClient['request']>[0]={operation:'local.bootstrap'};
  if(url.pathname.endsWith('/switch')){let input:unknown;try{input=await request.json();}catch{return failure(400,'invalid_project','Select a workspace');}const parsed=z.object({projectId:z.string().uuid()}).strict().safeParse(input);if(!parsed.success)return failure(400,'invalid_project','Select a workspace');command={operation:'workspace.select',projectId:parsed.data.projectId};}
  const result=await host.request(command);if(!result.ok)return failure(503,result.error.code,result.error.message);
  const data=result.data as {user:unknown;workspaces:unknown[]};
  return Response.json({data:url.pathname==='/v1/auth/me'?data.user:url.pathname==='/v1/me/workspaces'?data.workspaces:data,error:null});
 }
 const nativePairingRoute=nativeCredentials&&request.method==='POST'&&(url.pathname==='/v1/mcp/tokens'||/^\/v1\/mcp\/tokens\/[0-9a-fA-F-]{36}\/revoke$/.test(url.pathname));
 if(!nativePairingRoute&&!isLocalRoute(request.method,url.pathname))return failure(403,'desktop_scope_unavailable','This action requires a shared workspace or a provider configured in a later desktop step.');
 const authority=host.credentials();if(!authority)return failure(503,'runtime_unavailable','The local engine is starting or unavailable.');
 const headers=new Headers({'Authorization':'Bearer '+authority.bearer,'X-Orchestra-Local-Token':authority.token});
 for(const name of ['content-type','x-idempotency-key','accept']){const value=request.headers.get(name);if(value)headers.set(name,value);}
 let body:Uint8Array|undefined;
 if(request.body){const chunks:Uint8Array[]=[];let size=0;const reader=request.body.getReader();for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>55*1024*1024){await reader.cancel();return failure(413,'upload_too_large','Maximum upload size exceeded');}chunks.push(value);}body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}}
 try{
  const response=await fetch(`http://127.0.0.1:${authority.port}${url.pathname}${url.search}`,{method:request.method,headers,body:body as NonNullable<Parameters<typeof fetch>[1]>['body'],redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(180000)])});
  const outgoing=new Headers();for(const name of ['content-type','content-disposition','cache-control','retry-after']){const value=response.headers.get(name);if(value)outgoing.set(name,value);}
  // Preserve the real response stream and backend status; never forward cookies.
  return new Response(response.body,{status:response.status,headers:outgoing});
 }catch{return failure(503,'local_request_failed','The local request failed or was cancelled. Check its saved state before retrying.');}
}
