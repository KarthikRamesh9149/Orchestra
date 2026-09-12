import {lstat,opendir,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import ignore,{type Ignore} from 'ignore';
import {join,relative,resolve,extname} from 'node:path';
const extensions=new Set(['.txt','.md','.pdf','.docx','.csv','.xlsx']);
export const sourceCodeExtensions=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.go','.rs','.java','.kt','.swift','.c','.h','.cpp','.hpp','.cs','.rb','.php','.sql','.html','.css','.scss','.sh','.yaml','.yml','.toml']);
const excluded=new Set(['node_modules','vendor','dist','build','coverage','target','__pycache__','secrets','credentials']);
/** User-selected document roots only. Never follow symlinks or hidden paths.
 * Bounds apply to visited entries as well as accepted documents. */
export async function scanSourceFolder(selected:string,repository=false){
 const root=resolve(selected),stat=await lstat(root);
 if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(root)!==root)throw new Error('Choose a real directory, not a symbolic link');
 if(repository){let git;try{git=await lstat(join(root,'.git'));}catch{throw new Error('Choose a Git working tree');}if(git.isSymbolicLink()||(!git.isDirectory()&&!git.isFile()))throw new Error('Choose a real Git working tree');}
 const files:Array<{path:string;name:string;size:number}>=[];let visited=0,totalBytes=0,skipped=0,ignoreBytes=0;
 async function visit(directory:string,depth:number,parents:Array<{root:string;matcher:Ignore}>=[]){
  if(depth>8)throw new Error('Folder nesting exceeds eight levels');
  if(await realpath(directory)!==directory)throw new Error('Selected directory changed');
  const matchers=[...parents];
  if(repository){
   let file;try{file=await open(join(directory,'.gitignore'),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(file)try{const stat=await file.stat();if(!stat.isFile()||stat.size>65536)throw new Error('Git ignore rules exceed limit');const bytes=Buffer.alloc(65537),result=await file.read(bytes,0,bytes.length,0);ignoreBytes+=result.bytesRead;if(result.bytesRead>65536||ignoreBytes>262144)throw new Error('Git ignore rules exceed limit');matchers.push({root:directory,matcher:ignore().add(bytes.subarray(0,result.bytesRead).toString('utf8'))});}finally{await file.close();}
  }
  const entries=await opendir(directory);
  for await(const entry of entries){
   if(++visited>2000)throw new Error('Folder exceeds 2,000 entries; choose a smaller folder');
   if(entry.name.startsWith('.')||excluded.has(entry.name)||entry.isSymbolicLink()){skipped++;continue;}
   const path=join(directory,entry.name),info=await lstat(path);
   if(repository&&matchers.some(rule=>rule.matcher.ignores(relative(rule.root,path)+(info.isDirectory()?'/':'')))){skipped++;continue;}
   if(info.isSymbolicLink()){skipped++;continue;}
   if(info.isDirectory()){await visit(path,depth+1,matchers);continue;}
   const extension=extname(entry.name).toLowerCase();
   if(!info.isFile()||(!extensions.has(extension)&&!(repository&&sourceCodeExtensions.has(extension)))){skipped++;continue;}
   if(await realpath(path)!==path)throw new Error('Selected source changed');
   if(files.length>=100||info.size>50*1024*1024||(totalBytes+=info.size)>50*1024*1024)throw new Error('Choose at most 100 documents totalling 50 MiB');
   files.push({path,name:relative(root,path),size:info.size});
  }
 }
 await visit(root,0);return {root,files:files.sort((a,b)=>a.name.localeCompare(b.name)),skipped,totalBytes};
}
