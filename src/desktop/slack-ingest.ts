import type {Prisma,PrismaClient} from '@prisma/client';
import {desktopSlackBatchSchema} from './slack-contract.js';
import {authorizeActiveProject,requireAuthorizedProjectRole} from '../lib/auth/authorization.js';
import {MessageIngestionService} from '../modules/communications/message-ingestion.service.js';
import {MessageNormalizerService} from '../modules/communications/message-normalizer.service.js';
import {PostgresJobDispatcher} from '../lib/jobs/postgres.js';
import {JobNames} from '../lib/jobs/types.js';
import {jobKeys} from '../lib/jobs/keys.js';

/** Called only from the private native-parent IPC, not a renderer/API route. */
export async function ingestDesktopSlack(prisma:PrismaClient,actor:{id:string;orgId:string},value:unknown){
 const input=desktopSlackBatchSchema.parse(value);
 requireAuthorizedProjectRole(await authorizeActiveProject(prisma,{userId:actor.id,orgId:actor.orgId,projectId:input.projectId}),['manager']);
 return prisma.$transaction(async tx=>{
  // Serialize this connector's create/upsert and all its evidence effects.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`desktop-slack:${input.projectId}`},0))::text`;
  const existing=await tx.communicationConnector.findUnique({where:{projectId_provider:{projectId:input.projectId,provider:'slack'}}});
  const config=existing?.configJson as {desktop?:boolean;teamId?:string;channelIds?:string[];snapshotCutoffs?:Record<string,number>}|null;
  if(existing&&(!config?.desktop||config.teamId!==input.teamId))throw new Error('Different Slack connector already belongs to this project');
  const previousCutoff=config?.snapshotCutoffs?.[input.channel.id]??0;
  if(existing&&input.snapshot&&input.snapshot.latestMs<=previousCutoff){
   return {connectorId:existing.id,channelId:input.channel.id,messageCount:0,deletedMessageCount:0,superseded:true};
  }
  const channelIds=[...new Set([...(config?.channelIds??[]),input.channel.id])];
  const snapshotCutoffs={...config?.snapshotCutoffs,...(input.snapshot?{[input.channel.id]:input.snapshot.latestMs}:{})};
  const configJson={desktop:true,teamId:input.teamId,channelIds,snapshotCutoffs};
  const connector=await tx.communicationConnector.upsert({where:{projectId_provider:{projectId:input.projectId,provider:'slack'}},
   create:{projectId:input.projectId,provider:'slack',accountLabel:input.teamName,status:'connected',createdBy:actor.id,configJson},
   update:{configJson,status:'connected'}});
  const permalink=(ts:string)=>`https://app.slack.com/client/${input.teamId}/${input.channel.id}/p${ts.replace('.','')}`;
  const iso=(ts:string)=>new Date(Number(ts)*1000).toISOString();
  const deletedTimestamps=new Set(input.deletedTimestamps);
  const messages=input.messages.filter(message=>!deletedTimestamps.has(message.ts));
  const providerId=(ts:string)=>`${input.channel.id}:${ts}`;
  const liveIds=messages.map(message=>providerId(message.ts));
  const threads=[...new Set(messages.map(message=>message.threadTs))].map(ts=>({providerThreadId:providerId(ts),subject:`#${input.channel.name}`,participants:[],startedAt:iso(ts),threadUrl:permalink(ts),rawMetadata:{teamId:input.teamId,channelId:input.channel.id}}));
  const messageScope={projectId:input.projectId,connectorId:connector.id,provider:'slack' as const};
  if(liveIds.length){
   await tx.communicationMessage.updateMany({where:{...messageScope,providerMessageId:{in:liveIds},isDeletedByProvider:true},data:{isDeletedByProvider:false}});
  }
  let result:unknown={createdMessageCount:0};
  if(messages.length){const batch=new MessageNormalizerService().normalizeBatch({projectId:input.projectId,connectorId:connector.id,provider:'slack',threads,messages:messages.map(message=>({providerThreadId:providerId(message.threadTs),providerMessageId:providerId(message.ts),senderLabel:message.user,senderExternalRef:message.user,sentAt:iso(message.ts),bodyText:message.text,messageType:'user',providerPermalink:permalink(message.ts),rawMetadata:{teamId:input.teamId,channelId:input.channel.id,providerTs:message.ts},replyToProviderMessageId:message.threadTs===message.ts?null:providerId(message.threadTs)}))});
   // Existing ingestion enqueues durable indexing, without approving truth.
   result=await new MessageIngestionService(tx as unknown as PrismaClient,new PostgresJobDispatcher(tx as unknown as PrismaClient)).ingestNormalizedBatch(batch);
  }
  const withdrawn:Prisma.CommunicationMessageWhereInput[]=[];
  if(deletedTimestamps.size)withdrawn.push({providerMessageId:{in:[...deletedTimestamps].map(providerId)}});
  if(input.snapshot?.complete){
   // Replies to older roots were not enumerated. An absence is authoritative
   // only inside the fully fetched channel window (including the thread root).
   const window={gte:new Date(input.snapshot.oldestMs),lte:new Date(input.snapshot.latestMs)};
   withdrawn.push({sentAt:window,providerMessageId:{startsWith:`${input.channel.id}:`,notIn:liveIds},
    thread:{startedAt:window}});
  }
  const deletedMessageCount=withdrawn.length
   ? (await tx.communicationMessage.updateMany({where:{...messageScope,isDeletedByProvider:false,OR:withdrawn},data:{isDeletedByProvider:true}})).count
   : 0;
  await tx.communicationConnector.update({where:{id:connector.id},data:{lastSyncedAt:new Date(),lastError:null}});
  // An explicitly repeated import may repair failed indexing for these exact
  // verified messages. Never restart unrelated or accepted-effect jobs.
  const saved=await tx.communicationMessage.findMany({where:{...messageScope,providerMessageId:{in:liveIds},isDeletedByProvider:false},select:{id:true,bodyHash:true}});
  for(const message of saved){const key=jobKeys.indexCommunicationMessage(message.id,message.bodyHash);
   await tx.$executeRaw`UPDATE desktop_jobs SET status='queued',attempts=CASE WHEN failure_code='ai_revoked' THEN 0 ELSE attempts END,failure_code=NULL,available_at=now(),updated_at=now() WHERE name=${JobNames.indexCommunicationMessage} AND idempotency_key=${key} AND status='failed' AND (attempts<max_attempts OR failure_code='ai_revoked')`;
  }
  return {connectorId:connector.id,channelId:input.channel.id,messageCount:messages.length,deletedMessageCount,result};
 },{timeout:30000});
}
