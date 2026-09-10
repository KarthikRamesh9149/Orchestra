// Delay delivery of real backend SSE bytes, not model or response fixtures.
// This makes the navigation race reproducible even with fast offline answers.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];
if(!/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''))throw new Error('Synthetic profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',HOME:process.env.HOME,TMPDIR:process.env.TMPDIR??''},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(30000);const result={packageRoot,profile,passed:[]};
try{
 await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/chat');await page.getByRole('button',{name:'New chat',exact:true}).click();await page.waitForURL('orchestra://app/chat');await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');
 await page.evaluate(()=>{const original=window.fetch;window.fetch=async(input,init)=>{const response=await original(input,init);if(!String(input).includes('/messages/stream/v1')||!response.body)return response;return new Response(response.body.pipeThrough(new TransformStream({async transform(chunk,controller){await new Promise(resolve=>setTimeout(resolve,800));controller.enqueue(chunk);}})),{status:response.status,headers:response.headers});};});
 await page.getByPlaceholder('Ask Socrates anything about your project…').fill('When is the desktop pilot launch date? Verify the uploaded requirements.');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByRole('button',{name:'Stop generating response',exact:true}).waitFor();
 await page.getByRole('button',{name:'Memory',exact:true}).click();await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();
 await page.getByRole('button',{name:'Chat',exact:true}).click();await page.getByText('Evidence-only fallback',{exact:true}).first().waitFor();assert((await page.locator('body').innerText()).includes('21 October 2026'));await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/);const url=page.url();
 await page.reload();await page.getByText('Evidence-only fallback',{exact:true}).first().waitFor();assert.equal(page.url(),url);assert((await page.locator('body').innerText()).includes('21 October 2026'));
 result.passed.push('real evidence-only SSE delivery survives navigation away/back and reload without losing its answer');
}catch(error){result.failure=String(error);throw error;}
finally{await writeFile(join(profile,'stream-navigation.json'),JSON.stringify(result,null,2));await app.close();console.log(JSON.stringify(result));}
