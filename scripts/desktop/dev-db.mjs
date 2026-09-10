import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
process.chdir(root);
const directory=path.join(root,'.desktop');
fs.mkdirSync(directory,{recursive:true,mode:0o700});
const directoryInfo=fs.lstatSync(directory);
if(!directoryInfo.isDirectory()||directoryInfo.isSymbolicLink()||(process.platform!=='win32'&&(directoryInfo.mode&0o077)!==0))throw new Error('Unsafe secret directory');
const secret=path.join(directory,'development-db.json');
try { const fd=fs.openSync(secret,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({password:randomBytes(32).toString('hex')}));fs.closeSync(fd); }
catch(error){if(error.code!=='EEXIST')throw error;}
const secretInfo=fs.lstatSync(secret);
if(!secretInfo.isFile()||secretInfo.isSymbolicLink()||(process.platform!=='win32'&&(secretInfo.mode&0o077)!==0))throw new Error('Unsafe secret file');
const {password}=JSON.parse(fs.readFileSync(secret,'utf8'));
if(!/^[0-9a-f]{64}$/.test(password))throw new Error('Invalid generated database secret');
const env={...process.env,DESKTOP_DB_PASSWORD:password,DATABASE_URL:`postgresql://orchestra_migrator:${password}@127.0.0.1:55439/orchestra_desktop?schema=public`};
const action=process.argv[2];
let command,args;
if(action==='up'){command='docker';args=['compose','-f','infra/desktop/compose.yaml','up','-d','--wait'];}
else if(action==='stop'){command='docker';args=['compose','-f','infra/desktop/compose.yaml','stop'];}
else if(action==='migrate'){command=process.execPath;args=['node_modules/prisma/build/index.js','migrate','deploy'];}
else if(action==='provision-runtime'){
 const runtimeFile=path.join(directory,'runtime-db.json');
 try{fs.writeFileSync(runtimeFile,JSON.stringify({password:randomBytes(32).toString('hex')}),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
 const info=fs.lstatSync(runtimeFile);
 if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw new Error('Unsafe runtime credential file');
 const runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
 if(!/^[0-9a-f]{64}$/.test(runtime.password))throw new Error('Invalid runtime secret');
 const sql=`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='orchestra_desktop_runtime') THEN CREATE ROLE orchestra_desktop_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;
 ALTER ROLE orchestra_desktop_runtime PASSWORD '${runtime.password}';
 GRANT USAGE ON SCHEMA public,extensions TO orchestra_desktop_runtime;
 GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO orchestra_desktop_runtime;
 DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' LOOP
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO orchestra_desktop_runtime',t.tablename);
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t.tablename AND policyname='desktop_runtime_access') THEN
 EXECUTE format('CREATE POLICY desktop_runtime_access ON public.%I TO orchestra_desktop_runtime USING (true) WITH CHECK (true)',t.tablename); END IF;
 END LOOP; END $$;`;
 const provision=spawnSync('docker',['exec','-i','orchestra-desktop-dev-postgres-1','psql','-U','orchestra_migrator','-d','orchestra_desktop','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
 if(provision.status!==0)throw new Error('Runtime role provisioning failed; SQL output withheld to protect generated credentials');
 console.log('Restricted desktop runtime role provisioned');process.exit(0);
}
else if(action==='test'||action==='test-engine'){
 command=process.execPath;args=['node_modules/vitest/vitest.mjs','run',action==='test'?'tests/desktop-postgres.integration.test.ts':'tests/desktop-engine.integration.test.ts'];env.DESKTOP_DB_TEST='1';
 if(action==='test-engine'){
  const filename=path.join(directory,'runtime-db.json'),info=fs.lstatSync(filename);
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw new Error('Unsafe runtime credential file');
  const runtime=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!/^[0-9a-f]{64}$/.test(runtime.password))throw new Error('Invalid runtime secret');
  env.DESKTOP_RUNTIME_DATABASE_URL=`postgresql://orchestra_desktop_runtime:${runtime.password}@127.0.0.1:55439/orchestra_desktop?schema=public`;
 }
}
else throw new Error('Use up, stop, migrate, provision-runtime, test or test-engine; no destructive reset is provided');
const result=spawnSync(command,args,{env,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
