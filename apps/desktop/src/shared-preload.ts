import {contextBridge,ipcRenderer} from 'electron';
// Public, main-supplied metadata only; no network, filesystem or local runtime bridge.
const argument=process.argv.find(value=>value.startsWith('--orchestra-shared='));
if(!argument)throw new Error('Shared connection metadata missing');
const connection=JSON.parse(decodeURIComponent(argument.slice('--orchestra-shared='.length)));
let offline=false;
const listeners=new Set<()=>void>();
ipcRenderer.on('orchestra:shared-offline',(_event,value:unknown)=>{
 if(typeof value!=='boolean'||value===offline)return;
 offline=value;for(const notify of listeners)notify();
});
contextBridge.exposeInMainWorld('orchestraShared',Object.freeze({
 connection:Object.freeze(connection),close:()=>ipcRenderer.invoke('orchestra:shared-close'),
 copyText:(text:string)=>ipcRenderer.invoke('orchestra:shared-copy',text),
 isOffline:()=>offline,
 onOfflineChange:(notify:()=>void)=>{if(typeof notify!=='function')throw new Error('Invalid listener');listeners.add(notify);return ()=>{listeners.delete(notify);};}
}));
