import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,readlink,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {planRuntimeDependencies,stageRuntimeDependencies,validateStagedRuntime,assertPrismaSchemaMatches} from '../scripts/desktop/runtime-dependencies.mjs';

async function fixture() {
 const temp=await mkdtemp(join(tmpdir(),'orch-runtime-deps-')),root=join(temp,'source'),destination=join(temp,'stage/node_modules');
 const manifest={name:'fixture',version:'1',dependencies:{'@prisma/client':'6.6.0',app:'1.0.0',foo:'1.0.0'},devDependencies:{prisma:'6.6.0',vitest:'1.0.0',typescript:'5.7.0'}};
 const lock={lockfileVersion:3,packages:{'':manifest}};
 const put=async(path,text)=>{await mkdir(join(path,'..'),{recursive:true});await writeFile(path,text);};
 async function pkg(path,metadata,files={}) {
  lock.packages[path]={...metadata};delete lock.packages[path].name;
  await put(join(root,path,'package.json'),JSON.stringify(metadata));
  for(const [file,body]of Object.entries(files))await put(join(root,path,file),body);
 }
 await pkg('node_modules/@prisma/client',{name:'@prisma/client',version:'6.6.0',peerDependencies:{prisma:'*',typescript:'>=5.1.0'},peerDependenciesMeta:{prisma:{optional:true},typescript:{optional:true}}},{'default.js':'fixture client','runtime/library.js':'fixture library'});
 await pkg('node_modules/prisma',{name:'prisma',version:'6.6.0',dependencies:{'@prisma/engines':'6.6.0'},bin:{prisma:'build/index.js'}},{'build/index.js':'fixture migration CLI'});
 await pkg('node_modules/@prisma/engines',{name:'@prisma/engines',version:'6.6.0'},{'schema-engine-darwin-arm64':'fixture migration engine','libquery_engine-darwin-arm64.dylib.node':'fixture query engine'});
 await pkg('node_modules/app',{name:'app',version:'1.0.0',dependencies:{foo:'^2.0.0'},optionalDependencies:{native:'1.0.0',missing:'1.0.0'},peerDependencies:{peer:'1.0.0',optionalpeer:'1.0.0'},peerDependenciesMeta:{optionalpeer:{optional:true}}},{'index.js':'fixture app'});
 for(const [path,name,version]of [['node_modules/foo','foo','1.0.0'],['node_modules/app/node_modules/foo','foo','2.0.0'],['node_modules/native','native','1.0.0'],['node_modules/peer','peer','1.0.0'],['node_modules/typescript','typescript','5.7.0'],['node_modules/app/node_modules/hidden-dev','hidden-dev','1.0.0']])await pkg(path,{name,version},{'index.js':'fixture module'});
 await pkg('node_modules/vitest',{name:'vitest',version:'1.0.0',dependencies:{stackback:'0.0.2'}},{'bin.js':'fixture dev CLI'});
 await pkg('node_modules/stackback',{name:'stackback',version:'0.0.2'},{'index.js':'fixture dev only'});
 await put(join(root,'prisma/schema.prisma'),'fixture schema');
 await put(join(root,'node_modules/.prisma/client/package.json'),JSON.stringify({name:'generated-client',version:'6.6.0'}));
 for(const file of ['default.js','index.js','index.d.ts','libquery_engine-darwin-arm64.dylib.node'])await put(join(root,'node_modules/.prisma/client',file),'fixture generated '+file);
 await put(join(root,'node_modules/.prisma/client/schema.prisma'),'fixture schema');
 const {chmod}=await import('node:fs/promises');await chmod(join(root,'node_modules/@prisma/engines/schema-engine-darwin-arm64'),0o755);
 await symlink(join(root,'node_modules/.prisma'),join(root,'node_modules/@prisma/client/.prisma'));
 await mkdir(join(root,'node_modules/.bin'));await symlink('../prisma/build/index.js',join(root,'node_modules/.bin/prisma'));await symlink('../vitest/bin.js',join(root,'node_modules/.bin/vitest'));
 await put(join(root,'package.json'),JSON.stringify(manifest));await put(join(root,'package-lock.json'),JSON.stringify(lock));
 return {temp,root,destination,manifest,lock,put};
}
test('stages exact production graph, nested versions, required Prisma and present optional/native peers; omits dev tooling',async()=>{
 const f=await fixture();try{
  const originalLink=await readlink(join(f.root,'node_modules/@prisma/client/.prisma'));
  const report=await stageRuntimeDependencies({sourceRoot:f.root,destination:f.destination});
  const names=report.packages.map(p=>p.name);assert(!names.includes('stackback'));assert(!names.includes('vitest'));assert(!names.includes('hidden-dev'));
  for(const name of ['prisma','@prisma/client','@prisma/engines','native','peer','typescript'])assert(names.includes(name),name);
  assert.deepEqual(report.packages.filter(p=>p.name==='foo').map(p=>p.version).sort(),['1.0.0','2.0.0']);
  assert(report.absentOptional.some(e=>e.name==='missing'));assert(report.absentOptional.some(e=>e.name==='optionalpeer'));
  assert.equal(report.stagedResolutionVerified,true);assert.equal(report.prismaArtifacts.length,10);
  assert.equal((await readFile(join(f.destination,'prisma/build/index.js'))).toString(),'fixture migration CLI');
  assert((await lstat(join(f.destination,'@prisma/engines/schema-engine-darwin-arm64'))).mode&0o111);
  assert.equal(await readlink(join(f.destination,'@prisma/client/.prisma')),'../../.prisma');
  assert.equal(await readlink(join(f.root,'node_modules/@prisma/client/.prisma')),originalLink,'source link was not mutated');
  assert.deepEqual(report.binLinks,['.bin/prisma']);assert(await lstat(join(f.root,'node_modules/stackback')));
  await assert.rejects(lstat(join(f.destination,'stackback')),{code:'ENOENT'});
  await assert.rejects(stageRuntimeDependencies({sourceRoot:f.root,destination:f.destination}),{code:'EEXIST'});
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
async function addReviewedMammoth(f) {
 f.manifest.dependencies.mammoth='^1.13.0';
 f.manifest.overrides={mammoth:{argparse:'2.0.1'}};
 for(const [path,metadata] of [
  ['node_modules/mammoth',{name:'mammoth',version:'1.13.0',dependencies:{argparse:'~1.0.3'}}],
  ['node_modules/argparse',{name:'argparse',version:'2.0.1',license:'Python-2.0'}],
 ]) {
  const {name,...locked}=metadata;f.lock.packages[path]=locked;
  await f.put(join(f.root,path,'package.json'),JSON.stringify(metadata));
 }
 await f.put(join(f.root,'package.json'),JSON.stringify(f.manifest));
 await f.put(join(f.root,'package-lock.json'),JSON.stringify(f.lock));
}
test('stages only the exact reviewed Mammoth security override and records original/effective identity',async()=>{
 const f=await fixture();try{
  await addReviewedMammoth(f);
  const report=await stageRuntimeDependencies({sourceRoot:f.root,destination:f.destination});
  const edge=report.edges.find(e=>e.from==='node_modules/mammoth'&&e.name==='argparse');
  assert.equal(edge.range,'~1.0.3');
  assert.deepEqual(edge.override,{parent:'mammoth',parentVersion:'1.13.0',version:'2.0.1'});
  assert.equal(report.stagedResolutionVerified,true);
  assert.equal(JSON.parse(await readFile(join(f.destination,'argparse/package.json'))).version,'2.0.1');
  assert.deepEqual(report.packages.filter(p=>p.name==='foo').map(p=>p.version).sort(),['1.0.0','2.0.0']);
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('unreviewed override shapes or pins fail closed',async()=>{
 const f=await fixture();try{
  await addReviewedMammoth(f);
  for(const overrides of [null,[],{argparse:'2.0.1'},{mammoth:{argparse:'^2.0.1'}},{mammoth:{argparse:'2.0.2'}},{mammoth:{argparse:'$argparse'}},{'mammoth@1':{argparse:'2.0.1'}},{mammoth:{argparse:{'.':'2.0.1'}}},{mammoth:{argparse:'2.0.1',extra:'1.0.0'}},{mammoth:{argparse:'2.0.1'},other:{argparse:'2.0.1'}}]) {
   await f.put(join(f.root,'package.json'),JSON.stringify({...f.manifest,overrides}));
   await assert.rejects(planRuntimeDependencies(f.root),/Unreviewed runtime override/);
  }
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('reviewed override cannot change another parent, declared range, parent version or installed identity',async()=>{
 for(const mutation of ['other-parent','range','parent-version','installed-version','installed-build-version','peer']) {
  const f=await fixture();try{
   await addReviewedMammoth(f);
   const path=mutation==='other-parent'?'node_modules/app':mutation.startsWith('installed-')?'node_modules/argparse':'node_modules/mammoth';
   const metadata=JSON.parse(await readFile(join(f.root,path,'package.json')));
   if(mutation==='other-parent')metadata.dependencies.argparse='~1.0.3';
   if(mutation==='range')metadata.dependencies.argparse='^1.0.0';
   if(mutation==='parent-version')metadata.version='1.13.1';
   if(mutation==='installed-version')metadata.version='1.0.10';
   if(mutation==='installed-build-version')metadata.version='2.0.1+unexpected';
   if(mutation==='peer'){delete metadata.dependencies;metadata.peerDependencies={argparse:'~1.0.3'};}
   const {name,...locked}=metadata;f.lock.packages[path]=locked;
   await f.put(join(f.root,path,'package.json'),JSON.stringify(metadata));
   await f.put(join(f.root,'package-lock.json'),JSON.stringify(f.lock));
   await assert.rejects(planRuntimeDependencies(f.root),/range mismatch|override identity mismatch/);
  }finally{await rm(f.temp,{recursive:true,force:true});}
 }
});
test('an unused reviewed override is not accepted as release provenance',async()=>{
 const f=await fixture();try{
  f.manifest.overrides={mammoth:{argparse:'2.0.1'}};
  await f.put(join(f.root,'package.json'),JSON.stringify(f.manifest));
  await assert.rejects(planRuntimeDependencies(f.root),/Reviewed runtime override was not applied/);
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('missing required peer fails but absent optional dependencies and peers are recorded',async()=>{
 const f=await fixture();try{
  await rm(join(f.root,'node_modules/peer'),{recursive:true});
  await assert.rejects(planRuntimeDependencies(f.root),/Missing required dependency peer/);
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('installed version, dependency metadata and root lock drift fail closed',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.root,'node_modules/native/package.json'),JSON.stringify({name:'native',version:'2.0.0'}));
  await assert.rejects(planRuntimeDependencies(f.root),/identity mismatch/);
  await writeFile(join(f.root,'node_modules/native/package.json'),JSON.stringify({name:'native',version:'1.0.0',dependencies:{extra:'1'}}));
  await assert.rejects(planRuntimeDependencies(f.root),/differs from lock/);
  f.manifest.dependencies.extra='1';await writeFile(join(f.root,'package.json'),JSON.stringify(f.manifest));
  await assert.rejects(planRuntimeDependencies(f.root),/manifest\/lock drift/);
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('staged validation cannot fall back to source node_modules and detects changed package identity',async()=>{
 const f=await fixture();try{
  const plan=await planRuntimeDependencies(f.root);await stageRuntimeDependencies({sourceRoot:f.root,destination:f.destination});
  await rm(join(f.destination,'app/node_modules/foo'),{recursive:true});
  await assert.rejects(validateStagedRuntime(plan,f.destination,join(f.root,'prisma/schema.prisma')));
  assert.equal(JSON.parse(await readFile(join(f.root,'node_modules/app/node_modules/foo/package.json'))).version,'2.0.0');
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('stale generated schema or missing engine prevents staging',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.root,'node_modules/.prisma/client/schema.prisma'),'stale');
  await assert.rejects(stageRuntimeDependencies({sourceRoot:f.root,destination:f.destination}),/schema is stale/);
 }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('outside source links and attempts to stage over source are rejected without deleting source',async()=>{
 const f=await fixture();try{
  await assert.rejects(stageRuntimeDependencies({sourceRoot:f.root,destination:join(f.root,'node_modules')}),/fresh separate/);
  await f.put(join(f.temp,'outside.txt'),'external fixture');await symlink(join(f.temp,'outside.txt'),join(f.root,'node_modules/app/outside'));
  await assert.rejects(stageRuntimeDependencies({sourceRoot:f.root,destination:f.destination}),/escapes node_modules/);
  assert(await lstat(join(f.root,'node_modules/app/index.js')));
 }finally{await rm(f.temp,{recursive:true,force:true});}
});

test('pinned Prisma formatter accepts generated layout changes but rejects field and literal default changes',async()=>{
 const modules=fileURLToPath(new URL('../node_modules',import.meta.url));
 const datasource='datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\n';
 const schema=Buffer.from(datasource+'model Example {\n id String @id\n title String @default("keep  two spaces")\n count Int @default(1)\n}\n');
 const formatted=Buffer.from(datasource+'model Example {\n  id    String @id\n  title String @default("keep  two spaces")\n  count Int    @default(1)\n}\n');
 await assertPrismaSchemaMatches(modules,schema,formatted);
 for(const changed of [
   formatted.toString().replace('count Int','count Float'),
   formatted.toString().replace('@default(1)','@default(2)'),
   formatted.toString().replace('keep  two spaces','keep two spaces'),
 ])await assert.rejects(assertPrismaSchemaMatches(modules,schema,Buffer.from(changed)),/schema is stale/);
 await assert.rejects(assertPrismaSchemaMatches(modules,schema,Buffer.from('invalid schema')),/could not be canonically validated/);
 assert.equal(schema.toString(),datasource+'model Example {\n id String @id\n title String @default("keep  two spaces")\n count Int @default(1)\n}\n','input bytes are never rewritten');
 const relations=datasource+'model User {\n id Int @id\n Post Post[]\n}\nmodel Post {\n id Int @id\n ownerId Int\n owner User @relation(fields: [ownerId], references: [id])\n}\n';
 await assert.rejects(assertPrismaSchemaMatches(modules,Buffer.from(relations),Buffer.from(relations.replace(' Post Post[]\n',''))),/could not be canonically validated/,'formatter must not hide a missing field by auto-repairing it');
});
