import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('supplemental notices retain hashed content and pinned revision provenance',async()=>{
 const base=new URL('../docs/desktop/third-party/',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
 assert.equal(manifest.length,10);
 assert.equal(new Set(manifest.map(entry=>entry.package)).size,9);
 for(const entry of manifest){
  assert.match(entry.source,/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//);
  assert.match(entry.file,/^[a-z-]+\.txt$/);
  const bytes=await readFile(new URL(entry.file,base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  assert.match(bytes.toString(),/Copyright/);
  assert.match(bytes.toString(),/Permission is hereby granted|Apache License/);
 }
 const prepare=await readFile(new URL('../scripts/desktop/prepare-native.mjs',import.meta.url),'utf8');
 assert.match(prepare,/third-party-notices/);
});
