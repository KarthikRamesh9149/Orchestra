import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url));
test('owner logo is preserved at its original aspect ratio and used in README',async()=>{
 const png=await read('apps/desktop/assets/orchestra-logo.png');
 assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),728);assert.equal(png.readUInt32BE(20),718);
 const readme=(await read('README.md')).toString();
 assert.match(readme,/<img src="docs\/desktop\/media\/orchestra-banner-canva\.png" alt="Orchestra — Product Brain for High Speed Teams" width="900" \/>/);
 const banner=await read('docs/desktop/media/orchestra-banner-canva.png');
 assert.equal(banner.toString('hex',0,8),'89504e470d0a1a0a');
 assert(banner.readUInt32BE(16)>banner.readUInt32BE(20),'banner is landscape');
});
test('Mac packager uses a valid multiresolution Orchestra icon',async()=>{
 const icns=await read('apps/desktop/assets/Orchestra.icns');
 assert.equal(icns.toString('ascii',0,4),'icns');assert.equal(icns.readUInt32BE(4),icns.length);
 const types=[];let offset=8;
 while(offset<icns.length){const size=icns.readUInt32BE(offset+4);assert(size>=8&&offset+size<=icns.length);types.push(icns.toString('ascii',offset,offset+4));offset+=size;}
 assert.equal(offset,icns.length);
 for(const type of ['ic07','ic08','ic09','ic10','ic11','ic12'])assert(types.includes(type),type);
 assert.match((await read('apps/desktop/scripts/package.mjs')).toString(),/icon:join\(root,'apps\/desktop\/assets\/Orchestra\.icns'\)/);
});
