import {safeStorage} from 'electron';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,lstat,open,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
const secret=z.string().regex(/^[a-f0-9]{64}$/);
export const vaultSchema=z.object({version:z.literal(1),admin:secret,runtime:secret,installation:z.object({version:z.literal(1),loopback:secret,access:secret,refresh:secret,connectorEncryption:secret,oauthState:secret,clientShare:secret}).strict()}).strict();
export type Vault=z.infer<typeof vaultSchema>;
export async function loadVault(root:string):Promise<Vault>{
 if(!safeStorage.isEncryptionAvailable())throw new Error('OS credential protection unavailable; plaintext fallback is forbidden');
 await mkdir(root,{recursive:true,mode:0o700});
 const directory=await lstat(root);
 if(directory.isSymbolicLink()||!directory.isDirectory()||(process.platform!=='win32'&&(directory.mode&0o077)!==0))throw new Error('Private application directory required');
 const path=join(root,'credentials.enc');
 try{
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>16384||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Unsafe credential envelope');
   return vaultSchema.parse(JSON.parse(safeStorage.decryptString(await file.readFile())));
  }finally{await file.close();}
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const fresh=()=>randomBytes(32).toString('hex');
 const value:Vault={version:1,admin:fresh(),runtime:fresh(),installation:{version:1,loopback:fresh(),access:fresh(),refresh:fresh(),connectorEncryption:fresh(),oauthState:fresh(),clientShare:fresh()}};
 const tmp=join(root,`.vault-${randomUUID()}`);
 const file=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await file.writeFile(safeStorage.encryptString(JSON.stringify(value)));await file.sync();await file.close();await rename(tmp,path);}
 finally{await file.close().catch(()=>{});await unlink(tmp).catch(()=>{});}
 return value;
}
