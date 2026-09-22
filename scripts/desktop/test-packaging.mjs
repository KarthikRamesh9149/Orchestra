import {lstat,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join,relative,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Discover in JavaScript, not shell globs: npm uses different shells on Windows
// and POSIX. Include future nested Node tests, without mixing in Vitest's TS tests.
export async function collectPackagingTests(directory){
  if(!(await lstat(directory)).isDirectory())throw Error(`Test root must be a real directory, not a symlink: ${directory}`);
  const files=[];
  async function visit(path){
    for(const entry of await readdir(path,{withFileTypes:true})){
      const file=join(path,entry.name);
      if(entry.isSymbolicLink())throw Error(`Refusing symlink in packaging tests: ${file}`);
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()&&entry.name.endsWith('.test.mjs'))files.push(file);
    }
  }
  await visit(directory);
  if(!files.length)throw Error(`No Node .test.mjs tests found in ${directory}`);
  return files.sort();
}

export async function runPackagingTests({root=resolve(import.meta.dirname,'../..'),stdio='inherit'}={}){
  const files=await collectPackagingTests(join(root,'tests'));
  return new Promise((resolveResult,reject)=>{
    const child=spawn(process.execPath,['--test',...files],{cwd:root,stdio});
    if(stdio==='pipe'){child.stdout.resume();child.stderr.resume();}
    child.once('error',reject);
    child.once('exit',code=>resolveResult(code??1));
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const root=resolve(import.meta.dirname,'../..');
  if(process.argv.length===3&&process.argv[2]==='--list'){
    console.log(JSON.stringify((await collectPackagingTests(join(root,'tests'))).map(file=>relative(root,file).split('\\').join('/')),null,2));
  }else if(process.argv.length===2){
    process.exitCode=await runPackagingTests({root});
  }else{throw Error('Usage: node scripts/desktop/test-packaging.mjs [--list]');}
}
