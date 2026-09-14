import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inventoryNotices} from '../scripts/desktop/bundled-notices.mjs';
test('inventories actual notices without following outside symlinks or declaring compliance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'orchestra-notices-'));
 try {
  for(const name of ['@scope/a','b']){await mkdir(join(root,name),{recursive:true});await writeFile(join(root,name,'package.json'),JSON.stringify({name,version:'1',license:'MIT'}));}
  await writeFile(join(root,'@scope/a/LICENSE'),'Synthetic fixture license');
  await symlink('/Users',join(root,'outside'));
  const report=await inventoryNotices(root);
  assert.equal(report.packages.length,2);assert.equal(report.standaloneNoticeMissing[0].name,'b');
  assert.equal(report.complete,false);assert.match(report.packages[0].notices[0].sha256,/^[a-f0-9]{64}$/);
  await writeFile(join(root,'b/README.md'),'Copyright synthetic fixture. Permission is hereby granted. THE SOFTWARE IS PROVIDED without warranty.');
  const embedded=await inventoryNotices(root);
  assert.equal(embedded.standaloneNoticeMissing.length,1);
  assert.equal(embedded.unresolvedNoticeLocations.length,0);
  assert.equal(embedded.packages.find(p=>p.name==='b').embeddedNotices.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
