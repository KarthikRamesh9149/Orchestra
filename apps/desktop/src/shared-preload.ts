import {contextBridge,ipcRenderer} from 'electron';
// Public, main-supplied metadata only; no network, filesystem or local runtime bridge.
const argument=process.argv.find(value=>value.startsWith('--orchestra-shared='));
if(!argument)throw new Error('Shared connection metadata missing');
const connection=JSON.parse(decodeURIComponent(argument.slice('--orchestra-shared='.length)));
contextBridge.exposeInMainWorld('orchestraShared',Object.freeze({connection:Object.freeze(connection),close:()=>ipcRenderer.invoke('orchestra:shared-close'),copyText:(text:string)=>ipcRenderer.invoke('orchestra:shared-copy',text)}));
