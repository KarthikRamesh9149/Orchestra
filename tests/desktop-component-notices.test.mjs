import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('embedded component notices remain exact and do not clear package blockers', async () => {
  const root = new URL('../', import.meta.url);
  const bundle = await readFile(new URL('docs/desktop/third-party/component-notices.txt', root), 'utf8');
  const sources = [
    ['stackback', '0.0.2', 'formatstack.js', '\n\nfunction'],
    ['brotli', '1.3.3', 'dec/decode.js', '\n\nvar'],
  ];
  for (const [name, version, file, boundary] of sources) {
    let metadata;
    try {metadata = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), 'utf8'));}
    catch(error) {
      if(error.code!=='ENOENT')throw error;
      const lock=JSON.parse(await readFile(new URL('package-lock.json',root),'utf8'));
      assert(!Object.keys(lock.packages).some(path=>path===`node_modules/${name}`||path.endsWith(`/node_modules/${name}`)),`${name} must be absent from the final dependency graph`);
      assert(bundle.includes(name),'Historical component notice must remain retained');
      continue;
    }
    assert.equal(metadata.version, version, 'Review notices when the dependency changes');
    const source = await readFile(new URL(`node_modules/${name}/${file}`, root), 'utf8');
    const end = source.indexOf(boundary);
    assert(end > 0);
    assert(bundle.includes(source.slice(0, end)), `${name} source notice changed`);
  }
  const report = JSON.parse(await readFile(new URL('docs/desktop/third-party/recovered-notices.json', root), 'utf8'));
  assert.equal(report.complete, false);
  assert(report.unresolved.includes('brotli@1.3.3'));
  assert(report.unresolved.includes('stackback@0.0.2'));
});

test('recovered vendor and icon-family notices retain exact pinned text and scoped provenance',async()=>{
 const base=new URL('../docs/desktop/third-party/',import.meta.url);
 const entries=JSON.parse(await readFile(new URL('component-supplements.json',base),'utf8'));
 assert.equal(entries.length,4);
 for(const entry of entries){
  assert.match(entry.file,/^[a-z0-9.-]+$/);
  const bytes=await readFile(new URL(entry.file,base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  assert.match(entry.source,/\/([a-f0-9]{40})\/LICENSE(\.md)?$/);
  assert(entry.basis.length>100);
  if(entry.package==='react-icons')assert(['tb/','bi/','si/'].includes(entry.modulePrefix));
 }
 const report=JSON.parse(await readFile(new URL('recovered-notices.json',base),'utf8'));
 assert(report.unresolved.includes('brotli@1.3.3'),'Vendor notice is not the wrapper license');
});
