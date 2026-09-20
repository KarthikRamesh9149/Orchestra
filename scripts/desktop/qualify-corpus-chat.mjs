// Packaged, offline, synthetic 150-page corpus and 80-message conversation.
// No SQL seeding, simulated answers, provider credentials or paid model calls.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {createDesktopCorpusChatPdf} from './pdf-fixtures.mjs';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];
assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const output=await mkdtemp('/private/tmp/orchestra-step7-corpus-');
const proof={profile,packageRoot,output,pages:150,turns:40,passed:[],errors:[]};
const pdf=await createDesktopCorpusChatPdf();
proof.sourceBytes=pdf.length;
const app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??''},timeout:60000});
const page=await app.firstWindow();page.on('pageerror',e=>proof.errors.push(e.message));page.setDefaultTimeout(30000);
try{
 await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok&&!boot.data.aiConfigured,'Offline synthetic profile required');
 const projectId=boot.data.workspaces.find(w=>w.current)?.projectId;assert(projectId);
 const title='Synthetic-Corpus-'+Date.now();proof.title=title;
 await page.locator('input[type=file]').first().setInputFiles({name:title+'.pdf',mimeType:'application/pdf',buffer:pdf});
 const start=performance.now();await page.getByRole('button',{name:'Upload',exact:true}).click();
 const sourceActions=page.getByRole('button',{name:new RegExp('^Open actions for '+title+'(?:\\.pdf)?$')});
 await sourceActions.waitFor({timeout:120000});
 await page.getByText('Processing',{exact:true}).waitFor({state:'hidden',timeout:120000});
 proof.uploadMs=performance.now()-start;proof.passed.push('150-page real PDF upload reaches authoritative Memory');
 const session=await page.evaluate(async projectId=>{
  const response=await fetch(`/v1/projects/${projectId}/socrates/sessions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageContext:'dashboard_project'})});
  if(!response.ok)throw new Error('Session creation failed: '+response.status);return (await response.json()).data;
 },projectId);
 proof.sessionId=session.id;
 for(let n=0;n<40;n++){
  await page.evaluate(async({projectId,sessionId,n,title})=>{
   const response=await fetch(`/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/stream/v1`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:`Synthetic turn ${n}: according to ${title}, what does requirement ${n}-0 require?`,selectedSources:['documents'],includeArtifacts:false})});
   if(!response.ok)throw new Error('Chat request failed: '+response.status);
   const text=await response.text();if(!text.includes('event: done'))throw new Error('No successful terminal stream event');
  },{projectId,sessionId:session.id,n,title});
  if(n%10===9)console.log('Completed synthetic turns',n+1);
  // Honour the real per-minute limit; do not weaken it for qualification.
  await new Promise(resolve=>setTimeout(resolve,2100));
 }
 const history=()=>page.evaluate(async({projectId,id})=>{const r=await fetch(`/v1/projects/${projectId}/socrates/sessions/${id}/messages`);if(!r.ok)throw new Error('History failed');return (await r.json()).data;},{projectId,id:session.id});
 const messages=await history();proof.messageCount=messages.length;assert.equal(messages.length,80);
 proof.passed.push('40 real offline turns persist 80 messages');
 const startRoute=performance.now();await page.goto('orchestra://app/chat/'+session.id);await page.getByPlaceholder('Ask Socrates anything about your project…').waitFor();
 await page.getByText(/Synthetic turn 39:/).first().waitFor();proof.historyUsableMs=performance.now()-startRoute;
 await page.getByPlaceholder('Ask Socrates anything about your project…').fill('Synthetic long-chat draft');
 await page.getByRole('button',{name:'Memory',exact:true}).click();await page.getByRole('button',{name:'Chat',exact:true}).click();
 assert.equal(await page.getByPlaceholder('Ask Socrates anything about your project…').inputValue(),'Synthetic long-chat draft');
 await page.reload();await page.getByText(/Synthetic turn 39:/).first().waitFor();assert.equal((await history()).length,80);
 proof.passed.push('long-chat rendering, navigation, draft restoration and reload preserve all messages');
 assert.deepEqual(proof.errors,[]);
}catch(error){proof.failure=String(error);process.exitCode=1;}
finally{await writeFile(join(output,'report.json'),JSON.stringify(proof,null,2),{mode:0o600});await app.close();console.log(JSON.stringify(proof));}
