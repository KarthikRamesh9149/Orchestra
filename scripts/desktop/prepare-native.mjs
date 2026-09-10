import {mkdir,readFile,writeFile,cp,readdir,lstat,mkdtemp,rename} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,relative,dirname,basename} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('Native preparation requires a qualified target recipe; Windows remains blocked');
const native=join(root,'.desktop/native/darwin-arm64');
const archive=join(native,'node.tar.gz');
let bytes;try{bytes=await readFile(archive);}catch(error){if(error.code!=='ENOENT')throw error;const response=await fetch('https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz');if(!response.ok)throw new Error('Node download failed');bytes=Buffer.from(await response.arrayBuffer());}
if(createHash('sha256').update(bytes).digest('hex')!=='8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d')throw new Error('Node checksum mismatch');
await writeFile(archive,bytes);await mkdir(join(native,'node'),{recursive:true});
execFileSync('/usr/bin/tar',['-xf',archive,'--strip-components=1','-C',join(native,'node')]);
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
const runtime=await mkdtemp(join(root,'.desktop/runtime-build-'));
await cp(join(native,'pgsql'),join(runtime,'native/pgsql'),{recursive:true,verbatimSymlinks:true});
await mkdir(join(runtime,'native/node/bin'),{recursive:true});
await cp(join(native,'node/bin/node'),join(runtime,'native/node/bin/node'));
await cp(join(native,'node/LICENSE'),join(runtime,'native/node/LICENSE'));
await cp(join(root,'dist/src'),join(runtime,'backend/dist/src'),{recursive:true});
await cp(join(root,'node_modules'),join(runtime,'backend/node_modules'),{recursive:true,verbatimSymlinks:true});
await cp(join(root,'prisma'),join(runtime,'backend/prisma'),{recursive:true});
await writeFile(join(runtime,'backend/package.json'),JSON.stringify({private:true,type:'module'}));
await cp(join(root,'apps/beta-web/dist'),join(runtime,'ui'),{recursive:true});
const inventory=[];for(const file of await files(join(runtime,'native')))inventory.push({path:relative(runtime,file),sha256:createHash('sha256').update(await readFile(file)).digest('hex')});
await writeFile(join(runtime,'native-manifest.json'),JSON.stringify({platform:'darwin-arm64',node:'24.19.0',postgres:'17.11',pgvector:'0.8.6',internal:true,files:inventory},null,2));
try{await rename(join(root,'.desktop/runtime'),join(root,'.desktop/runtime-previous-'+randomUUID()));}catch(error){if(error.code!=='ENOENT')throw error;}
await rename(runtime,join(root,'.desktop/runtime'));
console.log('Private Mac runtime assembled; no Windows or clean-machine certification implied');
