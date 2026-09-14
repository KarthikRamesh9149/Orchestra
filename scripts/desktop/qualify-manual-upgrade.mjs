// Controlled internal-beta update qualification, not an automatic updater.
// All writes, process termination and rollback target a NEW synthetic copy.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile,mkdtemp,lstat,rename,access,mkdir} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const [oldPackage,newPackage,source]=process.argv.slice(2);
assert(oldPackage?.endsWith('/Orchestra Desktop Internal-darwin-arm64'));
assert(newPackage?.startsWith(resolve('.desktop/packages')+'/'));
assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(source??''));
assert.equal(JSON.parse(await readFile(join(source,'result.json'),'utf8')).profile,source);
const absent=async path=>{try{await access(path);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}};
const cold=async profile=>{assert(await absent(join(profile,'local-runtime/postgres/postmaster.pid')),'Database must be stopped');assert(await absent(join(profile,'SingletonLock')),'Application must be stopped');};
await cold(source);
const root=await mkdtemp('/private/tmp/orchestra-step7-manual-upgrade-');
const profile=join(root,'profile'),backup=join(root,'profile-backup'),appName='Orchestra Desktop Internal.app';
const proof={root,oldPackage,newPackage,passed:[],scope:'manual internal update and full-profile rollback; not automatic updater certification'};
const copy=(from,to)=>execFileSync('/bin/cp',['-cR',from,to],{stdio:'pipe'});
copy(source,profile);
let app;
async function launch(packageRoot){
 app=await _electron.launch({executablePath:join(packageRoot,appName,'Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??''},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();
 const state=await page.evaluate(async()=>{
  const boot=await window.orchestra.bootstrap();if(!boot.ok||boot.data.aiConfigured)throw Error('Offline synthetic workspace required');
  const projectId=boot.data.workspaces.find(w=>w.current)?.projectId;if(!projectId)throw Error('Missing project');
  const get=async url=>{const response=await fetch(url);if(!response.ok)throw Error('Snapshot request failed');return (await response.json()).data;};
  const documents=await get(`/v1/projects/${projectId}/documents`),sessions=await get(`/v1/projects/${projectId}/socrates/sessions?limit=30`);
  const transcripts=[];for(const session of sessions)transcripts.push({id:session.id,messages:await get(`/v1/projects/${projectId}/socrates/sessions/${session.id}/messages`)});
  return {projectId,documents:documents.map(d=>({id:d.id,title:d.title})),transcripts};
 });
 const version=await app.evaluate(({app})=>app.getVersion());
 return {page,state,version};
}
async function stop(){if(app){await app.close();app=undefined;}for(let n=0;n<100;n++){if(await absent(join(profile,'local-runtime/postgres/postmaster.pid')))break;await new Promise(r=>setTimeout(r,100));}await cold(profile);}
try{
 const before=await launch(oldPackage);assert.equal(before.version,'0.0.4');await stop();copy(profile,backup);
 proof.passed.push('0.0.4 opens a populated isolated profile; clean shutdown precedes whole-profile backup');
 // Actually interrupt the copy process; no partially copied application is run.
 const partial=join(root,'interrupted');await mkdir(partial,{mode:0o700});
 const child=spawn('/bin/cp',['-R',join(newPackage,appName),join(partial,appName)],{stdio:'ignore'});
 const exited=once(child,'exit');
 for(let n=0;n<500;n++){if(!(await absent(join(partial,appName,'Contents'))))break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(child.exitCode,null,'Copy must still be active for an interruption test');child.kill('SIGKILL');await exited;
 assert.equal(child.signalCode,'SIGKILL');
 const unchanged=await launch(oldPackage);assert.deepEqual(unchanged.state,before.state);await stop();
 proof.passed.push('Actual SIGKILL during candidate copy leaves old application and populated data usable');
 const installed=join(root,'installed');await mkdir(installed,{mode:0o700});copy(join(newPackage,appName),join(installed,appName));
 const upgraded=await launch(installed);assert.equal(upgraded.version,'0.0.5');assert.deepEqual(upgraded.state,before.state);
 // Deliberately create synthetic post-update data so rollback must restore the
 // earlier profile, not merely relaunch old code over the newer state.
 await upgraded.page.evaluate(async projectId=>{const r=await fetch(`/v1/projects/${projectId}/socrates/sessions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageContext:'dashboard_project'})});if(!r.ok)throw Error('Synthetic change failed');},before.state.projectId);
 await stop();proof.passed.push('Installed 0.0.5 preserves document IDs and full transcripts and accepts a real new session');
 await rename(profile,join(root,'retained-post-update-profile'));copy(backup,profile);
 const restored=await launch(oldPackage);assert.deepEqual(restored.state,before.state);await stop();
 proof.passed.push('Whole-profile restore plus 0.0.4 recovers exact pre-update transcripts and sources; newer profile retained separately');
 const retry=await launch(installed);assert.deepEqual(retry.state,before.state);await stop();
 proof.passed.push('Retrying 0.0.5 after rollback preserves the restored workspace');
 // Recoverable removal of only our synthetic installed bundle. No global app,
 // Launch Services settings or user data is deleted.
 await rename(join(installed,appName),join(root,'removed-app'));
 await access(join(profile,'local-runtime/credentials.enc'));
 await access(join(profile,'local-runtime/postgres/PG_VERSION'));
 await rename(join(root,'removed-app'),join(installed,appName));
 const reinstalled=await launch(installed);assert.deepEqual(reinstalled.state,before.state);await stop();
 proof.passed.push('Removing and restoring only the app bundle retains the complete usable workspace');
}catch(error){proof.failure=String(error).slice(0,2000);process.exitCode=1;}
finally{if(app)await app.close();await writeFile(join(root,'report.json'),JSON.stringify(proof,null,2),{mode:0o600});console.log(JSON.stringify(proof));}
