import {afterEach,describe,it,expect,vi} from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import {registerSharedDesktopRoutes} from '../src/desktop/shared-routes.js';
import {isAllowedBetaRoute} from '../src/app/build-app.js';
import type {AppContext} from '../src/types/index.js';
const id='11111111-1111-4111-8111-111111111111';
const apps:ReturnType<typeof Fastify>[]=[];
async function setup(profile='self-hosted',serverId:string|undefined=id){
 const app=Fastify(),profileValue={id,email:'synthetic@example.invalid'};
 const authorize=vi.fn(async()=>({userId:id,orgId:id,profile:profileValue}));
 const list=vi.fn(async()=>[{id,name:'Synthetic team',projectRole:'manager'}]);
 const context={env:{RUNTIME_PROFILE:profile,DESKTOP_SHARED_SERVER_ID:serverId},services:{authService:{authorizeSessionContext:authorize},meService:{listWorkspaces:list}}} as unknown as AppContext;
 app.decorate('appContext',context);app.addHook('onRequest',async request=>{request.appContext=context;});
 await app.register(jwt,{secret:'synthetic-test-key-not-a-real-secret'});await app.register(sensible);await app.register(registerSharedDesktopRoutes,{prefix:'/v1/desktop'});await app.ready();apps.push(app);
 return {app,authorize,list,token:app.jwt.sign({typ:'access',sessionId:id,userId:id,orgId:id})};
}
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
describe('opted-in shared desktop server routes',()=>{
 it('reports only the operator-enabled bounded read-only policy',async()=>{
  const {app}=await setup();Object.assign(app.appContext.env,{DESKTOP_SHARED_CACHE_ENABLED:true,DESKTOP_SHARED_CACHE_TTL_SECONDS:60,DESKTOP_SHARED_CACHE_MAX_BYTES:4096});
  expect((await app.inject('/v1/desktop/manifest')).json().data.offlineCache).toEqual({enabled:true,readOnly:true,ttlSeconds:60,maxBytes:4096});
 });
 it('exposes a compatible manifest with no private configuration',async()=>{const {app}=await setup();const r=await app.inject('/v1/desktop/manifest');expect(r.statusCode).toBe(200);expect(r.json().data).toMatchObject({serverId:id,mode:'self-hosted',offlineCache:{enabled:false}});expect(r.headers['cache-control']).toBe('no-store');});
 it.each(['managed','desktop-local'])('does not expose new routes in %s',async profile=>{const {app}=await setup(profile);expect((await app.inject('/v1/desktop/manifest')).statusCode).toBe(404);});
 it('requires a real bearer session and rechecks its authority',async()=>{const {app,token,authorize,list}=await setup();expect((await app.inject('/v1/desktop/session/bootstrap')).statusCode).toBe(401);const r=await app.inject({url:'/v1/desktop/session/bootstrap',headers:{authorization:'Bearer '+token}});expect(r.statusCode).toBe(200);expect(r.json().data.workspaces).toHaveLength(1);expect(authorize).toHaveBeenCalledWith(id,id,id);expect(list).toHaveBeenCalledTimes(1);authorize.mockRejectedValueOnce(app.httpErrors.unauthorized('Revoked'));expect((await app.inject({url:'/v1/desktop/session/bootstrap',headers:{authorization:'Bearer '+token}})).statusCode).toBe(401);expect(list).toHaveBeenCalledTimes(1);});
 it('does not allow the new prefix through managed beta routing',()=>{for(const path of ['/v1/desktop/manifest','/v1/desktop/session/bootstrap']){expect(isAllowedBetaRoute('GET',path,{RUNTIME_PROFILE:'managed',DESKTOP_SHARED_SERVER_ID:id})).toBe(false);expect(isAllowedBetaRoute('GET',path,{RUNTIME_PROFILE:'self-hosted',DESKTOP_SHARED_SERVER_ID:id})).toBe(true);expect(isAllowedBetaRoute('POST',path,{RUNTIME_PROFILE:'self-hosted',DESKTOP_SHARED_SERVER_ID:id})).toBe(false);}});
});
