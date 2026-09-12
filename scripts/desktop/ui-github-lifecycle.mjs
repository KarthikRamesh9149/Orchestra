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
 await app.evaluate(async({app,safeStorage,dialog})=>{
  dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});
  const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path'),file=path.join(app.getPath('userData'),'local-runtime/provider-settings.enc');
  const state=JSON.parse(safeStorage.decryptString(await fs.readFile(file)));if(!state.github)throw new Error('Dedicated GitHub grant required');
  state.github.expiresAt=Date.now()-1000;const temporary=file+'.qualification';await fs.writeFile(temporary,safeStorage.encryptString(JSON.stringify(state)),{mode:0o600,flag:'wx'});await fs.rename(temporary,file);
 });
 let repos=await page.evaluate(()=>window.orchestra.github.repositories());assert(repos.ok);assert(!repos.data.some(r=>r.full_name==='KarthikRamesh9149/orchestrav2'));
 const repo=repos.data.find(r=>r.full_name==='KarthikRamesh9149/Orchestra');assert(repo);
 assert(await app.evaluate(async({app,safeStorage})=>{const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');const s=JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(app.getPath('userData'),'local-runtime/provider-settings.enc'))));return s.github.expiresAt>Date.now();}));
 proof.passed.push('real GitHub token refresh is durably stored; installation stays restricted to Orchestra');
 const imported=await page.evaluate(input=>window.orchestra.github.importRepository(input),{projectId,repositoryId:repo.id});assert(imported.ok);
 const state=await page.evaluate(()=>window.orchestra.sync.inspect());assert(state.ok);const target=state.data.targets.find(t=>t.provider==='github'&&t.projectId===projectId);assert(target&&!target.enabled);
 const repeat=await page.evaluate(id=>window.orchestra.sync.update({id,action:'refresh'}),target.id);assert(repeat.ok);assert.equal(repeat.data.created,0);assert.equal(repeat.data.updated,0);proof.passed.push('saved GitHub selection refresh is idempotent and defaults to paused');
 await app.evaluate(()=>{globalThis.__githubFetch=globalThis.fetch;globalThis.fetch=(input,options)=>String(input).startsWith('https://api.github.com/')?Promise.reject(new Error('Synthetic offline')):globalThis.__githubFetch(input,options);});
 assert.equal((await page.evaluate(()=>window.orchestra.github.repositories())).ok,false);
 await app.evaluate(()=>{globalThis.fetch=globalThis.__githubFetch;delete globalThis.__githubFetch;});
 assert((await page.evaluate(()=>window.orchestra.github.repositories())).ok);proof.passed.push('offline inventory fails honestly and recovers');
 if(process.argv.includes('--disconnect')){const r=await page.evaluate(()=>window.orchestra.github.disconnect());assert(r.ok);assert.equal(r.data.remoteRevocationConfirmed,false);assert.equal((await page.evaluate(()=>window.orchestra.github.repositories())).ok,false);proof.passed.push('local credential removal blocks access and does not claim remote revocation');}
 console.log(JSON.stringify(proof));
}catch(error){proof.failure=String(error.message).slice(0,300);process.exitCode=1;console.error(proof.failure);}
finally{await app?.close();await writeFile(join(profile,'step5-github-lifecycle.json'),JSON.stringify(proof,null,2),{mode:0o600});}
