import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('recovered notices retain provenance and do not clear unresolved packages', async()=>{
 const base=new URL('../docs/desktop/third-party/',import.meta.url);
 const report=JSON.parse(await readFile(new URL('recovered-notices.json',base),'utf8'));
 assert.equal(report.complete,false);
 assert.equal(report.notices.length,2);
 assert.equal(report.unresolved.length,7);
 for(const entry of report.notices){
  assert.match(entry.file,/^[a-z.-]+$/);
  const bytes=await readFile(new URL(entry.file,base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  assert.match(bytes.toString(),/Copyright/);
  assert.match(bytes.toString(),/Permission is hereby granted/);
  assert.match(bytes.toString(),/THE SOFTWARE IS PROVIDED/);
  assert(entry.basis.length>80);
 }
 assert.match(report.notices[0].source,/c0afc395948730bed124859d7fc7cccabe0aac8a\/LICENSE$/);
 assert.equal(report.notices[1].source,'https://jsumners.mit-license.org/');
 assert.match(report.notices[1].basis,/dynamic 2026/);
});
