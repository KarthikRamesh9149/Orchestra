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
/** Explicit, bounded 30-day snapshot. No automatic workspace-wide retrieval. */
export async function readSlackChannel(credential:SlackCredential,channel:z.infer<typeof slackChannelSchema>,fetchImpl:typeof fetch=fetch):Promise<Pick<DesktopSlackBatch,'messages'|'deletedTimestamps'|'snapshot'>>{
 const messages=new Map<string,DesktopSlackBatch['messages'][number]>();let requests=0;
 const deletedTimestamps=new Set<string>();
 const schema=z.object({messages:z.array(z.object({ts:slackTimestampSchema.optional(),thread_ts:slackTimestampSchema.optional(),deleted_ts:slackTimestampSchema.optional(),previous_message:z.object({ts:slackTimestampSchema.optional()}).optional(),text:z.string().max(40000).optional(),user:z.string().max(100).optional(),reply_count:z.number().int().nonnegative().optional(),subtype:z.string().optional()})).max(200),response_metadata:pageMeta,has_more:z.boolean().optional(),is_limited:z.boolean().optional()});
 const latestMs=Date.now(),oldestMs=latestMs-30*86400_000;
 let complete=true;
 async function pages(method:'conversations.history'|'conversations.replies',thread?:string){
  let cursor='';const seen=new Set<string>();const roots:string[]=[];
  do{
   if(++requests>20)throw new Error('Selected channel exceeds the bounded import. No snapshot was saved.');
   const response=schema.parse(await slackRequest(method,new URLSearchParams({
    channel:channel.id,oldest:(oldestMs/1000).toFixed(3),latest:(latestMs/1000).toFixed(3),inclusive:'true',limit:'100',cursor,...(thread?{ts:thread}:{})
   }),credential.accessToken,fetchImpl));
   if(response.is_limited)complete=false;
   for(const message of response.messages){
    if(message.subtype==='message_deleted'){
     const timestamp=message.deleted_ts??message.previous_message?.ts??message.ts;
     if(timestamp)deletedTimestamps.add(timestamp);else complete=false;
     if(deletedTimestamps.size>200)throw new Error('Selected channel exceeds the bounded deletion history. No snapshot was saved.');
     continue;
    }
    if(!message.ts){complete=false;continue;}
    if(!thread&&(message.reply_count??0)>0)roots.push(message.ts);
    if(!message.text?.trim())continue;
    messages.set(message.ts,{ts:message.ts,threadTs:message.thread_ts??message.ts,text:message.text,user:message.user??'Slack member'});
    if(messages.size>200)throw new Error('Selected channel exceeds 200 messages. No snapshot was saved.');
   }
   cursor=response.response_metadata?.next_cursor??'';
   if(response.has_more&&!cursor)throw new Error('Slack did not supply a continuation cursor. No snapshot was saved.');
   if(cursor&&seen.has(cursor))throw new Error('Slack pagination repeated');seen.add(cursor);
  }while(cursor);
  return roots;
 }
 for(const root of await pages('conversations.history'))await pages('conversations.replies',root);
 return {messages:[...messages.values()].filter(message=>!deletedTimestamps.has(message.ts)),deletedTimestamps:[...deletedTimestamps],snapshot:{oldestMs,latestMs,complete}};
}
