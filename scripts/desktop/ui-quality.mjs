// Local packaged UI checks; synthetic profile only. External AI and shared
// identity qualification are separate steps, not simulated by this harness.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import AxeBuilder from '../../apps/beta-web/node_modules/@axe-core/playwright/dist/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];
if(!/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''))throw new Error('Synthetic profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const started=performance.now();
const app=await _electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(15000);
const results={packageRoot,profile,passed:[],errors:[],accessibility:[],routes:[]};const record=name=>{results.passed.push(name);console.log('PASS',name);};
page.on('pageerror',error=>results.errors.push(error.message));
try{
 await page.waitForURL('**/memory',{timeout:180000});await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();results.populatedLaunchMs=Math.round(performance.now()-started);record('populated app launch: '+results.populatedLaunchMs+' ms');
 for(const [route,heading] of [['/dashboard','Overview'],['/memory','Memory'],['/chat','Chat'],['/truth-inbox','Truth Inbox'],['/delivery','Delivery'],['/timeline','Timeline'],['/settings','Settings']]){
  await page.goto('orchestra://app'+route);await page.waitForTimeout(800);
  assert.equal(await page.title(),'Orchestra');const text=await page.locator('body').innerText();assert(text.length>100);assert(!/vite-error-overlay|Internal Server Error/.test(text));
  // Electron cannot create axe's auxiliary browser target. Legacy mode runs
  // the same rules in the trusted single frame (the app forbids subframes).
  const report=await new AxeBuilder({page}).setLegacyMode(true).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();results.accessibility.push({route,violations:report.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});
  for(const width of [768,1280]){await page.setViewportSize({width,height:850});await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route+' horizontal page overflow');}
  record(route+' identity, content, resize and axe collected');
 }
 await page.goto('orchestra://app/chat');await page.getByRole('link',{name:'When is the desktop pilot launch date?',exact:true}).click();await page.getByRole('button',{name:'Mark answer helpful'}).first().waitFor();
 const deleteButton=page.getByRole('button',{name:'Delete chat When is the desktop pilot launch date?',exact:true});await deleteButton.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('alertdialog');await dialog.waitFor();assert(await dialog.evaluate(el=>el.contains(document.activeElement)));for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert(await dialog.evaluate(el=>el.contains(document.activeElement)));}await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await deleteButton.evaluate(el=>el===document.activeElement));record('chat deletion keyboard focus trap, Escape and restoration');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));await page.waitForTimeout(300);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));record('native zoom retains usable layout');
 // Measure real sidebar navigation with data present. These are samples on this
 // machine, not population p95 or an external-AI performance certification.
 for(let n=0;n<5;n++)for(const [name,marker] of [['Memory','SOURCE DOCUMENTS'],['Chat','Ask Socrates anything about your project…']]){
  const t=performance.now();await page.getByRole('button',{name,exact:true}).click();if(name==='Chat')await page.getByPlaceholder(marker).waitFor();else await page.getByRole('button',{name:'Open actions for Desktop-Pilot-Requirements',exact:true}).waitFor();results.routes.push({name,usableMs:Math.round(performance.now()-t)});
 }
 record('10 warm sidebar navigation measurements');
 for(const [legacy,destination] of [['watchtower','truth-inbox'],['suggestions','truth-inbox'],['socrates','chat'],['integrations','settings']]){
  await page.goto('orchestra://app/'+legacy);await page.waitForURL(url=>url.pathname==='/'+destination||url.pathname.startsWith('/'+destination+'/'));
 }
 record('legacy feature links resolve to their canonical local workflow');
 // Test the real native navigation handler without opening another app or
 // touching its configuration. The native confirmation and OS launch are sinks.
 await app.evaluate(({dialog,shell})=>{globalThis.__externalProof={prompts:[],opened:[],allow:false};dialog.showMessageBox=async(_window,options)=>{globalThis.__externalProof.prompts.push(options.detail);return {response:globalThis.__externalProof.allow?1:0};};shell.openExternal=async url=>{globalThis.__externalProof.opened.push(url);};});
 await page.evaluate(()=>window.open('https://example.com/synthetic-source','_blank'));
 await page.waitForTimeout(200);
 let proof=await app.evaluate(()=>globalThis.__externalProof);assert.deepEqual(proof.opened,[]);assert.deepEqual(proof.prompts,['https://example.com/synthetic-source']);
 await app.evaluate(()=>{globalThis.__externalProof.allow=true;});await page.evaluate(()=>window.open('https://example.com/synthetic-source','_blank'));await page.waitForTimeout(200);
 proof=await app.evaluate(()=>globalThis.__externalProof);assert.deepEqual(proof.opened,['https://example.com/synthetic-source']);assert(page.url().startsWith('orchestra://app/'));assert.equal(app.windows().length,1);
 record('external source handoff requires confirmation and never loads remote renderer content (native sinks substituted)');
 await page.screenshot({path:join(profile,'quality.png'),animations:'disabled'});
 assert.deepEqual(results.errors,[]);assert.equal(results.accessibility.flatMap(r=>r.violations).length,0,'Accessibility violations recorded');
}catch(error){results.failure=String(error);console.log('FAIL',String(error));await page.screenshot({path:join(profile,'quality-failure.png')});throw error;}
finally{await writeFile(join(profile,'quality.json'),JSON.stringify(results,null,2));console.log('Evidence',join(profile,'quality.json'));await app.close();}
