// Real packaged renderer measurements on an explicitly synthetic profile.
// Not a clean-machine, large-dataset or external-model certification.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {cpus,totalmem} from 'node:os';
import assert from 'node:assert/strict';
const [packageRoot,profile]=process.argv.slice(2);
assert(packageRoot?.endsWith('/Orchestra Desktop Internal-darwin-arm64'));
assert(/^\/private\/tmp\/orchestra-transfer-ui-[A-Za-z0-9]+$/.test(profile??''),'Dedicated synthetic transfer profile required');
const prior=JSON.parse(await readFile(join(profile,'evidence.json'),'utf8'));
assert.equal(prior.profile,profile);
const output=await mkdtemp('/private/tmp/orchestra-step7-benchmark-');
const results={scope:'Internal package baseline, one Mac, small synthetic dataset; not Step 7 candidate certification',packageRoot:resolve(packageRoot),profile,hardware:{cpu:cpus()[0]?.model,logicalCores:cpus().length,ramBytes:totalmem()},samples:{routes:[],input:[],retrieval:[]},errors:[],unmeasured:['large dataset','clean machine','external model latency'],output};
const start=performance.now();let app;
const percentile=values=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*0.95)-1];
try{
 app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??''},timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>results.errors.push(e.message));
 await page.waitForURL('**/memory',{timeout:180000});
 await page.getByRole('button',{name:'Open actions for Transfer-Requirement',exact:true}).waitFor();
 results.populatedLaunchMs=performance.now()-start;
 await page.evaluate(()=>{window.__step7Shifts=[];new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__step7Shifts.push({at:e.startTime,value:e.value});}).observe({type:'layout-shift',buffered:false});});
 for(let n=0;n<30;n++){
  for(const name of ['Chat','Memory']){
   const began=performance.now();await page.getByRole('button',{name,exact:true}).click();
   if(name==='Memory')await page.getByRole('button',{name:'Open actions for Transfer-Requirement',exact:true}).waitFor();
   else await page.getByPlaceholder('Ask Socrates anything about your project…').waitFor();
   results.samples.routes.push({route:name,ms:performance.now()-began});
  }
 }
 await page.getByRole('button',{name:'Chat',exact:true}).click();
 const composer=page.getByPlaceholder('Ask Socrates anything about your project…');
 const draft=await composer.inputValue();
 try{
  for(let n=0;n<30;n++){
   await composer.evaluate(el=>{window.__step7Input=new Promise(resolve=>el.addEventListener('input',()=>{const start=performance.now();requestAnimationFrame(()=>resolve(performance.now()-start));},{once:true}));});
   await composer.fill(`Synthetic benchmark draft ${n}`);
   results.samples.input.push(await page.evaluate(()=>window.__step7Input));
  }
 }finally{await composer.fill(draft);}
 results.samples.retrieval=await page.evaluate(async()=>{
  const boot=await window.orchestra.bootstrap();if(!boot.ok||boot.data.aiConfigured)throw new Error('This benchmark requires its offline synthetic profile; no paid model calls');
  const projectId=boot.data.workspaces.find(w=>w.current)?.projectId;if(!projectId)throw new Error('No synthetic project selected');
  const samples=[];
  for(let n=0;n<20;n++){
   const start=performance.now(),result=await window.orchestra.ask({projectId,requestId:crypto.randomUUID(),question:'According to Transfer-Requirement, how many reviewers does approval require? Cite the document.'});
   if(!result.ok||!result.data.citations?.length||!result.data.modelMetadata?.degraded)throw new Error('Expected cited offline evidence');
   const retrievalMs=result.data.retrievalSummary?.performance?.retrievalMs;
   if(!Number.isFinite(retrievalMs)||retrievalMs<0)throw new Error('Missing retrieval timing');
   samples.push({retrievalMs,totalMs:performance.now()-start,citations:result.data.citations.length});
  }
  return samples;
 });
 results.layoutShifts=await page.evaluate(()=>window.__step7Shifts);
 // CLS uses the maximum session window, not the sum over the entire benchmark.
 let sessionStart=0,last=0,score=0,max=0;
 for(const e of results.layoutShifts){if(e.at-last>1000||e.at-sessionStart>5000){score=0;sessionStart=e.at;}score+=e.value;last=e.at;max=Math.max(max,score);}
 results.cls=max;
 results.summary={routeP95Ms:percentile(results.samples.routes.map(s=>s.ms)),inputHandlerToFrameP95Ms:percentile(results.samples.input),localRetrievalP95Ms:percentile(results.samples.retrieval.map(s=>s.retrievalMs)),cls:max};
 results.limits={routeMs:300,inputMs:100,localRetrievalMs:1000,cls:0.1};
 results.measuredTargetsPassed=results.summary.routeP95Ms<=300&&results.summary.inputHandlerToFrameP95Ms<=100&&results.summary.localRetrievalP95Ms<=1000&&max<=0.1&&results.errors.length===0;
 results.releaseReady=false;
}catch(error){results.failure=String(error);results.releaseReady=false;process.exitCode=1;}
finally{if(app)await app.close();await writeFile(join(output,'report.json'),JSON.stringify(results,null,2),{mode:0o600});console.log(JSON.stringify({output,summary:results.summary,failure:results.failure,releaseReady:false}));}
