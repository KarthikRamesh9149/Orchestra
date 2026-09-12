import {describe,it,expect,vi} from 'vitest';
import {SharedHttp,type SharedGrant} from '../apps/desktop/src/shared-http.js';
const id='11111111-1111-4111-8111-111111111111';
const manifest={product:'orchestra',protocol:1,minClientProtocol:1,maxClientProtocol:1,serverId:id,mode:'self-hosted',capabilities:['bearer-sessions-v1'],offlineCache:{enabled:false}};
const connection={id,name:'Synthetic team',origin:'https://team.invalid',serverId:id};
function setup(initial:SharedGrant|null=null){
 let saved=initial;const calls:{url:string;init:RequestInit}[]=[];
 const response=vi.fn(async(url:string,init:RequestInit)=>{
  calls.push({url,init});
  if(url.endsWith('/manifest'))return Response.json({data:manifest});
  if(url.endsWith('/login')||url.endsWith('/refresh'))return Response.json({data:{accessToken:'synthetic-access',refreshToken:'synthetic-refresh',user:{id}},error:null},{headers:{'set-cookie':'secret=must-not-forward'}});
  return Response.json({data:{ok:true},error:null});
 });
 const transport=new SharedHttp(connection,{read:async()=>saved,write:async grant=>{saved=grant;}},response);
 return {transport,calls,response,saved:()=>saved};
}
const request=(path:string,method='GET',body?:unknown,headers?:Record<string,string>)=>new Request('orchestra://app'+path,{method,headers:body?{'content-type':'application/json',...headers}:headers,body:body?JSON.stringify(body):undefined});
describe('shared main-process session boundary',()=>{
 it('handshakes before login, forces bearer and removes grants and cookies from renderer responses',async()=>{
  const s=setup();const result=await s.transport.handle(request('/v1/auth/login','POST',{email:'test@example.invalid',password:'synthetic-test-password',sessionMode:'browser'},{cookie:'local=secret',authorization:'Bearer local-owner','x-orchestra-local-token':'local-token'}));
  expect(result.status).toBe(200);expect(await result.json()).toEqual({data:{user:{id}},error:null});
  expect(result.headers.get('set-cookie')).toBeNull();expect(result.headers.get('cache-control')).toBe('no-store');
  expect(s.calls.map(c=>c.url)).toEqual([connection.origin+'/v1/desktop/manifest',connection.origin+'/v1/auth/login']);
  const sent=s.calls[1]!.init;expect(JSON.parse(String(sent.body)).sessionMode).toBe('bearer');
  expect(new Headers(sent.headers).get('authorization')).toBeNull();expect(new Headers(sent.headers).has('cookie')).toBe(false);expect(new Headers(sent.headers).has('x-orchestra-local-token')).toBe(false);
  expect(sent.redirect).toBe('error');expect(sent.credentials).toBe('omit');expect(s.saved()?.accessToken).toBe('synthetic-access');
 });
 it('will not send an existing grant when the server identity changes',async()=>{
  const s=setup({accessToken:'synthetic-access',refreshToken:'synthetic-refresh'});s.response.mockImplementationOnce(async()=>Response.json({data:{...manifest,serverId:'22222222-2222-4222-8222-222222222222'}}));
  expect((await s.transport.handle(request('/v1/auth/bootstrap','POST',{sessionMode:'browser'}))).status).toBe(503);expect(s.response).toHaveBeenCalledTimes(1);
 });
 it('maps browser bootstrap to the authorized native bootstrap without sending browser tokens',async()=>{
  const s=setup({accessToken:'synthetic-access',refreshToken:'synthetic-refresh'});const result=await s.transport.handle(request('/v1/auth/bootstrap','POST',{sessionMode:'browser'}));
  expect(result.status).toBe(200);expect(s.calls[1]!.url).toBe(connection.origin+'/v1/desktop/session/bootstrap');expect(s.calls[1]!.init.method).toBe('GET');expect(new Headers(s.calls[1]!.init.headers).get('authorization')).toBe('Bearer synthetic-access');
 });
 it('serializes refresh and supplies only its own saved grant',async()=>{
  const s=setup({accessToken:'a',refreshToken:'r'});
  const [a,b]=await Promise.all([s.transport.handle(request('/v1/auth/refresh','POST',{refreshToken:'injected'})),s.transport.handle(request('/v1/auth/refresh','POST',{}))]);
  expect(a.status).toBe(200);expect(b.status).toBe(200);expect(s.calls.filter(c=>c.url.endsWith('/refresh')).map(c=>JSON.parse(String(c.init.body)).refreshToken)).toEqual(['r','synthetic-refresh']);
  expect(JSON.stringify(await a.json())).not.toContain('synthetic-refresh');
 });
 it('requires authentication, denies arbitrary network paths and local native authority',async()=>{
  const s=setup();expect((await s.transport.handle(request('/v1/me/profile'))).status).toBe(401);
  for(const path of ['/v1/admin/export','/v1/mcp/tokens','/v1/projects/'+id+'/native/import','/v1/auth/unknown','/v1/auth/login/extra'])expect((await s.transport.handle(request(path,'POST',{}))).status).toBe(403);
  expect((await s.transport.handle(new Request('https://evil.invalid/v1/auth/login',{method:'POST'}))).status).toBe(403);
 });
 it('does not clear a grant or report logout success during an outage',async()=>{
  const s=setup({accessToken:'a',refreshToken:'r'});s.response.mockImplementation(async url=>{if(url.endsWith('/manifest'))return Response.json({data:manifest});throw new Error('offline');});
  expect((await s.transport.handle(request('/v1/auth/logout','POST',{}))).status).toBe(503);expect(s.saved()).not.toBeNull();
 });
 it('retains the current grant when revoking only other sessions',async()=>{
  const s=setup({accessToken:'a',refreshToken:'r'});
  expect((await s.transport.handle(request('/v1/me/sessions/revoke-all','POST',{includeCurrent:false}))).status).toBe(200);
  expect(s.saved()).toEqual({accessToken:'a',refreshToken:'r'});
 });
 it('revokes an expired session by refreshing after an explicit authorization rejection',async()=>{
  const s=setup({accessToken:'a',refreshToken:'r'});let attempts=0;
  s.response.mockImplementation(async(url,init)=>{
   s.calls.push({url,init});
   if(url.endsWith('/manifest'))return Response.json({data:manifest});
   if(url.endsWith('/refresh'))return Response.json({data:{accessToken:'new-access',refreshToken:'new-refresh'}});
   if(url.endsWith('/logout'))return ++attempts===1?Response.json({error:{code:'expired'}},{status:401}):Response.json({data:{ok:true}});
   throw new Error('Unexpected request');
  });
  expect((await s.transport.handle(request('/v1/auth/logout','POST',{}))).status).toBe(200);
  expect(attempts).toBe(2);expect(s.saved()).toBeNull();
  const logout=s.calls.filter(c=>c.url.endsWith('/logout'))[1]!;
  expect(JSON.parse(String(logout.init.body))).toEqual({refreshToken:'new-refresh'});
  expect(new Headers(logout.init.headers).get('authorization')).toBe('Bearer new-access');
 });
 it('clears revoked refresh grants and preserves server authorization failures',async()=>{
  const s=setup({accessToken:'a',refreshToken:'r'});s.response.mockImplementation(async url=>url.endsWith('/manifest')?Response.json({data:manifest}):Response.json({error:{code:'session_revoked',message:'Sign in again'}},{status:401}));
  expect((await s.transport.handle(request('/v1/auth/refresh','POST',{}))).status).toBe(401);expect(s.saved()).toBeNull();
 });
 it('passes SSE incrementally and never treats transport errors as empty data',async()=>{
  const s=setup({accessToken:'a',refreshToken:'r'});s.response.mockImplementation(async url=>url.endsWith('/manifest')?Response.json({data:manifest}):new Response('data: first\n\ndata: second\n\n',{headers:{'content-type':'text/event-stream'}}));
  const result=await s.transport.handle(request('/v1/projects/'+id+'/socrates/messages/stream/v1','POST',{question:'test'}));
  expect(result.status).toBe(200);expect(result.headers.get('content-type')).toContain('text/event-stream');expect(await result.text()).toContain('data: second');
 });
});
