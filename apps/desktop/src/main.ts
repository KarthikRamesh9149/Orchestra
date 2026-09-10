import {app,BrowserWindow,ipcMain,protocol,session,Menu,dialog,safeStorage} from 'electron';
import {join} from 'node:path';
import {commandSchema,isTrustedFrame} from './contracts.js';
import {assetResponse} from './assets.js';
import {loadVault} from './vault.js';
import {HostClient} from './host-client.js';
import {Selections} from './selections.js';
import {verifyNativeBundle} from './integrity.js';

protocol.registerSchemesAsPrivileged([{scheme:'orchestra',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.setName('Orchestra Desktop Internal');
const single=app.requestSingleInstanceLock();
let window:BrowserWindow|undefined;
let closing=false;
const host=new HostClient(delta=>{if(window&&!window.isDestroyed())window.webContents.send('orchestra:delta',delta);});
const selections=new Selections();
if(!single)app.quit();
else {
 app.on('second-instance',()=>{window?.show();window?.focus();});
 app.on('before-quit',event=>{if(!closing){event.preventDefault();closing=true;void host.close().finally(()=>app.quit());}});
 app.on('window-all-closed',()=>app.quit());
 void app.whenReady().then(async()=>{
  const resources=app.isPackaged?join(process.resourcesPath,'runtime'):join(app.getAppPath(),'../../.desktop/runtime');
  await protocol.handle('orchestra',request=>assetResponse(join(resources,'ui'),request.url,request.method));
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  window=new BrowserWindow({width:1280,height:850,show:false,webPreferences:{preload:join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:!app.isPackaged}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!isTrustedFrame(url,true))event.preventDefault();});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  const trusted=(event:Electron.IpcMainInvokeEvent)=>!!window&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&isTrustedFrame(event.senderFrame?.url??'',true);
  ipcMain.handle('orchestra:status',event=>{if(!trusted(event))throw new Error('Unauthorized frame');return host.status;});
  ipcMain.handle('orchestra:command',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');const command=commandSchema.safeParse(input);
   if(!command.success)return {ok:false,error:{code:'invalid_command',message:'Unsupported or invalid desktop command'}};
   if(command.data.operation==='evidence.upload'){
    try{return host.request(command.data,await selections.consume(command.data.selectionId));}catch{return {ok:false,error:{code:'selection_invalid',message:'The selected file changed or expired. Please select it again.'}};}
   }
   return host.request(command.data);
  });
  ipcMain.handle('orchestra:choose-evidence',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const result=await dialog.showOpenDialog(window!,{properties:['openFile'],filters:[{name:'Evidence',extensions:['pdf','docx','txt','md','csv','xlsx']}]});
   if(result.canceled)return {ok:true,data:{cancelled:true}};
   try{return {ok:true,data:await selections.add(result.filePaths[0]!) };}catch{return {ok:false,error:{code:'selection_invalid',message:'Select a supported regular file smaller than 50 MiB'}};}
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'Orchestra',submenu:[{label:'Runtime status',click:()=>{void dialog.showMessageBox(window!,{message:host.status.message});}},{label:'Create local workspace',click:async()=>{const result=await host.request({operation:'workspace.create',name:'Local workspace'});await dialog.showMessageBox(window!,{message:result.ok?'Workspace saved locally':result.error.message});}},{role:'quit'}]},
   {label:'Edit',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
   {label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'}]}
  ]));
  await window.loadURL('orchestra://app/index.html');window.show();
  try{
   await verifyNativeBundle(resources);
   const root=join(app.getPath('userData'),'local-runtime');const vault=await loadVault(root,safeStorage);
   host.start(join(resources,'native/node',process.platform==='win32'?'node.exe':'bin/node'),join(resources,'backend/dist/src/desktop/native-host.js'),{root,bundle:resources,vault});
  }catch{host.status={state:'failed',message:'Local runtime could not start. OS credential protection and bundled runtime are required.'};}
 }).catch(()=>{app.exit(1);});
}
