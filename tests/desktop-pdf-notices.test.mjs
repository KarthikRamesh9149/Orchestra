import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const base=new URL('../docs/desktop/third-party/',import.meta.url);

test('PDF component packet retains pinned exact notices and explicit original-versus-staged provenance',async()=>{
 const packet=JSON.parse(await readFile(new URL('pdf-notices.json',base)));
 assert.equal(packet.formatVersion,1);assert.equal(packet.notices.length,10);
 assert.equal(new Set(packet.notices.map(n=>n.file)).size,10);
 for(const item of packet.notices) {
  assert.match(item.file,/^[a-z0-9.-]+$/);
  assert.equal(sha(await readFile(new URL(item.file,base))),item.sha256);
  assert.match(item.source,/^https:\/\//);assert(item.basis.length>50);
 }
 const spec=JSON.parse(await readFile(new URL('pdf-standard-fonts-transform.json',base)));
 assert.equal(spec.targets.length,28);assert.equal(spec.excluded.encodingPaths.length,2);
 assert.equal(spec.excluded.umdPaths.length,2);assert.equal(spec.excluded.pdfLibBundles.paths.length,4);
 assert.match(spec.metadata.value,/^[\x20-\x7e]+$/);
 const adobe=await readFile(new URL(spec.permission.unchangedNoticeFile,base));
 assert.equal(sha(adobe),spec.permission.sourceSha256);
 assert.match(adobe.toString(),/all modifications to this file or any of the AFM/);
 assert.match(spec.permission.boundary,/not a legal opinion/);
});
