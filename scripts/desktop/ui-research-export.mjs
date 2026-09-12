// Reopen the real persisted result in the UI without another paid generation:
// only the start response is replayed; status/save/export endpoints remain real.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const prior=JSON.parse(await readFile(join(profile,'step5-research-ai.json'),'utf8'));assert.equal(prior.run.status,'completed');
const root=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
let app;const proof={packageRoot:root,startResponseReplayed:true,realRunId:prior.runId,passed:[]};
try{
 app=await _electron.launch({executablePath:join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 await app.evaluate(({session},file)=>{globalThis.__researchDownload=null;session.defaultSession.on('will-download',(_event,item)=>{item.setSavePath(file);item.once('done',(_event,state)=>{globalThis.__researchDownload=state;});});},join(profile,'step5-research-report.pdf'));
 await page.route('**/deep-research',route=>route.request().method()==='POST'?route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({data:prior.run,error:null})}):route.continue());
 await page.goto('orchestra://app/chat');await page.getByRole('button',{name:'Deep Research',exact:true}).click();
 await page.getByRole('dialog').getByRole('textbox').fill('Synthetic Copper Finch acceptance');await page.getByRole('button',{name:'Run Research',exact:true}).click();
 await page.getByText('Deep Research Complete',{exact:true}).waitFor({timeout:30000});
 assert((await page.getByRole('dialog').innerText()).includes('Copper Finch'));
 await page.getByRole('button',{name:/Download Report/}).click();
 for(let i=0;i<60;i++){if(await app.evaluate(()=>globalThis.__researchDownload)==='completed')break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(await app.evaluate(()=>globalThis.__researchDownload),'completed');const bytes=await readFile(join(profile,'step5-research-report.pdf'));assert.equal(bytes.subarray(0,4).toString(),'%PDF');assert(bytes.length>1000);
 proof.passed.push('real saved report rendered in packaged dialog; actual PDF export and Electron download completed after restart');console.log(JSON.stringify(proof));
}catch(error){proof.failure=String(error.message).slice(0,300);process.exitCode=1;console.error(proof.failure);}
finally{await app?.close();await writeFile(join(profile,'step5-research-export.json'),JSON.stringify(proof,null,2),{mode:0o600});}
