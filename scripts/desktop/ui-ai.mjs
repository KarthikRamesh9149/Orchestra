// Real packaged AI qualification with synthetic project data only. The key is
// read exclusively by Electron main from the explicitly approved ignored file.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const repo=resolve(import.meta.dirname,'../..');
const profile=process.argv[2];
if(!/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''))throw new Error('Synthetic smoke profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
const results={packageRoot,profile,passed:[],errors:[],samples:[]};
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
let app;
const pass=name=>{results.passed.push(name);console.log('PASS',name);};
try{
 app=await launch();let page=await app.firstWindow();page.setDefaultTimeout(30000);
 await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/settings');
 await page.getByRole('heading',{name:'Desktop AI',exact:true}).waitFor();
 await page.getByLabel('Maximum requests per 24 hours').fill('20');
 await page.getByLabel('Maximum output tokens per request').fill('1024');
 await app.evaluate(async({clipboard,dialog,app},envPath)=>{
  const fs=process.getBuiltinModule('fs/promises');const {parseEnv}=process.getBuiltinModule('util');
  const key=parseEnv(await fs.readFile(envPath,'utf8')).OPENAI_API_KEY;
  if(!key)throw new Error('Dedicated desktop key missing');
  await clipboard.writeText(key);
  // Substitute native confirmation and process-relaunch sinks only. Actual
  // model-access requests, IPC validation and OS-encrypted persistence run.
  globalThis.__originalQuit=app.quit;globalThis.__originalRelaunch=app.relaunch;
  dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
  app.relaunch=()=>{};app.quit=()=>{};
 },join(repo,'.env.local'));
 await page.getByRole('button',{name:'Import key, test and restart',exact:true}).click();
 await page.waitForFunction(async()=>{const result=await window.orchestra.ai.inspect();return result.ok&&result.data.configured;},{},{timeout:45000});
 await page.getByRole('button',{name:'Import key, test and restart',exact:true}).waitFor();
 assert.equal(await page.locator('input[type=password]').count(),0);
 assert.equal(await app.evaluate(async({clipboard})=>(await clipboard.readText()).length),0);
 pass('native import validates real model access and saves via OS encryption; key absent from renderer and cleared from clipboard');
 await app.evaluate(({app})=>{app.quit=globalThis.__originalQuit;app.relaunch=globalThis.__originalRelaunch;});await app.close();app=undefined;
 app=await launch();page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>results.errors.push(error.message));
 await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert.equal(boot.ok,true);assert.equal(boot.data.aiConfigured,true);
 pass('configured AI survives a real native runtime restart');
 await page.goto('orchestra://app/chat');
 const newChat=page.getByRole('button',{name:'New chat',exact:true});if(await newChat.count())await newChat.click();
 const composer=page.getByPlaceholder('Ask Socrates anything about your project…');await composer.fill('What is two plus two? Answer in one short sentence.');
 const start=performance.now();await composer.press('Enter');
 await page.getByRole('button',{name:'Mark answer helpful'}).last().waitFor({timeout:90000});
 results.samples.push({flow:'ordinary conversation',completionMs:Math.round(performance.now()-start)});
 const body=await page.locator('body').innerText();assert(/\b4\b|\bfour\b/i.test(body));
 assert(!/ai_not_configured|generation unavailable/i.test(body));
 pass('real ordinary conversation completes in packaged UI');
 assert.deepEqual(results.errors,[]);
 await page.screenshot({path:join(profile,'step5-ai.png'),animations:'disabled'});
}catch(error){results.failure=error instanceof Error?error.message:'qualification failed';throw error;}
finally{if(app){await app.evaluate(({app})=>{if(globalThis.__originalQuit)app.quit=globalThis.__originalQuit;}).catch(()=>{});await app.close().catch(()=>{});}await writeFile(join(profile,'step5-ai.json'),JSON.stringify(results,null,2));console.log('Evidence',join(profile,'step5-ai.json'));}
