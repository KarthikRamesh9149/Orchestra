// Exercise the real packaged bundle, not a miniature ZIP fixture. No execution
// or replacement of either application occurs here.
import {mkdtemp,lstat,readdir,readlink,readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {extractVerifiedUpdate} from '../../apps/desktop/src/update-extract.js';
const app=resolve(process.argv[2]??'');
assert(app.startsWith(resolve('.desktop/packages')+'/')&&app.endsWith('/Orchestra Desktop Internal.app'),'Use this worktree internal package');
assert((await lstat(app)).isDirectory());
const root=await mkdtemp('/private/tmp/orchestra-step7-real-extraction-');
const archive=join(root,'candidate.zip');
async function digest(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
async function inventory(path:string,prefix=''):Promise<Record<string,string>>{
 const result:Record<string,string>={};
 for(const entry of await readdir(path,{withFileTypes:true})){
  const file=join(path,entry.name),key=prefix+entry.name,stat=await lstat(file);
  if(stat.isSymbolicLink())result[key]='link:'+await readlink(file);
  else if(stat.isDirectory()){result[key]='directory';Object.assign(result,await inventory(file,key+'/'));}
  else{assert(stat.isFile());result[key]=`${Boolean(stat.mode&0o111)}:${stat.size}:${await digest(file)}`;}
 }
 return result;
}
const proof:{app:string;passed:string[];failure?:string;entries?:number}={app,passed:[]};
try{
 // No AppleDouble sidecars: this format carries bundle bytes and symlinks,
 // not filesystem-specific resource forks or extended-attribute metadata.
 execFileSync('/usr/bin/ditto',['-c','-k','--norsrc','--keepParent',app,archive],{stdio:'pipe',timeout:120000});
 const bytes=(await lstat(archive)).size,sha256=await digest(archive);
 const extracted=await extractVerifiedUpdate({artifactPath:archive,bytes,sha256,root:join(root,'stages')});
 const actual=await inventory(extracted.appPath),expected=await inventory(app);
 const differences=[...new Set([...Object.keys(actual),...Object.keys(expected)])].filter(key=>actual[key]!==expected[key]);
 assert.equal(differences.length,0,'Bundle differs: '+differences.slice(0,10).join(', '));
 assert.equal(extracted.installed,false);
 proof.entries=extracted.entries;
 proof.passed.push('Every actual bundle file hash, executable flag, directory and symlink matches after verified extraction');
 // This check establishes format compatibility only; a release signature must
 // supply the expected hash in the real controller. No self-hash trust claim.
 assert((await readFile(join(extracted.appPath,'Contents','Info.plist'))).length>0);
 proof.passed.push('Original application was not replaced or executed; no release trust or install claim');
 if(process.argv.includes('--launch')){
  const output=execFileSync(process.execPath,['scripts/desktop/ui-smoke.mjs',extracted.stage],{encoding:'utf8',timeout:240000,maxBuffer:1024*1024});
  await writeFile(join(root,'packaged-smoke.log'),output,{mode:0o600});
  proof.passed.push('Relocated extracted app passes fresh packaged onboarding, upload, cited offline answer, download and restart smoke');
 }
}catch(error){proof.failure=String(error);process.exitCode=1;}
await writeFile(join(root,'report.json'),JSON.stringify(proof,null,2),{mode:0o600});
console.log(JSON.stringify({root,...proof}));
