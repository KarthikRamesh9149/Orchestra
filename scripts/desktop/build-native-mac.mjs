import {mkdir,readFile,writeFile,copyFile,access,mkdtemp,symlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This recipe builds only macOS ARM64');
const root=resolve(import.meta.dirname,'../..');
// Upstream makefiles do not support whitespace in install/build flags. This
// private temporary alias still writes only into this repository's .desktop.
const alias=await mkdtemp(join(tmpdir(),'orchestra-native-'));
await symlink(join(root,'.desktop'),join(alias,'work'));
const base=join(alias,'work/native-build');
const prefix=join(alias,'work/native/darwin-arm64/pgsql');
await mkdir(base,{recursive:true});await mkdir(prefix,{recursive:true});
const sources=[
 {name:'postgresql-17.11',url:'https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2',sha256:'dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979'},
 {name:'openssl-3.5.8',url:'https://github.com/openssl/openssl/releases/download/openssl-3.5.8/openssl-3.5.8.tar.gz',sha256:'a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2'},
 {name:'pgvector-0.8.6',url:'https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v0.8.6',sha256:'10bf9938906e5d643bbc4a7eea104b6f57ba4898e5b76b20e60484ea1d5a7f8f'}
];
async function run(command,args,cwd,env={}){await new Promise((ok,fail)=>{const child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(new Error(`${command} failed: ${code}`)));});}
for(const source of sources){
 const archive=join(base,source.name+'.archive');
 try{await access(archive);}catch{const response=await fetch(source.url);if(!response.ok)throw new Error(`Download failed: ${source.name}`);await writeFile(archive,Buffer.from(await response.arrayBuffer()));}
 const digest=createHash('sha256').update(await readFile(archive)).digest('hex');
 if(source.sha256&&digest!==source.sha256)throw new Error(`Checksum mismatch: ${source.name}`);
 if(!source.sha256)throw new Error(`Pin pgvector source SHA256 before building: ${digest}`);
 try{await access(join(base,source.name));}catch{await run('/usr/bin/tar',['-xf',archive,'-C',base],base);}
}
const ssl=join(base,'openssl-shared');
try{await access(join(ssl,'lib/libcrypto.3.dylib'));}catch{
 await run('/usr/bin/make',['clean'],join(base,'openssl-3.5.8'));
 await run('/usr/bin/perl',['Configure','darwin64-arm64-cc','shared','no-tests',`--prefix=${ssl}`,'--libdir=lib'],join(base,'openssl-3.5.8'));
 await run('/usr/bin/make',['-j4'],join(base,'openssl-3.5.8'));
 await run('/usr/bin/make',['install_sw'],join(base,'openssl-3.5.8'));
}
const pg=join(base,'postgresql-17.11');
await run('./configure',[`--prefix=${prefix}`,'--without-readline','--without-icu','--without-zlib','--with-ssl=openssl',`CPPFLAGS=-I${ssl}/include`,`LDFLAGS=-L${ssl}/lib`],pg);
await run('/usr/bin/make',['-j4'],pg);await run('/usr/bin/make',['install'],pg);
for(const ext of ['pgcrypto','pg_trgm']){await run('/usr/bin/make',['-j4'],join(pg,'contrib',ext));await run('/usr/bin/make',['install'],join(pg,'contrib',ext));}
const wrapper=join(base,'pg-config-alias.mjs');
await copyFile(join(root,'scripts/desktop/pg-config-alias.mjs'),wrapper);await chmod(wrapper,0o700);
const buildEnv={ORCHESTRA_BUILD_PG_CONFIG:join(prefix,'bin/pg_config'),ORCHESTRA_BUILD_REAL_PREFIX:join(root,'.desktop/native/darwin-arm64/pgsql'),ORCHESTRA_BUILD_ALIAS_PREFIX:prefix};
await run('/usr/bin/make',['-j4',`PG_CONFIG=${wrapper}`],join(base,'pgvector-0.8.6'),buildEnv);
await run('/usr/bin/make',['install',`PG_CONFIG=${wrapper}`],join(base,'pgvector-0.8.6'),buildEnv);
await copyFile(join(ssl,'lib/libssl.3.dylib'),join(prefix,'lib/libssl.3.dylib'));
await copyFile(join(ssl,'lib/libcrypto.3.dylib'),join(prefix,'lib/libcrypto.3.dylib'));
await copyFile(join(pg,'COPYRIGHT'),join(prefix,'POSTGRESQL-LICENSE'));
await copyFile(join(base,'pgvector-0.8.6/LICENSE'),join(prefix,'PGVECTOR-LICENSE'));
await copyFile(join(base,'openssl-3.5.8/LICENSE.txt'),join(prefix,'OPENSSL-LICENSE'));
await writeFile(join(prefix,'../build-provenance.json'),JSON.stringify({platform:'darwin-arm64',sources,postgres:'17.11',pgvector:'0.8.6',openssl:'3.5.8'},null,2));
console.log('Native build complete; relocation and packaging verification are still required.');
