import {contextBridge,ipcRenderer} from 'electron';
import type {DesktopBridge,OperationResult,RuntimeStatus} from './contracts.js';
const invoke=(input:unknown)=>ipcRenderer.invoke('orchestra:command',input) as Promise<OperationResult>;
const bridge:DesktopBridge={
 sync:{inspect:()=>ipcRenderer.invoke('orchestra:sync-inspect'),update:input=>ipcRenderer.invoke('orchestra:sync-update',input),cancel:()=>ipcRenderer.invoke('orchestra:sync-cancel')},
 drive:{inspect:()=>ipcRenderer.invoke('orchestra:drive-inspect'),configure:()=>ipcRenderer.invoke('orchestra:drive-configure'),connect:()=>ipcRenderer.invoke('orchestra:drive-connect'),cancel:()=>ipcRenderer.invoke('orchestra:drive-cancel'),revoke:()=>ipcRenderer.invoke('orchestra:drive-revoke'),importFiles:projectId=>ipcRenderer.invoke('orchestra:drive-import',projectId)},
 github:{inspect:()=>ipcRenderer.invoke('orchestra:github-inspect'),connect:()=>ipcRenderer.invoke('orchestra:github-connect'),cancel:()=>ipcRenderer.invoke('orchestra:github-cancel'),repositories:()=>ipcRenderer.invoke('orchestra:github-repositories'),disconnect:()=>ipcRenderer.invoke('orchestra:github-disconnect'),importRepository:input=>ipcRenderer.invoke('orchestra:github-import',input)},
 slack:{inspect:()=>ipcRenderer.invoke('orchestra:slack-inspect'),connect:()=>ipcRenderer.invoke('orchestra:slack-connect'),cancel:()=>ipcRenderer.invoke('orchestra:slack-cancel'),revoke:()=>ipcRenderer.invoke('orchestra:slack-revoke'),channels:()=>ipcRenderer.invoke('orchestra:slack-channels'),importChannel:input=>ipcRenderer.invoke('orchestra:slack-import',input)},
 mcp:{inspect:()=>ipcRenderer.invoke('orchestra:mcp-inspect'),pair:input=>ipcRenderer.invoke('orchestra:mcp-pair',input),revoke:id=>ipcRenderer.invoke('orchestra:mcp-revoke',id)},
 ai:{inspect:()=>ipcRenderer.invoke('orchestra:ai-inspect'),configure:preferences=>ipcRenderer.invoke('orchestra:ai-configure',preferences),revoke:()=>ipcRenderer.invoke('orchestra:ai-revoke')},
 bootstrap:()=>invoke({operation:'local.bootstrap'}),
 completeOnboarding:()=>invoke({operation:'local.onboard'}),
 copyText:text=>ipcRenderer.invoke('orchestra:copy-text',text),
 downloadDocument:(projectId,documentId)=>ipcRenderer.invoke('orchestra:download-document',{projectId,documentId}),
 downloadPreflight:(projectId,packId)=>ipcRenderer.invoke('orchestra:download-preflight',{projectId,packId}),
 status:()=>ipcRenderer.invoke('orchestra:status') as Promise<RuntimeStatus>,
 workspaces:{list:()=>invoke({operation:'workspace.list'}),create:name=>invoke({operation:'workspace.create',name}),select:projectId=>invoke({operation:'workspace.select',projectId})},
 chooseEvidence:()=>ipcRenderer.invoke('orchestra:choose-evidence'),
 chooseFolder:()=>ipcRenderer.invoke('orchestra:choose-folder'),
 chooseRepository:()=>ipcRenderer.invoke('orchestra:choose-repository'),
 uploadEvidence:(projectId,selectionId)=>invoke({operation:'evidence.upload',projectId,selectionId}),
 ask:input=>invoke({operation:'socrates.ask',...input}),
 cancel:requestId=>invoke({operation:'socrates.cancel',requestId}),
 onDelta(callback){const listener=(_event:Electron.IpcRendererEvent,data:{requestId:string;delta:string})=>callback(data);ipcRenderer.on('orchestra:delta',listener);return()=>ipcRenderer.removeListener('orchestra:delta',listener);}
};
contextBridge.exposeInMainWorld('orchestra',bridge);
