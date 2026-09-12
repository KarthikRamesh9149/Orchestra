// Run after the authorized external writer appends the synthetic sync marker.
import {_electron} from '../../apps/beta-web/node_modules/playwright/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const profile=process.argv[2];assert(/^\/private\/tmp\/orchestra-step4-acceptance-[A-Za-z0-9]+$/.test(profile??''));
assert.equal(JSON.parse(await readFile(join(profile,'result.json'),'utf8')).profile,profile);
const prior=JSON.parse(await readFile(join(profile,'step5-drive-auth.json'),'utf8'));assert(prior.documentId);
const root=(await readFile(join(resolve(import.meta.dirname,'../..'),'.desktop/latest-package.txt'),'utf8')).trim();
const launch=()=>_electron.launch({executablePath:join(root,'Orchestra Desktop Internal.app/Contents/MacOS/Orchestra Desktop Internal'),args:['--user-data-dir='+profile],env:{PATH:'',TMPDIR:process.env.TMPDIR??'',HOME:process.env.HOME},timeout:60000});
let app;const proof={packageRoot:root,passed:[]};
async function waitPartial(page,projectId,id,revision){
 const deadline=Date.now()+60000;let doc;
 while(Date.now()<deadline){doc=await page.evaluate(async({projectId,id})=>(await(await fetch(`/v1/projects/${projectId}/documents/${id}`,{cache:'no-store'})).json()).data,{projectId,id});if(doc.parseStatus==='partial'&&doc.currentVersion.parseRevision===revision)return doc;await new Promise(resolve=>setTimeout(resolve,500));}
 throw new Error(`Expected partial revision ${revision}; received ${doc?.parseStatus} revision ${doc?.currentVersion?.parseRevision}`);
}
try{
 app=await launch();let page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:60000}).catch(async error=>{console.log((await page.locator('body').innerText()).slice(0,1500));throw error;});
 const boot=await page.evaluate(()=>window.orchestra.bootstrap());assert(boot.ok);const projectId=(boot.data.workspaces.find(w=>w.current)??boot.data.workspaces[0]).projectId;
 const selections=await page.evaluate(()=>window.orchestra.sync.inspect());assert(selections.ok);const target=selections.data.targets.find(t=>t.provider==='drive'&&t.projectId===projectId);assert(target&&!target.enabled&&target.resourceIds.length===1);
 const before=await page.evaluate(async({projectId,id})=>(await fetch(`/v1/projects/${projectId}/documents/${id}`)).json(),{projectId,id:prior.documentId});
 if(process.argv.includes('--inspect')){
  const result=await page.evaluate(async({projectId,id})=>{const response=await fetch(`/v1/projects/${projectId}/documents/${id}/file`);return {status:response.status,body:await response.text()};},{projectId,id:prior.documentId});
  console.log(JSON.stringify({document:before.data,file:result}));
  console.log(JSON.stringify(await app.evaluate(async({app,safeStorage},documentId)=>{
   const fs=process.getBuiltinModule('fs/promises'),path=process.getBuiltinModule('path');const base=path.join(app.getPath('userData'),'local-runtime');
   const vault=JSON.parse(safeStorage.decryptString(await fs.readFile(path.join(base,'credentials.enc'))));
   const port=(await fs.readFile(path.join(base,'postgres/postmaster.pid'),'utf8')).split('\n')[3];
   const require=process.getBuiltinModule('module').createRequire(path.join(process.resourcesPath,'runtime/backend/package.json'));
   const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasources:{db:{url:`postgresql://orchestra_desktop_runtime:${vault.runtime}@127.0.0.1:${port}/orchestra?schema=public`}}});
   try{return await db.$queryRaw`SELECT j.name,j.status,j.failure_code,j.payload->>'parseRevision' AS revision FROM desktop_jobs j JOIN document_versions v ON v.id::text=j.payload->>'documentVersionId' WHERE v.document_id=${documentId}::uuid ORDER BY j.created_at DESC LIMIT 12`;}finally{await db.$disconnect();}
  },prior.documentId)));
  process.exitCode=0;
 }else if(process.argv.includes('--recover')){
  assert.equal(before.data.versions.length,2);
  const retry=await page.evaluate(async({projectId,id})=>{const r=await fetch(`/v1/projects/${projectId}/documents/${id}/reprocess`,{method:'POST'});return {status:r.status,body:await r.json()};},{projectId,id:prior.documentId});
  assert.equal(retry.status,200);
  proof.beforeRestart=await waitPartial(page,projectId,prior.documentId,retry.body.data.parseRevision);
  await app.close();app=await launch();page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
  proof.afterRestart=await waitPartial(page,projectId,prior.documentId,retry.body.data.parseRevision);
  const after=await page.evaluate(async({projectId,id})=>{const doc=(await(await fetch(`/v1/projects/${projectId}/documents/${id}`,{cache:'no-store'})).json()).data;const file=await fetch(`/v1/projects/${projectId}/documents/${id}/file`,{cache:'no-store'});const search=await fetch(`/v1/projects/${projectId}/documents/${id}/search?q=COPPER-FINCH-SYNC-2`,{cache:'no-store'});return {doc,fileStatus:file.status,source:await file.text(),searchStatus:search.status,search:await search.json()};},{projectId,id:prior.documentId});
  assert.equal(after.doc.versions.length,2);assert.equal(after.doc.parseStatus,'partial');assert.equal(after.fileStatus,200);assert(after.source.includes('COPPER-FINCH-SYNC-2'));assert(after.source.includes('seven reviewers'));
  assert.equal(after.searchStatus,200);assert(JSON.stringify(after.search.data).includes('COPPER-FINCH-SYNC-2'));
  const repeat=await page.evaluate(id=>window.orchestra.sync.update({id,action:'refresh'}),target.id);assert(repeat.ok&&repeat.data.files[0].unchanged);
  proof.passed.push('real changed Drive revision retains both versions and stable identity; explicit reprocess with exhausted AI budget preserves lexical search, current original download and honest partial status across restart; repeat refresh creates no duplicate');console.log(JSON.stringify(proof));
 }else{
 assert(!JSON.stringify(before).includes('COPPER-FINCH-SYNC-2'));const count=before.data.versions.length;
 const result=await page.evaluate(id=>window.orchestra.sync.update({id,action:'refresh'}),target.id);assert(result.ok);assert.equal(result.data.files[0].documentId,prior.documentId);assert.equal(result.data.files[0].unchanged,false);
 const repeat=await page.evaluate(id=>window.orchestra.sync.update({id,action:'refresh'}),target.id);assert(repeat.ok&&repeat.data.files[0].unchanged);
 await app.close();app=await launch();page=await app.firstWindow();await page.waitForURL('**/memory',{timeout:180000});
 const after=await page.evaluate(async({projectId,id})=>{const doc=await(await fetch(`/v1/projects/${projectId}/documents/${id}`)).json();const source=await(await fetch(`/v1/projects/${projectId}/documents/${id}/file`)).text();return {doc:doc.data,source};},{projectId,id:prior.documentId});
 assert.equal(after.doc.versions.length,count+1);assert(after.source.includes('COPPER-FINCH-SYNC-2'));assert(after.source.includes('seven reviewers'));assert.equal(after.doc.sourceProvider,'google_drive');
 proof.parseStatus=after.doc.parseStatus;proof.passed.push('real provider revision update retained document identity and original versions; repeat made no duplicate; latest source bytes and provenance survived full restart');console.log(JSON.stringify(proof));
 }
}catch(error){proof.failure=String(error.message).slice(0,300);process.exitCode=1;console.error(proof.failure);}
finally{await app?.close();if(!process.argv.includes('--inspect'))await writeFile(join(profile,'step5-drive-update.json'),JSON.stringify(proof,null,2),{mode:0o600});}
