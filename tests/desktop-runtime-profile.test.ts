import { describe,it,expect } from 'vitest';
import { mkdtemp,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseRuntimeProfile } from '../src/config/runtime-profile.js';
import { loadInstallationSecrets } from '../src/config/installation-secrets.js';

describe('runtime profile boundary',()=>{
 const local={profile:'desktop-local',databaseUrl:'postgresql://test:test@127.0.0.1:55439/test',host:'127.0.0.1',storageRoot:'/private/tmp/test',queue:'postgres'};
 it('requires an explicit profile rather than reusing a staging bypass',()=>{
  expect(parseRuntimeProfile(local).profile).toBe('desktop-local');
  expect(()=>parseRuntimeProfile({...local,profile:'staging'})).toThrow();
  for(const bad of [{databaseUrl:'postgresql://test:test@remote.example/test'},{host:'0.0.0.0'},{queue:'bullmq'},{redisUrl:'redis://localhost:6379'},{storageRoot:'relative'}])expect(()=>parseRuntimeProfile({...local,...bad})).toThrow();
 });
 it('preserves configured server queue requirements',()=>{
  for(const profile of ['self-hosted','managed']){
   expect(parseRuntimeProfile({...local,profile,queue:'bullmq',redisUrl:'redis://localhost:6379'}).profile).toBe(profile);
   expect(()=>parseRuntimeProfile({...local,profile})).toThrow();
  }
 });
 it('generates distinct installation secrets and retains them across restarts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'orchestra-secrets-'));
  try{
   const [a,b]=await Promise.all([loadInstallationSecrets(root),loadInstallationSecrets(root)]);
   expect(a).toEqual(b);expect(a.access).not.toEqual(a.refresh);
   if(process.platform!=='win32')expect((await stat(join(root,'installation.json'))).mode&0o077).toBe(0);
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
