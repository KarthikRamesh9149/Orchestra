import {readFile,mkdtemp,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';

if(process.platform!=='darwin')throw new Error('Mac icon generation requires sips and iconutil');
const root=resolve(import.meta.dirname,'../../..');
const source=join(root,'apps/desktop/assets/orchestra-logo.png');
const bytes=await readFile(source);
if(bytes.toString('hex',0,8)!=='89504e470d0a1a0a')throw new Error('Expected PNG logo');
const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),side=Math.max(width,height);
if(side>4096||Math.min(width,height)<512)throw new Error('Unexpected logo dimensions');
const scratch=await mkdtemp(join(tmpdir(),'orchestra-app-icon-'));
const square=join(scratch,'square.png'),iconset=join(scratch,'Orchestra.iconset');
await mkdir(iconset);
const sips=(args)=>execFileSync('/usr/bin/sips',args,{stdio:'ignore'});
// Add canvas only: preserve the original aspect ratio and mark, no cropping.
sips(['--padColor','000000','-p',String(side),String(side),source,'--out',square]);
for(const size of [16,32,128,256,512])for(const scale of [1,2]){
 const name=`icon_${size}x${size}${scale===2?'@2x':''}.png`;
 sips(['-z',String(size*scale),String(size*scale),square,'--out',join(iconset,name)]);
}
execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',join(root,'apps/desktop/assets/Orchestra.icns')]);
console.log('Generated Mac icon from the owner-supplied logo; no redesign.');
