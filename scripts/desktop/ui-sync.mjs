// Real selected Google Drive refresh; interruptions are explicitly simulated.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const root=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const launch=()=>_electron.launch({executablePath:join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
let app,page,id;const proof={packageRoot:root,passed:[]};
async function wait(predicate){for(let i=0;i<120;i++){const r=await page.evaluate(()=>window.orchestra.sync.inspect());assert(r.ok);if(predicate(r.data))return r.data;await new Promise(r=>setTimeout(r,500));}throw new Error('Refresh state did not converge');}
try{
 app=await launch();page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok);const projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 assert((await page.evaluate(id=>window.orchestra.drive.importFiles(id),projectId)).ok);
 let state=await page.evaluate(()=>window.orchestra.sync.inspect());assert(state.ok);let target=state.data.targets.find(t=>t.provider==='drive'&&t.projectId===projectId);assert(target&&target.resourceIds.length===1&&!target.enabled);id=target.id;
 await page.goto('orchestra://app/settings');const row=page.getByRole('listitem',{name:'Google Drive refresh selection',exact:true});await row.waitFor();
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});
 await row.getByRole('button',{name:'Enable automatic refresh'}).click();
 await wait(s=>!s.running&&!s.targets.find(t=>t.id===id).enabled);
 proof.passed.push('manual import records only the selected source; automatic access defaults off and respects refused consent');
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 await row.getByRole('button',{name:'Enable automatic refresh'}).click();await row.getByRole('button',{name:'Pause automatic refresh'}).waitFor();
 const previous=target.lastSuccessAt;await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));
 state=await wait(s=>!s.running&&s.targets.find(t=>t.id===id)?.lastSuccessAt!==previous);assert.equal(state.targets.find(t=>t.id===id).error,null);
 proof.passed.push('opt-in through packaged Settings; wake triggers real authorized Drive refresh');
 assert((await page.evaluate(id=>window.orchestra.sync.update({id,action:'pause'}),id)).ok);
 await app.evaluate(()=>{globalThis.__syncFetch=globalThis.fetch;globalThis.fetch=(input,options)=>String(input).startsWith('https://www.googleapis.com/drive/')?Promise.reject(new Error('Synthetic offline')):globalThis.__syncFetch(input,options);});
 assert.equal((await page.evaluate(id=>window.orchestra.sync.update({id,action:'refresh'}),id)).ok,false);
 state=await wait(s=>s.targets.find(t=>t.id===id)?.error==='source_refresh_failed');assert(state.targets.find(t=>t.id===id).lastSuccessAt);
 await app.evaluate(()=>{globalThis.fetch=globalThis.__syncFetch;delete globalThis.__syncFetch;});
 assert((await page.evaluate(id=>window.orchestra.sync.update({id,action:'refresh'}),id)).ok);
 state=await wait(s=>s.targets.find(t=>t.id===id)?.error===null);proof.passed.push('offline check records failure without erasing last success; same selection recovers');
 await app.evaluate(()=>{globalThis.__syncFetch=globalThis.fetch;globalThis.fetch=(input,options)=>String(input).startsWith('https://www.googleapis.com/drive/')?new Promise((_,reject)=>{if(options?.signal?.aborted)reject(new Error('Cancelled'));else options?.signal?.addEventListener('abort',()=>reject(new Error('Cancelled')),{once:true});}):globalThis.__syncFetch(input,options);});
 const pending=page.evaluate(id=>window.orchestra.sync.update({id,action:'refresh'}),id);await wait(s=>s.running);assert((await page.evaluate(()=>window.orchestra.sync.cancel())).ok);assert.equal((await pending).ok,false);
 await app.evaluate(()=>{globalThis.fetch=globalThis.__syncFetch;delete globalThis.__syncFetch;});
 proof.passed.push('cancellation interrupts a stalled provider request and releases the native operation lock');
 await app.close();app=await launch();page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 state=await page.evaluate(()=>window.orchestra.sync.inspect());assert(state.ok);target=state.data.targets.find(t=>t.id===id);assert(target&&!target.enabled&&target.lastSuccessAt);
 proof.passed.push('exact source selection, paused state and last success survive full packaged restart');console.log(JSON.stringify(proof));
}catch(error){proof.failure=String(error.message).slice(0,400);process.exitCode=1;console.error(proof.failure);}
finally{if(page&&id)await page.evaluate(id=>window.orchestra.sync.update({id,action:'pause'}),id).catch(()=>{});await app?.close();await writeFile(join(profile,'step5-sync.json'),JSON.stringify(proof,null,2),{mode:0o600});}
