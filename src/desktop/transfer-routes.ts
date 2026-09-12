import type {FastifyPluginAsync} from 'fastify';
import {z} from 'zod';
import {authGuard} from '../app/auth.js';
import {ProjectTransferService} from './project-transfer-service.js';
import {nativeArchiveLimit,transferAction} from './transfer-contract.js';
const secret=z.string().min(16).max(1024);
const archive=z.string().max(Math.ceil(nativeArchiveLimit/3)*4);
const base=z.object({passphrase:secret,archiveBase64:archive}).strict();
export const registerTransferRoutes:FastifyPluginAsync=async app=>{
 const {env}=app.appContext;
 if(env.RUNTIME_PROFILE!=='desktop-local'&&!(env.RUNTIME_PROFILE==='self-hosted'&&env.DESKTOP_SHARED_SERVER_ID))return;
 let busy=false;
 app.post('/projects/:projectId/transfer/:action',{bodyLimit:24*1024*1024},authGuard(async(request,reply)=>{
  reply.header('cache-control','no-store');
  if(!request.headers.authorization?.startsWith('Bearer ')||(env.RUNTIME_PROFILE==='self-hosted'&&!request.authUser?.sessionId))throw app.httpErrors.unauthorized('Native bearer authority required');
  if(busy)throw app.httpErrors.tooManyRequests('Another project transfer is running. Retry shortly.');
  busy=true;
  try{
   const {projectId,action}=z.object({projectId:z.string().uuid(),action:transferAction}).parse(request.params),actor=request.authUser!;
   const service=new ProjectTransferService(app.appContext.prisma,app.appContext.storage,env.DESKTOP_SHARED_SERVER_ID??actor.orgId);
   if(action==='export'){
    const body=z.object({passphrase:secret}).strict().parse(request.body),bytes=await service.exportProject(projectId,actor,body.passphrase);
    if(bytes.length>nativeArchiveLimit)throw new Error('Archive too large');
    return {data:{archiveBase64:bytes.toString('base64')},error:null};
   }
   const body=action==='preview'?base.parse(request.body):base.extend({digest:z.string().regex(/^[a-f0-9]{64}$/),identityMap:z.record(z.string().uuid(),z.string().uuid()),acknowledgeHistoricalTruth:z.literal(true)}).parse(request.body);
   const bytes=Buffer.from(body.archiveBase64,'base64');if(bytes.length>nativeArchiveLimit||bytes.toString('base64')!==body.archiveBase64)throw new Error('Invalid archive');
   const data=action==='preview'?await service.previewImport(bytes,body.passphrase,projectId,actor):await service.importProject({...body as z.infer<typeof base>&{digest:string;identityMap:Record<string,string>;acknowledgeHistoricalTruth:true},archive:bytes,targetProjectId:projectId,actor});
   return {data,error:null};
  }catch{throw app.httpErrors.badRequest('Transfer not confirmed. Check manager access, passphrase, a complete identity mapping, an empty destination and the 16 MiB archive limit. Existing data is never replaced.');}
  finally{busy=false;}
 }));
};
