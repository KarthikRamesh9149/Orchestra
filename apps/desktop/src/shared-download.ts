import {basename} from 'node:path';
import type {DownloadItem,Event} from 'electron';
/** Explicit renderer-generated exports only. Electron presents its native Save dialog. */
export function authorizeSharedDownload(event:Pick<Event,'preventDefault'>,item:DownloadItem,origin:string,ownWindow:boolean){
 if(!ownWindow||!item.getURL().startsWith('blob:orchestra://app/')||item.getTotalBytes()>55*1024*1024){event.preventDefault();return false;}
 const name=basename(item.getFilename()).replace(/[\x00-\x1f\x7f]/g,'_').slice(0,200)||'Orchestra-export';
 item.setSaveDialogOptions({title:`Save an export from ${origin}`,buttonLabel:'Save export',defaultPath:name});
 item.on('updated',()=>{if(item.getReceivedBytes()>55*1024*1024)item.cancel();});
 return true;
}
