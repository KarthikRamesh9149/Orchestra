// One bounded real-model research run against explicitly selected synthetic docs.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const root=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
let app;const proof={packageRoot:root,passed:[]};
try{
 app=await _electron.launch({executablePath:join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok);const projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
 const start=await page.evaluate(async id=>{const r=await fetch(`/v1/projects/${id}/deep-research`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({researchFocus:'Summarize the fictional Copper Finch pilot reviewer count and acceptance criterion from Orchestra Desktop Synthetic Drive Qualification. Identify it as synthetic context, not approved truth.',sources:['docs'],outputFormat:'exec_summary',privacyMode:'internal_only',webSearchEnabled:false})});return {status:r.status,body:await r.json()};},projectId);
 proof.start=start;assert.equal(start.status,202);const id=start.body.data.id;assert(id);proof.runId=id;const began=Date.now();let result;
 for(let i=0;i<120;i++){result=await page.evaluate(async({projectId,id})=>{const r=await fetch(`/v1/projects/${projectId}/deep-research/${id}`);return r.json();},{projectId,id});if(['completed','failed'].includes(result.data?.status))break;await new Promise(r=>setTimeout(r,1000));}
 proof.completionMs=Date.now()-began;proof.run=result.data;assert.equal(result.data?.status,'completed');
 const text=JSON.stringify(result.data);assert(/seven|\b7\b/i.test(text)&&/Copper Finch/i.test(text));assert(/synthetic/i.test(text));
 const saved=await page.evaluate(async({projectId,id})=>{const r=await fetch(`/v1/projects/${projectId}/deep-research/${id}/add-to-memory`,{method:'POST'});return {status:r.status,body:await r.json()};},{projectId,id});assert.equal(saved.status,200);proof.saved=saved.body.data;
 const exported=await page.evaluate(async({projectId,id})=>{const r=await fetch(`/v1/projects/${projectId}/deep-research/${id}/export?format=markdown`);return {status:r.status,text:await r.text()};},{projectId,id});assert.equal(exported.status,200);assert(/Copper Finch/i.test(exported.text));
 await page.reload();const persisted=await page.evaluate(async({projectId,id})=>(await fetch(`/v1/projects/${projectId}/deep-research/${id}`)).json(),{projectId,id});assert.equal(persisted.data.status,'completed');
 proof.passed.push('real configured-AI research completed with correct synthetic source facts, saved generated context and downloadable report persisted across reload');console.log(JSON.stringify({passed:proof.passed,completionMs:proof.completionMs}));
}catch(error){proof.failure=String(error.message).slice(0,300);process.exitCode=1;console.error(proof.failure);}
finally{await app?.close();await writeFile(join(profile,'step5-research-ai.json'),JSON.stringify(proof,null,2),{mode:0o600});}
