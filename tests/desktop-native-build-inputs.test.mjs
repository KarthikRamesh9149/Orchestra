import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,lstat,readdir,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createNativeBuildWorkspace,publishNativeBuild,withNativeBuildLock} from '../scripts/desktop/native-build-inputs.mjs';

const bytes=Buffer.from('synthetic pinned archive');
const source={name:'source-1.0',url:'https://invalid.example/source.tar.gz',sha256:createHash('sha256').update(bytes).digest('hex')};
async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'orchestra-native-inputs-'));
  try{
    const desktop=join(root,'.desktop');await mkdir(join(desktop,'native-build'),{recursive:true});
    await writeFile(join(desktop,'native-build',source.name+'.archive'),bytes);
    await run({root,desktop});
  }finally{await rm(root,{recursive:true,force:true});}
}
async function extractFixture(command,args,cwd){
  assert.equal(command,'/usr/bin/tar');
  assert.deepEqual(await readFile(args[1]),bytes);
  await mkdir(join(cwd,source.name));await writeFile(join(cwd,source.name,'source.c'),'verified source');
}
const options={sources:[source],run:extractFixture,fetchSource:async()=>{throw Error('Unexpected network access');}};

test('verified archives feed fresh source, OpenSSL and output paths on every run',async()=>fixture(async({desktop})=>{
  await mkdir(join(desktop,'native-build',source.name));
  await writeFile(join(desktop,'native-build',source.name,'source.c'),'tampered old source');
  await mkdir(join(desktop,'native-build','openssl-shared','lib'),{recursive:true});
  await writeFile(join(desktop,'native-build','openssl-shared','lib','libcrypto.3.dylib'),'stale output');
  const first=await createNativeBuildWorkspace(desktop,options);
  await writeFile(join(first.directory,source.name,'source.c'),'tampered previous run');
  const second=await createNativeBuildWorkspace(desktop,options);
  assert.notEqual(first.directory,second.directory);
  assert.equal(await readFile(join(second.directory,source.name,'source.c'),'utf8'),'verified source');
  assert.deepEqual(await readdir(join(second.directory,'output')),[]);
  await assert.rejects(lstat(join(second.directory,'openssl-shared')),error=>error.code==='ENOENT');
  assert.deepEqual(second.sources,[source]);
}));

test('old symlinked extracted trees are never reused or followed',async()=>fixture(async({root,desktop})=>{
  const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'sentinel'),'preserve');
  await symlink(outside,join(desktop,'native-build',source.name));
  await symlink(outside,join(desktop,'native-build','openssl-shared'));
  const workspace=await createNativeBuildWorkspace(desktop,options);
  assert.equal(await readFile(join(workspace.directory,source.name,'source.c'),'utf8'),'verified source');
  assert.equal(await readFile(join(outside,'sentinel'),'utf8'),'preserve');
}));

test('tampered bytes, linked archives and linked cache parents fail before extraction',async()=>fixture(async({root,desktop})=>{
  const archive=join(desktop,'native-build',source.name+'.archive');
  const noExtraction={...options,run:async()=>assert.fail('Must not extract invalid cache')};
  await writeFile(archive,'tampered');
  await assert.rejects(createNativeBuildWorkspace(desktop,noExtraction),/Checksum mismatch/);
  await rm(archive);await writeFile(join(root,'external.archive'),bytes);await symlink(join(root,'external.archive'),archive);
  await assert.rejects(createNativeBuildWorkspace(desktop,noExtraction),/symlink|ELOOP/i);
  await rm(join(desktop,'native-build'),{recursive:true});await mkdir(join(root,'external-cache'));await symlink(join(root,'external-cache'),join(desktop,'native-build'));
  await assert.rejects(createNativeBuildWorkspace(desktop,noExtraction),/symlink/i);
}));

test('tar uses a private verified snapshot even if the original archive is replaced afterwards',async()=>fixture(async({desktop})=>{
  const archive=join(desktop,'native-build',source.name+'.archive');
  const workspace=await createNativeBuildWorkspace(desktop,{...options,run:async(command,args,cwd)=>{
    assert.notEqual(args[1],archive);
    await writeFile(archive,'replaced after verification');
    await extractFixture(command,args,cwd);
  }});
  assert.equal(await readFile(join(workspace.directory,source.name,'source.c'),'utf8'),'verified source');
}));

test('bad downloads and extraction failures cannot produce an installed candidate',async()=>fixture(async({desktop})=>{
  await rm(join(desktop,'native-build',source.name+'.archive'));
  await assert.rejects(createNativeBuildWorkspace(desktop,{...options,fetchSource:async()=>Buffer.from('bad')}),/Checksum mismatch/);
  await assert.rejects(lstat(join(desktop,'native-build',source.name+'.archive')),error=>error.code==='ENOENT');
  await assert.rejects(createNativeBuildWorkspace(desktop,{...options,fetchSource:async()=>bytes,run:async()=>{throw Error('tar failed');}}),/tar failed/);
  await assert.rejects(lstat(join(desktop,'native','darwin-arm64')),error=>error.code==='ENOENT');
}));

test('linked desktop roots, non-file archives and unpinned inputs fail closed',async()=>fixture(async({root,desktop})=>{
  await symlink(desktop,join(root,'linked-desktop'));
  await assert.rejects(createNativeBuildWorkspace(join(root,'linked-desktop'),options),/symlink/i);
  await rm(join(desktop,'native-build',source.name+'.archive'));
  await mkdir(join(desktop,'native-build',source.name+'.archive'));
  await assert.rejects(createNativeBuildWorkspace(desktop,options),/regular file/);
  for(const invalid of [{...source,sha256:''},{...source,name:'../escape'}])await assert.rejects(createNativeBuildWorkspace(desktop,{...options,sources:[invalid]}),/Invalid source/);
}));

