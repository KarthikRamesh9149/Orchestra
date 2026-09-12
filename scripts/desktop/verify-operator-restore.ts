/** Synthetic-only acceptance for the operator recovery command. */
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const target=process.argv[2];if(!target||!/^orchestra-operator-restore-[a-z0-9-]+$/.test(target))throw Error('Explicit synthetic restore project required');
const account=JSON.parse(await readFile('.desktop/self-host-v1-qualification/bootstrap-account.json','utf8'));assert.equal(account.email,'owner@qualification.invalid');
async function docker(args:string[],input?:string){return new Promise<string>((resolve,reject)=>{const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.stderr.resume();child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error('Synthetic restore verification failed')));child.stdin.end(input);});}
const sql=(project:string,query:string)=>docker(['exec',`${project}-postgres-1`,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','orchestra_migrator','-d','orchestra_shared','-c',query]);
assert.equal(Number(await sql(target,"SELECT count(*) FROM users WHERE email NOT LIKE '%@qualification.invalid'")),0);
const fingerprints=`SELECT json_agg(row_to_json(x) ORDER BY name) FROM (
 SELECT 'documents' name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),'')) hash FROM documents t
 UNION ALL SELECT 'document_versions',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),'')) FROM document_versions t
 UNION ALL SELECT 'brain_nodes',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),'')) FROM brain_nodes t
 UNION ALL SELECT 'project_members',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),'')) FROM project_members t) x`;
assert.deepEqual(JSON.parse(await sql(target,fingerprints)),JSON.parse(await sql('orchestra-shared-v1',fingerprints)));
const files=JSON.parse(await sql(target,`SELECT coalesce(json_agg(row_to_json(x)),'[]') FROM (SELECT DISTINCT ON (v.document_id) v.document_id,v.project_id,v.checksum_sha256 FROM document_versions v JOIN project_members m ON m.project_id=v.project_id JOIN users u ON u.id=m.user_id WHERE u.email='owner@qualification.invalid' AND v.status='ready' ORDER BY v.document_id,v.created_at DESC LIMIT 10) x`));
assert(files.length>0);
const program=`let text='';process.stdin.on('data',b=>text+=b);process.stdin.on('end',async()=>{try{const {account,files}=JSON.parse(text),crypto=require('node:crypto');const call=async(path,body,token)=>{const r=await fetch('http://127.0.0.1:3000'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error();return (await r.json()).data;};const login=await call('/v1/auth/login',{...account,sessionMode:'bearer'});for(const file of files){const r=await fetch('http://127.0.0.1:3000/v1/projects/'+file.project_id+'/documents/'+file.document_id+'/file',{headers:{authorization:'Bearer '+login.accessToken}});if(!r.ok||crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex')!==file.checksum_sha256)throw Error();}await call('/v1/auth/logout',{refreshToken:login.refreshToken},login.accessToken);console.log('PASS restored login, '+files.length+' exact-hash authenticated downloads and logout');}catch{process.exitCode=1;}});`;
console.log((await docker(['exec','-i',`${target}-api-1`,'node','-e',program],JSON.stringify({account,files}))).trim());
console.log('PASS original/restored document, version, accepted-brain and membership fingerprints match');
