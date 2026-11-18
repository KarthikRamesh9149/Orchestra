import {mkdir,readFile,writeFile,copyFile,mkdtemp,symlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {createNativeBuildWorkspace,publishNativeBuild,withNativeBuildLock} from './native-build-inputs.mjs';
import {assertNativePostgresDistribution} from './native-distribution.mjs';
import {nativeSources,nativeVersions} from './native-pins.mjs';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This recipe builds only macOS ARM64');
const root=resolve(import.meta.dirname,'../..');
const [postgresSource,opensslSource,vectorSource]=nativeSources;
async function run(command,args,cwd,env={}){await new Promise((ok,fail)=>{const child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(new Error(`${command} failed: ${code}`)));});}
await withNativeBuildLock(join(root,'.desktop'),async()=>{
const recipeFiles=['build-native-mac.mjs','native-build-inputs.mjs','native-distribution.mjs','native-pins.mjs','pg-config-alias.mjs'];
const recipe=await Promise.all(recipeFiles.map(async path=>({path:'scripts/desktop/'+path,sha256:createHash('sha256').update(await readFile(join(root,'scripts/desktop',path))).digest('hex')})));
const workspace=await createNativeBuildWorkspace(join(root,'.desktop'),{sources:nativeSources,run});
// Upstream makefiles do not support whitespace in install/build flags. This
// private temporary alias targets only this run's fresh, verified build tree.
const alias=await mkdtemp(join(tmpdir(),'orchestra-native-'));
await symlink(workspace.directory,join(alias,'work'));
const base=join(alias,'work'),prefix=join(base,'output/pgsql');
await mkdir(prefix);
const ssl=join(base,'openssl-shared');
const sslSource=join(base,opensslSource.name);
await run('/usr/bin/perl',['Configure','darwin64-arm64-cc','shared','no-tests',`--prefix=${ssl}`,'--libdir=lib'],sslSource);
await run('/usr/bin/make',['-j4'],sslSource);
await run('/usr/bin/make',['install_sw'],sslSource);
const pg=join(base,postgresSource.name);
await run('./configure',[`--prefix=${prefix}`,'--without-readline','--without-icu','--without-zlib','--with-ssl=openssl',`CPPFLAGS=-I${ssl}/include`,`LDFLAGS=-L${ssl}/lib`],pg);
await run('/usr/bin/make',['-j4'],pg);await run('/usr/bin/make',['install'],pg);
for(const ext of ['pgcrypto','pg_trgm']){await run('/usr/bin/make',['-j4'],join(pg,'contrib',ext));await run('/usr/bin/make',['install'],join(pg,'contrib',ext));}
const wrapper=join(base,'pg-config-alias.mjs');
await copyFile(join(root,'scripts/desktop/pg-config-alias.mjs'),wrapper);await chmod(wrapper,0o700);
const buildEnv={ORCHESTRA_BUILD_PG_CONFIG:join(prefix,'bin/pg_config'),ORCHESTRA_BUILD_REAL_PREFIX:join(workspace.directory,'output/pgsql'),ORCHESTRA_BUILD_ALIAS_PREFIX:prefix};
await run('/usr/bin/make',['-j4',`PG_CONFIG=${wrapper}`],join(base,vectorSource.name),buildEnv);
await run('/usr/bin/make',['install',`PG_CONFIG=${wrapper}`],join(base,vectorSource.name),buildEnv);
await copyFile(join(ssl,'lib/libssl.3.dylib'),join(prefix,'lib/libssl.3.dylib'));
await copyFile(join(ssl,'lib/libcrypto.3.dylib'),join(prefix,'lib/libcrypto.3.dylib'));
await copyFile(join(pg,'COPYRIGHT'),join(prefix,'POSTGRESQL-LICENSE'));
await copyFile(join(base,vectorSource.name,'LICENSE'),join(prefix,'PGVECTOR-LICENSE'));
await copyFile(join(sslSource,'LICENSE.txt'),join(prefix,'OPENSSL-LICENSE'));
await assertNativePostgresDistribution(prefix);
const {postgres,pgvector,openssl}=nativeVersions;
await writeFile(join(prefix,'../build-provenance.json'),JSON.stringify({platform:'darwin-arm64',sources:workspace.sources,postgres,pgvector,openssl,inputPolicy:'fresh-extraction-no-built-cache',recipe,stage:'native-install-before-relocation',buildDirectory:workspace.directory,builtAt:new Date().toISOString()},null,2));
const published=await publishNativeBuild(join(root,'.desktop'),workspace.directory);
if(published.previous)console.log(`Previous native candidate preserved at ${published.previous}`);
console.log('Native build complete; relocation and packaging verification are still required.');
});
