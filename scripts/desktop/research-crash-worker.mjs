// Disposable process used only by the synthetic packaged fault harness.
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const [backend,projectId,mode,runId]=process.argv.slice(2);
const client=await import(pathToFileURL(join(backend,'node_modules/@prisma/client/default.js')).href);
const {DeepResearchService}=await import(pathToFileURL(join(backend,'dist/src/modules/deep-research/service.js')).href);
const prisma=new (client.PrismaClient??client.default.PrismaClient)({datasources:{db:{url:process.env.ORCHESTRA_FAULT_DATABASE_URL}}});
const never=()=>{throw Error('Unexpected provider call');};
const service=new DeepResearchService(prisma,{BETA_DEEP_RESEARCH_ENABLED:true},
 {generateText:never},{embedText:async()=>{process.send({claimed:true});await new Promise(()=>{});}}, {},
 {ensureProjectAccess:async(id,userId)=>{if(!await prisma.projectMember.findFirst({where:{projectId:id,userId}}))throw Error('No fixture membership');}}, {},{},{});
try{
 if(mode==='claim'){
  const project=await prisma.project.findUniqueOrThrow({where:{id:projectId}});
  const member=await prisma.projectMember.findFirstOrThrow({where:{projectId}});
  const run=await prisma.deepResearchRun.create({data:{projectId,orgId:project.orgId,createdByUserId:member.userId,researchFocus:'Synthetic crash recovery probe',sourcesJson:['documents'],outputFormat:'markdown'}});
  process.send({runId:run.id});
  await service.runResearchJob(projectId,run.id,member.userId);
  throw Error('Fault fixture did not pause');
 }else if(mode==='inspect'){
  const run=await prisma.deepResearchRun.findUniqueOrThrow({where:{id:runId}});
  const result=await service.getRun(projectId,runId,{userId:run.createdByUserId,orgId:run.orgId});
  process.send({status:result.status,errorMessage:result.errorMessage,expiresAt:run.leaseExpiresAt?.getTime()??null});
 }else throw Error('Invalid probe');
}catch{process.send?.({failure:'Synthetic research worker probe failed'});process.exitCode=1;}
finally{await prisma.$disconnect();process.disconnect?.();}
