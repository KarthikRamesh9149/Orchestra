import {afterEach,describe,expect,it,vi} from 'vitest';
import {SharedReadCache} from '../apps/desktop/src/shared-cache.js';
const id='11111111-1111-4111-8111-111111111111';
const path=`/v1/projects/${id}/documents`;
const policy={enabled:true as const,readOnly:true as const,ttlSeconds:60,maxBytes:1024};
afterEach(()=>vi.useRealTimers());
describe('shared evidence cache',()=>{
 it('defaults to disabled and only admits document GET metadata',()=>{
  const cache=new SharedReadCache();cache.bind('session');
  cache.put(path,'hello');expect(cache.get(path)).toBeNull();cache.configure(policy);
  for(const excluded of ['/v1/auth/me',`/v1/projects/${id}/socrates/sessions`,`/v1/projects/${id}/documents/${id}/download`,`/v1/projects/${id}/product-brain`]){cache.put(excluded,'private');expect(cache.get(excluded)).toBeNull();}
  cache.put(path,'hello');expect(cache.get(path)?.body).toBe('hello');cache.close();
 });
 it('expires served evidence and explicitly invalidates its rendered view',()=>{
  vi.useFakeTimers();const invalidate=vi.fn(),cache=new SharedReadCache(invalidate,()=>Date.now());cache.configure(policy);cache.bind('session');cache.put(path,'hello');expect(cache.get(path)).not.toBeNull();
  vi.advanceTimersByTime(60000);expect(cache.get(path)).toBeNull();expect(invalidate).toHaveBeenCalledOnce();cache.close();
 });
 it('purges on identity changes, policy changes and detected revocation',()=>{
  const invalidate=vi.fn(),cache=new SharedReadCache(invalidate);cache.configure(policy);cache.bind('one');cache.put(path,'one');cache.get(path);
  cache.bind('two');expect(cache.get(path)).toBeNull();expect(invalidate).toHaveBeenCalledOnce();
  cache.put(path,'two');cache.configure({...policy,ttlSeconds:120});expect(cache.get(path)).toBeNull();
  cache.put(path,'two');cache.get(path);cache.clear();expect(cache.get(path)).toBeNull();expect(invalidate).toHaveBeenCalledTimes(2);cache.close();
 });
 it('does not extend visible evidence lifetime when it is replaced or evicted',()=>{
  vi.useFakeTimers();const invalidate=vi.fn(),cache=new SharedReadCache(invalidate,()=>Date.now());cache.configure(policy);cache.bind('session');cache.put(path,'old');cache.get(path);
  vi.advanceTimersByTime(30000);cache.put(path,'new');vi.advanceTimersByTime(30000);
  expect(invalidate).toHaveBeenCalledOnce();expect(cache.get(path)).toBeNull();cache.close();
 });
 it('bounds total UTF-8 bytes, evicts oldest, rejects oversized replacements and isolates instances',()=>{
  const cache=new SharedReadCache();cache.configure(policy);cache.bind('session');const next=path+'?page=2';
  cache.put(path,'a'.repeat(700));cache.put(next,'b'.repeat(700));expect(cache.get(path)).toBeNull();expect(cache.get(next)).not.toBeNull();
  cache.put(next,'😀'.repeat(300));expect(cache.get(next)).toBeNull();
  expect(new SharedReadCache().get(next)).toBeNull();cache.close();
 });
});
