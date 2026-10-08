import {app,BrowserWindow,ipcMain,protocol,session,Menu,dialog,safeStorage,clipboard,shell,powerMonitor} from 'electron';
import {openConfirmedExternal} from './external-link.js';
import {copyPlainText} from './clipboard.js';
import {join} from 'node:path';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {commandSchema,isTrustedFrame} from './contracts.js';
import {assetResponse} from './assets.js';
import {loadVault} from './vault.js';
import {ProtectedSettingsStore,aiPreferencesSchema} from './protected-settings.js';
import {AiSettingsSession,aiKeyImportSchema,desktopAiSearchStatus} from './ai-settings-session.js';
import {resolveDesktopGenerationEndpoint,resolveDesktopEmbeddingEndpoint} from '../../../src/desktop/ai-config.js';
import {testDesktopAiConnection} from '../../../src/desktop/ai-provider.js';
import {HostClient} from './host-client.js';
import {Selections} from './selections.js';
import {scanSourceFolder} from './source-folder.js';
import {verifyNativeBundle} from './integrity.js';
import {localHttp} from './local-http.js';
import {downloadDocument,downloadPreflight} from './document-download.js';
import {runMcpRelay} from './mcp-relay.js';
import {createDesktopPairing,revokeDesktopPairing,pairInputSchema,pairingSetup} from './mcp-pairing.js';
import {connectSlack,refreshSlack,revokeSlack} from './slack-oauth.js';
import {slackNativeCallback,SLACK_CALLBACK_SCHEME} from './slack-native-callback.js';
import {listSlackChannels,readSlackChannel} from './slack-sources.js';
import {connectGitHub,refreshGitHub,listGitHubRepositories} from './github-oauth.js';
import {readGitHubSnapshot} from './github-sources.js';
import {connectDrive,refreshDrive,revokeDrive,DriveAuthorizationError,parseDriveClient} from './drive-oauth.js';
import {readSelectedDriveFile} from './drive-sources.js';
import {rememberSyncTarget,refreshSelectedSource} from './connector-sync.js';
import {dueTarget,finishedTarget,type SyncTarget} from './connector-sync-state.js';
import {z} from 'zod';
import {SharedConnectionStore} from './shared-store.js';
import {registerSharedWindows} from './shared-windows.js';
import {registerProjectTransferUI} from './project-transfer-ui.js';

