import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,cp} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {aggregateArtifactNotices,renderArtifactNotices} from '../scripts/desktop/artifact-notices.mjs';
import {NOTICE_MANIFEST,NOTICE_TEXT,renderBuildNotices,sha256} from '../scripts/desktop/build-notices.mjs';
import {normalizeFontAttribution} from '../scripts/desktop/font-attribution.mjs';
const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const {createPackage}=await import(pathToFileURL(require.resolve('@electron/asar')).href);

async function fixture(){
 const temp=await mkdtemp(join(tmpdir(),'orch-artifact-notices-')),root=join(temp,'package');
 const resources=join(root,'Fixture.app/Contents/Resources'),runtime=join(resources,'runtime');
 async function put(path,text){await mkdir(join(path,'..'),{recursive:true});await writeFile(path,text);}
 const report={formatVersion:1,complete:false,outputs:[{path:'index.js',sha256:sha256('fixture();'),bytes:10}],packages:[],missingNoticeLocations:[],componentReviewRequired:[]};
 for(const dir of [join(temp,'asar/dist'),join(runtime,'ui')]){
  await put(join(dir,'index.js'),'fixture();');await put(join(dir,NOTICE_MANIFEST),JSON.stringify(report));await put(join(dir,NOTICE_TEXT),renderBuildNotices(report));
 }
 const native=[];for(const path of ['native/node/LICENSE','native/pgsql/POSTGRESQL-LICENSE','native/pgsql/PGVECTOR-LICENSE','native/pgsql/OPENSSL-LICENSE']){
  await put(join(runtime,path),'fixture native notice');native.push({path,sha256:sha256('fixture native notice')});
 }
 await put(join(runtime,'native-manifest.json'),JSON.stringify({platform:'darwin-arm64',node:'fixture',postgres:'fixture',pgvector:'fixture',files:native}));
 await put(join(runtime,'backend/node_modules/dep/package.json'),JSON.stringify({name:'dep',version:'1',license:'MIT'}));
 await put(join(runtime,'third-party-notices/dep.txt'),'fixture recovered license');
 await put(join(runtime,'third-party-notices/manifest.json'),JSON.stringify([{package:'dep',version:'1',file:'dep.txt',sha256:sha256('fixture recovered license')} ]));
 await put(join(runtime,'third-party-notices/recovered-notices.json'),JSON.stringify({notices:[],unresolved:[]}));
 await put(join(root,'LICENSE'),'fixture Electron notice');await put(join(root,'LICENSES.chromium.html'),'<p>fixture Chromium notice</p>');
 await createPackage(join(temp,'asar'),join(resources,'app.asar'));
 return {temp,root,runtime};
}
test('exact artifact aggregates backend supplements, Electron, native and flattened build evidence',async()=>{
 const {temp,root}=await fixture();
 try{const report=await aggregateArtifactNotices(root,{includeText:true});
  assert.equal(report.complete,false);assert.equal(report.builds.length,2);assert.deepEqual(report.gaps,[]);assert.deepEqual(report.integrityErrors,[]);
  assert.equal(report.backend.unresolvedAfterSupplementalNotices.length,0);assert.equal(report.native.notices.length,4);assert.equal(report.electron.length,2);
  assert.match(renderArtifactNotices(report),/fixture recovered license/);assert.match(renderArtifactNotices(report),/fixture Chromium notice/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('stale UI output and supplemental hashes are failures, never evidence of closure',async()=>{
 const {temp,root,runtime}=await fixture();
 try{await writeFile(join(runtime,'ui/index.js'),'changed();');await writeFile(join(runtime,'third-party-notices/dep.txt'),'changed notice');
  const report=await aggregateArtifactNotices(root);
  assert(report.integrityErrors.some(e=>e.includes('Stale frontend')));assert(report.integrityErrors.some(e=>e.includes('Hash mismatch')));
  assert.equal(report.backend.unresolvedAfterSupplementalNotices.length,1);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('old packages retain explicit build gaps and cannot be silently backfilled',async()=>{
 const {temp,root,runtime}=await fixture();
 try{await rm(join(runtime,'ui',NOTICE_MANIFEST));const report=await aggregateArtifactNotices(root);
  assert.equal(report.builds.length,1);assert(report.gaps.some(g=>g.includes('frontend')));
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('rejects path traversal in artifact-owned notice and build manifests',async()=>{
 const {temp,root,runtime}=await fixture();
 try{const path=join(runtime,'third-party-notices/manifest.json'),report=JSON.parse(await readFile(path));report[0].file='../outside.txt';
  await writeFile(path,JSON.stringify(report));await assert.rejects(aggregateArtifactNotices(root),/Unsafe notice path/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test('does not follow a package metadata symlink outside the exact artifact',async()=>{
 const {temp,root,runtime}=await fixture();
 try{const dir=join(runtime,'backend/node_modules/linked');await mkdir(dir);await writeFile(join(temp,'external.json'),JSON.stringify({name:'external',version:'1'}));await symlink(join(temp,'external.json'),join(dir,'package.json'));
  const report=await aggregateArtifactNotices(root);assert.deepEqual(report.backend.packages.map(p=>p.name),['dep']);
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('PDF font transforms and component notices are validated from the artifact, while removed historical blockers stay distinct',async()=>{
 const {temp,root,runtime}=await fixture();
 try {
  const source=fileURLToPath(new URL('../',import.meta.url)),modules=join(runtime,'backend/node_modules');
  const supplement=join(runtime,'third-party-notices'),specificationPath=join(supplement,'pdf-standard-fonts-transform.json');
  for(const name of ['pdf-lib','@pdf-lib/standard-fonts','@pdf-lib/upng','pako'])await cp(join(source,'node_modules',name),join(modules,name),{recursive:true});
  const packet=JSON.parse(await readFile(join(source,'docs/desktop/third-party/pdf-notices.json')));
  for(const name of ['pdf-notices.json','pdf-standard-fonts-transform.json',...packet.notices.map(n=>n.file)])await cp(join(source,'docs/desktop/third-party',name),join(supplement,name));
  const transformed=await normalizeFontAttribution({sourceModules:join(source,'node_modules'),stagedModules:modules,specificationPath});
  const transformPath=join(runtime,'font-attribution-transform.json');await writeFile(transformPath,JSON.stringify(transformed));
  await writeFile(join(supplement,'recovered-notices.json'),JSON.stringify({notices:[],unresolved:['dep@1','stackback@0.0.2']}));
  const report=await aggregateArtifactNotices(root);
  assert.deepEqual(report.integrityErrors,[]);assert.equal(report.fontAttribution.verified,true);
  assert.equal(report.fontAttribution.metricCopies,28);assert.equal(report.pdfComponentNotices.length,10);
  assert.deepEqual(report.declaredUnresolved,['dep@1']);assert.deepEqual(report.historicalUnresolvedNotBundled,['stackback@0.0.2']);
  await writeFile(transformPath,JSON.stringify({...transformed,omittedFiles:transformed.omittedFiles.slice(1)}));
  assert((await aggregateArtifactNotices(root)).integrityErrors.some(e=>e.includes('Invalid bundle omission record')));
  await rm(transformPath);
  assert((await aggregateArtifactNotices(root)).integrityErrors.some(e=>e.includes('Font attribution validation failed')));
  await writeFile(transformPath,JSON.stringify(transformed));
  await writeFile(join(supplement,packet.notices[0].file),'altered permission');
  assert((await aggregateArtifactNotices(root)).integrityErrors.some(e=>e.includes('Hash mismatch')));
 }finally{await rm(temp,{recursive:true,force:true});}
});
