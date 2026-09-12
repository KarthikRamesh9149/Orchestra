/** Operator-only, local Docker maintenance. Never use against managed Orchestra. */
import {spawn} from 'node:child_process';
import {readFile,open,link,unlink,lstat} from 'node:fs/promises';
import {constants,unlinkSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {encryptBackup,decryptBackup} from '../../src/lib/storage/encrypted-backup.js';
import {validateRecoveryArchive,unreferencedTransferFiles} from '../../src/desktop/recovery-archive.js';

process.on('uncaughtException',()=>{console.error('Recovery stopped. Inspect prerequisites and target state before retrying; configuration and archive contents are not logged.');process.exitCode=1;});

const [action,project,archivePath,passwordPath,...extra]=process.argv.slice(2);
if(!['backup','restore'].includes(action??'')||!project||!/^[a-z][a-z0-9-]{2,60}$/.test(project)||!archivePath||!passwordPath||extra.some(flag=>flag!=='--quarantine-orphans')||extra.length>1||(extra.length&&action!=='backup'))throw Error('Usage: node --import tsx scripts/desktop/self-host-recovery.ts backup|restore COMPOSE_PROJECT ARCHIVE PRIVATE_PASSPHRASE_FILE [--quarantine-orphans]');
const directory=process.env.SELF_HOST_CONFIG_DIR;
if(!directory||!process.env.ORCHESTRA_HTTPS_ORIGIN)throw Error('Explicit private config directory and HTTPS origin required');
const config=JSON.parse(await readFile(join(directory,'application.json'),'utf8'));
if(config.RUNTIME_PROFILE!=='self-hosted'||config.APP_BASE_URL!==process.env.ORCHESTRA_HTTPS_ORIGIN)throw Error('Self-hosted installation identity mismatch');
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
const configurationHash=hash(Buffer.from(JSON.stringify(Object.entries(config).sort(([a],[b])=>a.localeCompare(b)))));
async function privateRead(path:string,max:number){
 const file=await open(resolve(path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.size>max||(stat.mode&0o077)!==0)throw Error('Private regular file required');return await file.readFile();}finally{await file.close();}
}
const password=(await privateRead(passwordPath,4096)).toString().trim();
if(password.length<16||password.length>1024)throw Error('Use a separate private passphrase file containing 16–1024 characters');
const compose=['compose','-f','infra/self-host/v1/compose.yaml',...(process.env.ORCHESTRA_RECOVERY_COMPOSE_OVERRIDE?['-f',resolve(process.env.ORCHESTRA_RECOVERY_COMPOSE_OVERRIDE)]:[]),'-p',project];
let interrupted=false;
process.once('SIGINT',()=>{interrupted=true;});
async function docker(args:string[],input?:Buffer){
 return new Promise<Buffer>((accept,reject)=>{
  const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[];let size=0,failed=false;
  const fail=()=>{failed=true;child.kill('SIGKILL');};
  const timeout=setTimeout(fail,120000),poll=setInterval(()=>{if(interrupted)fail();},100);
  child.stdout.on('data',(chunk:Buffer)=>{if((size+=chunk.length)>180*1024*1024)fail();else chunks.push(chunk);});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',error=>{clearTimeout(timeout);clearInterval(poll);reject(error);});
  child.on('close',code=>{clearTimeout(timeout);clearInterval(poll);code===0&&!failed?accept(Buffer.concat(chunks)):reject(Error('Recovery Docker operation failed; no container output or secrets were printed'));});child.stdin.end(input);
 });
}
const sql=(query:string)=>docker([...compose,'exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','orchestra_migrator','-d','orchestra_shared','-c',query]);
async function helper(program:string,data:unknown={},asRoot=false){
 const wrapper=`let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',async()=>{try{const data=JSON.parse(input);${program}}catch{process.exitCode=1;}});`;
 return docker([...compose,'run','--rm','--no-deps',...(asRoot?['--user','root','--cap-add','CHOWN']:[]),'--entrypoint','node','api','-e',wrapper],Buffer.from(JSON.stringify(data)));
}
// A remote Docker context could silently target another system. Refuse it.
const context=JSON.parse((await docker(['context','inspect'])).toString());
if(process.env.DOCKER_HOST||!context[0]?.Endpoints?.docker?.Host?.startsWith('unix://'))throw Error('Use an explicit local Unix-socket Docker context');
const lockPath=join(directory,'.recovery.lock'),lock=await open(lockPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
await lock.writeFile(String(process.pid));await lock.close();
process.once('exit',()=>{try{unlinkSync(lockPath);}catch{}});
if(action==='backup'){
 const parent=await lstat(dirname(resolve(archivePath)));if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o077)!==0)throw Error('Archive parent must be a private directory');
 try{await lstat(archivePath);throw Error('Archive already exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const ids=(await docker([...compose,'ps','-q','api','worker','web'])).toString().trim().split(/\s+/).filter(Boolean);
 if(ids.length!==3)throw Error('Healthy API, worker and web must exist before backup');
 const containers=JSON.parse((await docker(['inspect',...ids])).toString());
 if(containers.some((row:any)=>!row.State.Running)||new Set(containers.map((row:any)=>row.Image)).size!==1)throw Error('Expected one running application image');
 const running=(await docker([...compose,'ps','--services','--status','running'])).toString().trim().split(/\s+/).filter((name:string)=>['api','worker','web','tls'].includes(name));
 let paused=false;
 try{
  paused=true;await docker([...compose,'stop',...running]);
  const dump=await docker([...compose,'exec','-T','postgres','pg_dump','-U','orchestra_migrator','-Fc','orchestra_shared']);
  const snapshot=JSON.parse((await helper(`const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),Redis=require('ioredis');let total=0;const files=[];
   async function walk(dir,prefix=''){for(const name of await fs.readdir(dir)){const p=path.join(dir,name),s=await fs.lstat(p),key=prefix+name;if(s.isSymbolicLink())throw Error();if(s.isDirectory())await walk(p,key+'/');else{if(!s.isFile()||(total+=s.size)>64000000||files.length>=10000)throw Error();const b=await fs.readFile(p);files.push({key,body:b.toString('base64'),hash:crypto.createHash('sha256').update(b).digest('hex')});}}}await walk('/var/lib/orchestra');
   const redis=new Redis('redis://redis:6379',{maxRetriesPerRequest:1});const keys=[];let cursor='0';do{const page=await redis.scan(cursor,'COUNT',1000);cursor=page[0];for(const key of page[1]){const b=await redis.dumpBuffer(key),ttl=await redis.pttl(key);if(b&&ttl!==-2)keys.push({key,dump:b.toString('base64'),expires:ttl<0?null:Date.now()+ttl});if(keys.length>100000)throw Error();}}while(cursor!=='0');await redis.quit();process.stdout.write(JSON.stringify({files,keys}));`)).toString());
  const payload=validateRecoveryArchive({version:1,serverId:config.DESKTOP_SHARED_SERVER_ID,configurationHash,image:containers[0].Image,createdAt:new Date().toISOString(),dump:dump.toString('base64'),dumpHash:hash(dump),...snapshot});
  const encrypted=encryptBackup(Buffer.from(JSON.stringify(payload)),password),temp=resolve(archivePath)+'.'+randomUUID()+'.pending';
  const file=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(encrypted);await file.sync();await file.close();await link(temp,resolve(archivePath));}finally{await file.close().catch(()=>{});await unlink(temp).catch(()=>{});}
  const parentHandle=await open(dirname(resolve(archivePath)),constants.O_RDONLY);try{await parentHandle.sync();}finally{await parentHandle.close();}
  if(extra.includes('--quarantine-orphans')){
   const references=JSON.parse((await sql("SELECT coalesce(json_agg(file_key),'[]'::json) FROM (SELECT file_key FROM document_versions UNION SELECT file_key FROM communication_attachments WHERE file_key IS NOT NULL) refs")).toString()) as string[];
   const keys=unreferencedTransferFiles(payload.files.map(row=>row.key),references);
   await helper(`const fs=require('node:fs/promises'),path=require('node:path');const root='/var/lib/orchestra',target=path.join(root,'transfer-quarantine',data.attempt);await fs.mkdir(target,{recursive:true,mode:0o700});
    const manifest=await fs.open(path.join(target,'manifest.json'),'wx',0o600);try{await manifest.writeFile(JSON.stringify({version:1,originalKeys:data.keys}));await manifest.sync();}finally{await manifest.close();}
    for(let i=0;i<data.keys.length;i++){const from=path.join(root,data.keys[i]);if(!(await fs.lstat(from)).isFile())throw Error();await fs.rename(from,path.join(target,String(i)));}`,{keys,attempt:randomUUID()});
   console.log(`PASS ${keys.length} unreferenced transfer files quarantined after backup; no files deleted.`);
  }
  console.log('PASS encrypted backup created. Keep original private configuration and passphrase separately. Restore qualification is still required.');
 }finally{if(paused){interrupted=false;await docker([...compose,'start',...running]);}}
}else{
 // Authenticate and validate every archive record before creating target resources.
 const payload=validateRecoveryArchive(JSON.parse(decryptBackup(await privateRead(archivePath,256*1024*1024+52),password).toString()));
 if(payload.serverId!==config.DESKTOP_SHARED_SERVER_ID||payload.configurationHash!==configurationHash)throw Error('Restore requires the original protected configuration and stable server identity');
 const existing=(await docker(['ps','-aq','--filter',`label=com.docker.compose.project=${project}`])).toString().trim();
 const volumes=(await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`])).toString().trim();
 if(existing||volumes)throw Error('Restore requires a completely new Compose project with no existing containers or volumes');
 const composeConfig=JSON.parse((await docker([...compose,'config','--format','json'])).toString());
 const selected=JSON.parse((await docker(['image','inspect',composeConfig.services.api.image])).toString());
 if(selected[0]?.Id!==payload.image)throw Error('Restore the exact backed-up application image before attempting an upgrade');
 await docker([...compose,'up','-d','--wait','postgres','redis']);
 try{
  if(Number((await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'")).toString())!==0)throw Error('Destination database is not empty');
  await sql('CREATE ROLE orchestra_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; DROP SCHEMA extensions;');
  await docker([...compose,'exec','-T','postgres','pg_restore','-U','orchestra_migrator','--single-transaction','--exit-on-error','-d','orchestra_shared'],Buffer.from(payload.dump,'base64'));
  await helper(`const fs=require('node:fs/promises'),path=require('node:path'),Redis=require('ioredis');const {PrivateLocalStorageDriver}=await import('./dist/src/lib/storage/private-local.js');
   if((await fs.readdir('/var/lib/orchestra')).length)throw Error();await fs.chmod('/var/lib/orchestra',0o700);const store=new PrivateLocalStorageDriver('/var/lib/orchestra');
   for(const file of data.files){const bytes=Buffer.from(file.body,'base64');await store.putObject({key:file.key,body:bytes,contentType:'application/octet-stream'});if(!(await store.getObject(file.key)).equals(bytes))throw Error();}
   async function own(p){if((await fs.lstat(p)).isDirectory())for(const name of await fs.readdir(p))await own(path.join(p,name));await fs.chown(p,1000,1000);}await own('/var/lib/orchestra');
   const redis=new Redis('redis://redis:6379',{maxRetriesPerRequest:1});if(await redis.dbsize())throw Error();for(const row of data.keys){const ttl=row.expires===null?0:row.expires-Date.now();if(row.expires!==null&&ttl<=0)continue;await redis.restore(row.key,ttl,Buffer.from(row.dump,'base64'));}await redis.quit();`,payload,true);
  console.log('PASS restore written to new isolated volumes. Services remain stopped. Run the documented migration/role provisioning, then verify before cutover.');
 }finally{interrupted=false;await docker([...compose,'stop','postgres','redis']);}
}
