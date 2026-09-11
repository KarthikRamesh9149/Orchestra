import {constants} from 'node:fs';
import {mkdir,lstat,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {CredentialProtection} from './vault.js';
import {slackCredentialSchema} from './slack-oauth.js';

const model=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/);
export const aiPreferencesSchema=z.object({
 generationModel:model,
 // The installed database uses vector(1536). Never silently mix models.
 embeddingModel:z.literal('text-embedding-3-small'),
 embeddingDimensions:z.literal(1536),
 maxRequestsPerDay:z.number().int().min(1).max(1000),
 maxOutputTokens:z.number().int().min(128).max(8192)
}).strict();
export const mcpPairingSchema=z.object({id:z.string().uuid(),projectId:z.string().uuid(),packId:z.string().uuid(),tokenId:z.string().uuid(),token:z.string().regex(/^mcp_[A-Za-z0-9_-]{43}$/),client:z.enum(['codex','claude','cursor','vscode']),expiresAt:z.string().datetime()}).strict();
export const protectedSettingsSchema=z.object({version:z.literal(1),slackRevokedTeamId:z.string().regex(/^T[A-Z0-9]+$/).optional(),slack:slackCredentialSchema.nullable().optional(),mcp:z.array(mcpPairingSchema).max(8).optional(),ai:z.object({
 preferences:aiPreferencesSchema,
 apiKey:z.string().min(20).max(512).regex(/^[\x21-\x7e]+$/)
}).strict().nullable()}).strict();
export type ProtectedSettings=z.infer<typeof protectedSettingsSchema>;
export type AiPreferences=z.infer<typeof aiPreferencesSchema>;
const maxEnvelope=32768;

/** Only Electron main owns this object. Never return it through renderer IPC. */
export class ProtectedSettingsStore {
 private pending:Promise<unknown>=Promise.resolve();
 constructor(private readonly root:string,private readonly protection:CredentialProtection){}
 private async checkDirectory(){
  if(!this.protection.isEncryptionAvailable())throw new Error('OS credential protection unavailable');
  await mkdir(this.root,{recursive:true,mode:0o700});
  const stat=await lstat(this.root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Private settings directory required');
 }
 async read():Promise<ProtectedSettings>{
  await this.checkDirectory();
  let file;
  try{file=await open(join(this.root,'provider-settings.enc'),constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,ai:null};throw error;}
  try{
   const stat=await file.stat();
   if(!stat.isFile()||stat.size>maxEnvelope||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Unsafe settings envelope');
   // A bounded read, including under concurrent file growth.
   const bytes=Buffer.alloc(maxEnvelope+1);const result=await file.read(bytes,0,bytes.length,0);
   if(result.bytesRead>maxEnvelope)throw new Error('Settings envelope too large');
   return protectedSettingsSchema.parse(JSON.parse(this.protection.decryptString(bytes.subarray(0,result.bytesRead))));
  }finally{await file.close();}
 }
 write(input:ProtectedSettings):Promise<void>{
  const value=protectedSettingsSchema.parse(input);
  const operation=this.pending.catch(()=>{}).then(async()=>{
   await this.checkDirectory();
   const encrypted=this.protection.encryptString(JSON.stringify(value));
   if(encrypted.length>maxEnvelope)throw new Error('Settings envelope too large');
   const destination=join(this.root,'provider-settings.enc');
   try{const stat=await lstat(destination);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Unsafe settings destination');}
   catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   const temporary=join(this.root,`.provider-${randomUUID()}`);
   const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await file.writeFile(encrypted);await file.sync();await file.close();await rename(temporary,destination);
    const directory=await open(this.root,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
   }finally{await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  });
  this.pending=operation;return operation;
 }
}
