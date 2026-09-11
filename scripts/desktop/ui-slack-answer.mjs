// One real generation against the explicitly approved synthetic Slack fixture.
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
  const requestId=crypto.randomUUID(),start=performance.now();let firstTextMs;
  const stop=window.orchestra.onDelta(event=>{if(event.requestId===requestId)firstTextMs??=Math.round(performance.now()-start);});
  try{return {response:await window.orchestra.ask({projectId,requestId,selectedSources:['slack'],question:'From Slack only: what export format and launch date are in the SYNTHETIC Project Larkspur test, and which CSV columns does its threaded acceptance criterion require? Cite the Slack messages and distinguish these unapproved test messages from accepted truth.'}),firstTextMs,completionMs:Math.round(performance.now()-start)};}finally{stop();}
 });
 proof.observed=observed;assert(observed.response.ok);const answer=observed.response.data;
 assert.equal(answer.modelMetadata.provider,'openai');assert.equal(answer.modelMetadata.degraded,false);
 assert(/18 November 2026|November 18,? 2026|2026-11-18/i.test(answer.answer_md));assert(/item_id/i.test(answer.answer_md));assert(/title/i.test(answer.answer_md));assert(/CSV/i.test(answer.answer_md));
 assert(answer.citations.length>=2);
 for(const citation of answer.citations){
  assert.equal(citation.sourceType,'slack_message');
  const target=answer.open_targets.find(target=>target.id===citation.openTargetId);
  assert.equal(target?.targetRef.channelId,'C0C1344HCLV');
  assert.equal(target?.targetRef.teamId,'T0B782DU524');
  assert.equal(target?.targetRef.provider,'slack');
  assert(target?.targetRef.providerPermalink.includes('C0C1344HCLV'));
 }
 assert(observed.firstTextMs!==undefined);
 proof.passed.push('real Slack-root and thread evidence supports a streamed answer with source citations');console.log(JSON.stringify({passed:proof.passed,firstTextMs:observed.firstTextMs,completionMs:observed.completionMs}));
}catch(error){proof.failure=error.message;process.exitCode=1;console.error('Slack answer gate failed:',error.message);}
finally{await app?.close();await writeFile(join(profile,'step5-slack-answer.json'),JSON.stringify(proof,null,2));}
