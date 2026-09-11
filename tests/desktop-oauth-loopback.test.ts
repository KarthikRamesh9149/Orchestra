import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {startOAuthCallback} from '../apps/desktop/src/oauth-loopback.js';

async function request(callback:Awaited<ReturnType<typeof startOAuthCallback>>,query:string,options:{method?:string;headers?:Record<string,string>}={}){
 const url=new URL(callback.redirectUri);url.hostname='127.0.0.1';url.search=query;
 return new Promise<{status:number;headers:Headers}>((resolve,reject)=>{
  const req=httpRequest(url,{method:options.method,headers:{Host:new URL(callback.redirectUri).host,...options.headers}},res=>{
   res.resume();res.on('end',()=>resolve({status:res.statusCode!,headers:new Headers(Object.entries(res.headers).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))}));
  });req.on('error',reject);req.end();
 });
}
describe('native OAuth callback',()=>{
 it('uses S256, rejects wrong state and accepts one valid callback',async()=>{
  const callback=await startOAuthCallback({port:0});try{
   expect(callback.challenge).toBe(createHash('sha256').update(callback.verifier).digest('base64url'));
   expect((await request(callback,'state=wrong&code=test')).status).toBe(400);
   const response=await request(callback,`state=${callback.state}&code=synthetic-code`);
   expect(response.headers.get('cache-control')).toBe('no-store');expect(await callback.code).toBe('synthetic-code');
  }finally{callback.cancel();}
 });
 it('rejects hostile hosts, non-GET requests and duplicate parameters without consuming state',async()=>{
  const callback=await startOAuthCallback({port:0});try{
   const query=`state=${callback.state}&code=test`;
   expect((await request(callback,query,{headers:{Host:'attacker.invalid'}})).status).toBe(400);
   expect((await request(callback,query,{method:'POST'})).status).toBe(400);
   expect((await request(callback,query+'&state=other')).status).toBe(400);
   expect((await request(callback,query+'&code=other')).status).toBe(400);
  }finally{callback.cancel();}await expect(callback.code).rejects.toThrow('cancelled');
 });
 it('handles denial, explicit cancellation and bounded timeout',async()=>{
  const callback=await startOAuthCallback({port:0});await request(callback,`state=${callback.state}&error=access_denied`);await expect(callback.code).rejects.toThrow('declined');
  const controller=new AbortController();const second=await startOAuthCallback({port:0,signal:controller.signal});controller.abort();await expect(second.code).rejects.toThrow('cancelled');
  const third=await startOAuthCallback({port:0,timeoutMs:10});await expect(third.code).rejects.toThrow('expired');
 });
});
