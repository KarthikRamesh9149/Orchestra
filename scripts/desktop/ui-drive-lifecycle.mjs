// Real provider refresh/recovery on the single selected synthetic document.
// No token values leave Electron main. Revocation is opt-in to allow reconnect.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const root=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
let app;const proof={packageRoot:root,passed:[]};
try{
 app=await _electron.launch({executablePath:join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
 const page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok);const projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
 const state=await page.evaluate(()=>window.orchestra.drive.inspect());assert(state.ok&&state.data.connected&&state.data.selectedFileCount===1);
 await app.evaluate(async({app,safeStorage,dialog})=>{
  dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
  const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');
  const file=path.join(app.getPath('userData'),'local-runtime/provider-settings.enc');
  const state=JSON.parse(safeStorage.decryptString(await fs.readFile(file)));if(state.drive?.fileIds.length!==1)throw new Error('Synthetic grant required');
  state.drive.expiresAt=Date.now()-1000;
  const temporary=file+'.qualification';await fs.writeFile(temporary,safeStorage.encryptString(JSON.stringify(state)),{mode:0o600,flag:'wx'});await fs.rename(temporary,file);
 });
 const refreshed=await page.evaluate(id=>window.orchestra.drive.importFiles(id),projectId);assert(refreshed.ok);assert(refreshed.data.files[0].unchanged);
 const persisted=await app.evaluate(async({app,safeStorage})=>{const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');const state=JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(app.getPath('userData'),'local-runtime/provider-settings.enc'))));return state.drive.expiresAt>Date.now();});assert(persisted);
 proof.passed.push('real Google refresh and durably saved token; repeated import remains idempotent');
 await app.evaluate(()=>{globalThis.__driveOriginalFetch=globalThis.fetch;globalThis.fetch=(input,options)=>String(input).startsWith('https://www.googleapis.com/drive/')?Promise.reject(new Error('Synthetic offline')):globalThis.__driveOriginalFetch(input,options);});
 const offline=await page.evaluate(id=>window.orchestra.drive.importFiles(id),projectId);assert.equal(offline.ok,false);assert(offline.error.message.includes('0 file(s)'));
 await app.evaluate(()=>{globalThis.fetch=globalThis.__driveOriginalFetch;delete globalThis.__driveOriginalFetch;});
 assert((await page.evaluate(id=>window.orchestra.drive.importFiles(id),projectId)).ok);proof.passed.push('native network interruption fails honestly; import recovers after connectivity returns');
 if(process.argv.includes('--revoke')){
  const revoked=await page.evaluate(()=>window.orchestra.drive.revoke());assert(revoked.ok);assert.equal((await page.evaluate(()=>window.orchestra.drive.inspect())).data.connected,false);
  assert.equal((await page.evaluate(id=>window.orchestra.drive.importFiles(id),projectId)).ok,false);proof.passed.push('real provider revocation clears local grant and prevents subsequent imports');
 }
 console.log(JSON.stringify(proof));
}catch(error){proof.failure=String(error.message).slice(0,300);process.exitCode=1;console.error(proof.failure);}
finally{await app?.close();await writeFile(join(profile,'step5-drive-lifecycle.json'),JSON.stringify(proof,null,2),{mode:0o600});}
