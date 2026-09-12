import {describe,it,expect,vi,afterEach} from 'vitest';
import {connectGitHub,refreshGitHub,listGitHubRepositories,githubRead,GITHUB_DESKTOP_APP_ID,type GitHubCredential} from '../apps/desktop/src/github-oauth.js';
const value:GitHubCredential={accessToken:'ghu_syntheticAccess',refreshToken:'ghr_syntheticRefresh',expiresAt:1,refreshExpiresAt:Date.now()+86400000};
const token={access_token:'ghu_syntheticReplacement',refresh_token:'ghr_syntheticReplacement',expires_in:28800,refresh_token_expires_in:15897600,scope:'',token_type:'bearer'}; // Synthetic test fixture, not a provider-issued credential.
const json=(value:unknown)=>new Response(JSON.stringify(value));
afterEach(()=>vi.useRealTimers());
describe('desktop GitHub native authorization boundary',()=>{
 it('rotates without a shared secret and refuses expired refresh authority',async()=>{
  const fetcher=vi.fn(async()=>json(token));const next=await refreshGitHub(value,fetcher);
  expect(next.accessToken).toBe(token.access_token);expect(next.expiresAt).toBeGreaterThan(Date.now());
  const [,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(String(options.body)).not.toContain('client_secret');expect(options.redirect).toBe('error');
  await expect(refreshGitHub({...value,refreshExpiresAt:1},fetcher)).rejects.toThrow('expired');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects legacy broad OAuth scopes and malformed provider credentials',async()=>{
  for(const patch of [{scope:'repo'},{token_type:'user'},{expires_in:0}])await expect(refreshGitHub(value,async()=>json({...token,...patch}))).rejects.toThrow();
 });
 it('does not refresh usable access and honors cancelled sign-in',async()=>{
  const fetcher=vi.fn();await refreshGitHub({...value,expiresAt:Date.now()+120000},fetcher);expect(fetcher).not.toHaveBeenCalled();
  const abort=new AbortController();abort.abort();
  await expect(connectGitHub(async()=>{},abort.signal,async(_url,options)=>{options?.signal?.throwIfAborted();return json({});})).rejects.toThrow();
 });
 it('rejects a provider supplied verification destination before displaying a code',async()=>{
  const display=vi.fn();
  await expect(connectGitHub(display,undefined,async()=>json({device_code:'a'.repeat(40),user_code:'ABCD-EFGH',verification_uri:'https://attacker.invalid',expires_in:900,interval:5}))).rejects.toThrow();expect(display).not.toHaveBeenCalled();
 });
 it('exposes only repositories on the desktop app read-only installations',async()=>{
  const installation={id:44,app_id:GITHUB_DESKTOP_APP_ID,permissions:{contents:'read',metadata:'read'},suspended_at:null,account:{login:'synthetic'}};
  const fetcher=vi.fn(async(input:Parameters<typeof fetch>[0])=>String(input).includes('/44/')?json({total_count:1,repositories:[{id:9,full_name:'synthetic/qualification',private:true,default_branch:'main'}]}):json({total_count:2,installations:[installation,{...installation,id:55,app_id:123}]}));
  expect(await listGitHubRepositories(value,fetcher)).toEqual([{id:9,full_name:'synthetic/qualification',private:true,default_branch:'main',installationId:44}]);expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(listGitHubRepositories(value,async()=>json({total_count:1,installations:[{...installation,permissions:{contents:'write'}}]}))).rejects.toThrow('read-only');
 });
 it('rejects arbitrary destinations, empty partial pages and oversized responses',async()=>{
  const fetcher=vi.fn();await expect(githubRead('https://attacker.invalid',value.accessToken,fetcher)).rejects.toThrow('Unapproved');expect(fetcher).not.toHaveBeenCalled();
  await expect(listGitHubRepositories(value,async()=>json({total_count:1,installations:[]}))).rejects.toThrow('incomplete');
  await expect(githubRead('/user/installations?per_page=100&page=1',value.accessToken,async()=>new Response('x'.repeat(2*1024*1024+1)))).rejects.toThrow('exceeds');
 });
});
