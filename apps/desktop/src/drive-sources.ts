import {z} from 'zod';
import {boundedGoogleBody,driveCredentialSchema,type DriveCredential} from './drive-oauth.js';
const MAX_BYTES=10*1024*1024;
const metadataSchema=z.object({id:z.string(),name:z.string().min(1).max(512),mimeType:z.string(),modifiedTime:z.string().datetime(),version:z.string().regex(/^\d+$/),trashed:z.boolean(),size:z.string().regex(/^\d+$/).optional(),capabilities:z.object({canDownload:z.boolean()})});
const blobTypes:Record<string,string>={'text/plain':'.txt','text/markdown':'.md','application/pdf':'.pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx'};
const exportTypes:Record<string,{type:string;extension:string}>={
 'application/vnd.google-apps.document':{type:'text/plain',extension:'.txt'},
 'application/vnd.google-apps.presentation':{type:'text/plain',extension:'.txt'},
 'application/vnd.google-apps.spreadsheet':{type:'application/pdf',extension:'.pdf'}
};
/** Main-process only. Selected file IDs are taken from the encrypted OAuth grant,
 * never a renderer URL. No provider-supplied download links are followed. */
export async function readSelectedDriveFile(value:DriveCredential,fileId:string,signal?:AbortSignal,fetcher:typeof fetch=fetch){
 const credential=driveCredentialSchema.parse(value);
 if(!credential.fileIds.includes(fileId))throw new Error('Drive file was not explicitly selected');
 signal?.throwIfAborted();
 const base=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
 const read=async(url:string,limit:number)=>{
  signal?.throwIfAborted();
  const response=await fetcher(url,{method:'GET',headers:{Authorization:`Bearer ${credential.accessToken}`},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
  return boundedGoogleBody(response,limit);
 };
 const metadataUrl=base+'?supportsAllDrives=true&fields='+encodeURIComponent('id,name,mimeType,modifiedTime,version,trashed,size,capabilities(canDownload)');
 const inspect=async()=>metadataSchema.parse(JSON.parse((await read(metadataUrl,32768)).toString('utf8')));
 const metadata=await inspect();
 if(metadata.id!==fileId||metadata.trashed||!metadata.capabilities.canDownload)throw new Error('Selected Drive file is unavailable for download');
 if(metadata.size&&BigInt(metadata.size)>BigInt(MAX_BYTES))throw new Error('Selected Drive file exceeds the size limit');
 const exported=exportTypes[metadata.mimeType];
 const contentType=exported?.type??metadata.mimeType,extension=exported?.extension??blobTypes[metadata.mimeType];
 if(!extension)throw new Error('Selected Drive file type is not supported');
 const bytes=await read(exported?base+'/export?mimeType='+encodeURIComponent(contentType):base+'?alt=media&supportsAllDrives=true',MAX_BYTES);
 if(!bytes.length)throw new Error('Selected Drive file is empty');
 const after=await inspect();
 if(after.id!==fileId||after.version!==metadata.version||after.modifiedTime!==metadata.modifiedTime||after.trashed||!after.capabilities.canDownload)throw new Error('Drive file changed during download; retry to capture a consistent version');
 const stem=metadata.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,160);
 return {fileId,name:metadata.name,mimeType:metadata.mimeType,modifiedTime:metadata.modifiedTime,version:metadata.version,sourceUrl:`https://drive.google.com/file/d/${fileId}/view`,contentType,fileName:stem.endsWith(extension)?stem:stem+extension,bytes};
}
