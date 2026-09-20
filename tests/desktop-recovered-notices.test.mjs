import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('recovered notices retain provenance and do not clear unresolved packages', async()=>{
 const base=new URL('../docs/desktop/third-party/',import.meta.url);
 const report=JSON.parse(await readFile(new URL('recovered-notices.json',base),'utf8'));
 assert.equal(report.complete,false);
 assert.equal(report.notices.length,4);
 assert.deepEqual(report.unresolved,['@swc/helpers@0.3.17','brotli@1.3.3','dfa@1.2.0','fontkit@1.9.0','stackback@0.0.2']);
 for(const entry of report.notices){
  assert.match(entry.file,/^[a-z0-9.-]+$/);
  const bytes=await readFile(new URL(entry.file,base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  assert.match(bytes.toString(),/Copyright/);
  if(entry.license==='BSD-2-Clause'){
   assert.match(bytes.toString(),/Redistribution and use in source and binary forms/);
   assert.match(bytes.toString(),/THIS SOFTWARE IS PROVIDED/);
  }else{
   assert.match(bytes.toString(),/Permission is hereby granted/);
   assert.match(bytes.toString(),/THE SOFTWARE IS PROVIDED/);
  }
  assert(entry.basis.length>80);
 }
 assert.match(report.notices[0].source,/c0afc395948730bed124859d7fc7cccabe0aac8a\/LICENSE$/);
 assert.equal(report.notices[1].source,'https://jsumners.mit-license.org/');
 assert.match(report.notices[1].basis,/dynamic 2026/);
 const dingbat=report.notices.find(n=>n.package==='dingbat-to-unicode');
 assert.match(dingbat.clarification,/#issuecomment-5740760399$/);
 assert.equal(dingbat.clarificationAuthor,'mwilliamson');
 assert.match(dingbat.basis,/any previous versions/);
 const tr46=report.notices.find(n=>n.package==='tr46');
 assert.match(tr46.source,/3a6f29721e7063b9ffd421e461a54beae6170001\/LICENSE.md$/);
 for(const [file,expected] of Object.entries(tr46.matchedSourceHashes)){
  const bytes=await readFile(new URL('../node_modules/tr46/'+file,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected);
 }
});
test('Unicode mapping attribution pins the generated data and preserves original and current notices',async()=>{
 const base=new URL('../docs/desktop/third-party/',import.meta.url);
 const entry=JSON.parse(await readFile(new URL('unicode-tr46.json',base),'utf8'));
 const notice=await readFile(new URL(entry.notice,base));
 const data=await readFile(new URL('../node_modules/tr46/lib/mappingTable.json',import.meta.url));
 assert.equal(createHash('sha256').update(data).digest('hex'),entry.componentSha256);
 assert.equal(createHash('sha256').update(notice).digest('hex'),entry.noticeSha256);
 assert.match(notice.toString(),/Copyright \(c\) 1991-2015 Unicode/);
 const license=notice.toString().slice(notice.toString().indexOf('UNICODE LICENSE V3'));
 assert.equal(createHash('sha256').update(license).digest('hex'),entry.licenseSha256);
 assert.match(entry.source,/\/8.0.0\/IdnaMappingTable.txt$/);
});
