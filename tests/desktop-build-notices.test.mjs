import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,appendFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {collectBuildNotices,writeEsbuildNotices,createViteNoticePlugin,NOTICE_MANIFEST,NOTICE_TEXT,sha256} from '../scripts/desktop/build-notices.mjs';

async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'orch-build-notices-')));
 const pkg=join(root,'node_modules/@scope/dep');
 await mkdir(join(pkg,'lib'),{recursive:true});
 await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@scope/dep',version:'1.2.3',license:'MIT',main:'lib/index.js'}));
 await writeFile(join(pkg,'lib/package.json'),JSON.stringify({type:'module'}));
 await writeFile(join(pkg,'lib/index.js'),'export const value=123;');
 await writeFile(join(pkg,'LICENSE'),'Copyright Fixture. Permission is hereby granted. THE SOFTWARE IS PROVIDED.');
 await writeFile(join(pkg,'README.md'),'See the project website for context; not a license.');
 return {root,pkg,input:join(pkg,'lib/index.js')};
}
test('contributed modules retain version, source hashes and exact notice text, not labels alone',async()=>{
 const {root,pkg,input}=await fixture();
 try{
  const report=await collectBuildNotices([input,input,'\0virtual',join(root,'app.js')],{root});
  assert.equal(report.packages.length,1);
  const p=report.packages[0];assert.equal(p.version,'1.2.3');assert.equal(p.path,'node_modules/@scope/dep');
  assert.equal(p.modules['lib/index.js'],sha256(await readFile(input)));
  assert.equal(p.notices[0].text,(await readFile(join(pkg,'LICENSE'))).toString());
  assert.equal(p.references.length,1);assert.equal(report.complete,false);
  await rm(join(pkg,'LICENSE'));
  const missing=await collectBuildNotices([input],{root});assert.deepEqual(missing.missingNoticeLocations,['@scope/dep@1.2.3']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('external package symlinks cannot supply notice evidence',async()=>{
 const {root,input}=await fixture();const outside=await mkdtemp(join(tmpdir(),'orch-external-notices-'));
 try{await writeFile(join(outside,'index.js'),'outside fixture');await symlink(outside,join(root,'node_modules/outside'));
  await assert.rejects(collectBuildNotices([join(root,'node_modules/outside/index.js')],{root}),/escapes/);
  assert.equal((await collectBuildNotices([input],{root})).packages.length,1);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('component notices are hash checked and do not substitute for missing wrapper attribution',async()=>{
 const {root,pkg,input}=await fixture();
 try{
  const dir=join(root,'docs/desktop/third-party');await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'component.txt'),'fixture component notice');
  await writeFile(join(dir,'component-supplements.json'),JSON.stringify([{package:'@scope/dep',version:'1.2.3',component:'fixture',modulePrefix:'lib/',file:'component.txt',sha256:sha256('fixture component notice')} ]));
  await rm(join(pkg,'LICENSE'));
  const report=await collectBuildNotices([input],{root});assert.equal(report.packages[0].componentNotices.length,1);
  assert.deepEqual(report.missingNoticeLocations,['@scope/dep@1.2.3']);
  await writeFile(join(dir,'component.txt'),'tampered');await assert.rejects(collectBuildNotices([input],{root}),/hash mismatch/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('real esbuild output gets sidecars with exact output hashes without changing code',async()=>{
 const {root}=await fixture();
 try{const entry=join(root,'entry.js'),outdir=join(root,'dist');await writeFile(entry,'import {value} from "@scope/dep"; console.log(value);');
  const result=await build({entryPoints:[entry],outdir,bundle:true,metafile:true,platform:'node',absWorkingDir:root});
  const before=await readFile(join(outdir,'entry.js'));
  const report=await writeEsbuildNotices(result.metafile,{root,cwd:root,outdir});
  assert.equal(report.packages[0].name,'@scope/dep');assert.equal(report.outputs[0].sha256,sha256(before));
  assert((await readFile(join(outdir,'entry.js'))).equals(before));
  assert.equal(JSON.parse(await readFile(join(outdir,NOTICE_MANIFEST))).packages.length,1);
  assert.match(await readFile(join(outdir,NOTICE_TEXT),'utf8'),/Copyright Fixture/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Vite write hook accounts only rendered modules and hashes final disk bytes without changing chunks',async()=>{
 const {root,input}=await fixture();
 try{const plugin=createViteNoticePlugin({root}),outdir=join(root,'dist');await mkdir(outdir);
  const bundle={'entry.js':{type:'chunk',code:'console.log(123);',modules:{[input]:{renderedLength:4},[join(root,'node_modules/missing/index.js')]:{renderedLength:0}}}};
  const finalCode=bundle['entry.js'].code+'\n// later preload rewrite';await writeFile(join(outdir,'entry.js'),finalCode);
  const before=JSON.stringify(bundle);await plugin.writeBundle.handler({dir:outdir},bundle);
  assert.equal(JSON.stringify(bundle),before);assert.equal(plugin.apply,'build');
  assert.equal(plugin.writeBundle.order,'post');assert.equal(plugin.writeBundle.sequential,true);
  const report=JSON.parse(await readFile(join(outdir,NOTICE_MANIFEST)));
  assert.equal(report.outputs[0].sha256,sha256(finalCode));assert.notEqual(report.outputs[0].sha256,sha256(bundle['entry.js'].code));assert.equal(report.packages.length,1);
  assert.equal(await readFile(join(outdir,'entry.js'),'utf8'),finalCode);
  assert.match(await readFile(join(outdir,NOTICE_TEXT),'utf8'),/Copyright Fixture/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('real Vite final files include late preload/render and asynchronous disk changes; later tampering still differs',async()=>{
 const {root}=await fixture();
 try{
  const require=createRequire(new URL('../apps/beta-web/package.json',import.meta.url));
  const {build:viteBuild}=await import(pathToFileURL(require.resolve('vite')).href);
  await writeFile(join(root,'index.html'),'<script type="module" src="/entry.js"></script>');
  await writeFile(join(root,'entry.js'),'import {value} from "@scope/dep"; console.log(value); globalThis.loadLazy=()=>import("./lazy.js");');
  await writeFile(join(root,'lazy.js'),'import "./lazy.css"; export const lazy=456;');
  await writeFile(join(root,'lazy.css'),'.lazy { color: red; }');
  const outdir=join(root,'dist'),changed=[];
  await viteBuild({root,configFile:false,logLevel:'silent',plugins:[createViteNoticePlugin({root}),{
   name:'fixture-late-render-and-write',enforce:'post',
   generateBundle(_options,bundle){for(const item of Object.values(bundle))if(item.type==='chunk')item.code+='\n// late generateBundle change\n';},
   async writeBundle(options,bundle){
    await new Promise(resolve=>setTimeout(resolve,20));
    for(const [name,item]of Object.entries(bundle))if(item.type==='chunk'){
     await appendFile(join(options.dir,name),'\n// asynchronous final disk change\n');changed.push(name);
    }
   }
  }],build:{outDir:outdir,minify:false,emptyOutDir:false}});
  const report=JSON.parse(await readFile(join(outdir,NOTICE_MANIFEST)));
  assert(report.packages.some(p=>p.name==='@scope/dep'));assert(changed.length>=2);
  assert(report.outputs.some(o=>o.path.endsWith('.css')));assert(report.outputs.some(o=>o.path==='index.html'));
  for(const output of report.outputs){const bytes=await readFile(join(outdir,output.path));assert.equal(output.sha256,sha256(bytes));assert.equal(output.bytes,bytes.length);}
  for(const name of changed){const code=await readFile(join(outdir,name),'utf8');assert.match(code,/late generateBundle change/);assert.match(code,/asynchronous final disk change/);}
  const target=report.outputs.find(o=>o.path===changed[0]);await appendFile(join(outdir,target.path),'\n// tampered after snapshot');
  assert.notEqual(sha256(await readFile(join(outdir,target.path))),target.sha256,'a later modification must not be blessed by the earlier evidence');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Vite final-file evidence rejects traversal, external symlinks and conflicting notice assets',async()=>{
 const {root}=await fixture();const outside=await mkdtemp(join(tmpdir(),'orch-write-notices-external-'));
 try{
  const plugin=createViteNoticePlugin({root}),outdir=join(root,'dist');await mkdir(outdir);
  const asset={type:'asset',source:'fixture'};
  await assert.rejects(plugin.writeBundle.handler({dir:outdir},{'../outside.js':asset}),/escapes output directory/);
  await writeFile(join(outside,'external.js'),'external');await symlink(join(outside,'external.js'),join(outdir,'external.js'));
  await assert.rejects(plugin.writeBundle.handler({dir:outdir},{'external.js':asset}),/confined regular file/);
  await assert.rejects(plugin.writeBundle.handler({dir:outdir},{[NOTICE_MANIFEST]:asset}),/Conflicting frontend notice output/);
  await assert.rejects(plugin.writeBundle.handler({},{}),/written output directory/);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
