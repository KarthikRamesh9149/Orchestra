import {describe,it,expect,vi} from 'vitest';
import {refreshSlack,revokeSlack,slackRequest,type SlackCredential} from '../apps/desktop/src/slack-oauth.js';
const credential:SlackCredential={teamId:'TTEST',teamName:'Synthetic workspace',userId:'UTEST',accessToken:'synthetic-access-only',refreshToken:'synthetic-refresh-only',expiresAt:1,scopes:['channels:read','channels:history']};
describe('native Slack token boundary',()=>{
 it('revokes refresh and access tokens without first refreshing an expired credential',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,revoked:true})));
  await revokeSlack(credential,fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const calls=fetcher.mock.calls as unknown as [string,RequestInit][];
  expect(calls.map(([url])=>url)).toEqual(Array(2).fill('https://slack.com/api/auth.revoke'));
  expect(calls.map(([,options])=>new URLSearchParams(String(options.body)).get('token'))).toEqual([credential.refreshToken,credential.accessToken]);
 });
 it('can retry partial revocation without treating network failures as success',async()=>{
  let count=0;
  const partial=vi.fn(async()=>{if(++count===2)throw new Error('offline');return new Response(JSON.stringify({ok:true,revoked:true}));});
  await expect(revokeSlack(credential,partial)).rejects.toThrow('offline');
  const retry=vi.fn(async()=>new Response(JSON.stringify({ok:false,error:'token_revoked'})));
  await expect(revokeSlack(credential,retry)).resolves.toBeUndefined();
  await expect(revokeSlack(credential,async()=>new Response(JSON.stringify({ok:false,error:'missing_scope'})))).rejects.toThrow();
 });
 it('refreshes without a shared secret and replaces both tokens',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,token_type:'user',access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:43200,scope:'channels:read,channels:history'})));
  const result=await refreshSlack(credential,fetcher);expect(result.refreshToken).toBe('synthetic-new-refresh');expect(result.teamId).toBe(credential.teamId);
  const options=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(options[0]).toBe('https://slack.com/api/oauth.v2.access');expect(String(options[1].body)).not.toContain('client_secret');expect(options[1].redirect).toBe('error');
 });
 it('does not refresh an unexpired token',async()=>{const fetcher=vi.fn();await refreshSlack({...credential,expiresAt:Date.now()+120000},fetcher);expect(fetcher).not.toHaveBeenCalled();});
 it('accepts Slack implicit identify metadata without allowing additional content permissions',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,token_type:'user',access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:43200,scope:'identify,channels:history,channels:read'})));
  expect((await refreshSlack(credential,fetcher)).scopes).toEqual(['channels:read','channels:history']);
 });
 it('rejects bot tokens and unexpected scope expansion',async()=>{
  for(const patch of [{token_type:'bot'},{scope:'channels:read,channels:history,chat:write'}]){
   const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,token_type:'user',access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:43200,scope:'channels:read,channels:history',...patch})));
   await expect(refreshSlack(credential,fetcher)).rejects.toThrow();
  }
 });
 it('does not expose provider errors or oversized response contents',async()=>{
  await expect(slackRequest('auth.test',new URLSearchParams(),credential.accessToken,async()=>new Response(JSON.stringify({ok:false,error:'secret-material'})))).rejects.toThrow('Slack rejected');
  await expect(slackRequest('auth.test',new URLSearchParams(),undefined,async()=>new Response('x'.repeat(2*1024*1024+1)))).rejects.toThrow('exceeds limit');
 });
});
