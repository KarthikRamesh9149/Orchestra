import {readFile,mkdir,chmod,chown} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const role=process.argv[2];
if(!['api','worker','web','migrate','bootstrap'].includes(role))throw new Error('Explicit self-hosted role required');
const config=JSON.parse(await readFile(role==='web'?'/run/secrets/web_config':'/run/secrets/application','utf8'));
for(const [key,value] of Object.entries(config)){if(typeof value!=='string')throw new Error('Invalid application configuration');process.env[key]=value;}
process.env.RUNTIME_PROFILE='self-hosted';process.env.NODE_ENV='production';process.env.DEPLOYMENT_ENV='production';
if(role==='web'){
 process.env.API_PROXY_TARGET='http://api:3000';process.env.PORT='4173';
 const {createBetaWebServer}=await import('./apps/beta-web/server.mjs');createBetaWebServer().listen(4173,'0.0.0.0');
}else{
const dbPassword=(await readFile(role==='migrate'?'/run/secrets/migrator_password':'/run/secrets/runtime_password','utf8')).trim();
if(!/^[a-f0-9]{64}$/.test(dbPassword))throw new Error('Invalid installation credential');
process.env.DATABASE_URL=`postgresql://${role==='migrate'?'orchestra_migrator':'orchestra_runtime'}:${dbPassword}@postgres:5432/orchestra_shared?schema=public`;
process.env.REDIS_URL='redis://redis:6379';process.env.QUEUE_MODE='bullmq';
process.env.SELF_HOST_DATA_ROOT='/var/lib/orchestra';process.env.STORAGE_DRIVER='local';process.env.STORAGE_LOCAL_ROOT='/var/lib/orchestra/files';
if(role==='migrate'){
 for(const path of ['/var/lib/orchestra','/var/lib/orchestra/files']){await mkdir(path,{recursive:true,mode:0o700});await chmod(path,0o700);await chown(path,1000,1000);}
 const child=spawn(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'inherit',env:process.env});
 const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});if(status!==0)process.exit(status??1);
 const {PrismaClient}=await import('@prisma/client');const prisma=new PrismaClient();
 try{
  const runtime=(await readFile('/run/secrets/runtime_password','utf8')).trim();if(!/^[a-f0-9]{64}$/.test(runtime))throw new Error('Invalid runtime credential');
  await prisma.$executeRawUnsafe("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orchestra_runtime') THEN CREATE ROLE orchestra_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$");
  // Input is a generated, strictly hex-only password, never operator SQL.
  await prisma.$executeRawUnsafe(`ALTER ROLE orchestra_runtime PASSWORD '${runtime}'`);
  await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public,extensions TO orchestra_runtime');
  await prisma.$executeRawUnsafe('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO orchestra_runtime');
  await prisma.$executeRawUnsafe(`DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' LOOP
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO orchestra_runtime',t.tablename);
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t.tablename AND policyname='self_host_backend_access') THEN EXECUTE format('CREATE POLICY self_host_backend_access ON public.%I TO orchestra_runtime USING (true) WITH CHECK (true)',t.tablename); END IF;
  END LOOP; END $$`);
  console.log('Migration complete; restricted backend role provisioned. Database is not exposed to clients.');
 }finally{await prisma.$disconnect();}
}else if(role==='bootstrap')await import('./self-host-bootstrap.mjs');
else {process.env.PORT='3000';process.env.HOST='0.0.0.0';await import(role==='worker'?'./dist/src/worker.js':'./dist/src/server.js');}
}
