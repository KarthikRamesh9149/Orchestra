import {describe,it,expect,vi} from 'vitest';
import {sharedNetwork} from '../apps/desktop/src/shared-network.js';

describe('system-trusted shared networking',()=>{
 it('preserves auth/body/cancellation while forbidding cookies, redirects and caching',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('ok'));
  const signal=new AbortController().signal;
  await sharedNetwork({fetch})('https://localhost:4446/v1/auth/login',{
   method:'POST',headers:{authorization:'Bearer synthetic'},body:'{}',signal,
   credentials:'include',redirect:'follow',cache:'force-cache'
  });
  expect(fetch).toHaveBeenCalledWith('https://localhost:4446/v1/auth/login',{
   method:'POST',headers:{authorization:'Bearer synthetic'},body:'{}',signal,
   credentials:'omit',redirect:'error',cache:'no-store'
  });
 });
 it.each(['http://localhost:4446/','file:///etc/passwd','https://user:password@example.com/'])('rejects unsafe destination %s',url=>{
  const fetch=vi.fn();expect(()=>sharedNetwork({fetch})(url,{})).toThrow();expect(fetch).not.toHaveBeenCalled();
 });
 it('propagates certificate and network failures instead of accepting them',async()=>{
  const error=new Error('certificate authority invalid');
  await expect(sharedNetwork({fetch:vi.fn().mockRejectedValue(error)})('https://localhost:4446/',{})).rejects.toBe(error);
 });
});
