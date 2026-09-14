import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadVault,type CredentialProtection} from '../apps/desktop/src/vault.js';

const roots:string[]=[];
async function root(){const value=await mkdtemp(join(tmpdir(),'orchestra-vault-recovery-'));roots.push(value);return value;}
// Deliberately synthetic protection. Real app must use Electron safeStorage.
const protection:CredentialProtection={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
afterEach(async()=>{for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
describe('installation credential durability',()=>{
 it('concurrent first starts publish only one identity and all callers reload it',async()=>{
  const path=await root();
  const values=await Promise.all(Array.from({length:12},()=>loadVault(path,protection)));
  const stored=await loadVault(path,protection);
  for(const value of values)expect(value).toEqual(stored);
  expect(await readdir(path)).toEqual(['credentials.enc']);
  expect((await stat(join(path,'credentials.enc'))).mode&0o777).toBe(0o600);
 });
 it('rejects an oversized encrypted envelope before publishing an unusable identity',async()=>{
  const path=await root();
  await expect(loadVault(path,{...protection,encryptString:()=>Buffer.alloc(16385)})).rejects.toThrow(/envelope/i);
  expect(await readdir(path)).toEqual([]);
 });
 it('credential encryption denial leaves no partial identity and later retry succeeds',async()=>{
  const path=await root();
  await expect(loadVault(path,{...protection,encryptString:()=>{throw new Error('Keychain denied');}})).rejects.toThrow('Keychain denied');
  expect(await readdir(path)).toEqual([]);
  const value=await loadVault(path,protection);
  expect(JSON.parse((await readFile(join(path,'credentials.enc'))).toString())).toEqual(value);
 });
});
