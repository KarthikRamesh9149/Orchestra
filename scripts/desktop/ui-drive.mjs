// Real native Drive sign-in; output contains no credentials or document content.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const repo=resolve(import.meta.dirname,'../..'),profile=process.argv[2];
assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''),'Dedicated synthetic profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
assert(packageRoot.startsWith(join(repo,'.desktop/packages/')));
const results={packageRoot,passed:[],errors:[]};let app,projectId,imported;
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
const safe=result=>assert(!/accessToken|refreshToken|ya29\.|1\/\//.test(JSON.stringify(result)),'Credential leaked to renderer');
try{
 app=await launch();let page=await app.firstWindow();page.on('pageerror',()=>results.errors.push('Renderer error'));
 await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/settings');
 await page.getByRole('heading',{name:'Desktop Google Drive',exact:true}).waitFor({timeout:30000});
 const initial=await page.evaluate(()=>window.orchestra.drive.inspect());assert(initial.ok);safe(initial);
 if(!initial.data.clientConfigured){
  const clientFile=process.argv[3];assert(clientFile&&/^\/Users\/[^/]+\/Downloads\/client_secret[^/]*\.json$/.test(clientFile),'Explicit downloaded desktop client JSON required');
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},clientFile);
  await page.getByRole('button',{name:'Import Google Desktop client',exact:true}).click();
  await page.getByRole('button',{name:'Select Google Drive files',exact:true}).waitFor();
  await page.waitForFunction(async()=>{const r=await window.orchestra.drive.inspect();return r.ok&&r.data.clientConfigured;});
  results.passed.push('explicit desktop client JSON imported into OS-protected settings');
 }
 if(!initial.data.connected){
  // Consent response is stubbed only inside this disposable qualification app.
  // Browser OAuth, PKCE exchange and protected credential storage remain real.
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await page.getByRole('button',{name:'Select Google Drive files',exact:true}).click();
  console.log('Waiting for Google authorization and selection of the synthetic qualification document.');
 }
 await Promise.race([
  page.getByRole('button',{name:'Revoke desktop Drive access',exact:true}).waitFor({timeout:240000}),
  page.locator('section[aria-labelledby="desktop-drive-heading"] [role="alert"]').waitFor({timeout:240000}).then(async()=>{
   results.authorizationError=await page.locator('section[aria-labelledby="desktop-drive-heading"] [role="alert"]').innerText();
   throw new Error('Native Drive authorization rejected');
  })
 ]);
 const state=await page.evaluate(()=>window.orchestra.drive.inspect());safe(state);assert(state.ok&&state.data.connected);assert.equal(state.data.selectedFileCount,1);
 results.passed.push('real Google native authorization with exactly one selected file and protected credential save');
 if(process.argv.includes('--import')){
  const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok);
  projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await page.getByRole('button',{name:'Import selected Drive files',exact:true}).click();
  await Promise.race([page.getByText(/1 file\(s\) confirmed saved to Memory/).waitFor({timeout:90000}),page.locator('section[aria-labelledby="desktop-drive-heading"] [role="alert"]').waitFor({timeout:90000}).then(async()=>{results.importError=await page.locator('section[aria-labelledby="desktop-drive-heading"] [role="alert"]').innerText();throw new Error('Import failed');})]);
  const again=await page.evaluate(id=>window.orchestra.drive.importFiles(id),projectId);safe(again);assert(again.ok);assert.equal(again.data.saved,1);
  imported=again.data.files[0];assert.equal(imported.unchanged,true);results.documentId=imported.documentId;
  results.passed.push('real selected Drive content saved via packaged UI; repeated import retains the same document/version');
  await page.waitForFunction(async({projectId,documentId})=>{const r=await fetch(`/v1/projects/${projectId}/documents/${documentId}`);if(!r.ok)return false;return ['ready','partial','failed'].includes((await r.json()).data.parseStatus);},{projectId,documentId:imported.documentId},{timeout:90000});
  const doc=await page.evaluate(async({projectId,documentId})=>{const r=await fetch(`/v1/projects/${projectId}/documents/${documentId}`);return (await r.json()).data;},{projectId,documentId:imported.documentId});
  results.parseStatus=doc.parseStatus;assert.equal(doc.parseStatus,'ready');assert.equal(doc.sourceProvider,'google_drive');assert.equal(doc.versions.length,1);assert(JSON.stringify(doc.source).includes('https://drive.google.com/file/d/'));
  const content=await page.evaluate(async({projectId,documentId})=>{const r=await fetch(`/v1/projects/${projectId}/documents/${documentId}/file`);return {status:r.status,body:await r.text()};},{projectId,documentId:imported.documentId});
  assert.equal(content.status,200);assert(content.body.includes('Copper Finch'));assert(content.body.includes('seven reviewers'));
  results.passed.push('authorized backend confirms parsed Drive provenance and original synthetic source bytes');
 }
 await app.close();app=undefined;app=await launch();page=await app.firstWindow();
 await page.waitForURL('**/memory',{timeout:180000});
 const restored=await page.evaluate(()=>window.orchestra.drive.inspect());safe(restored);assert(restored.ok&&restored.data.connected);assert.equal(restored.data.selectedFileCount,1);
 results.passed.push('protected selected-file authorization survives packaged restart');assert.deepEqual(results.errors,[]);
 if(imported){
  const doc=await page.evaluate(async({projectId,documentId})=>{const r=await fetch(`/v1/projects/${projectId}/documents/${documentId}`);return {status:r.status,data:(await r.json()).data};},{projectId,documentId:imported.documentId});
  assert.equal(doc.status,200);assert.equal(doc.data.parseStatus,'ready');assert.equal(doc.data.sourceProvider,'google_drive');assert.equal(doc.data.versions.length,1);
  results.passed.push('parsed source, canonical Drive link and single document/version survive complete packaged restart');
 }
 console.log(JSON.stringify(results));
}catch(error){results.failure='Drive qualification failed: '+String(error.message).slice(0,300);process.exitCode=1;console.error(results.failure);}
finally{if(app)await app.close().catch(()=>{});await writeFile(join(profile,'step5-drive-auth.json'),JSON.stringify(results,null,2));}
