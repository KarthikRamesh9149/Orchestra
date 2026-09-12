import {describe,it,expect,vi} from 'vitest';
import {readGitHubSnapshot} from '../apps/desktop/src/github-sources.js';
import {GITHUB_DESKTOP_APP_ID,type GitHubCredential} from '../apps/desktop/src/github-oauth.js';
const credential:GitHubCredential={accessToken:'ghu_synthetic',refreshToken:'ghr_synthetic',expiresAt:Date.now()+3600000,refreshExpiresAt:Date.now()+86400000};
const json=(data:unknown)=>new Response(JSON.stringify(data));
function provider(){return vi.fn(async(url:Parameters<typeof fetch>[0],_options?:RequestInit)=>{
 const path=String(url);
 if(path.includes('/user/installations?'))return json({total_count:1,installations:[{id:44,app_id:GITHUB_DESKTOP_APP_ID,permissions:{contents:'read',pull_requests:'read'},suspended_at:null,account:{login:'synthetic'}}]});
 if(path.includes('/repositories?'))return json({total_count:1,repositories:[{id:9,full_name:'synthetic/qualification',private:true,default_branch:'main'}]});
 if(path.includes('/pulls?'))return json([{number:2,title:'Synthetic CSV export',body:'Export item_id and title',state:'closed',updated_at:'2026-09-12T00:00:00Z',head:{sha:'a'.repeat(40)},base:{ref:'main'}}]);
 if(path.includes('/commits?'))return json([{sha:'b'.repeat(40),commit:{message:'Implement CSV export',committer:{date:'2026-09-11T00:00:00Z'}}}]);
 throw new Error('Unexpected destination');
});}
describe('desktop GitHub source selection',()=>{
 it('revalidates installation access and creates provider-linked evidence without trusting URLs',async()=>{
  const fetcher=provider();const result=await readGitHubSnapshot(credential,9,fetcher);
  expect(result.repository.full_name).toBe('synthetic/qualification');expect(result.items).toHaveLength(2);
  expect(result.items[0]).toMatchObject({evidenceType:'github_pull_request',sourceUrl:'https://github.com/synthetic/qualification/pull/2',summary:'Export item_id and title'});
  expect(result.items[1].sourceUrl).toBe('https://github.com/synthetic/qualification/commit/'+'b'.repeat(40));
  for(const [,options] of fetcher.mock.calls as unknown as Array<[unknown,RequestInit]>)expect(options.redirect).toBe('error');
  expect(JSON.stringify(result)).not.toContain(credential.accessToken);
 });
 it('rejects unselected or invalid repository IDs before reading content',async()=>{
  const fetcher=provider();await expect(readGitHubSnapshot(credential,10,fetcher)).rejects.toThrow('authorized');
  expect(fetcher.mock.calls.every(([url])=>!String(url).includes('/repos/'))).toBe(true);
  await expect(readGitHubSnapshot(credential,-1,fetcher)).rejects.toThrow();
 });
 it('does not turn permission/network errors into empty evidence',async()=>{
  const normal=provider();const fetcher:typeof fetch=async(url,options)=>String(url).includes('/pulls?')?new Response('',{status:403}):normal(url,options);
  await expect(readGitHubSnapshot(credential,9,fetcher)).rejects.toThrow();
 });
 it('rejects pagination overflow rather than pretending a truncated import is complete',async()=>{
  const normal=provider();const fetcher:typeof fetch=async(url,options)=>String(url).includes('/pulls?')?json(Array.from({length:100},(_,i)=>({number:i+1,title:'Synthetic',body:'',state:'open',updated_at:'2026-09-12T00:00:00Z',head:{sha:'a'.repeat(40)},base:{ref:'main'}}))):normal(url,options);
  await expect(readGitHubSnapshot(credential,9,fetcher)).rejects.toThrow(/limit|duplicate/);
 });
});
