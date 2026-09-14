import {lstat,readdir,readlink,realpath,unlink,symlink,access} from 'node:fs/promises';
import {resolve,join,dirname,relative,sep,isAbsolute} from 'node:path';

// Only operates on the private runtime build, never its source dependencies.
export async function normalizeRuntimeLinks(root){
 root=await realpath(root);
 const prisma=join(root,'backend/node_modules/@prisma/client/.prisma');
 try{
  if((await lstat(prisma)).isSymbolicLink()){
   await access(join(root,'backend/node_modules/.prisma/client/default.js'));
   await unlink(prisma);await symlink('../../.prisma',prisma);
  }
 }catch(error){if(error.code!=='ENOENT')throw error;}
 async function walk(dir){
  for(const item of await readdir(dir,{withFileTypes:true})){
   const path=join(dir,item.name);
   if(item.isSymbolicLink()){
    const target=await readlink(path),absolute=resolve(dirname(path),target);
    if(!absolute.startsWith(root+sep))throw new Error('Runtime symlink escapes bundle: '+relative(root,path));
    const canonical=await realpath(path);
    if(!canonical.startsWith(root+sep))throw new Error('Runtime symlink chain escapes bundle: '+relative(root,path));
    if(isAbsolute(target)){await unlink(path);await symlink(relative(dirname(path),absolute),path);}
   }else if(item.isDirectory())await walk(path);
  }
 }
 await walk(root);
}
