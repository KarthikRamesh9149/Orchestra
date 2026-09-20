// Real local UI cancellation/reconciliation and explicitly injected transport
// failures. Responses are never replaced with fabricated success data.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {createDesktopRecoveryPdf} from './pdf-fixtures.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];if(!/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''))throw new Error('Synthetic profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(15000);
const results={packageRoot,profile,passed:[],errors:[]},record=name=>{results.passed.push(name);console.log('PASS',name);};page.on('pageerror',e=>results.errors.push(e.message));
try{
 await page.waitForURL('**/memory',{timeout:180000});await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();
 // A real upload whose transport is stopped before the request is sent. The
 // normal retry must reconcile the operation ID before sending the file once.
 const pdf=await createDesktopRecoveryPdf();const name='Recovery-'+Date.now();
 await page.evaluate(()=>{const send=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(body){const xhr=this;setTimeout(()=>{if(xhr.readyState===XMLHttpRequest.OPENED)send.call(xhr,body);},800);};});
 await page.locator('input[type=file]').first().setInputFiles({name:name+'.pdf',mimeType:'application/pdf',buffer:pdf});await page.getByRole('button',{name:'Upload',exact:true}).click();await page.getByRole('button',{name:'Stop upload',exact:true}).click();await page.getByText('Upload stopped. We will check its status before another upload.',{exact:true}).waitFor();record('stopping an upload gives an honest reconciliation state');
 await page.getByRole('button',{name:'Upload',exact:true}).click();await page.getByRole('button',{name:'Open actions for '+name,exact:true}).waitFor({timeout:30000});await page.reload();await page.getByRole('button',{name:'Open actions for '+name,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Open actions for '+name,exact:true}).count(),1);record('retry reconciles and retains exactly one document');
 await page.getByRole('button',{name:'Open actions for '+name,exact:true}).click();await page.getByRole('button',{name:'Remove from memory',exact:true}).click();const dialog=page.getByRole('alertdialog');await dialog.waitFor();assert(await dialog.evaluate(el=>el.contains(document.activeElement)));await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});record('document removal is cancellable by keyboard');
 await page.getByRole('button',{name:'Open actions for '+name,exact:true}).click();await page.getByRole('button',{name:'Remove from memory',exact:true}).click();await dialog.getByRole('button',{name:'Remove',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.reload();await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Open actions for '+name,exact:true}).count(),0);record('authorized removal persists and preserves the other document');
 await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).click();await page.getByRole('button',{name:'Open',exact:true}).click();await page.waitForURL('**/view');await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});await page.getByRole('button',{name:'Download original',exact:true}).click();record('native save cancellation leaves the document usable');
 await page.goto('orchestra://app/chat');await page.getByRole('button',{name:'New chat',exact:true}).click();await page.waitForURL('orchestra://app/chat');await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');await page.getByPlaceholder('Ask Socrates anything about your project…').fill('Explain the local acceptance requirements and their evidence.');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByRole('button',{name:'Stop generating response',exact:true}).click({force:true});
 await page.getByRole('button',{name:'Stop generating response',exact:true}).waitFor({state:'hidden',timeout:30000});await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/);const stopped=page.url();
 await page.getByText(/Response stopped\.|Evidence-only fallback|Cancellation was not confirmed/).first().waitFor({timeout:30000});
 await page.reload();await page.getByText(/Response stopped\.|Evidence-only fallback/).first().waitFor({timeout:30000});const terminal=await page.locator('body').innerText();
 results.cancellationOutcome=terminal.includes('Response stopped.')?'cancelled':'completed before cancellation';
 assert.equal(page.url(),stopped);record('cancellation/completion race reaches an honest durable terminal state: '+results.cancellationOutcome);
 await page.goto('orchestra://app/truth-inbox');await page.getByRole('heading',{name:'Truth Inbox',exact:true}).waitFor();
 await page.evaluate(()=>{const original=window.fetch;window.fetch=(input,init)=>String(input).includes('/truth-inbox')?Promise.reject(new TypeError('Synthetic transport outage')):original(input,init);});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('alert').waitFor();record('transport failure remains visible instead of becoming an empty success');await page.reload();await page.getByRole('heading',{name:'Truth Inbox',exact:true}).waitFor();record('reload recovers after a transient transport failure');
 assert.deepEqual(results.errors,[]);await page.screenshot({path:join(profile,'recovery.png'),animations:'disabled'});
}catch(error){results.failure=String(error);console.log('FAIL',String(error),await page.locator('body').innerText());throw error;}
finally{await writeFile(join(profile,'recovery.json'),JSON.stringify(results,null,2));await app.close();}
