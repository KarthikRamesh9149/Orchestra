import {z} from 'zod';
import {slackRequest,type SlackCredential} from './slack-oauth.js';
import {slackChannelSchema,slackTimestampSchema,type DesktopSlackBatch} from '../../../src/desktop/slack-contract.js';
const pageMeta=z.object({next_cursor:z.string().max(2048).optional()}).optional();
export async function listSlackChannels(credential:SlackCredential,fetchImpl:typeof fetch=fetch){
 const result:Array<z.infer<typeof slackChannelSchema>>=[];let cursor='';const seen=new Set<string>();
 for(let page=0;page<10;page++){
  const response=z.object({channels:z.array(z.object({id:z.string(),name:z.string(),is_private:z.boolean(),is_archived:z.boolean(),is_member:z.boolean()})).max(200),response_metadata:pageMeta}).parse(await slackRequest('conversations.list',new URLSearchParams({types:'public_channel',exclude_archived:'true',limit:'200',cursor}),credential.accessToken,fetchImpl));
  for(const channel of response.channels)if(!channel.is_private&&!channel.is_archived&&channel.is_member)result.push(slackChannelSchema.parse({id:channel.id,name:channel.name}));
  cursor=response.response_metadata?.next_cursor??'';if(!cursor)return result;
  if(seen.has(cursor))throw new Error('Slack channel pagination repeated');seen.add(cursor);
 }throw new Error('Slack channel inventory exceeds this desktop limit.');
}
export const slackCheckpointSchema=z.object({
 latestMs:z.number().int().positive(),index:z.number().int().positive(),historyCursor:z.string().max(2048),
 historyDone:z.boolean(),roots:z.array(slackTimestampSchema).max(100),replyCursor:z.string().max(2048),allAvailable:z.boolean(),
}).strict();
export type SlackCheckpoint=z.infer<typeof slackCheckpointSchema>;

/** Selected 30-day window with bounded work and a restartable history/reply cursor. */
export async function readSlackChannel(credential:SlackCredential,channel:z.infer<typeof slackChannelSchema>,fetchImpl:typeof fetch=fetch,resume?:SlackCheckpoint){
 const messages=new Map<string,DesktopSlackBatch['messages'][number]>();let requests=0;
 const deletedTimestamps=new Set<string>();
 const schema=z.object({messages:z.array(z.object({ts:slackTimestampSchema.optional(),thread_ts:slackTimestampSchema.optional(),deleted_ts:slackTimestampSchema.optional(),previous_message:z.object({ts:slackTimestampSchema.optional()}).optional(),text:z.string().max(40000).optional(),user:z.string().max(100).optional(),reply_count:z.number().int().nonnegative().optional(),subtype:z.string().optional()})).max(200),response_metadata:pageMeta,has_more:z.boolean().optional(),is_limited:z.boolean().optional()});
 const state=resume?slackCheckpointSchema.parse(resume):{latestMs:Date.now(),index:0,historyCursor:'',historyDone:false,roots:[] as string[],replyCursor:'',allAvailable:true};
 const {latestMs}=state,oldestMs=latestMs-30*86400_000;
 let visited=0;
 const seen=new Set<string>();
 while(requests<20&&visited<200&&(!state.historyDone||state.roots.length)){
   requests++;
   const thread=state.roots[0],method=thread?'conversations.replies':'conversations.history';
   const cursor=thread?state.replyCursor:state.historyCursor;
   const cursorIdentity=`${thread??'history'}:${cursor}`;
   if(seen.has(cursorIdentity))throw new Error('Slack pagination repeated');
   seen.add(cursorIdentity);
   const limit=Math.min(100,200-visited);
   const response=schema.parse(await slackRequest(method,new URLSearchParams({
    channel:channel.id,oldest:(oldestMs/1000).toFixed(3),latest:(latestMs/1000).toFixed(3),inclusive:'true',limit:String(limit),cursor,...(thread?{ts:thread}:{})
   }),credential.accessToken,fetchImpl));
   if(response.messages.length>limit)throw new Error('Slack returned more items than requested');
   visited+=response.messages.length;
   if(response.is_limited)state.allAvailable=false;
   for(const message of response.messages){
    if(message.subtype==='message_deleted'){
     const timestamp=message.deleted_ts??message.previous_message?.ts??message.ts;
     if(timestamp)deletedTimestamps.add(timestamp);else state.allAvailable=false;
     continue;
    }
    if(!message.ts){state.allAvailable=false;continue;}
    if(!thread&&(message.reply_count??0)>0&&!state.roots.includes(message.ts))state.roots.push(message.ts);
    if(!message.text?.trim())continue;
    messages.set(message.ts,{ts:message.ts,threadTs:message.thread_ts??message.ts,text:message.text,user:message.user??'Slack member'});
   }
   const next=response.response_metadata?.next_cursor??'';
   if(response.has_more&&!next)throw new Error('Slack did not supply a continuation cursor. The current batch was not saved.');
   if(next&&seen.has(`${thread??'history'}:${next}`))throw new Error('Slack pagination repeated');
   if(thread){state.replyCursor=next;if(!next)state.roots.shift();}
   else{state.historyCursor=next;state.historyDone=!next;}
 }
 const final=state.historyDone&&!state.roots.length;
 return {messages:[...messages.values()].filter(message=>!deletedTimestamps.has(message.ts)),deletedTimestamps:[...deletedTimestamps],
  snapshot:{oldestMs,latestMs,complete:final&&state.allAvailable,batch:{index:state.index,final}},
  checkpoint:final?null:slackCheckpointSchema.parse({...state,index:state.index+1})};
}
