// Synthetic packaged-Mac acceptance. No production accounts or external AI.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import PDFDocument from 'pdfkit';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const repo=resolve(import.meta.dirname,'../..');
const packageRoot=process.argv[2]?resolve(process.argv[2]):(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
const data=await mkdtemp('/private/tmp/orchestra-step4-acceptance-');
const pdf=await new Promise(resolve=>{const chunks=[],document=new PDFDocument();document.on('data',chunk=>chunks.push(chunk));document.on('end',()=>resolve(Buffer.concat(chunks)));document.fontSize(18).text('Orchestra Desktop Pilot Requirements');document.fontSize(12).text('The pilot launch date is 21 October 2026. Local workspaces need no hosted account. Evidence remains on this Mac. Acceptance requires upload, cited search, persistent chats and drafts, and restart recovery. The responsible owner is the local product manager. Changes require human approval; generated suggestions are not accepted truth.');document.end();});
const results={profile:data,packageRoot,passed:[],errors:[],httpFailures:[]};
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+data],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
let app=await launch(),page=await app.firstWindow();
function observe(){page.on('pageerror',error=>results.errors.push(error.message));page.on('response',response=>{if(response.url().includes('/v1/')&&response.status()>=400)results.httpFailures.push({url:response.url(),status:response.status()});});}
const record=name=>{results.passed.push(name);console.log('PASS',name);};
observe();
try{
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Continue locally',exact:true}).click({timeout:180000});
 await page.getByLabel('New workspace name').fill('Mac Acceptance Workspace');await page.getByRole('button',{name:'Create workspace',exact:true}).click();
 await page.waitForURL('**/memory',{timeout:30000});record('local onboarding and workspace creation');
 await page.locator('input[type=file]').first().setInputFiles({name:'Desktop-Pilot-Requirements.pdf',mimeType:'application/pdf',buffer:pdf});
 await page.getByRole('button',{name:'Upload',exact:true}).click();
 await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor({timeout:60000});record('authorized PDF upload');
 await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).click();await page.getByRole('button',{name:'Open',exact:true}).click();
 await page.waitForURL('**/view');await page.getByText('The pilot launch date is 21 October 2026.',{exact:false}).first().waitFor();record('document viewer extracted content');
 const downloadPath=join(data,'downloaded-original.pdf');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},downloadPath);
 await page.getByRole('button',{name:'Download original',exact:true}).click();let downloaded;for(let attempt=0;attempt<100;attempt++){try{downloaded=await readFile(downloadPath);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}assert.deepEqual(downloaded,pdf);record('native saved original matches uploaded bytes');
 await page.goto('orchestra://app/chat');const composer=page.getByPlaceholder('Ask Socrates anything about your project…');await composer.fill('When is the desktop pilot launch date?');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await page.waitForURL(/\/chat\/[0-9a-f-]{36}/,{timeout:30000});const conversation=page.url();
 await page.getByText('Evidence-only fallback',{exact:true}).first().waitFor({timeout:60000});assert((await page.locator('body').innerText()).includes('21 October 2026'));record('honest evidence-only answer with document source');
 await composer.fill('Unsent restart acceptance draft');await page.getByRole('button',{name:'Memory',exact:true}).click();await page.getByRole('button',{name:'Chat',exact:true}).click();await page.getByPlaceholder('Ask Socrates anything about your project…').waitFor();assert.equal(await page.getByPlaceholder('Ask Socrates anything about your project…').inputValue(),'Unsent restart acceptance draft');record('chat and unsent draft survive feature navigation');
 for(const route of ['/dashboard','/truth-inbox','/delivery','/timeline','/settings']){await page.goto('orchestra://app'+route);await page.waitForTimeout(1500);const text=await page.locator('body').innerText();assert(!text.includes('ACCESS UNAVAILABLE'),route);console.log(route,text.slice(0,250));}
 record('major local routes load without access rejection');
 await app.close();app=await launch();page=await app.firstWindow();observe();
 await page.waitForURL('**/memory',{timeout:180000});await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor({timeout:30000});
 await page.goto(conversation);await page.getByPlaceholder('Ask Socrates anything about your project…').waitFor();assert.equal(await page.getByPlaceholder('Ask Socrates anything about your project…').inputValue(),'Unsent restart acceptance draft');record('workspace document chat and draft survive application restart');
 await page.goto('orchestra://app/settings');await page.locator('#workspace').getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#workspace input').first().fill('Renamed Mac Workspace');await page.locator('#workspace').getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Renamed Mac Workspace',{exact:true}).waitFor();await page.reload();await page.getByText('Renamed Mac Workspace',{exact:true}).waitFor();record('workspace rename survives reload');
 await page.goto('orchestra://app/dashboard');await page.getByRole('button',{name:'+ Add Subscription',exact:true}).click();await page.getByLabel('Service name',{exact:true}).fill('Synthetic Free Local Tool');await page.getByLabel('Cost',{exact:true}).fill('0');await page.getByRole('dialog').getByRole('button',{name:'Add Subscription',exact:true}).click();await page.getByRole('button',{name:'Edit Synthetic Free Local Tool'}).waitFor();await page.reload();await page.getByRole('button',{name:'Edit Synthetic Free Local Tool'}).waitFor();record('subscription record survives reload (no purchase)');
 await page.goto(conversation);await page.getByText('Evidence-only fallback',{exact:true}).first().waitFor();await page.getByRole('button',{name:'New chat',exact:true}).click();await page.waitForURL('orchestra://app/chat');await page.waitForFunction(()=>document.querySelector('textarea')?.value==='');await page.getByPlaceholder('Ask Socrates anything about your project…').fill('What is required for local acceptance?');await page.getByRole('button',{name:'Send message',exact:true}).click();await page.getByText('Evidence-only fallback',{exact:true}).first().waitFor({timeout:60000});assert.notEqual(page.url(),conversation);record('multiple independent chat sessions');
 await page.getByRole('button',{name:'Delete chat What is required for local acceptance?',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('alertdialog').waitFor({state:'hidden'});await page.reload();await page.getByRole('link',{name:'When is the desktop pilot launch date?',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Delete chat What is required for local acceptance?',exact:true}).count(),0);record('chat deletion confirmed after reload');
 assert.deepEqual(results.errors,[]);assert.deepEqual(results.httpFailures,[]);
 await page.screenshot({path:join(data,'chat.png')});
}catch(error){results.failure=String(error);console.log('FAILURE',page.url(),await page.locator('body').innerText());await page.screenshot({path:join(data,'failure.png')});throw error;}
finally{await writeFile(join(data,'result.json'),JSON.stringify(results,null,2));console.log('Evidence',join(data,'result.json'));await app.close();}
