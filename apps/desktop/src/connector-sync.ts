import {createHash} from 'node:crypto';
import {syncTargetSchema,type SyncTarget} from './connector-sync-state.js';
import type {ProtectedSettingsStore} from './protected-settings.js';
import type {HostClient} from './host-client.js';
import {refreshDrive} from './drive-oauth.js';
import {readSelectedDriveFile} from './drive-sources.js';
import {refreshGitHub} from './github-oauth.js';
import {readGitHubSnapshot} from './github-sources.js';
import {refreshSlack} from './slack-oauth.js';
import {listSlackChannels,readSlackChannel} from './slack-sources.js';
import type {DesktopDriveFile} from '../../../src/desktop/drive-contract.js';
export async function rememberSyncTarget(settings:ProtectedSettingsStore,input:Pick<SyncTarget,'provider'|'projectId'|'resourceIds'|'teamId'>){
 const hash=createHash('sha256').update(JSON.stringify([input.provider,input.projectId,[...input.resourceIds].sort(),input.teamId??''])).digest('hex');
 const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
 const state=await settings.read(),old=state.syncTargets?.find(t=>t.id===id);
 if(!old&&(state.syncTargets?.length??0)>=16)throw new Error('Remove an old refresh selection first');
 const now=Date.now(),target=syncTargetSchema.parse({...input,id,enabled:old?.enabled??false,nextAt:now+300000,lastAttemptAt:new Date(now).toISOString(),lastSuccessAt:new Date(now).toISOString(),error:null});
 await settings.write({...state,syncTargets:[...(state.syncTargets??[]).filter(t=>t.id!==id),target]});
 return target;
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
  const snapshot=await readGitHubSnapshot(credential,Number(target.resourceIds[0]),fetcher);
  return persist({operation:'desktop.github.ingest',projectId:target.projectId,...snapshot});
 }
 if(target.provider==='slack'){
  if(!state.slack||state.slack.teamId!==target.teamId||target.resourceIds.length!==1)throw new Error('Slack grant changed');
  const credential=await refreshSlack(state.slack,fetcher);await settings.write({...state,slack:credential});
  const channel=(await listSlackChannels(credential,fetcher)).find(c=>c.id===target.resourceIds[0]);if(!channel)throw new Error('Selected channel unavailable');
  const messages=await readSlackChannel(credential,channel,fetcher);
  return persist({operation:'desktop.slack.ingest',projectId:target.projectId,teamId:credential.teamId,teamName:credential.teamName,channel,messages});
 }
 if(!state.drive||target.resourceIds.some(id=>!state.drive!.fileIds.includes(id)))throw new Error('Drive selection changed');
 const files=[];
 for(const id of target.resourceIds){
  signal?.throwIfAborted();const credential=await refreshDrive(state.drive!,fetcher);state={...state,drive:credential};await settings.write(state);
  const file=await readSelectedDriveFile(credential,id,signal,fetcher);
  files.push(await persist({operation:'desktop.drive.ingest',projectId:target.projectId,fileId:file.fileId,name:file.name,mimeType:file.mimeType,modifiedTime:file.modifiedTime,version:file.version,contentType:file.contentType as DesktopDriveFile['contentType'],fileName:file.fileName,base64:file.bytes.toString('base64')}));
 }
 return {saved:files.length,files};
}
