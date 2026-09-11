// One synthetic named-document request via the actual packaged native bridge.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
let app;const proof={packageRoot,passed:[]};
try{
 app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const observed=await page.evaluate(async()=>{
  const boot=await window.orchestra.bootstrap();if(!boot.ok||!boot.data.aiConfigured)throw new Error('Configured runtime required');
  const projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
  const configured=await window.orchestra.ai.inspect();if(!configured.ok)throw new Error('AI settings unavailable');
  const requestId=crypto.randomUUID(),start=performance.now();let firstTextMs,deltas=0;
  const stop=window.orchestra.onDelta(event=>{if(event.requestId===requestId){firstTextMs??=Math.round(performance.now()-start);deltas++;}});
  try{const response=await window.orchestra.ask({projectId,requestId,question:'According to Orchestra Desktop Pilot Requirements, when is the pilot launch date and what does local acceptance require? Cite that document.'});return {response,selectedModel:configured.data.preferences.generationModel,firstTextMs,deltas,completionMs:Math.round(performance.now()-start)};}finally{stop();}
 });
 proof.observed=observed;assert(observed.response.ok);const answer=observed.response.data;
 assert.equal(answer.modelMetadata.provider,'openai');assert.equal(answer.modelMetadata.degraded,false);assert.equal(answer.modelMetadata.model,observed.selectedModel);
 assert(/21 October 2026|October 21,? 2026|2026-10-21/i.test(answer.answer_md));
 assert(answer.citations?.length>0);assert(observed.deltas>0);
 proof.passed.push('packaged named-document retrieval uses real OpenAI, returns expected date with citations and streamed text');
 console.log(JSON.stringify({passed:proof.passed,firstTextMs:observed.firstTextMs,completionMs:observed.completionMs,modelMetadata:answer.modelMetadata,retrieval:answer.retrievalSummary?.performance}));
}catch(error){proof.failure=error.message;console.error('Packaged evidence gate failed:',error.message);process.exitCode=1;}
finally{await app?.close();await writeFile(join(profile,'step5-ai-evidence.json'),JSON.stringify(proof,null,2));}
