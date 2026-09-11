import {describe,it,expect,vi} from 'vitest';
import {refreshSlack,slackRequest,type SlackCredential} from '../apps/desktop/src/slack-oauth.js';
const credential:SlackCredential={teamId:'TTEST',teamName:'Synthetic workspace',userId:'UTEST',accessToken:'synthetic-access-only',refreshToken:'synthetic-refresh-only',expiresAt:1,scopes:['channels:read','channels:history']};
describe('native Slack token boundary',()=>{
 it('refreshes without a shared secret and replaces both tokens',async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,token_type:'user',access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:43200,scope:'channels:read,channels:history'})));
  const result=await refreshSlack(credential,fetcher);expect(result.refreshToken).toBe('synthetic-new-refresh');expect(result.teamId).toBe(credential.teamId);
  const options=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(options[0]).toBe('https://slack.com/api/oauth.v2.access');expect(String(options[1].body)).not.toContain('client_secret');expect(options[1].redirect).toBe('error');
 });
 it('does not refresh an unexpired token',async()=>{const fetcher=vi.fn();await refreshSlack({...credential,expiresAt:Date.now()+120000},fetcher);expect(fetcher).not.toHaveBeenCalled();});
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
