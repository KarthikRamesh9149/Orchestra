// Real packaged GitHub authorization. Never log device/access/refresh tokens.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const repo=resolve(import.meta.dirname,'../..'),profile=process.argv[2];
assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''),'Dedicated synthetic profile required');
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const packageRoot=(await readFile(join(repo,'.desktop/latest-package.txt'),'utf8')).trim();
assert(packageRoot.startsWith(join(repo,'.desktop/packages/')),'Internal package required');
const results={packageRoot,passed:[],errors:[],freshSignIn:false};let app,projectId,imported;
const launch=()=>_electron.launch({executablePath:join(packageRoot,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
const safe=value=>assert(!JSON.stringify(value).match(/accessToken|refreshToken|ghu_|ghr_|device_code/),'Credential leaked to renderer');
try{
 app=await launch();let page=await app.firstWindow();page.on('pageerror',()=>results.errors.push('Renderer error'));
 await page.waitForURL('**/memory',{timeout:180000});await page.goto('orchestra://app/settings');
 await page.getByRole('heading',{name:'Desktop GitHub',exact:true}).waitFor({timeout:30000});
 if(process.argv.includes('--revoked')){
  assert.equal((await page.evaluate(()=>window.orchestra.github.repositories())).ok,false,'Remote revocation must deny the existing saved grant');
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  const removed=await page.evaluate(()=>window.orchestra.github.disconnect());assert(removed.ok&&removed.data.remoteRevocationConfirmed===false);
  results.passed.push('real GitHub-side revocation denies the previously saved grant; local removal is truthfully separate');
  await page.reload();await page.getByRole('heading',{name:'Desktop GitHub',exact:true}).waitFor();
 }
 const initial=await page.evaluate(()=>window.orchestra.github.inspect());assert(initial.ok);safe(initial);
 if(!initial.data.configured){
  results.freshSignIn=true;
  await page.getByRole('button',{name:'Connect desktop GitHub',exact:true}).click();
  console.log('Waiting for native GitHub confirmation and real browser device authorization.');
 }
 await page.getByRole('button',{name:'Remove GitHub from this Mac',exact:true}).waitFor({timeout:240000});
 await page.getByRole('button',{name:'List authorized repositories',exact:true}).click();
 const inventory=page.getByRole('list',{name:'Authorized GitHub repositories'});
 await inventory.waitFor({timeout:45000});assert((await inventory.innerText()).includes('KarthikRamesh9149/Orchestra'));
 assert(!(await inventory.innerText()).includes('KarthikRamesh9149/orchestrav2'));
 const state=await page.evaluate(()=>window.orchestra.github.inspect());assert(state.ok&&state.data.configured);safe(state);
 results.passed.push(results.freshSignIn?'real device sign-in and native protected save':'existing protected GitHub authorization restored','desktop installation lists Orchestra, not orchestrav2');
 if(process.argv.includes('--import')){
  const bootstrap=await page.evaluate(()=>window.orchestra.bootstrap());assert(bootstrap.ok);safe(bootstrap);
  projectId=(bootstrap.data.workspaces.find(w=>w.current)??bootstrap.data.workspaces[0]).projectId;
  const repositories=await page.evaluate(()=>window.orchestra.github.repositories());assert(repositories.ok);
  const target=repositories.data.find(r=>r.full_name==='KarthikRamesh9149/Orchestra');assert(target);
  // Synthetic-profile test only: consent dialog response is stubbed. Real
  // provider reads, native validation and database writes are not mocked.
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
  await page.getByLabel('Repository to import').selectOption(String(target.id));
  await page.getByRole('button',{name:'Import selected GitHub repository',exact:true}).click();
  await page.getByText(/GitHub evidence records confirmed:/).waitFor({timeout:90000});
  const again=await page.evaluate(input=>window.orchestra.github.importRepository(input),{projectId,repositoryId:target.id});
  assert(again.ok,'Repeat import rejected');safe(again);imported=again.data;
  assert(imported.evidenceCount>0);assert.equal(imported.created,0);assert.equal(imported.updated,0);
  results.import={repository:imported.repository,evidenceCount:imported.evidenceCount,repeatCreated:0,repeatUpdated:0};
  results.passed.push('real selected-repository import via packaged UI; identical repeat makes no duplicate evidence');
 }
 await app.close();app=undefined;
 app=await launch();page=await app.firstWindow();page.on('pageerror',()=>results.errors.push('Renderer error'));
 await page.waitForURL('**/memory',{timeout:180000});
 const restored=await page.evaluate(()=>window.orchestra.github.inspect());assert(restored.ok&&restored.data.configured);safe(restored);
 const repositories=await page.evaluate(()=>window.orchestra.github.repositories());assert(repositories.ok);safe(repositories);
 assert(repositories.data.some(x=>x.full_name==='KarthikRamesh9149/Orchestra'));
 results.passed.push('protected credentials and authorized repository access survive packaged restart');
 if(imported){
  const evidence=await page.evaluate(async id=>{const r=await fetch(`/v1/projects/${id}/github/code-status`);return {status:r.status,body:await r.json()};},projectId);
  results.persistedRead={status:evidence.status,code:evidence.body.error?.code??null};
  assert.equal(evidence.status,200);assert(evidence.body.data);safe(evidence);
  const serialized=JSON.stringify(evidence.body.data);
  assert(serialized.includes('KarthikRamesh9149/Orchestra'),'Persisted repository missing after restart');
  assert(serialized.includes('https://github.com/KarthikRamesh9149/Orchestra/'),'Source links missing after restart');
  results.passed.push('authorized backend returns persisted repository evidence and source links after packaged restart');
 }
 assert.deepEqual(results.errors,[]);console.log(JSON.stringify(results));
}catch(error){
 results.failedAssertion=String(error?.message??'Unknown failure').replace(/(?:gh[ur]_|mcp_)[A-Za-z0-9_-]+/g,'[redacted]').slice(0,500);
 results.failure='Packaged GitHub qualification failed or timed out';process.exitCode=1;console.error(results.failure);
}finally{
 if(app)await app.close().catch(()=>{});
 await writeFile(join(profile,'step5-github-auth.json'),JSON.stringify(results,null,2));
}
