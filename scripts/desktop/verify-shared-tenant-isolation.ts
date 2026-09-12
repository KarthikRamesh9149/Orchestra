/** Disposable local fixture only: project creator is not a tenant membership. */
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const account=JSON.parse(await readFile('.desktop/self-host-v1-qualification/bootstrap-account.json','utf8'));assert.equal(account.email,'owner@qualification.invalid');
async function docker(args:string[],input?:string){return new Promise<string>((resolve,reject)=>{const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.stderr.resume();child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error('Synthetic tenant check failed')));child.stdin.end(input);});}
const sql=(query:string)=>docker(['exec','orchestra-shared-v1-postgres-1','psql','-XqAt','-v','ON_ERROR_STOP=1','-U','orchestra_migrator','-d','orchestra_shared','-c',query]);
assert.equal(Number(await sql("SELECT count(*) FROM users WHERE email NOT LIKE '%@qualification.invalid'")),0);
const org=randomUUID(),project=randomUUID(),user=(await sql("SELECT id FROM users WHERE email='owner@qualification.invalid'")).trim();assert.match(user,/^[a-f0-9-]{36}$/);
await sql(`BEGIN; INSERT INTO organizations(id,name,slug,updated_at) VALUES ('${org}','Synthetic other tenant','synthetic-${org}',now()); INSERT INTO projects(id,org_id,name,slug,status,created_by,updated_at) VALUES ('${project}','${org}','Synthetic foreign project','synthetic-${project}','active','${user}',now()); COMMIT;`);
const program=`let raw='';process.stdin.on('data',b=>raw+=b);process.stdin.on('end',async()=>{try{const {account,project}=JSON.parse(raw);const call=async(path,method='GET',body,token)=>fetch('http://127.0.0.1:3000'+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const login=await call('/v1/auth/login','POST',{...account,sessionMode:'bearer'});if(!login.ok)throw Error();const auth=(await login.json()).data;
 const checks=[['/v1/projects/'+project+'/settings','GET'],['/v1/projects/'+project+'/documents','GET'],['/v1/projects/'+project+'/truth-inbox','GET'],['/v1/projects/'+project+'/settings','PATCH',{name:'Rejected change'}],['/v1/me/workspaces/switch','POST',{projectId:project}]];
 for(const [path,method,body] of checks){const r=await call(path,method,body,auth.accessToken);if(![403,404].includes(r.status))throw Error();await r.body?.cancel();}
 const exported=await call('/v1/desktop/projects/'+project+'/transfer/export','POST',{passphrase:'synthetic-not-a-real-secret'},auth.accessToken);if(exported.status!==400)throw Error();const response=await exported.json();if(response.data?.archiveBase64)throw Error();
 await call('/v1/auth/logout','POST',{refreshToken:auth.refreshToken},auth.accessToken);console.log('PASS six real cross-tenant read, write, switch and transfer-denial checks');}catch{process.exitCode=1;}});`;
console.log((await docker(['exec','-i','orchestra-shared-v1-api-1','node','-e',program],JSON.stringify({account,project}))).trim());
assert.equal((await sql(`SELECT name FROM projects WHERE id='${project}'`)).trim(),'Synthetic foreign project');
