// Kill only our owned native runtime after observing its durable parse claim.
// A real PDF, PostgreSQL lease and retry are used. No customer data or SQL writes.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {createDesktopWorkerCrashPdf} from './pdf-fixtures.mjs';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const output=await mkdtemp('/private/tmp/orchestra-step7-worker-crash-');
const proof={profile,packageRoot,output,passed:[]};
const pdf=await createDesktopWorkerCrashPdf();
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??''},timeout:60000});
let app=await launch(),page=await app.firstWindow();page.setDefaultTimeout(60000);
const query=sql=>app.evaluate(async({app,safeStorage},sql)=>{
 const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path'),cp=process.getBuiltinModule('child_process');
 const root=path.join(app.getPath('userData'),'local-runtime');
 const vault=JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(root,'credentials.enc'))));
 const port=(await fs.readFile(path.join(root,'postgres/postmaster.pid'),'utf8')).split('\n')[3];
 return new Promise((resolve,reject)=>{
  const child=cp.spawn(path.join(process.resourcesPath,'runtime/native/pgsql/bin/psql'),['-X','-w','-h','127.0.0.1','-p',port,'-U','orchestra_desktop_runtime','-d','orchestra','-A','-t','-c',sql],{env:{PATH:'',PGPASSWORD:vault.runtime},stdio:['ignore','pipe','ignore']});
  let out='';const timer=setTimeout(()=>{child.kill();reject(new Error('Diagnostic timeout'));},10000);
  child.stdout.on('data',chunk=>{out+=chunk;if(out.length>4096)child.kill();});child.on('error',()=>{clearTimeout(timer);reject(new Error('Diagnostic failed'));});child.on('exit',code=>{clearTimeout(timer);code===0?resolve(out.trim()):reject(new Error('Diagnostic failed'));});
 });
},sql);
try{
 await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok&&!boot.data.aiConfigured);
 assert.equal(await query("SELECT count(*) FROM desktop_jobs WHERE status IN ('queued','running')"),'0','Synthetic fixture must be idle');
 const title='Synthetic-Crash-'+Date.now();proof.title=title;
 await page.locator('input[type=file]').first().setInputFiles({name:title+'.pdf',mimeType:'application/pdf',buffer:pdf});
 await page.getByRole('button',{name:'Upload',exact:true}).click();
 let job;
 for(let n=0;n<100;n++){
  const observed=await query("SELECT id FROM desktop_jobs WHERE name='parse_document' AND status='running' ORDER BY created_at DESC LIMIT 1");
  if(/^[a-f0-9-]{36}$/.test(observed)){job=observed;break;}
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert(job,'No durable running parse claim observed; no process killed');proof.jobId=job;
 const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(row=>row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
 const owned=rows.filter(row=>Number(row[2])===app.process().pid&&row[3].includes(packageRoot)&&row[3].endsWith('/backend/dist/src/desktop/native-host.js'));
 assert.equal(owned.length,1);process.kill(Number(owned[0][1]),'SIGKILL');
 await page.waitForFunction(async()=>(await window.orchestra.status()).state==='failed');
 proof.passed.push('actual SIGKILL after durable parse claim reports runtime failure');
 await app.close();app=await launch();page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 let final;
 for(let n=0;n<90;n++){
  final=await query(`SELECT status||'|'||attempts FROM desktop_jobs WHERE id='${job}'`);
  if(final.startsWith('completed|')||final.startsWith('failed|'))break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 proof.finalJob=final;assert.equal(final,'failed|1');
 proof.passed.push('lease recovery explicitly fails abandoned work rather than spinning or blindly repeating effects');
 await page.reload();const actions=page.getByRole('button',{name:new RegExp('^Open actions for '+title+'(?:\\.pdf)?$')});
 await actions.waitFor();assert.equal(await actions.count(),1);
 await actions.click();await page.getByRole('button',{name:'Retry processing',exact:true}).click();
 let retried;
 for(let n=0;n<60;n++){
  retried=await query(`SELECT status FROM desktop_jobs WHERE name='parse_document' AND id<>'${job}' AND payload->>'documentVersionId'=(SELECT payload->>'documentVersionId' FROM desktop_jobs WHERE id='${job}') ORDER BY created_at DESC LIMIT 1`);
  if(retried==='completed'||retried==='failed')break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.equal(retried,'completed');proof.retryJob=retried;
 await page.reload();await actions.waitFor();assert.equal(await actions.count(),1);
 proof.passed.push('native UI retry completes a new parse revision without re-upload or duplicate source');
 proof.passed.push('exactly one source document survives the real crash and retry');
}catch(error){proof.failure=String(error);process.exitCode=1;}
finally{await writeFile(join(output,'report.json'),JSON.stringify(proof,null,2),{mode:0o600});await app.close();console.log(JSON.stringify(proof));}
