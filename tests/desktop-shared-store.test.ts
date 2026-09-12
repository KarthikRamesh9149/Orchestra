import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,readFile,rm,chmod,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {SharedConnectionStore} from '../apps/desktop/src/shared-store.js';
const key=randomBytes(32);
const protection={isEncryptionAvailable:()=>true,encryptString(text:string){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(text),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]);},decryptString(data:Buffer){const cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString();}};
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const a={id,name:'Synthetic A',origin:'https://a.invalid',serverId:id},b={id:other,name:'Synthetic B',origin:'https://b.invalid',serverId:other};
const roots:string[]=[];
async function setup(){const root=await mkdtemp(join(tmpdir(),'orchestra-shared-store-'));roots.push(root);return {root,store:new SharedConnectionStore(root,protection)};}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
describe('separate protected shared registry',()=>{
 it('persists only encrypted grants, redacts listings and isolates connections across restart',async()=>{
  const {root,store}=await setup();await Promise.all([store.add(a),store.add(b)]);
  await store.grants(id).write({accessToken:'synthetic-access-a',refreshToken:'synthetic-refresh-a'});
  const again=new SharedConnectionStore(root,protection);expect(await again.list()).toEqual([a,b]);expect(await again.grants(other).read()).toBeNull();expect(await again.grants(id).read()).toMatchObject({accessToken:'synthetic-access-a'});
  expect((await readFile(join(root,'connections.enc'))).includes(Buffer.from('synthetic-access-a'))).toBe(false);
  await again.remove(id);await expect(again.grants(id).read()).rejects.toThrow('removed');expect(await again.list()).toEqual([b]);
 });
 it('serializes whole read-modify-write updates, not just file writes',async()=>{
  const {store}=await setup();await Promise.all([store.add(a),store.add(b)]);await Promise.all([store.grants(id).write({accessToken:'a',refreshToken:'r'}),store.grants(other).write({accessToken:'b',refreshToken:'s'})]);expect((await store.grants(id).read())?.accessToken).toBe('a');expect((await store.grants(other).read())?.accessToken).toBe('b');
 });
 it('rejects duplicate origins and unknown grant targets',async()=>{const {store}=await setup();await store.add(a);await expect(store.add({...a,id:other})).rejects.toThrow('already');await expect(store.grants(other).write({accessToken:'x',refreshToken:'y'})).rejects.toThrow('removed');});
 it('never falls back to plaintext or permissive storage',async()=>{const {root,store}=await setup();await expect(new SharedConnectionStore(root,{...protection,isEncryptionAvailable:()=>false}).list()).rejects.toThrow('OS credential');await chmod(root,0o755);await expect(store.add(a)).rejects.toThrow('Private');});
 it('rejects symlink envelopes and preserves the target',async()=>{const {root,store}=await setup();const target=join(root,'target');await writeFile(target,'unchanged',{mode:0o600});await symlink(target,join(root,'connections.enc'));await expect(store.add(a)).rejects.toThrow();expect(await readFile(target,'utf8')).toBe('unchanged');});
});
