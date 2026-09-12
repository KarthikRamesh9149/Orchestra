import {BrowserWindow,session,ipcMain,dialog,shell,clipboard,powerMonitor} from 'electron';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {sharedOriginSchema} from '../../../src/desktop/shared-contract.js';
import {SharedHttp,inspectSharedServer,type SavedConnection} from './shared-http.js';
import {SharedConnectionStore} from './shared-store.js';
import {assetResponse} from './assets.js';
import {isTrustedFrame} from './contracts.js';
import {openConfirmedExternal} from './external-link.js';
import {copyPlainText} from './clipboard.js';
import {authorizeSharedDownload} from './shared-download.js';

const connectSchema=z.object({name:z.string().trim().min(1).max(100),origin:sharedOriginSchema}).strict();
export function registerSharedWindows(options:{local:BrowserWindow;resources:string;preload:string;store:SharedConnectionStore;packaged:boolean}){
 const windows=new Map<string,{window:BrowserWindow;transport:SharedHttp}>();
 const resumed=()=>{for(const row of windows.values())row.transport.revalidate();};
 powerMonitor.on('resume',resumed);
 const trustedLocal=(event:Electron.IpcMainInvokeEvent)=>event.sender===options.local.webContents&&event.senderFrame===options.local.webContents.mainFrame&&isTrustedFrame(event.senderFrame?.url??'',true);
 const trustedShared=(event:Electron.IpcMainInvokeEvent)=>[...windows.values()].find(row=>row.window.webContents===event.sender&&event.senderFrame===row.window.webContents.mainFrame&&isTrustedFrame(event.senderFrame?.url??'',true));
 let changing=false;
 async function open(connection:SavedConnection){
  const existing=windows.get(connection.id);if(existing&&!existing.window.isDestroyed()){existing.window.show();existing.window.focus();return;}
  // No persist: prefix: cookies, localStorage, HTTP caches and drafts remain memory-only.
  const isolated=session.fromPartition('orchestra-shared-'+connection.id+'-'+randomUUID(),{cache:false});
  isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));isolated.setPermissionCheckHandler(()=>false);
  const transport=new SharedHttp(connection,options.store.grants(connection.id),fetch,{
   onOffline:value=>{if(!window.isDestroyed())window.webContents.send('orchestra:shared-offline',value);},
   invalidateView:()=>{if(!window.isDestroyed())window.webContents.reload();}
  });
  isolated.protocol.handle('orchestra',request=>new URL(request.url).pathname.startsWith('/v1/')?transport.handle(request):assetResponse(join(options.resources,'ui'),request.url,request.method));
  const title=`Orchestra · ${connection.name} · ${connection.origin}`;
  const window=new BrowserWindow({title,width:1280,height:850,show:false,webPreferences:{session:isolated,preload:options.preload,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:!options.packaged,additionalArguments:['--orchestra-shared='+encodeURIComponent(JSON.stringify(connection))]}});
  windows.set(connection.id,{window,transport});
  window.on('page-title-updated',event=>event.preventDefault());
  let externalPrompt=false;
  const outside=async(url:string)=>{if(externalPrompt)return;externalPrompt=true;try{await openConfirmedExternal(url,async destination=>(await dialog.showMessageBox(window,{type:'question',message:'Open this source in your browser?',detail:destination,buttons:['Cancel','Open browser'],defaultId:0,cancelId:0})).response===1,destination=>shell.openExternal(destination));}finally{externalPrompt=false;}};
  window.webContents.setWindowOpenHandler(({url})=>{void outside(url).catch(()=>{});return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(!isTrustedFrame(url,true)){event.preventDefault();void outside(url).catch(()=>{});}});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  isolated.on('will-download',(event,item,contents)=>{authorizeSharedDownload(event,item,connection.origin,contents===window.webContents);});
  window.on('closed',()=>{transport.close();windows.delete(connection.id);void isolated.clearStorageData();void isolated.clearCache();isolated.protocol.unhandle('orchestra');});
  await window.loadURL('orchestra://app/');window.show();
 }
 ipcMain.handle('orchestra:shared-list',async event=>{if(!trustedLocal(event))throw new Error('Unauthorized frame');try{return {ok:true,data:await options.store.list()};}catch{return {ok:false,error:{code:'shared_store_unavailable',message:'Protected server settings could not be read.'}};}});
 ipcMain.handle('orchestra:shared-connect',async(event,value:unknown)=>{
  if(!trustedLocal(event))throw new Error('Unauthorized frame');const parsed=connectSchema.safeParse(value);
  if(!parsed.success)return {ok:false,error:{code:'invalid_server',message:'Enter a name and the server HTTPS origin, without a path or credentials.'}};
  if(changing)return {ok:false,error:{code:'shared_busy',message:'Finish the current server operation.'}};changing=true;
  try{
   const decision=await dialog.showMessageBox(options.local,{type:'question',message:'Connect to this team server?',detail:`${parsed.data.name}\n${parsed.data.origin}\n\nThis server owns shared accounts, files and approvals. Sign in with an account for this server. Your local workspace and provider credentials will not be sent. Offline caching is off by default. Your server operator may allow a bounded, expiring read-only copy of document metadata in this window's memory.`,buttons:['Cancel','Check server and connect'],defaultId:0,cancelId:0});
   if(decision.response!==1)return {ok:true,data:{cancelled:true}};
   const manifest=await inspectSharedServer(parsed.data.origin),connection={...parsed.data,id:randomUUID(),serverId:manifest.serverId};
   await options.store.add(connection);await open(connection);return {ok:true,data:{connected:true}};
  }catch{return {ok:false,error:{code:'shared_connect_failed',message:'Connection was not completed. The server must have trusted HTTPS, compatible desktop support and a stable server identity. If it was saved, try Open below.'}};}finally{changing=false;}
 });
 ipcMain.handle('orchestra:shared-open',async(event,value:unknown)=>{
  if(!trustedLocal(event))throw new Error('Unauthorized frame');const parsed=z.string().uuid().safeParse(value);if(!parsed.success)return {ok:false,error:{message:'Choose a saved server.'}};
  try{const connection=(await options.store.list()).find(row=>row.id===parsed.data);if(!connection)throw new Error('Unknown connection');await open(connection);return {ok:true,data:{opened:true}};}catch{return {ok:false,error:{message:'The saved server could not be opened.'}};}
 });
 ipcMain.handle('orchestra:shared-remove',async(event,value:unknown)=>{
  if(!trustedLocal(event))throw new Error('Unauthorized frame');const parsed=z.string().uuid().safeParse(value);if(!parsed.success)return {ok:false,error:{message:'Choose a saved server.'}};
  if(changing)return {ok:false,error:{message:'Finish the current server operation.'}};changing=true;
  try{
   const connection=(await options.store.list()).find(row=>row.id===parsed.data);if(!connection)throw new Error('Unknown connection');
   const decision=await dialog.showMessageBox(options.local,{type:'question',message:'Sign out and remove this server?',detail:`${connection.origin}\nLocal workspace data is unaffected. Shared data remains on the server. An active saved session must be revoked successfully before removal.`,buttons:['Cancel','Sign out and remove'],defaultId:0,cancelId:0});if(decision.response!==1)return {ok:true,data:{cancelled:true}};
   windows.get(connection.id)?.window.close();
   const grants=options.store.grants(connection.id);if(await grants.read()){
    const transport=new SharedHttp(connection,grants);try{const result=await transport.handle(new Request('orchestra://app/v1/auth/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));if(!result.ok)throw new Error('Sign-out not confirmed');}finally{transport.close();}
   }
   await options.store.remove(connection.id);return {ok:true,data:{removed:true}};
  }catch{return {ok:false,error:{message:'Removal was not confirmed. Reconnect and sign out successfully before removing the server.'}};}finally{changing=false;}
 });
 ipcMain.handle('orchestra:shared-close',event=>{const row=trustedShared(event);if(!row)throw new Error('Unauthorized frame');options.local.show();options.local.focus();row.window.close();});
 ipcMain.handle('orchestra:shared-copy',async(event,value:unknown)=>{if(!trustedShared(event))throw new Error('Unauthorized frame');try{copyPlainText(value,text=>clipboard.writeText(text));return {ok:true,data:{copied:true}};}catch{return {ok:false,error:{message:'Text could not be copied.'}};}});
 return ()=>{powerMonitor.removeListener('resume',resumed);for(const row of windows.values()){row.transport.close();row.window.close();}};
}
