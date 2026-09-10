/** Privileged child of Electron main. Never accepts renderer messages directly. */
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdir,lstat,readFile,writeFile,unlink,readdir,rename} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createLocalEngine} from './engine.js';
import {installationSecretsSchema} from '../config/installation-secrets.js';

const secret=z.string().regex(/^[a-f0-9]{64}$/);
const configSchema=z.object({root:z.string().refine(isAbsolute),bundle:z.string().refine(isAbsolute),vault:z.object({version:z.literal(1),admin:secret,runtime:secret,installation:installationSecretsSchema}).strict()}).strict();
type Config=z.infer<typeof configSchema>;
let postgres:ChildProcess|undefined;
let engine:Awaited<ReturnType<typeof createLocalEngine>>|undefined;
let initializing=false,stopping=false;
let stage='initializing';
let owner:{id:string;orgId:string}|undefined;
const streams=new Map<string,AbortController>();
const subprocesses=new Set<ChildProcess>();
const send=(message:unknown)=>{if(process.connected)process.send?.(message as object);};
const environment:NodeJS.ProcessEnv={PATH:'',TMPDIR:process.env.TMPDIR??'',SystemRoot:process.env.SystemRoot??'',LANG:'C',LC_ALL:'C',NODE_ENV:'production'};
async function freePort(){return new Promise<number>((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string')return reject(new Error('Port allocation failed'));server.close(error=>error?reject(error):resolve(address.port));});});}
async function run(file:string,args:string[],env:NodeJS.ProcessEnv={},input?:string){
 if(stopping)throw new Error('Runtime stopping');
 return new Promise<string>((resolve,reject)=>{
  const child=spawn(file,args,{env:{...environment,...env},stdio:['pipe','pipe','pipe'],windowsHide:true});let output='';
  subprocesses.add(child);
  const timer=setTimeout(()=>{child.kill();reject(new Error('Native command timed out'));},120000);
  child.stdout.on('data',data=>{if(output.length<1024*1024)output+=String(data);});child.stderr.resume();
  child.on('error',()=>{subprocesses.delete(child);clearTimeout(timer);reject(new Error('Native command could not start'));});
  child.on('exit',code=>{subprocesses.delete(child);clearTimeout(timer);code===0?resolve(output.trim()):reject(new Error('Native command failed'));});
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
async function shutdown(){
 if(stopping)return;stopping=true;
 for(const child of subprocesses)child.kill('SIGTERM');
 for(const stream of streams.values())stream.abort();
 await engine?.close().catch(()=>{});
 const child=postgres;
 if(child&&child.exitCode===null&&child.signalCode===null)await new Promise<void>(resolve=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},15000);
  child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGINT');
 });
 process.exit(0);
}
process.on('disconnect',()=>{void shutdown();});process.on('SIGTERM',()=>{void shutdown();});process.on('SIGINT',()=>{void shutdown();});
async function initialize(config:Config){
 stage='provisioning database';
 const {root,bundle,vault}=config;
 await mkdir(root,{recursive:true,mode:0o700});
 const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe application directory');
 const cluster=join(root,'postgres');
 const marker=join(cluster,'.orchestra-owned');
 const bin=join(bundle,'native/pgsql/bin');const executable=(name:string)=>join(bin,name+(process.platform==='win32'?'.exe':''));
 let fresh=false;
 try{if((await readFile(marker,'utf8'))!=='orchestra-native-v1\n')throw new Error('Unowned database');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;try{await lstat(cluster);throw new Error('Refusing unmanaged database directory');}catch(missing){if((missing as NodeJS.ErrnoException).code!=='ENOENT')throw missing;}fresh=true;}
 if(fresh){
  const pending=join(root,'postgres.pending');
  // Preserve interrupted initialization for inspection, never erase user data.
  try{const stat=await lstat(pending);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe pending database');await rename(pending,join(root,`postgres.interrupted-${randomUUID()}`));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await mkdir(pending,{mode:0o700});
  // macOS initdb reads the pipe directly: no plaintext bootstrap secret file.
  // Windows needs an independently qualified protected-handle equivalent.
  if(process.platform!=='darwin')throw new Error('Windows credential bootstrap is not qualified');
  await run(executable('initdb'),['-D',pending,'-U','orchestra_admin','--pwfile','/dev/stdin','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--no-locale'],{},vault.admin+'\n');
  if(stopping)throw new Error('Runtime stopping');
  await writeFile(join(pending,'.orchestra-owned'),'orchestra-native-v1\n',{flag:'wx',mode:0o600});await rename(pending,cluster);
 }
 if((await lstat(cluster)).isSymbolicLink())throw new Error('Unsafe database directory');
 const port=await freePort();
 stage='starting database';
 postgres=spawn(process.execPath,[join(bundle,'backend/dist/src/desktop/postgres-watchdog.js')],{env:environment,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
 postgres.send?.({executable:executable('postgres'),cluster,port});
 postgres.on('error',()=>{send({type:'failed'});void shutdown();});
 postgres.once('exit',()=>{if(!stopping){send({type:'failed'});void shutdown();}});
 const sqlEnv={PGPASSWORD:vault.admin};
 const sql=(query:string,database='postgres')=>run(executable('psql'),['-X','-w','-h','127.0.0.1','-p',String(port),'-U','orchestra_admin','-d',database,'-v','ON_ERROR_STOP=1','-A','-t'],sqlEnv,query);
 let ready=false;
 for(let attempt=0;attempt<100&&!stopping;attempt++){
  try{await sql('SELECT 1');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}
 }
 if(!ready||stopping)throw new Error('Owned database did not become ready');
 if((await sql("SELECT 1 FROM pg_database WHERE datname='orchestra'"))!=='1')await sql('CREATE DATABASE orchestra');
 await sql("DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS extensions; ALTER DATABASE orchestra SET search_path TO public,extensions;",'orchestra');
 const databaseUrl=`postgresql://orchestra_admin:${vault.admin}@127.0.0.1:${port}/orchestra?schema=public`;
 stage='applying migrations';
 await run(process.execPath,[join(bundle,'backend/node_modules/prisma/build/index.js'),'migrate','deploy','--schema',join(bundle,'backend/prisma/schema.prisma')],{DATABASE_URL:databaseUrl});
 await sql(`DO $$ BEGIN CREATE ROLE orchestra_desktop_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 ALTER ROLE orchestra_desktop_runtime PASSWORD '${vault.runtime}';
 GRANT USAGE ON SCHEMA public,extensions TO orchestra_desktop_runtime;
 GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO orchestra_desktop_runtime;
 DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' LOOP
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO orchestra_desktop_runtime',t.tablename);
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t.tablename AND policyname='desktop_runtime_access') THEN EXECUTE format('CREATE POLICY desktop_runtime_access ON public.%I TO orchestra_desktop_runtime USING (true) WITH CHECK (true)',t.tablename); END IF; END LOOP; END $$;`,'orchestra');
 stage='starting engine';
 engine=await createLocalEngine({databaseUrl:`postgresql://orchestra_desktop_runtime:${vault.runtime}@127.0.0.1:${port}/orchestra?schema=public`,installationRoot:root,secrets:vault.installation,port:await freePort()});
 const db=engine.context.prisma;
 // Installation-local principal, not a hosted account or verified email identity.
 stage='initializing local identity';
 owner=await db.$transaction(async tx=>{
  const existing=await tx.user.findUnique({where:{normalizedEmail:'local-owner@localhost.invalid'}});if(existing)return {id:existing.id,orgId:existing.orgId};
  const organization=await tx.organization.create({data:{name:'Local installation',slug:'local-installation'}});
  return tx.user.create({data:{orgId:organization.id,email:'local-owner@localhost.invalid',normalizedEmail:'local-owner@localhost.invalid',displayName:'Local owner',globalRole:'owner',workspaceRoleDefault:'manager'},select:{id:true,orgId:true}});
 });
 stage='listening';await engine.start();const address=engine.app.server.address();send({type:'ready',port:address&&typeof address==='object'?address.port:undefined});
}
async function command(value:unknown,selection?:unknown){
 if(!engine||!owner||stopping)throw new Error('Runtime unavailable');
 const base=z.object({operation:z.string()}).parse(value);
 const services=engine.context.services;
 switch(base.operation){
  case 'workspace.list':z.object({operation:z.literal('workspace.list')}).strict().parse(value);return services.projectService.listProjects(owner.id,owner.orgId);
  case 'workspace.create':{const input=z.object({operation:z.literal('workspace.create'),name:z.string().trim().min(1).max(100)}).strict().parse(value);return services.projectService.createProject({orgId:owner.orgId,actorUserId:owner.id,name:input.name});}
  case 'workspace.select':{const input=z.object({operation:z.literal('workspace.select'),projectId:z.string().uuid()}).strict().parse(value);const available=await services.projectService.listProjects(owner.id,owner.orgId);const selected=available.find(project=>project.id===input.projectId);if(!selected)throw new Error('Unauthorized workspace');return selected;}
  case 'evidence.upload':{
   const input=z.object({operation:z.literal('evidence.upload'),projectId:z.string().uuid(),selectionId:z.string().uuid()}).strict().parse(value);
   const file=z.object({fileName:z.string().max(255),contentType:z.string().max(150),base64:z.string().max(70*1024*1024)}).strict().parse(selection);
   const buffer=Buffer.from(file.base64,'base64');if(buffer.length>50*1024*1024)throw new Error('File too large');
   return services.documentService.uploadFile({projectId:input.projectId,actorUserId:owner.id,kind:'reference',title:file.fileName,visibility:'internal',fileName:file.fileName,contentType:file.contentType,buffer});
  }
  case 'socrates.ask':{
   const input=z.object({operation:z.literal('socrates.ask'),projectId:z.string().uuid(),requestId:z.string().uuid(),question:z.string().trim().min(1).max(10000),sessionId:z.string().uuid().optional()}).strict().parse(value);
   if(streams.size>=2||streams.has(input.requestId))throw new Error('Stream limit');const controller=new AbortController();streams.set(input.requestId,controller);
   try{return await services.socratesService.askV1ProjectMemory({projectId:input.projectId,actorUserId:owner.id,question:input.question,sessionId:input.sessionId,signal:controller.signal,onDelta:delta=>{send({type:'delta',requestId:input.requestId,delta});}});}finally{streams.delete(input.requestId);}
  }
  case 'socrates.cancel':{const input=z.object({operation:z.literal('socrates.cancel'),requestId:z.string().uuid()}).strict().parse(value);streams.get(input.requestId)?.abort();return {cancelled:true};}
  default:throw new Error('Unsupported operation');
 }
}
process.on('message',(message:unknown)=>{
 if(!message||typeof message!=='object')return;
 const event=message as Record<string,unknown>;
 if(event.type==='shutdown'){void shutdown();return;}
 if(event.type==='initialize'&&!initializing){initializing=true;void Promise.resolve().then(()=>initialize(configSchema.parse(event.config))).catch(()=>{send({type:'failed',stage});void shutdown();});return;}
 if(event.type==='command'&&typeof event.id==='string')void command(event.command,event.selection).then(data=>send({type:'result',id:event.id,result:{ok:true,data}})).catch(()=>send({type:'result',id:event.id,result:{ok:false,error:{code:'operation_failed',message:'The local operation failed. No success has been confirmed.'}}}));
});