app.setName('Orchestra Desktop Internal');
const relay=process.argv.find(arg=>arg.startsWith('--orchestra-mcp='));
if(relay){void runMcpRelay(relay.slice('--orchestra-mcp='.length));}else{
protocol.registerSchemesAsPrivileged([{scheme:'orchestra',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const single=app.requestSingleInstanceLock();
let window:BrowserWindow|undefined;
let closing=false;
let shutdownComplete=false;
let slackAuthorization:AbortController|undefined;
let githubAuthorization:AbortController|undefined;
let driveAuthorization:AbortController|undefined;
const host=new HostClient(delta=>{if(window&&!window.isDestroyed())window.webContents.send('orchestra:delta',delta);});
const selections=new Selections();
if(!single)app.quit();
else {
 app.on('open-url',(event,url)=>{event.preventDefault();if(slackNativeCallback.accept(url)){window?.show();window?.focus();}});
 app.on('second-instance',()=>{window?.show();window?.focus();});
 app.on('before-quit',event=>{
  if(shutdownComplete)return;
  event.preventDefault();if(closing)return;closing=true;
  slackAuthorization?.abort();githubAuthorization?.abort();driveAuthorization?.abort();
  void (async()=>{
   // Normal close lets the renderer flush pending drafts before its engine stops.
   if(window&&!window.isDestroyed())await new Promise<void>(resolve=>{window!.once('closed',()=>resolve());window!.close();});
   await host.close();
  })().finally(()=>{shutdownComplete=true;app.quit();});
 });
 app.on('window-all-closed',()=>{if(!closing)app.quit();});
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
  registerProjectTransferUI('orchestra:local-transfer',event=>trusted(event)?{window:window!,send:request=>localHttp(request,host,true)}:undefined);
  const settings=new ProtectedSettingsStore(join(app.getPath('userData'),'local-runtime'),safeStorage);
  const aiDraft=new AiSettingsSession();
  const closeShared=registerSharedWindows({local:window,resources,preload:join(__dirname,'shared-preload.cjs'),store:new SharedConnectionStore(join(app.getPath('userData'),'shared-connections'),safeStorage),packaged:app.isPackaged});
  app.on('before-quit',closeShared);
  let configuringAi=false;
  let syncController:AbortController|undefined;
  const runRefresh=async(target:SyncTarget)=>{
   syncController=new AbortController();const timer=setTimeout(()=>syncController?.abort(),60000);let ok=false;
   try{return await refreshSelectedSource(target,settings,host,syncController.signal).then(result=>{ok=true;return result;});}
   finally{clearTimeout(timer);syncController=undefined;const state=await settings.read();await settings.write({...state,syncTargets:state.syncTargets?.map(t=>t.id===target.id?finishedTarget(t,ok,Date.now()):t)});}
  };
  const pumpRefresh=async(wake=false)=>{
   if(configuringAi||closing||host.status.state!=='ready')return;configuringAi=true;
   try{const state=await settings.read();if(wake)await settings.write({...state,syncTargets:state.syncTargets?.map(t=>t.enabled?{...t,nextAt:0}:t)});
    const current=await settings.read(),target=dueTarget(current.syncTargets??[],Date.now());if(target)await runRefresh(target);
   }catch{/* The persisted target status is authoritative; no secret-bearing provider logs. */}finally{configuringAi=false;}
  };
  const syncTimer=setInterval(()=>void pumpRefresh(),15000);syncTimer.unref();
  powerMonitor.on('resume',()=>void pumpRefresh(true));
  app.on('before-quit',()=>{clearInterval(syncTimer);syncController?.abort();});
  ipcMain.handle('orchestra:sync-inspect',async event=>{if(!trusted(event))throw new Error('Unauthorized frame');try{return {ok:true,data:{targets:(await settings.read()).syncTargets??[],running:!!syncController}};}catch{return {ok:false,error:{code:'sync_status_unavailable',message:'Source refresh status could not be read.'}};}});
  ipcMain.handle('orchestra:sync-cancel',event=>{if(!trusted(event))throw new Error('Unauthorized frame');syncController?.abort();return {ok:true,data:{cancelled:true}};});
  ipcMain.handle('orchestra:sync-update',async(event,value:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');const input=z.object({id:z.string().uuid(),action:z.enum(['enable','pause','remove','refresh'])}).strict().safeParse(value);
   if(!input.success)return {ok:false,error:{code:'invalid_sync_selection',message:'Choose a saved source selection.'}};
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'A native operation is active. Cancel refresh or retry when it finishes.'}};configuringAi=true;
   try{const state=await settings.read(),target=state.syncTargets?.find(t=>t.id===input.data.id);if(!target)throw new Error('Selection missing');
    if(input.data.action==='refresh')return {ok:true,data:await runRefresh(target)};
    if(input.data.action==='enable'){const consent=await dialog.showMessageBox(window!,{type:'question',message:'Enable background refresh for this selected source?',detail:`Only the saved ${target.provider} selection in its original local workspace will be refreshed. While Orchestra is open, changes are checked approximately every five minutes and after wake. Existing size and history bounds remain; failures are shown here. Newly imported content may be sent to your configured AI for indexing. Pause or remove this selection at any time.`,buttons:['Cancel','Enable refresh'],defaultId:0,cancelId:0});if(consent.response!==1)return {ok:true,data:{cancelled:true}};}
    await settings.write({...state,syncTargets:input.data.action==='remove'?state.syncTargets!.filter(t=>t.id!==target.id):state.syncTargets!.map(t=>t.id===target.id?{...t,enabled:input.data.action==='enable',nextAt:0}:t)});return {ok:true,data:{updated:true}};
   }catch{return {ok:false,error:{code:'source_refresh_failed',message:'Source refresh was not confirmed. Check its connection, permissions and snapshot limits, then retry.'}};}finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:github-inspect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   try{return {ok:true,data:{configured:!!(await settings.read()).github,authorizing:!!githubAuthorization}};}
   catch{return {ok:false,error:{code:'github_settings_unavailable',message:'Protected GitHub settings could not be read.'}};}
  });
  ipcMain.handle('orchestra:github-cancel',async event=>{if(!trusted(event))throw new Error('Unauthorized frame');githubAuthorization?.abort();return {ok:true,data:{cancelled:true}};});
  ipcMain.handle('orchestra:github-connect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native operation.'}};
   configuringAi=true;githubAuthorization=new AbortController();
   try{
    if((await settings.read()).github)throw new Error('Already configured');
    const credential=await connectGitHub(async code=>{
     const consent=await dialog.showMessageBox(window!,{type:'question',message:'Connect Orchestra Desktop to GitHub?',detail:`Your device code is ${code}. Only enter this code at github.com/login/device. The app requests read-only access to repositories you installed it on. No repository content is imported by sign-in.`,buttons:['Cancel','Copy code and open GitHub'],defaultId:0,cancelId:0});
     if(consent.response!==1)throw new Error('Cancelled');
     clipboard.writeText(code);await shell.openExternal('https://github.com/login/device');
    },githubAuthorization.signal);
    await settings.write({...await settings.read(),github:credential});
    return {ok:true,data:{configured:true}};
   }catch{return {ok:false,error:{code:'github_connect_failed',message:'GitHub sign-in was not saved. It may have been cancelled, expired or rejected. Retry from Orchestra.'}};}
   finally{githubAuthorization=undefined;configuringAi=false;}
  });
  ipcMain.handle('orchestra:github-repositories',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native operation.'}};
   configuringAi=true;
   try{const state=await settings.read();if(!state.github)throw new Error('Not configured');const credential=await refreshGitHub(state.github);await settings.write({...state,github:credential});return {ok:true,data:await listGitHubRepositories(credential)};}
   catch{return {ok:false,error:{code:'github_repositories_failed',message:'GitHub repositories could not be verified. Check connectivity, read-only installation permissions and account access.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:github-disconnect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native operation.'}};
   configuringAi=true;
   try{const consent=await dialog.showMessageBox(window!,{type:'question',message:'Remove GitHub credentials from this Mac?',detail:'This removes local credentials only. To revoke remote access, remove Orchestra Desktop under GitHub Settings → Applications → Authorized GitHub Apps. Existing evidence is retained.',buttons:['Cancel','Remove local credentials'],defaultId:0,cancelId:0});if(consent.response!==1)return {ok:true,data:{cancelled:true}};await settings.write({...await settings.read(),github:null});return {ok:true,data:{configured:false,remoteRevocationConfirmed:false}};}
   catch{return {ok:false,error:{code:'github_disconnect_failed',message:'Local removal could not be confirmed.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:github-import',async(event,value:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const input=z.object({projectId:z.string().uuid(),repositoryId:z.number().int().positive()}).strict().safeParse(value);
   if(!input.success)return {ok:false,error:{code:'invalid_github_selection',message:'Choose a workspace and authorized repository.'}};
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native operation.'}};
   configuringAi=true;
   try{
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Import selected GitHub repository evidence?',detail:'Read-only snapshot of pull-request descriptions and commit messages, up to 200 of each. Text excerpts are limited to 4,000 characters with credential-pattern redaction. No source files or provider writes. Saved evidence may be sent to your configured AI when you ask a question. It is not accepted product truth.',buttons:['Cancel','Import evidence'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const state=await settings.read();if(!state.github)throw new Error('GitHub not connected');
    const credential=await refreshGitHub(state.github);await settings.write({...state,github:credential});
    const snapshot=await readGitHubSnapshot(credential,input.data.repositoryId);
    const imported=await host.request({operation:'desktop.github.ingest',projectId:input.data.projectId,...snapshot});
    if(imported.ok)await rememberSyncTarget(settings,{provider:'github',projectId:input.data.projectId,resourceIds:[String(input.data.repositoryId)]});return imported;
   }catch{return {ok:false,error:{code:'github_import_failed',message:'GitHub import was not confirmed. Check workspace access, connectivity and repository permissions. Snapshots exceeding 200 pull requests or 200 commits fail rather than silently dropping evidence.'}};}
   finally{configuringAi=false;}
  });
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
    const imported=await host.request({operation:'desktop.slack.ingest',projectId:input.data.projectId,teamId:credential.teamId,teamName:credential.teamName,channel,messages});
    if(imported.ok)await rememberSyncTarget(settings,{provider:'slack',projectId:input.data.projectId,resourceIds:[channel.id],teamId:credential.teamId});return imported;
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
    if(!app.isPackaged||!app.setAsDefaultProtocolClient(SLACK_CALLBACK_SCHEME))throw new Error('Native Slack callback registration unavailable');
    const credential=await connectSlack(url=>shell.openExternal(url),slackAuthorization.signal);
    await settings.write({...await settings.read(),slack:credential});
    return {ok:true,data:{connected:true,teamName:credential.teamName,teamId:credential.teamId}};
   }catch{return {ok:false,error:{code:'slack_connect_failed',message:'Slack connection was not saved. Open the packaged desktop app and retry; authorization may have expired, been declined, or the browser could not return to Orchestra.'}};}
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
    const credential=stored.slack;
    await revokeSlack(credential);
    await settings.write({...await settings.read(),slack:null,slackRevokedTeamId:credential.teamId});await reconcileSlackRevocation();return {ok:true,data:{connected:false}};
   }catch{return {ok:false,error:{code:'slack_revoke_failed',message:'Slack revocation is not confirmed. Check your connection or revoke Orchestra Desktop in Slack, then retry.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:drive-inspect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   try{const {drive,driveClient}=await settings.read();return {ok:true,data:{connected:!!drive,clientConfigured:!!driveClient,selectedFileCount:drive?.fileIds.length??0}};}
   catch{return {ok:false,error:{code:'drive_settings_unavailable',message:'Protected Google Drive settings could not be read.'}};}
  });
  ipcMain.handle('orchestra:drive-cancel',event=>{if(!trusted(event))throw new Error('Unauthorized frame');driveAuthorization?.abort();return {ok:true};});
  ipcMain.handle('orchestra:drive-configure',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native settings operation.'}};
   configuringAi=true;
   try{
    const state=await settings.read();if(state.drive)throw new Error('Revoke the existing Drive connection before replacing its client.');
    const selected=await dialog.showOpenDialog(window!,{title:'Import your Google Desktop OAuth client JSON',properties:['openFile'],filters:[{name:'Google Desktop client',extensions:['json']}]});
    if(selected.canceled)return {ok:true,data:{cancelled:true}};
    const file=await open(selected.filePaths[0]!,constants.O_RDONLY|constants.O_NOFOLLOW);
    let client;
    try{const stat=await file.stat();if(!stat.isFile()||stat.size>32768)throw new Error('Invalid client file');const bytes=Buffer.alloc(32769);const read=await file.read(bytes,0,bytes.length,0);if(read.bytesRead>32768)throw new Error('Client file too large');client=parseDriveClient(bytes.subarray(0,read.bytesRead).toString('utf8'));}
    finally{await file.close();}
    await settings.write({...state,driveClient:client});return {ok:true,data:{clientConfigured:true}};
   }catch{return {ok:false,error:{code:'drive_configuration_failed',message:'Import a valid Google Desktop client JSON file. Web clients are not supported. Revoke any existing Drive connection before replacing its client.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:drive-connect',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native settings operation.'}};
   configuringAi=true;driveAuthorization=new AbortController();
   try{
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Select Google Drive files for Orchestra?',detail:'Google opens in your browser. Only files you select are authorized. Google’s selected-file scope also permits editing those files, but Orchestra uses read operations only. Credentials are encrypted on this Mac. Selecting files does not import their content.',buttons:['Cancel','Open Google file selection'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const client=(await settings.read()).driveClient;if(!client)throw new DriveAuthorizationError('configuration');
    const credential=await connectDrive(url=>shell.openExternal(url),driveAuthorization.signal,fetch,client);
    await settings.write({...await settings.read(),drive:credential});return {ok:true,data:{connected:true,selectedFileCount:credential.fileIds.length}};
   }catch(error){return {ok:false,error:{code:error instanceof DriveAuthorizationError?`drive_${error.reason}_failed`:'drive_authorization_failed',message:error instanceof DriveAuthorizationError?error.message:'Google Drive authorization was not confirmed. Check the browser, selected files and desktop OAuth configuration, then retry.'}};}
   finally{driveAuthorization=undefined;configuringAi=false;}
  });
  ipcMain.handle('orchestra:drive-revoke',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native settings operation.'}};
   configuringAi=true;
   try{
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Revoke Orchestra Desktop’s Google Drive access?',detail:'This revokes the desktop Google grant and removes this Mac’s saved token. Existing imported evidence is retained. Other installations using this desktop grant may need to reconnect.',buttons:['Cancel','Revoke Drive access'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const state=await settings.read();if(state.drive)await revokeDrive(state.drive);await settings.write({...state,drive:null});return {ok:true,data:{connected:false,selectedFileCount:0}};
   }catch{return {ok:false,error:{code:'drive_revoke_failed',message:'Google Drive revocation was not confirmed. Reconnect to the network and retry.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:drive-import',async(event,value:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const project=z.string().uuid().safeParse(value);if(!project.success)return {ok:false,error:{code:'invalid_workspace',message:'Choose a workspace before importing.'}};
   if(configuringAi)return {ok:false,error:{code:'settings_busy',message:'Finish the current native operation.'}};
   configuringAi=true;driveAuthorization=new AbortController();let saved=0;
   try{
    const workspaces=await host.request({operation:'workspace.list'});
    if(!workspaces.ok||!Array.isArray(workspaces.data)||!workspaces.data.some(p=>p.id===project.data))throw new Error('Unauthorized workspace');
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Import selected Drive files into this workspace?',detail:'Reads only files explicitly selected in Google Picker. Supported documents are limited to 10 MB each. Files are saved privately on this Mac and processed into Memory, not approved product truth. Their content may be sent to your configured AI provider for indexing and answers. Cancelling stops remaining downloads; already saved files are retained.',buttons:['Cancel','Import selected files'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    let state=await settings.read();if(!state.drive)throw new Error('Drive not connected');
    const files=[];
    for(const fileId of state.drive.fileIds){
     driveAuthorization.signal.throwIfAborted();
     const credential=await refreshDrive(state.drive!);state={...state,drive:credential};await settings.write(state);
     const file=await readSelectedDriveFile(credential,fileId,driveAuthorization.signal);
     driveAuthorization.signal.throwIfAborted();
     const result=await host.request({operation:'desktop.drive.ingest',projectId:project.data,fileId:file.fileId,name:file.name,mimeType:file.mimeType,modifiedTime:file.modifiedTime,version:file.version,contentType:file.contentType as 'text/plain',fileName:file.fileName,base64:file.bytes.toString('base64')});
     if(!result.ok)throw new Error('Persistence not confirmed');files.push(result.data);saved++;
    }
    await rememberSyncTarget(settings,{provider:'drive',projectId:project.data,resourceIds:state.drive!.fileIds});return {ok:true,data:{saved,files}};
   }catch{return {ok:false,error:{code:'drive_import_failed',message:`Drive import stopped; ${saved} file(s) were confirmed saved. Check connectivity, selected-file access and supported file types, then retry. Already saved files are retained and retries do not create duplicate documents.`}};}
   finally{driveAuthorization=undefined;configuringAi=false;}
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
   try{const [value,runtime]=await Promise.all([settings.read(),host.request({operation:'local.bootstrap'})]);return {ok:true,data:{configured:!!value.ai,preferences:value.ai?.preferences??null,...desktopAiSearchStatus(runtime)}};}
   catch{return {ok:false,error:{code:'credentials_unavailable',message:'OS-protected AI settings could not be read.'}};}
  });
  ipcMain.handle('orchestra:ai-discard-draft',(event,target:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'ai_settings_busy',message:'Finish the current native operation.'}};
   const parsed=z.enum(['generation','embedding']).optional().safeParse(target);
   if(!parsed.success)return {ok:false,error:{code:'invalid_ai_target',message:'Choose a valid credential target.'}};
   aiDraft.clear(parsed.data);return {ok:true,data:{discarded:true}};
  });
  ipcMain.handle('orchestra:ai-import-key',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const parsed=aiKeyImportSchema.safeParse(input);
   if(!parsed.success)return {ok:false,error:{code:'invalid_ai_settings',message:'Select a provider and valid HTTPS endpoint before adding its API key.'}};
   if(configuringAi)return {ok:false,error:{code:'ai_settings_busy',message:'Finish the current native operation.'}};
   configuringAi=true;
   try{
    await settings.read(); // Require working OS protection before reading a key.
    const {target,preferences}=parsed.data;
    const provider=target==='generation'?(preferences.provider??'openai'):(preferences.embeddingProvider??((preferences.provider??'openai')==='openai'?'openai':'none'));
    if(provider==='none')return {ok:false,error:{code:'embedding_disabled',message:'Select an embedding provider first.'}};
    const destination=target==='generation'?resolveDesktopGenerationEndpoint(preferences):(provider==='openai'?'https://api.openai.com/v1/embeddings':`${preferences.embeddingBaseUrl!.replace(/\/$/,'')}/embeddings`);
    const consent=await dialog.showMessageBox(window!,{type:'question',message:`Add ${target==='generation'?'an API key':'an embedding API key'} for ${provider}?`,detail:`Copy a dedicated ${provider} API key first. Intended network destination: ${destination}\n\nThe key is read directly from your clipboard in the native app, never the web interface. It stays in native memory until you test and save; saved keys use OS encryption. No network request is made by this import. The copied key will be cleared from the clipboard.`,buttons:['Cancel','Import API key'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    const apiKey=(await clipboard.readText()).trim();
    aiDraft.importKey(target,preferences,apiKey);
    if((await clipboard.readText()).trim()===apiKey)await clipboard.clear();
    return {ok:true,data:{imported:true}};
   }catch{return {ok:false,error:{code:'ai_key_import_failed',message:'API key import was not confirmed. Copy a valid provider key and check OS credential protection.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:ai-test',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const parsed=aiPreferencesSchema.safeParse(input);
   if(!parsed.success)return {ok:false,error:{code:'invalid_ai_settings',message:'Choose valid AI settings and request limits.'}};
   if(configuringAi)return {ok:false,error:{code:'ai_settings_busy',message:'Finish the current AI configuration first.'}};
   configuringAi=true;
   try{
    const saved=(await settings.read()).ai;
    const config=aiDraft.configuration(parsed.data,saved);
    const embeddingDestination=resolveDesktopEmbeddingEndpoint(config);
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Test connection to your selected AI provider?',detail:`Generation: ${resolveDesktopGenerationEndpoint(parsed.data)}\nModel: ${parsed.data.generationModel}\nEmbeddings: ${embeddingDestination??'Disabled; lexical evidence search only'}\n\nThis sends a small synthetic test, never project evidence. It makes ${embeddingDestination?'up to two requests':'one request'} and may incur API charges. Configuration tests are separate from your saved daily request allowance. Passing confirms this small test, not universal model compatibility. Nothing is saved yet.`,buttons:['Cancel','Test connection'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    await aiDraft.test(parsed.data,saved,testDesktopAiConnection);
    return {ok:true,data:{tested:true}};
   }catch{return {ok:false,error:{code:'ai_test_failed',message:'Connection test failed. Check that a key was added for each selected provider, the endpoint and model are compatible, and the API account has access and credit.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:ai-configure',async(event,input:unknown)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   const parsed=aiPreferencesSchema.safeParse(input);
   if(!parsed.success)return {ok:false,error:{code:'invalid_ai_settings',message:'Choose valid AI settings and request limits.'}};
   if(configuringAi)return {ok:false,error:{code:'ai_settings_busy',message:'Finish the current AI configuration first.'}};
   configuringAi=true;
   try{
    const state=await settings.read(),ai=aiDraft.confirmed(parsed.data,state.ai);
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Save AI settings and restart Orchestra?',detail:`Generation: ${resolveDesktopGenerationEndpoint(parsed.data)}\nEmbeddings: ${resolveDesktopEmbeddingEndpoint(ai)??'Disabled; lexical evidence search only'}\n\nRelevant project evidence will be sent to these destinations using your API accounts. Keys are encrypted on this Mac. Usage limits are request ceilings, not dollar spending caps. An embedding identity change safely disables incompatible existing vectors until reindexing.`,buttons:['Cancel','Save and restart'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    await settings.write({...state,ai:aiDraft.confirmed(parsed.data,state.ai)});aiDraft.clear();
    app.relaunch();app.quit();return {ok:true,data:{restarting:true}};
   }catch{return {ok:false,error:{code:'ai_configuration_failed',message:'AI settings were not saved. Test the current settings again, then save within 15 minutes. Check OS credential protection if the problem continues.'}};}
   finally{configuringAi=false;}
  });
  ipcMain.handle('orchestra:ai-revoke',async event=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(configuringAi)return {ok:false,error:{code:'ai_settings_busy',message:'Finish the current AI configuration first.'}};
   configuringAi=true;
   try{
    const consent=await dialog.showMessageBox(window!,{type:'question',message:'Remove AI access from this installation?',detail:'Orchestra will remove its saved generation and embedding keys, stop active AI work and restart offline. This does not delete your project evidence or revoke the keys in your provider accounts.',buttons:['Cancel','Remove and restart'],defaultId:0,cancelId:0});
    if(consent.response!==1)return {ok:true,data:{cancelled:true}};
    await settings.write({...await settings.read(),ai:null});aiDraft.clear();app.relaunch();app.quit();return {ok:true,data:{restarting:true}};
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
  const chooseSourceFolder=async(event:Electron.IpcMainInvokeEvent,repository:boolean)=>{
   if(!trusted(event))throw new Error('Unauthorized frame');
   if(selectingFolder)return {ok:false,error:{code:'selection_busy',message:'Finish the current folder selection.'}};
   selectingFolder=true;
   try{
    const result=await dialog.showOpenDialog(window!,{title:repository?'Choose a Git working tree to preview':'Choose a folder of project documents',properties:['openDirectory']});
    if(result.canceled)return {ok:true,data:{cancelled:true}};
    const scanned=await scanSourceFolder(result.filePaths[0]!,repository);
    const files=[];for(const file of scanned.files)files.push({...await selections.add(file.path,repository),name:file.name});
    return {ok:true,data:{files,skipped:scanned.skipped,totalBytes:scanned.totalBytes}};
   }catch{return {ok:false,error:{code:'folder_selection_failed',message:'Choose a smaller, readable folder: at most 100 supported documents, 50 MiB total and eight levels. Symbolic links are not supported.'}};}
   finally{selectingFolder=false;}
  };
  ipcMain.handle('orchestra:choose-folder',event=>chooseSourceFolder(event,false));
  ipcMain.handle('orchestra:choose-repository',event=>chooseSourceFolder(event,true));
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
