import {packager} from '@electron/packager';
import {access,readFile,writeFile,cp,rm,lstat} from 'node:fs/promises';
import {normalizeRuntimeLinks} from './runtime-links.mjs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const FIRST_PARTY_LICENSE_NAME='ORCHESTRA-LICENSE.txt';
// Pin the owner-approved, complete Apache-2.0 text. A changed licence requires review.
const FIRST_PARTY_LICENSE_SHA256='cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
function assertFirstPartyLicense(bytes){
 if(createHash('sha256').update(bytes).digest('hex')!==FIRST_PARTY_LICENSE_SHA256)throw new Error('Unexpected first-party license: reviewed Apache-2.0 text required');
}
export async function readFirstPartyLicense(path){
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error('First-party license must be a regular file');
 const bytes=await readFile(path);assertFirstPartyLicense(bytes);return bytes;
}
export async function writeFirstPartyLicense(directory,bytes){
 assertFirstPartyLicense(bytes);
 const stat=await lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('First-party license destination must be a regular directory');
 // Never replace Electron's LICENSE, another notice, or a pre-existing link/file.
 await writeFile(join(directory,FIRST_PARTY_LICENSE_NAME),bytes,{flag:'wx',mode:0o644});
}
async function main(){
const root=resolve(import.meta.dirname,'../../..');
const firstPartyLicense=await readFirstPartyLicense(join(root,'LICENSE'));
const {version}=JSON.parse(await readFile(join(root,'apps/desktop/package.json'),'utf8'));
const manifest=JSON.parse(await readFile(join(root,'.desktop/runtime/native-manifest.json'),'utf8'));
if(manifest.platform!==`${process.platform}-${process.arch}`)throw new Error('A matching native runtime is required; cross-platform qualification cannot be skipped');
await access(join(root,'apps/desktop/dist/main.cjs'));
const runtime=join(root,'.desktop/runtime');
await normalizeRuntimeLinks(runtime);
const outputs=await packager({icon:join(root,'apps/desktop/assets/Orchestra.icns'),protocols:[{name:'Orchestra Desktop Slack authorization',schemes:['orchestra-desktop']}],dir:join(root,'apps/desktop'),name:'Orchestra Desktop Internal',appBundleId:'dev.orchestra.desktop.internal',appVersion:version,electronVersion:'44.3.0',platform:process.platform,arch:process.arch,out:join(root,'.desktop/packages',randomUUID()),overwrite:false,asar:true,prune:false,ignore:[/^\/node_modules($|\/)/,/^\/src($|\/)/,/^\/scripts($|\/)/,/^\/tsconfig\.json$/],extraResource:[runtime],afterCopyExtraResources:[async ({buildPath})=>{
 // Packager's default fs.cp expands relative links into absolute paths back to
 // the build machine. Replace only its fresh staging copy, preserving links.
 const destination=join(buildPath,'Orchestra Desktop Internal.app/Contents/Resources/runtime');
 await access(join(destination,'native-manifest.json'));
 await rm(destination,{recursive:true});
 await cp(runtime,destination,{recursive:true,verbatimSymlinks:true});
 await normalizeRuntimeLinks(destination);
 await writeFirstPartyLicense(join(buildPath,'Orchestra Desktop Internal.app/Contents/Resources'),firstPartyLicense);
}]});
for(const output of outputs)await writeFirstPartyLicense(output,firstPartyLicense);
console.log(outputs.join('\n'));
await writeFile(join(root,'.desktop/latest-package.txt'),outputs[0]+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
