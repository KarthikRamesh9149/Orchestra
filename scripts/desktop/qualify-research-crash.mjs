// Real packaged service + PostgreSQL + SIGKILL. Provider is deliberately paused
// after the durable claim. This is fault proof, never live AI certification.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile('.desktop/latest-package.txt','utf8')).trim();
const root=await mkdtemp('/private/tmp/orchestra-step7-research-crash-'),proof={root,packageRoot,profile,passed:[]};
const app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??''},timeout:60000});
const page=await app.firstWindow();
const probe=(projectId,mode,runId)=>app.evaluate(async({app,safeStorage},{worker,projectId,mode,runId})=>{
 const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path'),cp=process.getBuiltinModule('child_process');
 const base=path.join(app.getPath('userData'),'local-runtime');
 const secret=JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(base,'credentials.enc'))));
 const port=(await fs.readFile(path.join(base,'postgres/postmaster.pid'),'utf8')).split('\n')[3];
 const url=`postgresql://orchestra_desktop_runtime:${secret.runtime}@127.0.0.1:${port}/orchestra`;
 return await new Promise((resolve,reject)=>{
  const child=cp.spawn(path.join(process.resourcesPath,'runtime/native/node/bin/node'),[worker,path.join(process.resourcesPath,'runtime/backend'),projectId,mode,runId??''],{env:{PATH:'',ORCHESTRA_FAULT_DATABASE_URL:url},stdio:['ignore','ignore','ignore','ipc']});
  let result={},killed=false;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Fault probe timed out'));},20000);
  child.on('message',message=>{Object.assign(result,message);if(message.claimed){killed=child.kill('SIGKILL');}});
  child.on('error',()=>{clearTimeout(timer);reject(Error('Fault probe could not start'));});
  child.on('exit',(code,signal)=>{clearTimeout(timer);if((killed&&signal==='SIGKILL')||code===0)resolve({...result,killed});else reject(Error('Fault probe failed'));});
 });
},{worker:resolve('scripts/desktop/research-crash-worker.mjs'),projectId,mode,runId});
try{
 await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok&&!boot.data.aiConfigured);
 const projectId=boot.data.workspaces.find(w=>w.current)?.projectId;assert(projectId);
 const claim=await probe(projectId,'claim');assert(claim.killed&&claim.claimed&&claim.runId);proof.runId=claim.runId;
 const active=await probe(projectId,'inspect',claim.runId);assert.equal(active.status,'running');assert(active.expiresAt>Date.now());
 proof.passed.push('Actual packaged research handler was SIGKILLed after its durable claim; active lease is not prematurely reset');
 console.log('Waiting for the real two-minute lease expiry, without changing database clocks or production settings.');
 await new Promise(r=>setTimeout(r,Math.max(0,active.expiresAt-Date.now()+250)));
 const recovered=await probe(projectId,'inspect',claim.runId);assert.equal(recovered.status,'failed');
 proof.passed.push('Real elapsed lease expiry reconciles the run to explicitly failed, not permanently running');
}catch(error){proof.failure=String(error).slice(0,1000);process.exitCode=1;}
finally{await app.close();await writeFile(join(root,'report.json'),JSON.stringify(proof,null,2),{mode:0o600});console.log(JSON.stringify(proof));}
