import {mkdir,readFile,writeFile,cp,readdir,lstat,mkdtemp,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,relative,dirname,basename} from 'node:path';
import {normalizeRuntimeLinks} from '../../apps/desktop/scripts/runtime-links.mjs';
import {assertNativePostgresDistribution} from './native-distribution.mjs';
import {stageRuntimeDependencies} from './runtime-dependencies.mjs';
import {normalizeFontAttribution} from './font-attribution.mjs';
import {assertNativeBuildPins,nativeVersions,nodeArchiveSha256} from './native-pins.mjs';
const root=resolve(import.meta.dirname,'../..');
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Native preparation requires a qualified target recipe; Windows remains blocked');
const native=join(root,'.desktop/native/darwin-arm64');
assertNativeBuildPins(JSON.parse(await readFile(join(native,'build-provenance.json'),'utf8')));
await assertNativePostgresDistribution(join(native,'pgsql'));
const stage=await mkdtemp(join(native,'node-stage-'));
const archive=join(stage,'node.tar.gz');
const response=await fetch(`https://nodejs.org/dist/v${nativeVersions.node}/node-v${nativeVersions.node}-darwin-arm64.tar.gz`);
if(!response.ok)throw new Error('Node download failed');
const bytes=Buffer.from(await response.arrayBuffer());
if(createHash('sha256').update(bytes).digest('hex')!==nodeArchiveSha256)throw new Error('Node checksum mismatch');
await writeFile(archive,bytes,{flag:'wx'});
execFileSync('/usr/bin/tar',['-xf',archive,'--strip-components=1','-C',stage]);
if(execFileSync(join(stage,'bin/node'),['--version'],{encoding:'utf8'}).trim()!==`v${nativeVersions.node}`)throw new Error('Unexpected standalone Node executable version');
async function files(directory){const result=[];for(const name of await readdir(directory)){const file=join(directory,name),stat=await lstat(file);if(stat.isDirectory())result.push(...await files(file));else if(stat.isFile())result.push(file);}return result;}
const pg=join(native,'pgsql');
for(const file of [...await files(join(pg,'bin')),...await files(join(pg,'lib'))]){
 let dependencies;try{dependencies=execFileSync('/usr/bin/otool',['-L',file],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{continue;}
 if(!dependencies.includes('compatibility version'))continue;
 for(const line of dependencies.split('\n').slice(1)){
  const match=line.trim().match(/^(.+?) \(compatibility version/);if(!match)continue;
  const dependency=match[1];if(dependency.startsWith('/usr/lib/')||dependency.startsWith('/System/Library/')||dependency.startsWith('@loader_path/'))continue;
  const target=join(pg,'lib',basename(dependency));await lstat(target);
  const replacement='@loader_path/'+relative(dirname(file),target);
  execFileSync('/usr/bin/install_name_tool',['-change',dependency,replacement,file]);
 }
 if(file.endsWith('.dylib'))execFileSync('/usr/bin/install_name_tool',['-id','@loader_path/'+basename(file),file]);
 execFileSync('/usr/bin/codesign',['--force','--sign','-',file],{stdio:'ignore'});
}
if(execFileSync(join(pg,'bin/postgres'),['--version'],{encoding:'utf8'}).trim()!==`postgres (PostgreSQL) ${nativeVersions.postgres}`)throw new Error('Unexpected PostgreSQL executable version');
const runtime=await mkdtemp(join(root,'.desktop/runtime-build-'));
await cp(join(native,'pgsql'),join(runtime,'native/pgsql'),{recursive:true,verbatimSymlinks:true});
await assertNativePostgresDistribution(join(runtime,'native/pgsql'));
await mkdir(join(runtime,'native/node/bin'),{recursive:true});
await cp(join(stage,'bin/node'),join(runtime,'native/node/bin/node'));
await cp(join(stage,'LICENSE'),join(runtime,'native/node/LICENSE'));
await cp(join(root,'dist/src'),join(runtime,'backend/dist/src'),{recursive:true});
const runtimeDependencies=await stageRuntimeDependencies({sourceRoot:root,destination:join(runtime,'backend/node_modules')});
await writeFile(join(runtime,'runtime-dependencies.json'),JSON.stringify(runtimeDependencies,null,2)+'\n');
const fontAttribution=await normalizeFontAttribution({sourceModules:join(root,'node_modules'),stagedModules:join(runtime,'backend/node_modules'),specificationPath:join(root,'docs/desktop/third-party/pdf-standard-fonts-transform.json')});
await writeFile(join(runtime,'font-attribution-transform.json'),JSON.stringify(fontAttribution,null,2)+'\n');
await cp(join(root,'prisma'),join(runtime,'backend/prisma'),{recursive:true});
await writeFile(join(runtime,'backend/package.json'),JSON.stringify({private:true,type:'module'}));
await cp(join(root,'apps/beta-web/dist'),join(runtime,'ui'),{recursive:true});
// Preserve pinned supplemental upstream notices alongside the internal runtime.
await cp(join(root,'docs/desktop/third-party'),join(runtime,'third-party-notices'),{recursive:true});
await normalizeRuntimeLinks(runtime);
const inventory=[];for(const file of await files(join(runtime,'native')))inventory.push({path:relative(runtime,file),sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
await writeFile(join(runtime,'native-manifest.json'),JSON.stringify({platform:'darwin-arm64',...nativeVersions,internal:true,files:inventory},null,2));
try{await rename(join(root,'.desktop/runtime'),join(root,'.desktop/runtime-previous-'+randomUUID()));}catch(error){if(error.code!=='ENOENT')throw error;}
await rename(runtime,join(root,'.desktop/runtime'));
console.log('Private Mac runtime assembled; no Windows or clean-machine certification implied');