test('the native build lock excludes concurrent builds and releases after failure',async()=>fixture(async({desktop})=>{
  await assert.rejects(withNativeBuildLock(desktop,async()=>{
    await assert.rejects(withNativeBuildLock(desktop,async()=>assert.fail('Concurrent build started')),/lock exists/);
    throw Error('build failed');
  }),/build failed/);
  assert.equal(await withNativeBuildLock(desktop,async()=>42),42);
}));

test('a FIFO cache file is rejected without blocking the native build', {skip:process.platform==='win32'},async()=>fixture(async({desktop})=>{
  const archive=join(desktop,'native-build',source.name+'.archive');await rm(archive);
  const fifo=spawnSync('mkfifo',[archive],{encoding:'utf8'});assert.equal(fifo.status,0,fifo.stderr);
  const helper=new URL('../scripts/desktop/native-build-inputs.mjs',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import {createNativeBuildWorkspace} from ${JSON.stringify(helper)};await createNativeBuildWorkspace(${JSON.stringify(desktop)},{sources:[${JSON.stringify(source)}],run:async()=>{}});`],{encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined,'A non-regular cache entry must not block open()');
  assert.equal(result.status,1);assert.match(result.stderr,/regular file/);
}));

test('a failed extraction preserves the previous install and provenance unchanged',async()=>fixture(async({desktop})=>{
  const installed=join(desktop,'native','darwin-arm64');
  await mkdir(join(installed,'pgsql'),{recursive:true});await writeFile(join(installed,'pgsql','old'),'old');
  await writeFile(join(installed,'build-provenance.json'),'old provenance');
  await assert.rejects(createNativeBuildWorkspace(desktop,{...options,run:async()=>{throw Error('tar failed');}}),/tar failed/);
  assert.equal(await readFile(join(installed,'pgsql','old'),'utf8'),'old');
  assert.equal(await readFile(join(installed,'build-provenance.json'),'utf8'),'old provenance');
}));

test('publishing replaces complete output with matching provenance and retains prior candidate',async()=>fixture(async({desktop})=>{
  const installed=join(desktop,'native','darwin-arm64');
  await mkdir(join(installed,'pgsql'),{recursive:true});await writeFile(join(installed,'pgsql','stale'),'old');
  await writeFile(join(installed,'build-provenance.json'),'old provenance');
  const workspace=await createNativeBuildWorkspace(desktop,options);
  await mkdir(join(workspace.directory,'output','pgsql'));await writeFile(join(workspace.directory,'output','pgsql','new'),'new');
  await writeFile(join(workspace.directory,'output','build-provenance.json'),'new provenance');
  const result=await publishNativeBuild(desktop,workspace.directory);
  assert.equal(await readFile(join(installed,'pgsql','new'),'utf8'),'new');
  assert.equal(await readFile(join(installed,'build-provenance.json'),'utf8'),'new provenance');
  await assert.rejects(lstat(join(installed,'pgsql','stale')),error=>error.code==='ENOENT');
  assert.equal(await readFile(join(result.previous,'pgsql','stale'),'utf8'),'old');
}));

test('a publication rename failure restores the old candidate and its matching provenance',async()=>fixture(async({desktop})=>{
  const installed=join(desktop,'native','darwin-arm64');
  await mkdir(join(installed,'pgsql'),{recursive:true});await writeFile(join(installed,'pgsql','old'),'old');
  await writeFile(join(installed,'build-provenance.json'),'old provenance');
  const workspace=await createNativeBuildWorkspace(desktop,options),output=join(workspace.directory,'output');
  await mkdir(join(output,'pgsql'));await writeFile(join(output,'build-provenance.json'),'new provenance');
  await assert.rejects(publishNativeBuild(desktop,workspace.directory,{renamePath:async(from,to)=>{
    if(from===output)throw Error('synthetic publication failure');
    await rename(from,to);
  }}),/synthetic publication failure/);
  assert.equal(await readFile(join(installed,'pgsql','old'),'utf8'),'old');
  assert.equal(await readFile(join(installed,'build-provenance.json'),'utf8'),'old provenance');
  assert.equal(await readFile(join(output,'build-provenance.json'),'utf8'),'new provenance');
}));

test('linked install destinations are refused without changing the target',async()=>fixture(async({root,desktop})=>{
  const workspace=await createNativeBuildWorkspace(desktop,options);
  await mkdir(join(root,'external-install'));await mkdir(join(desktop,'native'));await symlink(join(root,'external-install'),join(desktop,'native','darwin-arm64'));
  await assert.rejects(publishNativeBuild(desktop,workspace.directory),/symlink/i);
  assert.deepEqual(await readdir(join(root,'external-install')),[]);
}));

test('Mac recipe builds OpenSSL unconditionally from fresh inputs and publishes only after success',async()=>{
  const recipe=await readFile(resolve(import.meta.dirname,'../scripts/desktop/build-native-mac.mjs'),'utf8');
  assert.match(recipe,/createNativeBuildWorkspace/);
  assert.doesNotMatch(recipe,/await access\(/);
  assert(recipe.indexOf('publishNativeBuild(')>recipe.indexOf("'OPENSSL-LICENSE'"));
  assert.match(recipe,/fresh-extraction-no-built-cache/);
});
