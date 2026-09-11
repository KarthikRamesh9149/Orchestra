import {app,BrowserWindow,ipcMain,protocol,session,Menu,dialog,safeStorage,clipboard,shell} from 'electron';
import {openConfirmedExternal} from './external-link.js';
import {copyPlainText} from './clipboard.js';
import {join} from 'node:path';
import {commandSchema,isTrustedFrame} from './contracts.js';
import {assetResponse} from './assets.js';
import {loadVault} from './vault.js';
import {ProtectedSettingsStore,aiPreferencesSchema,protectedSettingsSchema} from './protected-settings.js';
import {HostClient} from './host-client.js';
import {Selections} from './selections.js';
import {scanSourceFolder} from './source-folder.js';
import {verifyNativeBundle} from './integrity.js';
import {localHttp} from './local-http.js';
import {downloadDocument,downloadPreflight} from './document-download.js';
import {runMcpRelay} from './mcp-relay.js';
import {createDesktopPairing,revokeDesktopPairing,pairInputSchema,pairingSetup} from './mcp-pairing.js';
import {connectSlack,refreshSlack,slackRequest} from './slack-oauth.js';
import {listSlackChannels,readSlackChannel} from './slack-sources.js';
import {z} from 'zod';

app.setName('Orchestra Desktop Internal');
const relay=process.argv.find(arg=>arg.startsWith('--orchestra-mcp='));
if(relay){void runMcpRelay(relay.slice('--orchestra-mcp='.length));}else{
protocol.registerSchemesAsPrivileged([{scheme:'orchestra',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const single=app.requestSingleInstanceLock();
let window:BrowserWindow|undefined;
let closing=false;
let slackAuthorization:AbortController|undefined;
const host=new HostClient(delta=>{if(window&&!window.isDestroyed())window.webContents.send('orchestra:delta',delta);});
const selections=new Selections();
if(!single)app.quit();
else {
 app.on('second-instance',()=>{window?.show();window?.focus();});
 app.on('before-quit',event=>{if(!closing){event.preventDefault();closing=true;slackAuthorization?.abort();void host.close().finally(()=>app.quit());}});
 app.on('window-all-closed',()=>app.quit());
 void app.whenReady().then(async()=>{
  const resources=app.isPackaged?join(process.resourcesPath,'runtime'):join(app.getAppPath(),'../../.desktop/runtime');
  await protocol.handle('orchestra',request=>new URL(request.url).pathname.startsWith('/v1/')?localHttp(request,host):assetResponse(join(resources,'ui'),request.url,request.method));
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  window=new BrowserWindow({width:1280,height:850,show:false,webPreferences:{preload:join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:!app.isPackaged}});
  let externalPrompt=false;
  const outside=async(url:string)=>{
   if(externalPrompt)return;externalPrompt=true;
   try{await openConfirmedExternal(url,async destination=>(await dialog.showMessageBox(window!,{type:'question',message:'Open this source in your browser?',detail:destination,buttons:['Cancel','Open browser'],defaultId:0,cancelId:0})).response===1,destination=>shell.openExternal(destination));}
   catch{await dialog.showMessageBox(window!,{type:'error',message:'The source could not be opened in your browser.'});}
   finally{externalPrompt=false;}
  };
  window.webContents.setWindowOpenHandler(({url})=>{void outside(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(!isTrustedFrame(url,true)){event.preventDefault();void outside(url);}});
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  const trusted=(event:Electron.IpcMainInvokeEvent)=>!!window&&event.sender===window.webContents&&event.senderFrame===window.webContents.mainFrame&&isTrustedFrame(event.senderFrame?.url??'',true);
  const settings=new ProtectedSettingsStore(join(app.getPath('userData'),'local-runtime'),safeStorage);
  let configuringAi=false;
  const reconcileSlackRevocation=async()=>{const state=await settings.read();if(!state.slackRevokedTeamId)return;const result=await host.request({operation:'desktop.slack.disconnect',teamId:state.slackRevokedTeamId});if(!result.ok)throw new Error('Local revocation pending');const {slackRevokedTeamId:_,...rest}=state;await settings.write(rest);};
  ipcMain.handle('orchestra:slack-channels',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current operation.'}};
   configuringAi=true;try{const state=await settings.read();if(!state.slack)throw new Error('Not connected');const credential=await refreshSlack(state.slack);await settings.write({...state,slack:credential});return {ok:true,data:await listSlackChannels(credential)};}
   catch{return {ok:false,error:{code:'slack_channels_failed',message:'Slack channels could not be listed. Check connectivity and account access, or reconnect.'}};}finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:slack-import',async(event,value:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const input=z.object({projectId:z.string().uuid(),channelId:z.string().regex(/^C[A-Z0-9]+$/)}).strict().safeParse(value);
   if(!input.success)return {ok:false,error:{code:'invalid_slack_selection',message:'Select a project and public channel.'}};
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current operation.'}};
   configuringAi=true;try{
    const projects=await host.request({operation:'workspace.list'});
    if(!projects.ok||!Array.isArray(projects.data)||!projects.data.some(project=>project.id===input.data.projectId))throw new Error('Project unavailable');
    const state=await settings.read();if(!state.slack)throw new Error('Not connected');const credential=await refreshSlack(state.slack);await settings.write({...state,slack:credential});
    const channel=(await listSlackChannels(credential)).find(item=>item.id===input.data.channelId);if(!channel)throw new Error('Channel unavailable');
    const consent=await dialog.showMessageBox(window!,{type:'question',message:`Import #${channel.name} into the selected local project?`,detail:'Read up to 200 messages and thread replies from the past 30 days. Messages become local evidence, not accepted truth. Configured AI may process the imported evidence. No other channels or direct messages are read.',buttons:['Cancel','Import selected channel'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const messages=await readSlackChannel(credential,channel);
    return await host.request({operation:'desktop.slack.ingest',projectId:input.data.projectId,teamId:credential.teamId,teamName:credential.teamName,channel,messages});
   }catch{return {ok:false,error:{code:'slack_import_failed',message:'Slack import was not confirmed. Check Memory before retrying. The snapshot is limited to 200 messages and 20 API pages; rate limits and unavailable channels are reported as failures, not empty imports.'}};}finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:slack-inspect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   try{const value=(await settings.read()).slack;return {ok:true,data:{connected:!!value,teamName:value?.teamName??null,teamId:value?.teamId??null,expiresAt:value?.expiresAt??null}};}
   catch{return {ok:false,error:{code:'slack_settings_unavailable',message:'Protected Slack settings could not be read.'}};}
  });
  ipcMain.handle('orchestra:slack-cancel',event=>{if(!trusted(event))throw new Error('Unauthorized frame');slackAuthorization?.abort();return {ok:true,data:{cancelled:true}};});
  ipcMain.handle('orchestra:slack-connect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native settings operation.'}};
   configuringAi=true;slackAuthorization=new AbortController();
   try{
    await reconcileSlackRevocation();
    if((await settings.read()).slack)return {ok:false,error:{code:'slack_already_connected',message:'Disconnect this installation before linking another Slack account.'}};
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Connect Slack to this Mac?',detail:'Slack will request read-only access to public channels. Tokens are encrypted with macOS protection, outside the web interface. No messages are imported until you explicitly select channels. This does not connect hosted Orchestra.',buttons:['Cancel','Continue to Slack'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const credential=await connectSlack(url=>shell.openExternal(url),slackAuthorization.signal);
    await settings.write({...await settings.read(),slack:credential});
    return {ok:true,data:{connected:true,teamName:credential.teamName,teamId:credential.teamId}};
   }catch{return {ok:false,error:{code:'slack_connect_failed',message:'Slack connection was not saved. It may have been cancelled, expired, blocked by the local callback port, or rejected by Slack. Retry from Orchestra.'}};}
   finally{slackAuthorization=undefined;configuringAi=false;}
  });
  ipcMain.handle('orchestra:slack-revoke',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native settings operation.'}};
   configuringAi=true;
   try{
    await reconcileSlackRevocation();
    const stored=await settings.read();if(!stored.slack)return {ok:true,data:{connected:false}};
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Disconnect desktop Slack?',detail:'Revoke this installation’s Slack token. Existing imported evidence is retained. Other Orchestra apps are not changed.',buttons:['Cancel','Disconnect'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const credential=await refreshSlack(stored.slack);
    // Persist replacement refresh token before any subsequent provider request.
    await settings.write({...stored,slack:credential});
    await slackRequest('auth.revoke',new URLSearchParams(),credential.accessToken);
    await settings.write({...await settings.read(),slack:null,slackRevokedTeamId:credential.teamId});await reconcileSlackRevocation();return {ok:true,data:{connected:false}};
   }catch{return {ok:false,error:{code:'slack_revoke_failed',message:'Slack revocation is not confirmed. Check your connection or revoke Orchestra Desktop in Slack, then retry.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:mcp-inspect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   try{const value=await settings.read();return {ok:true,data:(value.mcp??[]).map(({token:_,tokenId:__,...pairing})=>({...pairing,setup:pairingSetup(pairing.id,pairing.client,process.execPath,app.getPath('userData'))}))};}
   catch{return {ok:false,error:{code:'mcp_pairings_unavailable',message:'Protected MCP pairings could not be read.'}};}
  });
  ipcMain.handle('orchestra:mcp-pair',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const parsed=pairInputSchema.safeParse(input);
   if(!parsed.success)return {ok:false,error:{code:'invalid_pairing',message:'Choose a valid project, Preflight and agent.'}};
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native settings operation.'}};
   configuringAi=true;
   try{
    const consent=await dialog.showMessageBox(window!,{type:'question',message:`Pair ${parsed.data.client} with this Preflight?`,detail:'This grants seven-day access to the selected project context pack and permits recording linked Postflight evidence. It cannot approve product changes. Client settings are not modified by this button.',buttons:['Cancel','Create scoped pairing'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const pairing=await createDesktopPairing(parsed.data,host,settings);return {ok:true,data:{...pairing,setup:pairingSetup(pairing.id,pairing.client,process.execPath,app.getPath('userData'))}};
   }catch{return {ok:false,error:{code:'mcp_pairing_failed',message:'MCP pairing was not confirmed. Check the Preflight and local runtime.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:mcp-revoke',async(event,id:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native settings operation.'}};
   configuringAi=true;try{return {ok:true,data:await revokeDesktopPairing(id,host,settings)};}
   catch{return {ok:false,error:{code:'mcp_revoke_failed',message:'MCP revocation was not confirmed. Reopen the runtime and retry.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:ai-inspect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   try{const value=await settings.read();return {ok:true,data:{configured:!!value.ai,preferences:value.ai?.preferences??null}};}
   catch{return {ok:false,error:{code:'credentials_unavailable',message:'OS-protected AI settings could not be read.'}};}
  });
  ipcMain.handle('orchestra:ai-configure',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const parsed=aiPreferencesSchema.safeParse(input);
   if(!parsed.success)return {ok:false,error:{code:'invalid_ai_settings',message:'Choose valid AI settings and request limits.'}};
   if(configuringAi)return {ok:false,error:{code:'ai_settings_busy',message:'Finish the current AI configuration first.'}};
   configuringAi=true;
   try{
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Import an OpenAI key from your clipboard?',detail:'Copy a dedicated OpenAI API key first. It stays outside the web interface and is encrypted using OS protection. Orchestra will test model access, save it and restart. Later AI requests send relevant evidence to OpenAI and may incur charges on your API account. The request limit is not a dollar spending cap.',buttons:['Cancel','Test, save and restart'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const apiKey=(await clipboard.readText()).trim();
    const value=protectedSettingsSchema.parse({version:1,ai:{apiKey,preferences:parsed.data}});
    // Fixed HTTPS destination, no redirects, no prompt or project data in this test.
    for(const model of [parsed.data.generationModel,parsed.data.embeddingModel]){
     const response=await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`,{headers:{Authorization:`Bearer ${apiKey}`},redirect:'error',signal:AbortSignal.timeout(15000)});
     await response.body?.cancel();if(!response.ok)throw new Error('Model access failed');
    }
    await settings.write({...await settings.read(),ai:value.ai});
    if((await clipboard.readText()).trim()===apiKey)await clipboard.clear();
    app.relaunch();app.quit();return {ok:true,data:{restarting:true}};
   }catch{return {ok:false,error:{code:'ai_configuration_failed',message:'AI configuration was not confirmed. Check the clipboard key, model access, network and OS credential protection.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:ai-revoke',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'ai_settings_busy',message:'Finish the current AI configuration first.'}};
   configuringAi=true;
   try{
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Remove AI access from this installation?',detail:'Orchestra will remove its saved key, stop active AI work and restart offline. This does not delete your project evidence or revoke the key in your OpenAI account.',buttons:['Cancel','Remove and restart'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    await settings.write({...await settings.read(),ai:null});app.relaunch();app.quit();return {ok:true,data:{restarting:true}};
   }catch{return {ok:false,error:{code:'ai_revoke_failed',message:'AI access removal could not be confirmed.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:status',event=>{if(!trusted(event))throw new Error('Unauthorized frame');return host.status;});
  ipcMain.handle('orchestra:copy-text',(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   try{return {ok:true,data:copyPlainText(input,text=>clipboard.writeText(text))};}
   catch{return {ok:false,error:{code:'copy_failed',message:'The text could not be copied.'}};}
  });
  let downloading=false;
  ipcMain.handle('orchestra:download-preflight',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(downloading)return {ok:false,error:{code:'download_busy',message:'Finish the current download first.'}};
   downloading=true;
   try{return {ok:true,data:await downloadPreflight(input,host,async name=>{const result=await dialog.showSaveDialog(window!,{defaultPath:name,title:'Save Preflight context pack'});return result.canceled?undefined:result.filePath;})};}
   catch{return {ok:false,error:{code:'download_failed',message:'The context pack could not be saved. Check the destination and try again.'}};}
   finally{downloading=false;}
  });
  ipcMain.handle('orchestra:download-document',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(downloading)return {ok:false,error:{code:'download_busy',message:'Finish the current download first.'}};
   downloading=true;
   try{const data=await downloadDocument(input,host,async name=>{const selection=await dialog.showSaveDialog(window!,{defaultPath:name,title:'Save original document'});return selection.canceled?undefined:selection.filePath;});return {ok:true,data};}
   catch{return {ok:false,error:{code:'download_failed',message:'The original could not be saved. Check the destination and try again.'}};}
   finally{downloading=false;}
  });
  ipcMain.handle('orchestra:command',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');const command=commandSchema.safeParse(input);
   if(!command.success)return {ok:false,error:{code:'invalid_command',message:'Unsupported or invalid desktop command'}};
   if(command.data.operation==='evidence.upload'){
    try{return host.request(command.data,await selections.consume(command.data.selectionId));}catch{return {ok:false,error:{code:'selection_invalid',message:'The selected file changed or expired. Please select it again.'}};}
   }
   return host.request(command.data);
  });
  let selectingFolder=false;
  ipcMain.handle('orchestra:choose-folder',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(selectingFolder)return {ok:false,error:{code:'selection_busy',message:'Finish the current folder selection.'}};
   selectingFolder=true;
   try{
    const result=await dialog.showOpenDialog(window!,{title:'Choose a folder of project documents',properties:['openDirectory']});
    if(result.canceled)return {ok:true,data:{cancelled:true}};
    const scanned=await scanSourceFolder(result.filePaths[0]!);
    const files=[];for(const file of scanned.files)files.push({...await selections.add(file.path),name:file.name});
    return {ok:true,data:{files,skipped:scanned.skipped,totalBytes:scanned.totalBytes}};
   }catch{return {ok:false,error:{code:'folder_selection_failed',message:'Choose a smaller, readable folder: at most 100 supported documents, 50 MiB total and eight levels. Symbolic links are not supported.'}};}
   finally{selectingFolder=false;}
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
  await window.loadURL('orchestra://app/');window.show();
  try{
   await verifyNativeBundle(resources);
   const root=join(app.getPath('userData'),'local-runtime');const vault=await loadVault(root,safeStorage);
   const providers=await settings.read();
   host.start(join(resources,'native/node',process.platform==='win32'?'node.exe':'bin/node'),join(resources,'backend/dist/src/desktop/native-host.js'),{root,bundle:resources,vault,ai:providers.ai??undefined});
  }catch{host.status={state:'failed',message:'Local runtime could not start. OS credential protection and bundled runtime are required.'};}
 }).catch(()=>{app.exit(1);});
}
}
