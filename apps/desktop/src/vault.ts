import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,lstat,open,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
const secret=z.string().regex(/^[a-f0-9]{64}$/);
export const vaultSchema=z.object({version:z.literal(1),admin:secret,runtime:secret,installation:z.object({version:z.literal(1),loopback:secret,access:secret,refresh:secret,connectorEncryption:secret,oauthState:secret,clientShare:secret}).strict()}).strict();
export type Vault=z.infer<typeof vaultSchema>;
export interface CredentialProtection {isEncryptionAvailable():boolean;encryptString(value:string):Buffer;decryptString(value:Buffer):string}
export async function loadVault(root:string,safeStorage:CredentialProtection):Promise<Vault>{
 if(!safeStorage.isEncryptionAvailable())throw new Error('OS credential protection unavailable; plaintext fallback is forbidden');
 await mkdir(root,{recursive:true,mode:0o700});
 const directory=await lstat(root);
 if(directory.isSymbolicLink()||!directory.isDirectory()||(process.platform!=='win32'&&(directory.mode&0o077)!==0))throw new Error('Private application directory required');
 const path=join(root,'credentials.enc');
 try{
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();if(!stat.isFile()||stat.size>16384||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Unsafe credential envelope');
   const bytes=Buffer.alloc(16385),{bytesRead}=await file.read(bytes,0,bytes.length,0);
   if(bytesRead>16384)throw new Error('Unsafe credential envelope');
   return vaultSchema.parse(JSON.parse(safeStorage.decryptString(bytes.subarray(0,bytesRead))));
  }finally{await file.close();}
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const fresh=()=>randomBytes(32).toString('hex');
 const value:Vault={version:1,admin:fresh(),runtime:fresh(),installation:{version:1,loopback:fresh(),access:fresh(),refresh:fresh(),connectorEncryption:fresh(),oauthState:fresh(),clientShare:fresh()}};
 const encrypted=safeStorage.encryptString(JSON.stringify(value));
 if(encrypted.length>16384)throw new Error('Unsafe credential envelope');
 const tmp=join(root,`.vault-${randomUUID()}`);
 const file=await open(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{
  await file.writeFile(encrypted);await file.sync();await file.close();
  // Publish without replacement. Even overlapping processes must converge on
  // the same identity, never overwrite a just-created credential envelope.
  try{await link(tmp,path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;return await loadVault(root,safeStorage);}
  const directory=await open(root,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
 }
 finally{await file.close().catch(()=>{});await unlink(tmp).catch(()=>{});}
 return value;
}
