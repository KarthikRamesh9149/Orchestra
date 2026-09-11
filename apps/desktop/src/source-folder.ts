import {lstat,opendir,realpath} from 'node:fs/promises';
import {join,relative,resolve,extname} from 'node:path';
const extensions=new Set(['.txt','.md','.pdf','.docx','.csv','.xlsx']);
const excluded=new Set(['node_modules','vendor','dist','build','coverage','target','__pycache__']);
/** User-selected document roots only. Never follow symlinks or hidden paths.
 * Bounds apply to visited entries as well as accepted documents. */
export async function scanSourceFolder(selected:string){
 const root=resolve(selected),stat=await lstat(root);
 if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(root)!==root)throw new Error('Choose a real directory, not a symbolic link');
 const files:Array<{path:string;name:string;size:number}>=[];let visited=0,totalBytes=0,skipped=0;
 async function visit(directory:string,depth:number){
  if(depth>8)throw new Error('Folder nesting exceeds eight levels');
  if(await realpath(directory)!==directory)throw new Error('Selected directory changed');
  const entries=await opendir(directory);
  for await(const entry of entries){
   if(++visited>2000)throw new Error('Folder exceeds 2,000 entries; choose a smaller folder');
   if(entry.name.startsWith('.')||excluded.has(entry.name)||entry.isSymbolicLink()){skipped++;continue;}
   const path=join(directory,entry.name),info=await lstat(path);
   if(info.isSymbolicLink()){skipped++;continue;}
   if(info.isDirectory()){await visit(path,depth+1);continue;}
   if(!info.isFile()||!extensions.has(extname(entry.name).toLowerCase())){skipped++;continue;}
   if(await realpath(path)!==path)throw new Error('Selected source changed');
   if(files.length>=100||info.size>50*1024*1024||(totalBytes+=info.size)>50*1024*1024)throw new Error('Choose at most 100 documents totalling 50 MiB');
   files.push({path,name:relative(root,path),size:info.size});
  }
 }
 await visit(root,0);return {root,files:files.sort((a,b)=>a.name.localeCompare(b.name)),skipped,totalBytes};
}
