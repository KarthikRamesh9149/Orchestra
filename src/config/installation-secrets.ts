import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir,lstat,open,link,unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const installationSecretsSchema=z.object({
  version:z.literal(1),
  loopback:z.string().regex(/^[0-9a-f]{64}$/),
  access:z.string().regex(/^[0-9a-f]{64}$/),
  refresh:z.string().regex(/^[0-9a-f]{64}$/),
  connectorEncryption:z.string().regex(/^[0-9a-f]{64}$/),
  oauthState:z.string().regex(/^[0-9a-f]{64}$/),
  clientShare:z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type InstallationSecrets=z.infer<typeof installationSecretsSchema>;
/** Private bootstrap material, not an OS credential-vault replacement.
 * The caller supplies a dedicated credentials directory, outside project data.
 * Step 3 wraps this authority in the OS vault/runtime supervisor. */
export async function loadInstallationSecrets(directory:string){
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||(process.platform!=='win32'&&(info.mode&0o077)!==0))throw new Error('Installation secret directory is not private');
  const filename=join(directory,'installation.json');
  const temporary=join(directory,`.installation-${randomUUID()}.pending`);
  const writer=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{
    const secret=()=>randomBytes(32).toString('hex');
    await writer.writeFile(JSON.stringify({version:1,loopback:secret(),access:secret(),refresh:secret(),connectorEncryption:secret(),oauthState:secret(),clientShare:secret()}));
    await writer.sync();await writer.close();
    // Atomic publication without replacing another launch's generated identity.
    try{await link(temporary,filename);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  }finally{await writer.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>4096||(process.platform!=='win32'&&(stat.mode&0o077)!==0))throw new Error('Unsafe installation secret file');
    const result=installationSecretsSchema.parse(JSON.parse(await handle.readFile('utf8')));
    if(new Set(Object.values(result).filter(v=>typeof v==='string')).size!==6)throw new Error('Installation secrets must be distinct');
    return result;
  }finally{await handle.close();}
}
