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
 expect((await readSlackChannel(credential,{id:'CTEST',name:'test'},fetcher)).messages).toHaveLength(2);expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects incomplete pagination rather than reporting empty success',async()=>{
 await expect(readSlackChannel(credential,{id:'CTEST',name:'test'},async()=>json({messages:[],has_more:true}))).rejects.toThrow('continuation');
});
it('preserves the original timestamp of a deletion without declaring a limited history complete',async()=>{
 const fetcher=async()=>json({is_limited:true,messages:[{subtype:'message_deleted',ts:'1789000002.000001',deleted_ts:'1789000001.000001'}]});
 const snapshot=await readSlackChannel(credential,{id:'CTEST',name:'test'},fetcher);
 expect(snapshot).toMatchObject({messages:[],deletedTimestamps:['1789000001.000001'],snapshot:{complete:false}});
});
it.each([199,200,201])('imports all %s selected Slack messages in bounded restartable batches',async total=>{
 const rows=Array.from({length:total},(_,i)=>({ts:`1789000000.${String(i+1).padStart(6,'0')}`,text:`Synthetic message ${i}`}));
 const fetcher=vi.fn(async(_url:Parameters<typeof fetch>[0],options?:RequestInit)=>{
  const body=new URLSearchParams(String(options?.body));
  const start=Number(body.get('cursor')||0),end=start+Number(body.get('limit'));
  return json({messages:rows.slice(start,end),has_more:end<total,response_metadata:{next_cursor:end<total?String(end):''}});
 });
 const read=readSlackChannel as Function;
 const first=await read(credential,{id:'CTEST',name:'test'},fetcher);
 expect(first.messages).toHaveLength(Math.min(200,total));
 expect(first.snapshot.complete).toBe(total<=200);
 expect(first.checkpoint!==null).toBe(total>200);
 if(first.checkpoint){
  const restarted=JSON.parse(JSON.stringify(first.checkpoint));
  const last=await read(credential,{id:'CTEST',name:'test'},fetcher,restarted);
  expect(last.snapshot).toMatchObject({latestMs:first.snapshot.latestMs,complete:true});
  expect(last.checkpoint).toBeNull();
  expect(new Set([...first.messages,...last.messages].map(row=>row.ts))).toHaveLength(total);
 }
});
