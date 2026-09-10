// Continues ONLY the synthetic profile created by ui-smoke, never customer data.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const data=process.argv[2];if(!/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(data??''))throw new Error('A synthetic acceptance profile is required');
const prior=JSON.parse(await readFile(join(data,'result.json'),'utf8'));if(prior.profile!==data)throw new Error('Profile provenance mismatch');
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+data],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
const page=await app.firstWindow(),passed=[],errors=[],httpFailures=[];const record=name=>{passed.push(name);console.log('PASS',name);};
page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.url().includes('/v1/')&&response.status()>=400)httpFailures.push({status:response.status(),url:response.url()});});
try{
 await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/chat');
 await page.getByRole('link',{name:'When is the desktop pilot launch date?',exact:true}).waitFor();
 if(await page.getByRole('button',{name:'Delete chat What is required for local acceptance?',exact:true}).count()){await page.getByRole('button',{name:'Delete chat What is required for local acceptance?',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('alertdialog').waitFor({state:'hidden'});}
 await page.reload();await page.getByRole('link',{name:'When is the desktop pilot launch date?',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Delete chat What is required for local acceptance?',exact:true}).count(),0);record('delete chat persists without deleting another conversation');
 await page.getByRole('link',{name:'When is the desktop pilot launch date?',exact:true}).click();await page.getByText('Evidence-only fallback',{exact:true}).first().waitFor();assert((await page.locator('body').innerText()).includes('21 October 2026'));record('original transcript and citation remain after restart and other chat deletion');
 await page.goto('orchestra://app/timeline');await page.getByRole('button',{name:'Add Event',exact:true}).click();await page.getByLabel('Event title',{exact:true}).fill('Synthetic local acceptance event');await page.getByLabel('Event description',{exact:true}).fill('Manually recorded local test. Not a provider communication.');await page.getByRole('button',{name:'+ Add to timeline',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.reload();await page.getByText('Synthetic local acceptance event',{exact:true}).waitFor();record('manual Timeline event persists');
 await page.goto('orchestra://app/settings');await page.getByRole('button',{name:'dark',exact:true}).click();await page.waitForFunction(()=>document.documentElement.classList.contains('dark')||document.documentElement.dataset.theme==='dark');await page.reload();await page.getByRole('button',{name:'dark',exact:true,pressed:true}).waitFor();record('appearance preference persists');
 await page.goto('orchestra://app/delivery');await page.getByRole('button',{name:'Generate brief',exact:true}).click();await page.getByRole('button',{name:'Regenerate brief',exact:true}).waitFor({timeout:30000});await page.reload();await page.getByRole('button',{name:'Regenerate brief',exact:true}).waitFor();record('evidence-backed executive brief persists');
 assert.deepEqual(errors,[]);assert.deepEqual(httpFailures,[]);await page.screenshot({path:join(data,'followup.png'),animations:'disabled'});
}catch(error){console.log('FAILURE',String(error),await page.locator('body').innerText());throw error;}
finally{await writeFile(join(data,'followup.json'),JSON.stringify({packageRoot,passed,errors,httpFailures},null,2));await app.close();}
