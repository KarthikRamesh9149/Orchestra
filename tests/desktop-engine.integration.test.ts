import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { describe,it,expect,afterAll,beforeAll } from 'vitest';
import { createLocalEngine } from '../src/desktop/engine.js';
import { PostgresWorker } from '../src/lib/jobs/postgres-worker.js';
import { PostgresJobDispatcher } from '../src/lib/jobs/postgres.js';
import { PostgresAiLimiter } from '../src/lib/ai-ops/postgres-limits.js';
import { createLocalBackup,restoreLocalBackup } from '../src/desktop/backup.js';
import { hashPassword } from '../src/lib/auth/password.js';

const enabled=process.env.DESKTOP_DB_TEST==='1';
if(enabled)for(const value of [process.env.DATABASE_URL,process.env.DESKTOP_RUNTIME_DATABASE_URL]){
 const url=new URL(value!);
 if(url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/orchestra_desktop')throw new Error('Isolated desktop fixture required');
}
describe.skipIf(!enabled)('real restricted desktop engine',()=>{
 const owner=new PrismaClient();
 const runtime=enabled?new PrismaClient({datasources:{db:{url:process.env.DESKTOP_RUNTIME_DATABASE_URL!}}}):new PrismaClient();
 const prefix='desktop-engine-'+randomUUID();
 let filesRoot:string;
 let savedVersionId:string;
 beforeAll(async()=>{
  const [row]=await owner.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM desktop_jobs WHERE status IN ('queued','running')`;
  if(Number(row.count)!==0)throw new Error('Isolated fixture must be idle; refusing to consume pre-existing work');
 });
 afterAll(async()=>{await owner.$executeRaw`DELETE FROM desktop_jobs WHERE idempotency_key LIKE ${prefix+'%'}`;
  await owner.$executeRaw`DELETE FROM desktop_limit_state WHERE key LIKE ${'%'+prefix+'%'}`;await runtime.$disconnect();await owner.$disconnect();});
 it('rejects privileged DB roles and enforces installation authentication',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-engine-'));
  await expect(createLocalEngine({databaseUrl:process.env.DATABASE_URL!,installationRoot:root})).rejects.toThrow('non-owner');
  const engine=await createLocalEngine({databaseUrl:process.env.DESKTOP_RUNTIME_DATABASE_URL!,installationRoot:root});
  try{
   expect((await engine.app.inject({url:'/health'})).statusCode).toBe(401);
   expect((await engine.app.inject({url:'/health',headers:{'x-orchestra-local-token':engine.localToken}})).statusCode).toBe(200);
   await expect(createLocalEngine({databaseUrl:process.env.DESKTOP_RUNTIME_DATABASE_URL!,installationRoot:root})).rejects.toThrow('already in use');
   await expect(createLocalBackup({databaseUrl:process.env.DATABASE_URL!,filesRoot:join(root,'data','files'),passphrase:'synthetic-backup-password',dump:async()=>{throw new Error('must not dump active engine');}})).rejects.toThrow('already in use');
   await expect(runtime.$executeRaw`CREATE TABLE forbidden_desktop_ddl(id int)`).rejects.toThrow();
   await expect(runtime.$queryRaw`SELECT * FROM _prisma_migrations`).rejects.toThrow();
   await engine.start();
   const health=await fetch('http://127.0.0.1:43119/health',{headers:{'x-orchestra-local-token':engine.localToken}});
   expect(health.status).toBe(200);
  }finally{await engine.close();}
 });
 it('persists request limits and atomically denies multi-scope costs without Redis',async()=>{
  const first=new PostgresAiLimiter(runtime),second=new PostgresAiLimiter(runtime);
  try{
   expect((await first.checkRequestLimit({key:prefix,maxRequests:1,windowMs:60000})).allowed).toBe(true);
   expect((await second.checkRequestLimit({key:prefix,maxRequests:1,windowMs:60000})).allowed).toBe(false);
   expect((await first.checkDailyCosts([{key:prefix+'a',maxDailyCostUsd:1,addCostUsd:0.5},{key:prefix+'b',maxDailyCostUsd:1,addCostUsd:2}])).allowed).toBe(false);
   expect((await second.checkDailyCost({key:prefix+'a',maxDailyCostUsd:1,addCostUsd:1})).allowed).toBe(true);
  }finally{await first.close();await second.close();}
 });
 it('uploads, parses and searches real source bytes, then preserves them after engine restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-workflow-'));
  let engine=await createLocalEngine({databaseUrl:process.env.DESKTOP_RUNTIME_DATABASE_URL!,installationRoot:root});
  const org=await owner.organization.create({data:{name:prefix,slug:prefix}});
  const password=randomUUID()+randomUUID();
  const user=await owner.user.create({data:{orgId:org.id,email:prefix+'@example.invalid',normalizedEmail:prefix+'@example.invalid',passwordHash:await hashPassword(password,4),displayName:'Synthetic local owner',globalRole:'owner',workspaceRoleDefault:'manager'}});
  try{
   const services=engine.context.services;
   const project=await services.projectService.createProject({orgId:org.id,actorUserId:user.id,name:'Local source evidence'});
   const source=Buffer.from('# Offline acceptance\n\nThe launch approval workflow requires exactly three reviewers. The retention period is ninety days.');
   const login=await services.authService.login({email:user.email,password,sessionMode:'bearer'});
   const headers={'x-orchestra-local-token':engine.localToken,authorization:`Bearer ${login.accessToken}`};
   const uploadResponse=await engine.app.inject({method:'POST',url:`/v1/projects/${project.id}/documents/upload`,headers,payload:{title:'Offline acceptance',kind:'prd',visibility:'internal',pastedText:source.toString()}});
   expect(uploadResponse.statusCode,uploadResponse.body).toBe(200);
   const uploaded=uploadResponse.json().data as {documentVersionId:string;documentId:string};
   for(let n=0;n<30&&await engine.worker.runOnce();n++){}
   const version=await owner.documentVersion.findUniqueOrThrow({where:{id:uploaded.documentVersionId}});
   filesRoot=join(root,'data','files');savedVersionId=version.id;
   expect(version.status).toBe('partial');
   expect(await engine.context.storage.getObject(version.fileKey)).toEqual(source);
   const fileUrl=`/v1/projects/${project.id}/documents/${uploaded.documentId}/file`;
   expect((await engine.app.inject({url:fileUrl,headers:{'x-orchestra-local-token':engine.localToken}})).statusCode).toBe(401);
   expect((await engine.app.inject({url:fileUrl,headers})).rawPayload).toEqual(source);
   const found=await services.documentService.searchDocument(project.id,uploaded.documentId,user.id,{q:'three reviewers'});
   expect(JSON.stringify(found)).toContain('three reviewers');
   const answer=await services.socratesService.askV1ProjectMemory({projectId:project.id,actorUserId:user.id,question:'In Offline acceptance, how many reviewers are required for launch approval?',selectedSources:['documents']});
   expect(JSON.stringify(answer)).toContain('three reviewers');
   expect(answer.citations.length).toBeGreaterThan(0);
   expect(answer.modelMetadata.provider).not.toBe('openai');
   expect(answer.costEstimate.modelCalls).toBe(0);
   // The real offline worker now projects the uploaded human-authored source.
   // Do not seed an artifact: doing so used to conceal the disabled chain.
   const section=await owner.documentSection.findFirstOrThrow({where:{documentVersionId:version.id}});
   const artifact=await owner.artifactVersion.findFirstOrThrow({where:{projectId:project.id,artifactType:'brain_graph',status:'accepted'},orderBy:{versionNumber:'desc'}});
   const node=await owner.brainNode.findFirstOrThrow({where:{artifactVersionId:artifact.id}});
   const proposal=await services.changeProposalService.create(project.id,user.id,{title:'Clarify launch approval',summary:'Require three reviewers',proposalType:'clarification',newUnderstanding:{text:'Launch approval requires exactly three reviewers.'},affectedDocumentSectionIds:[section.id],affectedBrainNodeIds:[node.id],communicationMessageIds:[],externalEvidenceRefs:['synthetic-source:'+version.id]});
   await expect(services.changeProposalService.accept(project.id,proposal.id,randomUUID())).rejects.toThrow();
   expect((await services.changeProposalService.accept(project.id,proposal.id,user.id)).status).toBe('accepted');
   expect((await services.changeProposalService.accept(project.id,proposal.id,user.id)).status).toBe('accepted');
   for(let n=0;n<30&&await engine.worker.runOnce();n++){}
   expect(await owner.liveDocSectionRevision.count({where:{proposalId:proposal.id}})).toBe(1);
   expect((await owner.specChangeProposal.findUniqueOrThrow({where:{id:proposal.id}})).acceptedBrainVersionId).toBeTruthy();
   await engine.close();engine=await createLocalEngine({databaseUrl:process.env.DESKTOP_RUNTIME_DATABASE_URL!,installationRoot:root});
   expect(await engine.context.storage.getObject(version.fileKey)).toEqual(source);
   expect(JSON.stringify(await engine.context.services.documentService.searchDocument(project.id,uploaded.documentId,user.id,{q:'three reviewers'}))).toContain('three reviewers');
   expect((await engine.context.services.changeProposalService.get(project.id,proposal.id,user.id)).status).toBe('accepted');
   expect((await owner.socratesMessage.findUniqueOrThrow({where:{id:answer.messageId}})).content).toContain('three reviewers');
   const nextLogin=await engine.context.services.authService.login({email:user.email,password,sessionMode:'bearer'});
   expect((await engine.app.inject({url:fileUrl,headers:{'x-orchestra-local-token':engine.localToken,authorization:`Bearer ${nextLogin.accessToken}`}})).rawPayload).toEqual(source);
  }finally{for(let n=0;n<30&&await engine.worker.runOnce();n++){}await engine.close();}
 },30000);
 it('rolls back handler effects on failure and commits acknowledgement with effects',async()=>{
  const queue=new PostgresJobDispatcher(runtime);
  const existing=await owner.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM desktop_jobs WHERE status IN ('queued','running')`;
  expect(Number(existing[0]!.count)).toBe(0);
  const handler=(fail:boolean)=>new PostgresWorker(runtime,tx=>({refresh_dashboard_snapshot:async()=>{
   await tx.$executeRaw`INSERT INTO desktop_limit_state(key,data) VALUES (${prefix+'-effect'},'{}')`;
   if(fail)throw new Error('synthetic crash before acknowledgement');
  }}));
  await queue.enqueue('refresh_dashboard_snapshot',{},prefix+'-failure');await handler(true).runOnce();
  expect(await runtime.$queryRaw`SELECT key FROM desktop_limit_state WHERE key=${prefix+'-effect'}`).toEqual([]);
  await queue.enqueue('refresh_dashboard_snapshot',{},prefix+'-success');await handler(false).runOnce();
  expect(await runtime.$queryRaw`SELECT status FROM desktop_jobs WHERE idempotency_key=${prefix+'-success'}`).toEqual([{status:'completed'}]);
  expect(await runtime.$queryRaw`SELECT key FROM desktop_limit_state WHERE key=${prefix+'-effect'}`).toHaveLength(1);
 });
 it('kills a real effect-writing worker, preserves healthy ownership and retries without duplicate effects',async()=>{
  const queue=new PostgresJobDispatcher(runtime,500),key=prefix+'-killed-effect';
  await queue.enqueue('refresh_dashboard_snapshot',{effectKey:key},prefix+'-killed');
  const child=fork('scripts/desktop/effect-and-wait.mjs',[],{execArgv:['--import','tsx'],stdio:['ignore','ignore','ignore','ipc']});
  let deadline:ReturnType<typeof setTimeout>|undefined;
  try{
   await Promise.race([once(child,'message'),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Worker did not reach effect checkpoint')),5000);})]);
   clearTimeout(deadline);
   await new Promise(resolve=>setTimeout(resolve,650));
   // An expired timestamp must not steal work from a healthy locked transaction.
   expect(await queue.claim()).toBeNull();
   const exit=once(child,'exit');child.kill('SIGKILL');await exit;
   expect(await queue.claim()).toBeNull();
   expect(await runtime.$queryRaw`SELECT key FROM desktop_limit_state WHERE key=${key}`).toEqual([]);
   let [job]=await runtime.$queryRaw<Array<{id:string;status:string}>>`SELECT id,status FROM desktop_jobs WHERE idempotency_key=${prefix+'-killed'}`;
   for(let attempts=0;job.status==='running'&&attempts<30;attempts++){
    await new Promise(resolve=>setTimeout(resolve,50));await queue.claim();
    [job]=await runtime.$queryRaw<Array<{id:string;status:string}>>`SELECT id,status FROM desktop_jobs WHERE idempotency_key=${prefix+'-killed'}`;
   }
   expect(job.status).toBe('failed');expect(await queue.retryFailed(job.id)).toBe(true);
   await new Promise(resolve=>setTimeout(resolve,2100));
   const worker=new PostgresWorker(runtime,tx=>({refresh_dashboard_snapshot:async()=>{await tx.$executeRaw`INSERT INTO desktop_limit_state(key,data) VALUES (${key},'{}')`;}}));
   expect(await worker.runOnce()).toBe(true);
   expect(await runtime.$queryRaw`SELECT key FROM desktop_limit_state WHERE key=${key}`).toHaveLength(1);
  }finally{clearTimeout(deadline);if(child.exitCode===null)child.kill('SIGKILL');}
 },10000);
 it('cancels an active handler without committing its pending effect',async()=>{
  const queue=new PostgresJobDispatcher(runtime),key=prefix+'-active-cancel';
  await queue.enqueue('refresh_dashboard_snapshot',{},key);
  let started!:()=>void;const checkpoint=new Promise<void>(resolve=>{started=resolve;});
  const worker=new PostgresWorker(runtime,tx=>({refresh_dashboard_snapshot:async()=>{
   await tx.$executeRaw`INSERT INTO desktop_limit_state(key,data) VALUES (${key},'{}')`;started();await new Promise(()=>{});
  }}));
  const running=worker.runOnce();await checkpoint;
  const [job]=await runtime.$queryRaw<Array<{id:string}>>`SELECT id FROM desktop_jobs WHERE idempotency_key=${key}`;
  expect(await queue.cancel(job.id)).toBe(true);await running;
  expect(await runtime.$queryRaw`SELECT key FROM desktop_limit_state WHERE key=${key}`).toEqual([]);
  expect(await runtime.$queryRaw`SELECT status FROM desktop_jobs WHERE id=${job.id}::uuid`).toEqual([{status:'cancelled'}]);
 },5000);
 it('backs up and restores real PostgreSQL plus evidence bytes to an empty isolated target',async()=>{
  expect(filesRoot).toBeTruthy();
  const run=(args:string[],input?:Buffer)=>{
   const result=spawnSync('docker',['exec','-i','orchestra-desktop-dev-postgres-1',...args],{input,maxBuffer:128*1024*1024});
   if(result.status!==0)throw new Error('Isolated PostgreSQL backup/restore command failed');return result.stdout;
  };
  const passphrase='synthetic-local-backup-'+randomUUID();
  const archive=await createLocalBackup({databaseUrl:process.env.DATABASE_URL!,filesRoot,passphrase,dump:async()=>run(['pg_dump','-U','orchestra_migrator','-d','orchestra_desktop','--format=custom','--no-owner','--no-acl'])});
  const target='orchestra_desktop_restore_'+randomUUID().replaceAll('-','');
  const targetUrl=new URL(process.env.DATABASE_URL!);targetUrl.pathname='/'+target;
  run(['createdb','-U','orchestra_migrator',target]);
  const restored=new PrismaClient({datasources:{db:{url:targetUrl.toString()}}});
  try{
   const root=await mkdtemp(join(tmpdir(),'orchestra-restored-'));
   await restoreLocalBackup({databaseUrl:targetUrl.toString(),filesRoot:root,passphrase,archive,
    assertEmptyDatabase:async()=>{const [row]=await restored.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM pg_tables WHERE schemaname='public'`;expect(Number(row.count)).toBe(0);},
    restore:async dump=>{run(['pg_restore','-U','orchestra_migrator','-d',target,'--no-owner','--no-acl','--exit-on-error','--single-transaction'],dump);}});
   const version=await restored.documentVersion.findUniqueOrThrow({where:{id:savedVersionId}});
   const {PrivateLocalStorageDriver}=await import('../src/lib/storage/private-local.js');
   expect((await new PrivateLocalStorageDriver(root).getObject(version.fileKey)).toString()).toContain('three reviewers');
   expect(await restored.specChangeProposal.count({where:{projectId:version.projectId,status:'accepted'}})).toBe(1);
  }finally{
   await restored.$disconnect();
   // Exact UUID-qualified database created by this test only; never source DB.
   run(['dropdb','-U','orchestra_migrator',target]);
  }
 },30000);
 it('reconciles research failure and resets only the matching failed run on explicit retry',async()=>{
  const version=await owner.documentVersion.findUniqueOrThrow({where:{id:savedVersionId}});
  const project=await owner.project.findUniqueOrThrow({where:{id:version.projectId}});
  const run=await owner.deepResearchRun.create({data:{orgId:project.orgId,projectId:project.id,createdByUserId:version.uploadedBy,researchFocus:'Synthetic offline run',outputFormat:'brief'}});
  const queue=new PostgresJobDispatcher(runtime);
  await queue.enqueue('deep_research_run',{projectId:project.id,runId:run.id},prefix+'-research');
  const worker=new PostgresWorker(runtime,()=>({deep_research_run:async()=>{throw new Error('ai_not_configured');}}));
  await worker.runOnce();
  expect((await owner.deepResearchRun.findUniqueOrThrow({where:{id:run.id}})).status).toBe('failed');
  const [job]=await runtime.$queryRaw<Array<{id:string}>>`SELECT id FROM desktop_jobs WHERE idempotency_key=${prefix+'-research'}`;
  expect(await queue.retryFailed(job.id)).toBe(true);
  expect((await owner.deepResearchRun.findUniqueOrThrow({where:{id:run.id}})).status).toBe('queued');
  await queue.cancel(job.id);await worker.runOnce();
  expect((await owner.deepResearchRun.findUniqueOrThrow({where:{id:run.id}})).status).toBe('failed');
 });
});
