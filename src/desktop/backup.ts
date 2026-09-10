import { lstat,readdir,mkdir } from 'node:fs/promises';
import { join,isAbsolute } from 'node:path';
import { z } from 'zod';
import { encryptBackup,decryptBackup } from '../lib/storage/encrypted-backup.js';
import { PrivateLocalStorageDriver } from '../lib/storage/private-local.js';
import { acquireDatabaseOwnership } from './database-ownership.js';

const maxBytes=128*1024*1024;
const key=z.string().min(1).max(1024).refine(k=>!k.includes('\\')&&!k.includes(':')&&!k.includes('\0')&&k.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p.length<=200));
const archiveSchema=z.object({version:z.literal(1),database:z.string(),files:z.array(z.object({key,body:z.string()})).max(10000)}).strict();
function decode(value:string){if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error('Invalid archive encoding');return Buffer.from(value,'base64');}

/** dump/restore adapters are privileged runtime-owned functions, never renderer
 * arguments. This bounded format contains data/files only, not credential dirs. */
export async function createLocalBackup(input:{databaseUrl:string;filesRoot:string;passphrase:string;dump:()=>Promise<Buffer>}){
 if(!isAbsolute(input.filesRoot))throw new Error('Absolute private files root required');
 const release=await acquireDatabaseOwnership(input.databaseUrl);
 try{
  const database=await input.dump();let total=database.length;
  if(total>maxBytes)throw new Error('Backup exceeds supported 128 MiB; nothing was written');
  const files:Array<{key:string;body:string}>=[];
  const walk=async(path:string,prefix:string)=>{
   const info=await lstat(path);
   if(info.isSymbolicLink()||!info.isDirectory()||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw new Error('Unsafe backup storage directory');
   for(const name of await readdir(path)){
    const relative=prefix?`${prefix}/${name}`:name;key.parse(relative);
    const child=join(path,name),stat=await lstat(child);
    if(stat.isSymbolicLink())throw new Error('Symlinks are not backup evidence');
    if(stat.isDirectory()){await walk(child,relative);continue;}
    if(!stat.isFile()||files.length>=10000||(total+=stat.size)>maxBytes)throw new Error('Backup exceeds supported bounds');
    const body=await new PrivateLocalStorageDriver(input.filesRoot,maxBytes).getObject(relative);
    if(body.length!==stat.size)throw new Error('Storage changed during backup');
    files.push({key:relative,body:body.toString('base64')});
   }
  };
  await walk(input.filesRoot,'');
  return encryptBackup(Buffer.from(JSON.stringify({version:1,database:database.toString('base64'),files})),input.passphrase);
 }finally{await release();}
}

export async function restoreLocalBackup(input:{databaseUrl:string;filesRoot:string;passphrase:string;archive:Buffer;assertEmptyDatabase:()=>Promise<void>;restore:(dump:Buffer)=>Promise<void>}){
 // Authenticate and validate every entry before any database/file mutation.
 const archive=archiveSchema.parse(JSON.parse(decryptBackup(input.archive,input.passphrase).toString('utf8')));
 if(new Set(archive.files.map(f=>f.key)).size!==archive.files.length)throw new Error('Duplicate archive paths');
 const database=decode(archive.database),files=archive.files.map(f=>({key:f.key,body:decode(f.body)}));
 if(database.length+files.reduce((n,f)=>n+f.body.length,0)>maxBytes)throw new Error('Backup exceeds supported bounds');
 if(!isAbsolute(input.filesRoot))throw new Error('Absolute restore directory required');
 const release=await acquireDatabaseOwnership(input.databaseUrl);
 try{
  await input.assertEmptyDatabase();
  await mkdir(input.filesRoot,{recursive:true,mode:0o700});
  const info=await lstat(input.filesRoot);
  if(info.isSymbolicLink()||!info.isDirectory()||(process.platform!=='win32'&&(info.mode&0o077)!==0)||(await readdir(input.filesRoot)).length)throw new Error('Restore requires an empty private directory');
  const storage=new PrivateLocalStorageDriver(input.filesRoot,maxBytes);
  // Restore failures leave an explicitly incomplete new target, never replace
  // a working installation. Caller must not launch it on failure.
  for(const file of files)await storage.putObject({...file,contentType:'application/octet-stream'});
  await input.restore(database);
 }finally{await release();}
}
