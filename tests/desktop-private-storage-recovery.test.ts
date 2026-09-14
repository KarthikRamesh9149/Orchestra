import {afterEach,describe,expect,it,vi} from 'vitest';
import {appendFile,chmod,mkdtemp,rm,truncate} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PrivateLocalStorageDriver} from '../src/lib/storage/private-local.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
describe('private storage read bounds',()=>{
 it('closes a stream destroyed before its first read',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-storage-recovery-'));roots.push(root);
  const storage=new PrivateLocalStorageDriver(root,16);
  await storage.putObject({key:'evidence',body:Buffer.from('synthetic'),contentType:'text/plain'});
  // Observe the real opened descriptor, without substituting filesystem I/O.
  const observed=vi.spyOn(storage as any,'readHandle');
  const result=await storage.getObjectStream('evidence');
  const {handle}=await observed.mock.results[0]!.value;
  try{result.stream.destroy();await vi.waitFor(()=>expect(handle.fd).toBe(-1),{timeout:500});}
  finally{await handle.close();observed.mockRestore();}
 });
 it('does not return a non-private object through buffered or streamed reads',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-storage-recovery-'));roots.push(root);
  const storage=new PrivateLocalStorageDriver(root,16);
  await storage.putObject({key:'evidence',body:Buffer.from('synthetic'),contentType:'text/plain'});
  await chmod(join(root,'evidence'),0o644);
  await expect(storage.getObject('evidence')).rejects.toThrow(/private|Invalid/);
  await expect(storage.getObjectStream('evidence')).rejects.toThrow(/private|Invalid/);
 });
 it('returns exact bounded bytes and rejects oversized replacement without losing the old object',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-storage-recovery-'));roots.push(root);
  const storage=new PrivateLocalStorageDriver(root,16),body=Buffer.alloc(16,65);
  await storage.putObject({key:'evidence',body,contentType:'text/plain'});
  await expect(storage.putObject({key:'evidence',body:Buffer.alloc(17),contentType:'text/plain'})).rejects.toThrow('limit');
  expect(await storage.getObject('evidence')).toEqual(body);
 });
 it.each(['growth','truncation'])('rejects concurrent %s rather than returning a successful mismatched stream',async change=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-storage-recovery-'));roots.push(root);
  const storage=new PrivateLocalStorageDriver(root,16);
  await storage.putObject({key:'evidence',body:Buffer.alloc(16),contentType:'text/plain'});
  const result=await storage.getObjectStream('evidence');
  if(change==='growth')await appendFile(join(root,'evidence'),Buffer.alloc(4096));
  else await truncate(join(root,'evidence'),4);
  await expect((async()=>{for await(const _chunk of result.stream){/* consume */}})()).rejects.toThrow('changed during read');
 });
});
