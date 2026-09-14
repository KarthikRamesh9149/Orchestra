import {packager} from '@electron/packager';
import {access,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {normalizeRuntimeLinks} from './runtime-links.mjs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
const root=resolve(import.meta.dirname,'../../..');
const {version}=JSON.parse(await readFile(join(root,'apps/desktop/package.json'),'utf8'));
const manifest=JSON.parse(await readFile(join(root,'.desktop/runtime/native-manifest.json'),'utf8'));
if(manifest.platform!==`${process.platform}-${process.arch}`)throw new Error('A matching native runtime is required; cross-platform qualification cannot be skipped');
await access(join(root,'apps/desktop/dist/main.cjs'));
const runtime=join(root,'.desktop/runtime');
await normalizeRuntimeLinks(runtime);
const outputs=await packager({protocols:[{name:'Orchestra Desktop Slack authorization',schemes:['orchestra-desktop']}],dir:join(root,'apps/desktop'),name:'Orchestra Desktop Internal',appBundleId:'dev.orchestra.desktop.internal',appVersion:version,electronVersion:'44.3.0',platform:process.platform,arch:process.arch,out:join(root,'.desktop/packages',randomUUID()),overwrite:false,asar:true,prune:false,ignore:[/^\/node_modules($|\/)/,/^\/src($|\/)/,/^\/scripts($|\/)/,/^\/tsconfig\.json$/],extraResource:[runtime],afterCopyExtraResources:[async ({buildPath})=>{
 // Packager's default fs.cp expands relative links into absolute paths back to
 // the build machine. Replace only its fresh staging copy, preserving links.
 const destination=join(buildPath,'Orchestra Desktop Internal.app/Contents/Resources/runtime');
 await access(join(destination,'native-manifest.json'));
 await rm(destination,{recursive:true});
 await cp(runtime,destination,{recursive:true,verbatimSymlinks:true});
 await normalizeRuntimeLinks(destination);
}]});
console.log(outputs.join('\n'));
await writeFile(join(root,'.desktop/latest-package.txt'),outputs[0]+'\n');
