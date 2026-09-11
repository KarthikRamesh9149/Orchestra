import {it,expect,vi} from 'vitest';
import {listSlackChannels,readSlackChannel} from '../apps/desktop/src/slack-sources.js';
import type {SlackCredential} from '../apps/desktop/src/slack-oauth.js';
const credential:SlackCredential={teamId:'TTEST',teamName:'Test',userId:'UTEST',accessToken:'synthetic-token',refreshToken:'synthetic-refresh',expiresAt:Date.now()+100000,scopes:['channels:read','channels:history']};
const json=(payload:unknown)=>new Response(JSON.stringify({ok:true,...payload as object}));
it('lists only joined public non-archived channels',async()=>{
 const fetcher=vi.fn(async()=>json({channels:[{id:'CTEST',name:'test',is_private:false,is_archived:false,is_member:true},{id:'COTHER',name:'other',is_private:false,is_archived:false,is_member:false}]}));
 expect(await listSlackChannels(credential,fetcher)).toEqual([{id:'CTEST',name:'test'}]);
});
it('reads only the selected channel and deduplicates thread roots',async()=>{
 const root={ts:'1789000000.000001',text:'Synthetic root',user:'UTEST',reply_count:1};
 const fetcher=vi.fn(async(url:Parameters<typeof fetch>[0],options?:RequestInit)=>{expect(String(options?.body)).toContain('channel=CTEST');return json({messages:String(url).endsWith('history')?[root]:[root,{ts:'1789000001.000001',thread_ts:root.ts,text:'Synthetic reply',user:'UTEST'}]});});
 expect(await readSlackChannel(credential,{id:'CTEST',name:'test'},fetcher)).toHaveLength(2);expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects incomplete pagination rather than reporting empty success',async()=>{
 await expect(readSlackChannel(credential,{id:'CTEST',name:'test'},async()=>json({messages:[],has_more:true}))).rejects.toThrow('continuation');
});
