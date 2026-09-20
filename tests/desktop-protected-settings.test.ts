import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,symlink,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {ProtectedSettingsStore,aiPreferencesSchema,type ProtectedSettings} from '../apps/desktop/src/protected-settings.js';

const key=randomBytes(32);
// Test double only. Production supplies Electron safeStorage, not this key.
const protection={isEncryptionAvailable:()=>true,encryptString(value:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(value),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},decryptString(value:Buffer){const cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString();}};
const value:ProtectedSettings={version:1,ai:{apiKey:'synthetic-test-only-not-a-real-api-key',preferences:{generationModel:'gpt-test',embeddingModel:'text-embedding-3-small',embeddingDimensions:1536,maxRequestsPerDay:20,maxOutputTokens:1024}}};
const directories:string[]=[];
async function setup(){const root=await mkdtemp(join(tmpdir(),'orchestra-settings-test-'));directories.push(root);return {root,store:new ProtectedSettingsStore(root,protection)};}
afterEach(async()=>{await Promise.all(directories.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
describe('OS-protected desktop settings',()=>{
 it('defaults offline, persists encrypted, reloads and revokes',async()=>{const {root,store}=await setup();expect(await store.read()).toEqual({version:1,ai:null});await store.write(value);expect((await readFile(join(root,'provider-settings.enc'))).includes(Buffer.from(value.ai!.apiKey))).toBe(false);expect(await new ProtectedSettingsStore(root,protection).read()).toEqual(value);await store.write({version:1,ai:null});expect((await store.read()).ai).toBeNull();});
 it('refuses plaintext fallback',async()=>{const {root}=await setup();const store=new ProtectedSettingsStore(root,{...protection,isEncryptionAvailable:()=>false});await expect(store.read()).rejects.toThrow('OS credential');await expect(store.write(value)).rejects.toThrow('OS credential');});
 it('rejects symlink envelopes without modifying the target',async()=>{const {root,store}=await setup();const target=join(root,'target');await writeFile(target,'unchanged');await symlink(target,join(root,'provider-settings.enc'));await expect(store.read()).rejects.toThrow();await expect(store.write(value)).rejects.toThrow();expect(await readFile(target,'utf8')).toBe('unchanged');});
 it('fails closed on corruption and oversized envelopes',async()=>{const {root,store}=await setup();await writeFile(join(root,'provider-settings.enc'),Buffer.alloc(32769),{mode:0o600});await expect(store.read()).rejects.toThrow('Unsafe');await writeFile(join(root,'provider-settings.enc'),'corrupt');await expect(store.read()).rejects.toThrow();});
 it('rejects permissive directories',async()=>{const {root,store}=await setup();await chmod(root,0o755);await expect(store.write(value)).rejects.toThrow('Private');});
 it('serializes concurrent saves and keeps the last requested state',async()=>{const {store}=await setup();await Promise.all([store.write(value),store.write({version:1,ai:null})]);expect((await store.read()).ai).toBeNull();});
 it('preserves legacy OpenAI settings and encrypts distinct compatible-provider keys across restart',async()=>{
  const {store,root}=await setup();await store.write(value);expect((await new ProtectedSettingsStore(root,protection).read()).ai).toEqual(value.ai);
  const updated:ProtectedSettings={...value,ai:{apiKey:'synthetic-generation-key',embeddingApiKey:'synthetic-embedding-key',preferences:{...value.ai!.preferences,provider:'openai-compatible',baseUrl:'https://api.example.com/v1',generationModel:'vendor/model',embeddingProvider:'openai-compatible',embeddingBaseUrl:'https://embeddings.example.com/v1',embeddingModel:'vendor/embedding'}}};
  await store.write(updated);expect(await new ProtectedSettingsStore(root,protection).read()).toEqual(updated);
  const envelope=await readFile(join(root,'provider-settings.enc'));expect(envelope.includes(Buffer.from(updated.ai!.apiKey))).toBe(false);expect(envelope.includes(Buffer.from(updated.ai!.embeddingApiKey!))).toBe(false);
  await store.write({...updated,ai:null});expect((await new ProtectedSettingsStore(root,protection).read()).ai).toBeNull();
 });
 it('rejects unbounded usage and unsupported embedding identity',()=>{for(const change of [{maxRequestsPerDay:0},{maxRequestsPerDay:1001},{maxOutputTokens:99999},{embeddingModel:'other'},{embeddingDimensions:3072}])expect(aiPreferencesSchema.safeParse({...value.ai!.preferences,...change}).success).toBe(false);});
});
