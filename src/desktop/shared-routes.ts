import type {FastifyPluginAsync} from 'fastify';
import {authGuard} from '../app/auth.js';
import {SHARED_DESKTOP_PROTOCOL} from './shared-contract.js';

/** Explicitly opted-in self-hosted servers only. No change to managed exposure. */
export const registerSharedDesktopRoutes:FastifyPluginAsync=async app=>{
 const env=app.appContext.env;
 if(env.RUNTIME_PROFILE!=='self-hosted'||!env.DESKTOP_SHARED_SERVER_ID)return;
 app.get('/manifest',async(_request,reply)=>{
  reply.header('Cache-Control','no-store');
  return {data:{product:'orchestra',protocol:SHARED_DESKTOP_PROTOCOL,minClientProtocol:1,maxClientProtocol:1,
   serverId:env.DESKTOP_SHARED_SERVER_ID,mode:'self-hosted',capabilities:['bearer-sessions-v1'],offlineCache:{enabled:false}},meta:null,error:null};
 });
 app.get('/session/bootstrap',authGuard(async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  // A local owner token or cookie alone is never a shared desktop session.
  if(!request.headers.authorization?.startsWith('Bearer ')||!request.authUser?.sessionId)throw app.httpErrors.unauthorized('A shared bearer session is required');
  const actor=request.authUser;
  const [user,workspaces]=await Promise.all([
   request.authProfile??request.appContext.services.authService.getMe(actor.userId,actor.orgId),
   request.appContext.services.meService.listWorkspaces(actor,actor.sessionId)
  ]);
  return {data:{user,workspaces},meta:null,error:null};
 }));
};
