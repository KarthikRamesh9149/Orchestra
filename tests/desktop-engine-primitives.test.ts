import { describe, it, expect,vi } from "vitest";
import * as filesystem from 'node:fs/promises';
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,open:vi.fn(actual.open)};
});
import { mkdtemp, mkdir, symlink, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivateLocalStorageDriver } from "../src/lib/storage/private-local.js";
import { encryptBackup, decryptBackup } from "../src/lib/storage/encrypted-backup.js";

describe('private local storage',()=>{
 it('persists atomic writes across new driver instances and never exposes a filesystem URL',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-private-'));
  try{
   const driver=new PrivateLocalStorageDriver(root);
   await driver.putObject({key:'project/document',body:Buffer.from('evidence'),contentType:'text/plain'});
   expect((await new PrivateLocalStorageDriver(root).getObject('project/document')).toString()).toBe('evidence');
   await expect(driver.getSignedUrl('project/document')).rejects.toThrow('authenticated');
   expect(await readdir(join(root,'project'))).toEqual(['document']);
   await driver.deleteObject('project/document');await driver.deleteObject('project/document');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('rejects traversal, symlink parents, oversized content and non-private roots',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-path-'));
  const outside=await mkdtemp(join(tmpdir(),'orchestra-outside-'));
  try{
   const driver=new PrivateLocalStorageDriver(root,4);
   for(const key of ['../outside','/absolute','a/../b','a\\b','C:drive','a//b'])
    await expect(driver.putObject({key,body:Buffer.from('x'),contentType:'text/plain'})).rejects.toThrow();
   await symlink(outside,join(root,'escape'));
   await expect(driver.putObject({key:'escape/file',body:Buffer.from('x'),contentType:'text/plain'})).rejects.toThrow();
   await expect(driver.putObject({key:'large',body:Buffer.from('12345'),contentType:'text/plain'})).rejects.toThrow('limit');
   expect(await readdir(outside)).toEqual([]);
   await mkdir(join(root,'public'),{mode:0o755});
   if(process.platform!=='win32')await expect(new PrivateLocalStorageDriver(join(root,'public')).putObject({key:'file',body:Buffer.from('x'),contentType:'text/plain'})).rejects.toThrow('private');
  }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
 });
 it('does not replace the previous object when the next write is rejected',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-atomic-'));
  try{const driver=new PrivateLocalStorageDriver(root,4);await driver.putObject({key:'file',body:Buffer.from('old'),contentType:'text/plain'});
   await expect(driver.putObject({key:'file',body:Buffer.from('oversize'),contentType:'text/plain'})).rejects.toThrow();
   expect((await readFile(join(root,'file'))).toString()).toBe('old');
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it.each(['writeFile','sync'] as const)('preserves the previous bytes after %s fails and removes partial writes',async(operation)=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-disk-failure-'));
  try{
   const driver=new PrivateLocalStorageDriver(root);await driver.putObject({key:'file',body:Buffer.from('old'),contentType:'text/plain'});
   const original=(await vi.importActual<typeof filesystem>('node:fs/promises')).open;
   vi.spyOn(filesystem,'open').mockImplementationOnce(async(...args)=>{
    const handle=await original(...args);
    vi.spyOn(handle,operation).mockRejectedValueOnce(Object.assign(new Error('Synthetic disk failure'),{code:operation==='writeFile'?'ENOSPC':'EIO'}));
    return handle;
   });
   await expect(driver.putObject({key:'file',body:Buffer.from('replacement'),contentType:'text/plain'})).rejects.toThrow('Synthetic disk failure');
   expect((await readFile(join(root,'file'))).toString()).toBe('old');
   expect(await readdir(root)).toEqual(['file']);
  }finally{vi.restoreAllMocks();await rm(root,{recursive:true,force:true});}
 });
});

describe('backup envelope',()=>{
 it('round trips with a random salt/nonce and rejects wrong passphrase or tampering',()=>{
  const pass='synthetic-test-passphrase',data=Buffer.from('synthetic private archive');
  const a=encryptBackup(data,pass),b=encryptBackup(data,pass);
  expect(a.equals(b)).toBe(false);expect(decryptBackup(a,pass)).toEqual(data);
  expect(()=>decryptBackup(a,'incorrect-test-passphrase')).toThrow();
  for(const index of [0,10,25,40,52]){const changed=Buffer.from(a);changed[index]^=1;expect(()=>decryptBackup(changed,pass)).toThrow();}
  expect(()=>encryptBackup(data,'short')).toThrow();
 });
});
