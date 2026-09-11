// Actual packaged stdio transport against an explicitly synthetic local profile.
// This is transport qualification, not a claim that every agent client passed.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const profile=process.argv[2];
assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const root=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const executable=join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal');
const env={PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME};
const results={packageRoot:root,profile,passed:[]};let app,relay,page,pairing;
const pass=name=>{results.passed.push(name);console.log('PASS',name);};
try{
 app=await _electron.launch({executablePath:executable,args:['--user-data-dir='+profile],env,timeout:60000});
 page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok);
 const projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
 const pack=await page.evaluate(async projectId=>{
  const response=await fetch(`/v1/projects/${projectId}/delivery/agent-preflight`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskPrompt:'Review the synthetic desktop launch requirements. Do not change accepted truth.',targetAgent:'codex',budgetPreset:'compact'})});
  if(!response.ok)throw new Error('Preflight rejected');return (await response.json()).data.contextPack;
 },projectId);assert(pack.id);
 await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
 const paired=await page.evaluate(input=>window.orchestra.mcp.pair(input),{projectId,packId:pack.id,client:'codex'});
 assert(paired.ok,JSON.stringify(paired));pairing=paired.data;
 const inspected=await page.evaluate(()=>window.orchestra.mcp.inspect());assert(inspected.ok);
 const publicPair=inspected.data.find(p=>p.id===pairing.id);assert(publicPair);assert(!/mcp_[A-Za-z0-9_-]{43}/.test(publicPair.setup));pass('native pairing persists without exposing a bearer token in client setup');
 relay=spawn(executable,[`--orchestra-mcp=${pairing.id}`,`--user-data-dir=${profile}`],{env,stdio:['pipe','pipe','pipe']});
 let buffer='',sequence=0;const pending=new Map();
 relay.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let response;try{response=JSON.parse(line);}catch{continue;}pending.get(response.id)?.(response);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`RPC timeout: ${method}`));},25000);pending.set(id,response=>{clearTimeout(timer);pending.delete(id);resolve(response);});relay.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const initialized=await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'orchestra-disposable-qualification',version:'1'}});assert(!initialized.error,JSON.stringify(initialized));
 const listed=await rpc('tools/list',{});assert(!listed.error,JSON.stringify(listed));
 const retrieved=await rpc('tools/call',{name:'orchestra.get_context_pack',arguments:{projectId,packId:pack.id}});assert(!retrieved.error&&!retrieved.result?.isError,JSON.stringify(retrieved));assert(JSON.stringify(retrieved).includes(pack.id));pass('packaged MCP initializes and retrieves the exact durable Preflight');
 const denied=await rpc('tools/call',{name:'orchestra.get_context_pack',arguments:{projectId,packId:randomUUID()}});assert(denied.error||denied.result?.isError);pass('another context pack is rejected');
 const title='Synthetic MCP transport qualification '+Date.now();
 const recorded=await rpc('tools/call',{name:'orchestra.record_agent_run',arguments:{projectId,contextPackId:pack.id,taskTitle:title,taskType:'review',status:'completed',outputSummary:'Transport test only; no external coding agent or implementation was executed.',testStatus:'not_run',limitations:['Synthetic transport qualification, not real client qualification.']}});
 assert(!recorded.error&&!recorded.result?.isError,JSON.stringify(recorded));assert(JSON.stringify(recorded).includes(pack.id));pass('Postflight evidence records the original context-pack lineage');
 const revoked=await page.evaluate(id=>window.orchestra.mcp.revoke(id),pairing.id);assert(revoked.ok);pairing=undefined;
 const after=await rpc('tools/call',{name:'orchestra.get_context_pack',arguments:{projectId,packId:pack.id}});assert(after.error||after.result?.isError);pass('revocation denies access in an already-running relay');
}catch(error){results.failure=error.message;throw error;}
finally{relay?.kill();if(pairing&&page)await page.evaluate(id=>window.orchestra.mcp.revoke(id),pairing.id).catch(()=>{});await app?.close();await writeFile(join(profile,'step5-mcp.json'),JSON.stringify(results,null,2));}
