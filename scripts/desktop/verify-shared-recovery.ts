/** Disposable single-machine qualification, never an operator/customer backup command. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {encryptBackup,decryptBackup} from '../../src/lib/storage/encrypted-backup.js';
import {PrivateLocalStorageDriver} from '../../src/lib/storage/private-local.js';

const configRoot=resolve('.desktop/self-host-v1-qualification');
const config=JSON.parse(await readFile(join(configRoot,'application.json'),'utf8'));
const account=JSON.parse(await readFile(join(configRoot,'bootstrap-account.json'),'utf8'));
assert.equal(account.email,'owner@qualification.invalid');
assert.equal(config.APP_BASE_URL,'https://localhost:4446');
const env={...process.env,SELF_HOST_CONFIG_DIR:configRoot,ORCHESTRA_HTTPS_ORIGIN:'https://localhost:4446'};
const compose=['compose','-f','infra/self-host/v1/compose.yaml'];
async function docker(args:string[],input?:Buffer){
 return await new Promise<Buffer>((resolve,reject)=>{
  const child=spawn('docker',args,{env,stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[];let size=0,errors='';
  child.stdout.on('data',(part:Buffer)=>{size+=part.length;if(size>128*1024*1024){child.kill();reject(new Error('Qualification snapshot exceeds bounded size'));}else chunks.push(part);});
  child.stderr.on('data',(part:Buffer)=>{errors=(errors+part.toString()).slice(-2048);});
  child.on('error',reject);child.stdin.on('error',()=>{});
  child.on('close',code=>code===0?resolve(Buffer.concat(chunks)):reject(new Error(`Disposable Docker operation failed (${code}): ${errors}`)));
  child.stdin.end(input);
 });
}
const sql=(database:string,query:string)=>docker([...compose,'exec','-T','postgres','psql','-X','-v','ON_ERROR_STOP=1','-U','orchestra_migrator','-d',database,'-At','-c',query]);
const sha=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const target='orchestra_restore_'+randomBytes(6).toString('hex');
const output=await mkdtemp(resolve('.desktop/step6-recovery-'));
const manifestQuery=`CREATE TEMP TABLE qualification_fingerprints(name text, rows bigint, hash text);
 DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename LOOP
 EXECUTE format('INSERT INTO qualification_fingerprints SELECT %L,count(*),md5(coalesce(string_agg(to_jsonb(r)::text,E''\\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r',t.tablename,t.tablename);
 END LOOP; END $$;
 SELECT jsonb_agg(to_jsonb(qualification_fingerprints) ORDER BY name)::text FROM qualification_fingerprints;`;
const fingerprint=async(database:string)=>JSON.parse((await sql(database,manifestQuery)).toString().trim().split('\n').at(-1)!);
let stopped=false;
try{
 const foreign=Number((await sql('orchestra_shared',"SELECT count(*) FROM users WHERE email NOT LIKE '%@qualification.invalid'")).toString().trim());
 assert.equal(foreign,0,'Refusing to export any non-synthetic account');
 await docker([...compose,'--profile','tls','stop','tls','web','api','worker']);stopped=true;
 const before=await fingerprint('orchestra_shared');
 const dump=await docker([...compose,'exec','-T','postgres','pg_dump','-U','orchestra_migrator','-Fc','orchestra_shared']);
 // The one-shot application image can read only this Compose project's private storage volume.
 const fileReader=`const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
 (async()=>{const root='/var/lib/orchestra/files',files=[];let total=0;
 async function walk(dir,prefix=''){for(const name of await fs.readdir(dir)){const p=path.join(dir,name),s=await fs.lstat(p),key=prefix+name;
 if(s.isSymbolicLink())throw Error('No symlinks');if(s.isDirectory())await walk(p,key+'/');else{if(!s.isFile()||(total+=s.size)>64000000||files.length>=10000)throw Error('Snapshot bounds');const b=await fs.readFile(p);files.push({key,body:b.toString('base64'),sha256:crypto.createHash('sha256').update(b).digest('hex')});}}}
 await walk(root);process.stdout.write(JSON.stringify(files));})().catch(()=>process.exit(1));`;
 const files=JSON.parse((await docker([...compose,'run','--rm','--no-deps','--entrypoint','node','api','-e',fileReader])).toString()) as Array<{key:string;body:string;sha256:string}>;
 assert(files.length>0,'Run shared upload qualification first');
 const passphrase=randomBytes(32).toString('hex');
 const archive=encryptBackup(Buffer.from(JSON.stringify({version:1,dump:dump.toString('base64'),dumpSha256:sha(dump),files})),passphrase);
 await writeFile(join(output,'synthetic-database-and-files.orchbk'),archive,{flag:'wx',mode:0o600});
 await writeFile(join(output,'synthetic-backup-passphrase'),passphrase,{flag:'wx',mode:0o600});
 // Backup/passphrase co-location is acceptable only for this disposable fixture, not an operator recommendation.
 const damaged=Buffer.from(archive);damaged[damaged.length-1]^=1;
 assert.throws(()=>decryptBackup(damaged,passphrase));assert.throws(()=>decryptBackup(archive,'wrong-synthetic-passphrase'));
 const restored=JSON.parse(decryptBackup(archive,passphrase).toString());
 assert.equal(sha(Buffer.from(restored.dump,'base64')),restored.dumpSha256);
 await sql('postgres',`CREATE DATABASE ${target}`);
 await sql('postgres',`ALTER DATABASE ${target} SET search_path=public,extensions`);
 await docker([...compose,'exec','-T','postgres','pg_restore','-U','orchestra_migrator','--exit-on-error','--single-transaction','-d',target],Buffer.from(restored.dump,'base64'));
 assert.deepEqual(await fingerprint(target),before,'Every public table must retain all row content, including provenance and accepted decisions');
 const filesRoot=join(output,'restored-files');await mkdir(filesRoot,{mode:0o700});const storage=new PrivateLocalStorageDriver(filesRoot);
 const seen=new Set<string>();
 for(const file of restored.files as typeof files){assert(!seen.has(file.key));seen.add(file.key);const body=Buffer.from(file.body,'base64');assert.equal(sha(body),file.sha256);await storage.putObject({key:file.key,body,contentType:'application/octet-stream'});assert.equal(sha(await storage.getObject(file.key)),file.sha256);}
 await writeFile(join(output,'evidence.json'),JSON.stringify({source:'disposable localhost self-host fixture only',targetDatabase:target,tableCount:before.length,fileCount:files.length,databaseRowsAndFileHashesPreserved:true,wrongPassphraseAndTamperRejected:true,queueRestore:'not tested',fullApplicationRestore:'not tested',twoComputerGate:'pending'},null,2),{flag:'wx',mode:0o600});
 console.log(`PASS encrypted database/file restore: ${before.length} tables and ${files.length} files; tamper and wrong password rejected. Queue and restored-application boot remain separate checks.`);
}finally{
 if(stopped)await docker([...compose,'--profile','tls','start','api','worker','web','tls']);
 // Retain only this newly created fixture database and private evidence for inspection; never drop a working database.
}
