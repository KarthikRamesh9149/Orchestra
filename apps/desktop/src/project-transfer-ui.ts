import {ipcMain,dialog,clipboard,type BrowserWindow} from 'electron';
import {constants} from 'node:fs';
import {open,link,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {NativeProjectTransfer} from './project-transfer.js';
import {nativeArchiveLimit,transferPath} from '../../../src/desktop/transfer-contract.js';
type Target={window:BrowserWindow;send(request:Request):Promise<Response>};
export function registerProjectTransferUI(channel:string,resolve:(event:Electron.IpcMainInvokeEvent)=>Target|undefined){
 const controllers=new Map<number,NativeProjectTransfer>();
 for(const action of ['export','preview','commit'] as const)ipcMain.handle(`${channel}:${action}`,async(event,value:unknown)=>{
  const target=resolve(event);if(!target)throw new Error('Unauthorized frame');
  let controller=controllers.get(event.sender.id);
  if(!controller){
   const window=target.window;
   controller=new NativeProjectTransfer({
    send:async(action,projectId,body)=>{
     const response=await target.send(new Request('orchestra://app'+transferPath(projectId,action),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
     if(!response.ok){await response.body?.cancel();throw new Error('Server could not confirm the transfer. Check access, passphrase, archive size and destination; nothing should be assumed saved.');}
     const reader=response.body?.getReader();if(!reader)throw new Error('No response');let size=0;const chunks:Buffer[]=[];
     try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24*1024*1024)throw new Error('Response too large');chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8')).data;}
     finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    },
    choose:async()=>{
     const choice=await dialog.showOpenDialog(window,{title:'Choose encrypted Orchestra core transfer',properties:['openFile'],filters:[{name:'Orchestra transfer',extensions:['orchestra-transfer']}]});
     if(choice.canceled||!choice.filePaths[0])return;
     const file=await open(choice.filePaths[0],constants.O_RDONLY|constants.O_NOFOLLOW);
     try{const stat=await file.stat();if(!stat.isFile()||stat.size>nativeArchiveLimit)throw new Error('Choose a regular archive up to 16 MiB.');return await file.readFile();}finally{await file.close();}
    },
    passphrase:async exporting=>{
     const choice=await dialog.showMessageBox(window,{type:'question',message:exporting?'Create an encrypted core transfer?':'Read the archive passphrase from your clipboard?',detail:exporting
      ?'Documents and accepted product history may contain sensitive content. Private chats, credentials and other workflows are excluded. Orchestra will copy a new passphrase to your clipboard. Store it in your password manager before continuing; losing it makes this archive unreadable. Other apps may access the clipboard.'
      :'Copy the archive passphrase from your password manager first. Orchestra reads it only after you approve, clears it from the clipboard, and keeps it in native memory for at most five minutes. It will be sent over the selected server’s protected connection, never to the product page.',buttons:['Cancel',exporting?'Generate and copy passphrase':'Read passphrase'],defaultId:0,cancelId:0});
     if(choice.response!==1)return;
     const passphrase=exporting?randomBytes(32).toString('base64url'):await clipboard.readText();
     if(passphrase.length<16||passphrase.length>1024)throw new Error('The clipboard must contain only the archive passphrase (16–1024 characters).');
     if(exporting){await clipboard.writeText(passphrase);const saved=await dialog.showMessageBox(window,{type:'question',message:'Save this passphrase before exporting',detail:'The new passphrase is on your clipboard. Save it in your password manager now. It is not stored in Orchestra.',buttons:['Cancel','I saved it; export archive'],defaultId:0,cancelId:0});if(await clipboard.readText()===passphrase)await clipboard.clear();if(saved.response!==1)return;}
     else if(await clipboard.readText()===passphrase)await clipboard.clear();
     return passphrase;
    },
    save:async bytes=>{
     const choice=await dialog.showSaveDialog(window,{title:'Save encrypted project core',defaultPath:'Orchestra-core.orchestra-transfer'});if(choice.canceled||!choice.filePath)return {cancelled:true};
     const temp=join(dirname(choice.filePath),'.orchestra-transfer-'+randomUUID()),file=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
     try{await file.writeFile(bytes);await file.sync();await file.close();await link(temp,choice.filePath);return {saved:true};}
     finally{await file.close().catch(()=>{});await unlink(temp).catch(()=>{});}
    },
    confirm:async projectId=>(await dialog.showMessageBox(window,{type:'warning',message:'Import historical accepted truth into this empty workspace?',detail:`Destination ID: ${projectId}\nReview all identity mappings in Orchestra first. Existing data is never overwritten. This imports historical approval, not new provider certification. Reconnect integrations separately.`,buttons:['Cancel','Import reviewed core'],defaultId:0,cancelId:0})).response===1
   });
   controllers.set(event.sender.id,controller);const id=event.sender.id;
   window.once('closed',()=>{controllers.get(id)?.close();controllers.delete(id);});
  }
  try{return {ok:true,data:await controller[action](value as never)};}catch{return {ok:false,error:{code:'transfer_not_confirmed',message:'Transfer not confirmed. Check manager access, passphrase, file size and an empty destination. Choose a new filename for export, or reselect the archive if its five-minute preview expired. Check saved state before retrying.'}};}
 });
}
