import {contextBridge,ipcRenderer} from 'electron';
import type {DesktopBridge,OperationResult,RuntimeStatus} from './contracts.js';
const invoke=(input:unknown)=>ipcRenderer.invoke('orchestra:command',input) as Promise<OperationResult>;
const bridge:DesktopBridge={
 bootstrap:()=>invoke({operation:'local.bootstrap'}),
 completeOnboarding:()=>invoke({operation:'local.onboard'}),
 copyText:text=>ipcRenderer.invoke('orchestra:copy-text',text),
 downloadDocument:(projectId,documentId)=>ipcRenderer.invoke('orchestra:download-document',{projectId,documentId}),
 downloadPreflight:(projectId,packId)=>ipcRenderer.invoke('orchestra:download-preflight',{projectId,packId}),
 status:()=>ipcRenderer.invoke('orchestra:status') as Promise<RuntimeStatus>,
 workspaces:{list:()=>invoke({operation:'workspace.list'}),create:name=>invoke({operation:'workspace.create',name}),select:projectId=>invoke({operation:'workspace.select',projectId})},
 chooseEvidence:()=>ipcRenderer.invoke('orchestra:choose-evidence'),
 uploadEvidence:(projectId,selectionId)=>invoke({operation:'evidence.upload',projectId,selectionId}),
 ask:input=>invoke({operation:'socrates.ask',...input}),
 cancel:requestId=>invoke({operation:'socrates.cancel',requestId}),
 onDelta(callback){const listener=(_event:Electron.IpcRendererEvent,data:{requestId:string;delta:string})=>callback(data);ipcRenderer.on('orchestra:delta',listener);return()=>ipcRenderer.removeListener('orchestra:delta',listener);}
};
contextBridge.exposeInMainWorld('orchestra',bridge);
