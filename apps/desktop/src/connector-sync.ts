import {createHash} from 'node:crypto';
import {finishedTarget,syncTargetSchema,type SyncTarget,type SyncCheckpoint} from './connector-sync-state.js';
import type {ProtectedSettingsStore} from './protected-settings.js';
import type {HostClient} from './host-client.js';
import {refreshDrive,type DriveCredential} from './drive-oauth.js';
import {refreshSelectedDriveFile} from './drive-sources.js';
import {refreshGitHub} from './github-oauth.js';
import {readGitHubSnapshot} from './github-sources.js';
import {refreshSlack} from './slack-oauth.js';
import {listSlackChannels,readSlackChannel} from './slack-sources.js';
import type {DesktopDriveFile} from '../../../src/desktop/drive-contract.js';

export async function importSelectedDriveRevision(projectId:string,credential:DriveCredential,fileId:string,host:HostClient,signal?:AbortSignal,fetcher:typeof fetch=fetch){
 const persist=async(command:Parameters<HostClient['request']>[0])=>{
  signal?.throwIfAborted();
  const result=await host.request(command);
  if(!result.ok)throw new Error('Drive revision could not be verified or saved');
  return result.data;
 };
 return refreshSelectedDriveFile(credential,fileId,
  revision=>persist({operation:'desktop.drive.revision',projectId,...revision}),
  file=>persist({operation:'desktop.drive.ingest',projectId,fileId:file.fileId,name:file.name,mimeType:file.mimeType,
   modifiedTime:file.modifiedTime,version:file.version,contentType:file.contentType as DesktopDriveFile['contentType'],fileName:file.fileName,base64:file.bytes.toString('base64')}),
  signal,fetcher);
}

type Selection=Pick<SyncTarget,'provider'|'projectId'|'resourceIds'|'teamId'>;
function selectionId(input:Selection){
 const hash=createHash('sha256').update(JSON.stringify([input.provider,input.projectId,[...input.resourceIds].sort(),input.teamId??''])).digest('hex');
 return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
export async function savedSyncTarget(settings:ProtectedSettingsStore,input:Selection){
 return (await settings.read()).syncTargets?.find(t=>t.id===selectionId(input));
}
export async function rememberSyncTarget(settings:ProtectedSettingsStore,input:Selection,checkpoint:SyncCheckpoint|null=null,historyLimited=false){
 const id=selectionId(input);
 const state=await settings.read(),old=state.syncTargets?.find(t=>t.id===id);
 if(!old&&(state.syncTargets?.length??0)>=16)throw new Error('Remove an old refresh selection first');
 const now=Date.now();
 const target=finishedTarget(syncTargetSchema.parse({...old,...input,id,enabled:old?.enabled??false,nextAt:now,
  checkpoint,historyLimited,checkpointPaused:false}),true,now);
 await settings.write({...state,syncTargets:[...(state.syncTargets??[]).filter(t=>t.id!==id),target]});
 return target;
}

async function saveCheckpoint(settings:ProtectedSettingsStore,target:SyncTarget,checkpoint:SyncCheckpoint|null,historyLimited=false){
 const state=await settings.read();
 await settings.write({...state,syncTargets:state.syncTargets?.map(current=>current.id===target.id?
  syncTargetSchema.parse({...current,checkpoint,historyLimited}):current)});
}
/** Main owns the settings mutex and grants; no arbitrary URLs or renderer tokens. */
export async function refreshSelectedSource(target:SyncTarget,settings:ProtectedSettingsStore,host:HostClient,signal?:AbortSignal){
 syncTargetSchema.parse(target);signal?.throwIfAborted();
 const fetcher:typeof fetch=(input,options)=>fetch(input,{...options,signal:signal?AbortSignal.any([signal,...(options?.signal?[options.signal]:[])]):options?.signal});
 const available=await host.request({operation:'workspace.list'});
 if(!available.ok||!Array.isArray(available.data)||!available.data.some(p=>p.id===target.projectId))throw new Error('Workspace access unavailable');
 let state=await settings.read();
 const persist=async(command:Parameters<HostClient['request']>[0])=>{signal?.throwIfAborted();const result=await host.request(command);if(!result.ok)throw new Error('Source persistence failed');return result.data;};
 if(target.provider==='github'){
  if(!state.github||target.resourceIds.length!==1)throw new Error('GitHub disconnected');
  const credential=await refreshGitHub(state.github,fetcher,signal);await settings.write({...state,github:credential});
  const {checkpoint,...snapshot}=await readGitHubSnapshot(credential,Number(target.resourceIds[0]),fetcher,
   target.checkpoint?.provider==='github'?target.checkpoint.cursor:undefined);
  const data=await persist({operation:'desktop.github.ingest',projectId:target.projectId,...snapshot});
  await saveCheckpoint(settings,target,checkpoint?{provider:'github',cursor:checkpoint}:null);
  return {...data as object,inProgress:!!checkpoint};
 }
 if(target.provider==='slack'){
  if(!state.slack||state.slack.teamId!==target.teamId||target.resourceIds.length!==1)throw new Error('Slack grant changed');
  const credential=await refreshSlack(state.slack,fetcher);await settings.write({...state,slack:credential});
  const channel=(await listSlackChannels(credential,fetcher)).find(c=>c.id===target.resourceIds[0]);if(!channel)throw new Error('Selected channel unavailable');
  const {checkpoint,...snapshot}=await readSlackChannel(credential,channel,fetcher,
   target.checkpoint?.provider==='slack'?target.checkpoint.cursor:undefined);
  const data=await persist({operation:'desktop.slack.ingest',projectId:target.projectId,teamId:credential.teamId,teamName:credential.teamName,channel,...snapshot});
  const historyLimited=!checkpoint&&!snapshot.snapshot.complete;
  await saveCheckpoint(settings,target,checkpoint?{provider:'slack',cursor:checkpoint}:null,historyLimited);
  return {...data as object,inProgress:!!checkpoint,historyLimited};
 }
 if(!state.drive||target.resourceIds.some(id=>!state.drive!.fileIds.includes(id)))throw new Error('Drive selection changed');
 const files=[];
 for(const id of target.resourceIds){
  signal?.throwIfAborted();const credential=await refreshDrive(state.drive!,fetcher);state={...state,drive:credential};await settings.write(state);
  files.push(await importSelectedDriveRevision(target.projectId,credential,id,host,signal,fetcher));
 }
 return {saved:files.length,files};
}
