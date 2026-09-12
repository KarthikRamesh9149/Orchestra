/** Real recovery of a disposable self-host stack. Refuses customer accounts. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {encryptBackup,decryptBackup} from '../../src/lib/storage/encrypted-backup.js';

const root=resolve('.desktop/self-host-v1-qualification');
const account=JSON.parse(await readFile(join(root,'bootstrap-account.json'),'utf8'));
const config=JSON.parse(await readFile(join(root,'application.json'),'utf8'));
assert.equal(account.email,'owner@qualification.invalid');assert.equal(config.APP_BASE_URL,'https://localhost:4446');
const env={...process.env,SELF_HOST_CONFIG_DIR:root,ORCHESTRA_HTTPS_ORIGIN:'https://localhost:4446',SELF_HOST_WEB_PORT:'0'};
const base=['compose','-f','infra/self-host/v1/compose.yaml'];
const source=[...base,'-p','orchestra-shared-v1'];
const name='orchestra-recovery-'+randomBytes(6).toString('hex'),target=[...base,'-p',name];
const output=await mkdtemp(resolve('.desktop/step6-stack-recovery-'));
const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
async function docker(args:string[],input?:Buffer){return new Promise<Buffer>((resolve,reject)=>{
 const child=spawn('docker',args,{env,stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[];let size=0,diagnostic='';
 const timer=setTimeout(()=>{child.kill();reject(Error('Disposable operation exceeded 120 seconds'));},120000);
 child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>128*1024*1024){child.kill();reject(Error('Snapshot bounds exceeded'));}else chunks.push(b);});
 // Do not print container errors containing request/configuration content.
 child.stderr.on('data',(b:Buffer)=>{const safe=b.toString().match(/QUALIFICATION_FAILURE [a-zA-Z0-9_-]+ [a-zA-Z0-9_-]+/);if(safe)diagnostic=safe[0];});child.stdin.on('error',()=>{});child.on('error',reject);
 child.on('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(chunks)):reject(Error(`Disposable Docker operation failed (${code}): ${args.slice(0,8).join(' ')} ${diagnostic}`));});child.stdin.end(input);
});}
const sql=(stack:string[],query:string)=>docker([...stack,'exec','-T','postgres','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','orchestra_migrator','-d','orchestra_shared','-c',query]);
async function node(stack:string[],program:string,input:unknown={},user?:string){
 const wrapped=`let input='',phase='start';process.stdin.on('data',b=>input+=b);process.stdin.on('end',async()=>{try{const data=JSON.parse(input);${program}}catch(error){process.stderr.write('QUALIFICATION_FAILURE '+phase+' '+(error.code||error.name));process.exitCode=1;}});`;
 return docker([...stack,'run','--rm','--no-deps',...(user?['--user',user,'--cap-add','CHOWN']:[]),'--entrypoint','node','api','-e',wrapped],Buffer.from(JSON.stringify(input)));
}
const fingerprints=`CREATE TEMP TABLE comparison(name text,rows bigint,hash text);
 DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
 EXECUTE format('INSERT INTO comparison SELECT %L,count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E''\\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r',t.tablename,t.tablename);END LOOP;END $$;
 SELECT jsonb_agg(to_jsonb(comparison) ORDER BY name)::text FROM comparison;`;
const sourceText='Synthetic restored queue acceptance: launch is 21 October 2026; changes require human approval.';
const authProgram=`const call=async(path,method='GET',body,access)=>{const r=await fetch('http://api:3000'+path,{method,headers:{'content-type':'application/json',...(access?{authorization:'Bearer '+access}:{})},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('Request failed');return (await r.json()).data;};
 const login=await call('/v1/auth/login','POST',{...data.account,sessionMode:'bearer'});const token=login.accessToken;`;
let paused=false,targetStarted=false;
try{
 assert.equal(Number((await sql(source,"SELECT count(*) FROM users WHERE email NOT LIKE '%@qualification.invalid'")).toString()),0);
 // A real upload remains queued at the backup boundary, rather than an invented Redis marker.
 await docker([...source,'stop','worker']);paused=true;
 const pending=JSON.parse((await node(source,authProgram+`
 const workspaces=await call('/v1/me/workspaces','GET',undefined,token);const projectId=workspaces[0].projectId;
 const uploaded=await call('/v1/projects/'+projectId+'/documents/upload','POST',{kind:'reference',title:'Synthetic queued restore',visibility:'internal',pastedText:data.source},token);
 await call('/v1/auth/logout','POST',{refreshToken:login.refreshToken},token);
 process.stdout.write(JSON.stringify({projectId,...uploaded}));`,{account,source:sourceText})).toString());
 assert.match(pending.documentVersionId,/^[a-f0-9-]{36}$/);
 await docker([...source,'--profile','tls','stop','tls','web','api']);
 const before=JSON.parse((await sql(source,fingerprints)).toString());
 const dump=await docker([...source,'exec','-T','postgres','pg_dump','-U','orchestra_migrator','-Fc','orchestra_shared']);
 const snapshotProgram=`const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),Redis=require('ioredis');
 const files=[];let bytes=0;
 async function walk(dir,prefix=''){for(const name of await fs.readdir(dir)){const p=path.join(dir,name),s=await fs.lstat(p),key=prefix+name;if(s.isSymbolicLink())throw Error('Unsafe file');if(s.isDirectory())await walk(p,key+'/');else{if(!s.isFile()||(bytes+=s.size)>64000000||files.length>=10000)throw Error('Bounds');const b=await fs.readFile(p);files.push({key,body:b.toString('base64'),hash:crypto.createHash('sha256').update(b).digest('hex')});}}}
 await walk('/var/lib/orchestra/files');const redis=new Redis('redis://redis:6379',{maxRetriesPerRequest:1});const keys=[];let cursor='0';
 do{const page=await redis.scan(cursor,'COUNT',1000);cursor=page[0];for(const key of page[1]){const dumped=await redis.dumpBuffer(key),ttl=await redis.pttl(key);if(dumped&&ttl!==-2)keys.push({key,dump:dumped.toString('base64'),expires:ttl<0?null:Date.now()+ttl});if(keys.length>100000)throw Error('Bounds');}}while(cursor!=='0');
 await redis.quit();process.stdout.write(JSON.stringify({files,keys}));`;
 const snapshot=JSON.parse((await node(source,snapshotProgram)).toString());
 assert(snapshot.keys.some((row:any)=>row.key.includes(pending.documentVersionId)),'The pending real document job must be in the Redis snapshot');
 const passphrase=randomBytes(32).toString('hex');
 const archive=encryptBackup(Buffer.from(JSON.stringify({version:1,dump:dump.toString('base64'),hash:hash(dump),...snapshot})),passphrase);
 await writeFile(join(output,'synthetic-stack.orchbk'),archive,{flag:'wx',mode:0o600});
 // Synthetic inspection only: a customer/operator passphrase must be stored separately.
 await writeFile(join(output,'synthetic-passphrase'),passphrase,{flag:'wx',mode:0o600});
 const corrupt=Buffer.from(archive);corrupt[corrupt.length-1]^=1;assert.throws(()=>decryptBackup(corrupt,passphrase));
 const restored=JSON.parse(decryptBackup(archive,passphrase).toString());assert.equal(hash(Buffer.from(restored.dump,'base64')),restored.hash);
 await docker([...target,'up','-d','--wait','postgres','redis']);targetStarted=true;
 assert.equal(Number((await sql(target,"SELECT count(*) FROM pg_tables WHERE schemaname='public'")).toString()),0,'Restore only into this new empty database');
 await sql(target,'CREATE ROLE orchestra_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; DROP SCHEMA extensions;');
 await docker([...target,'exec','-T','postgres','pg_restore','-U','orchestra_migrator','--exit-on-error','--single-transaction','-d','orchestra_shared'],Buffer.from(restored.dump,'base64'));
 assert.deepEqual(JSON.parse((await sql(target,fingerprints)).toString()),before);
 const restoreProgram=`const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),Redis=require('ioredis');
 phase='storage_import';const {PrivateLocalStorageDriver}=await import('./dist/src/lib/storage/private-local.js');
 await fs.mkdir('/var/lib/orchestra/files',{recursive:true,mode:0o700});if((await fs.readdir('/var/lib/orchestra/files')).length)throw Error('Nonempty restore root');
 phase='storage_write';const store=new PrivateLocalStorageDriver('/var/lib/orchestra/files');const seen=new Set();
 for(const file of data.files){if(seen.has(file.key))throw Error('Duplicate path');seen.add(file.key);const b=Buffer.from(file.body,'base64');if(crypto.createHash('sha256').update(b).digest('hex')!==file.hash)throw Error('Hash mismatch');await store.putObject({key:file.key,body:b,contentType:'application/octet-stream'});}
 async function own(p){if((await fs.lstat(p)).isDirectory())for(const name of await fs.readdir(p))await own(path.join(p,name));await fs.chown(p,1000,1000);}await own('/var/lib/orchestra');
 phase='redis_restore';const redis=new Redis('redis://redis:6379',{maxRetriesPerRequest:1});if(await redis.dbsize())throw Error('Nonempty target queue');
 for(const row of data.keys){const ttl=row.expires===null?0:row.expires-Date.now();if(row.expires!==null&&ttl<=0)continue;await redis.restore(row.key,ttl,Buffer.from(row.dump,'base64'));}
 await redis.quit();process.stdout.write('restored');`;
 await node(target,restoreProgram,restored,'root');
 // Reapply immutable migrations on populated restored data; no downgrade or skipped migration.
 await docker([...target,'run','--rm','migrate']);
 assert.deepEqual(JSON.parse((await sql(target,fingerprints)).toString()),before);
 await docker([...target,'up','-d','--wait','api','worker','web']);
 const deadline=Date.now()+60000;let status='';
 while(Date.now()<deadline){status=(await sql(target,`SELECT status FROM document_versions WHERE id='${pending.documentVersionId}'`)).toString().trim();if(['ready','partial','failed'].includes(status))break;await new Promise(resolve=>setTimeout(resolve,500));}
 assert(['ready','partial'].includes(status),`Restored pending job did not complete: ${status}`);
 const result=await node(target,authProgram+`
 const r=await fetch('http://api:3000/v1/projects/'+data.pending.projectId+'/documents/'+data.pending.documentId+'/file',{headers:{authorization:'Bearer '+token}});if(!r.ok||await r.text()!==data.source)throw Error('Restored file mismatch');
 const sessions=await call('/v1/desktop/session/bootstrap','GET',undefined,token);if(sessions.user.email!==data.account.email)throw Error('Restored identity mismatch');
 await call('/v1/auth/logout','POST',{refreshToken:login.refreshToken},token);process.stdout.write('verified');`,{account,pending,source:sourceText});
 assert.equal(result.toString(),'verified');
 await writeFile(join(output,'evidence.json'),JSON.stringify({source:'synthetic local stack',target:name,tables:before.length,files:restored.files.length,queueKeys:restored.keys.length,pendingDocumentStatus:status,fullApplicationBoot:true,authenticatedFileBytes:true,populatedMigrationReapply:true,actualOldVersionUpgrade:false,twoComputerGate:'pending'},null,2),{flag:'wx',mode:0o600});
 console.log(`PASS isolated full-stack restore: ${before.length} tables, ${restored.files.length} files, Redis queue, real pending job, authenticated download, and populated migration reapply. Evidence: ${output}`);
}finally{
 try{if(paused)await docker([...source,'--profile','tls','start','api','worker','web','tls']);}
 finally{if(targetStarted)await docker([...target,'stop']);}
 // Retain new target volumes and encrypted evidence for inspection. No deletion or production access.
}
