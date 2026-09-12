import {describe,it,expect,vi} from 'vitest';
import {readSelectedDriveFile} from '../apps/desktop/src/drive-sources.js';
import {DRIVE_FILE_SCOPE,type DriveCredential} from '../apps/desktop/src/drive-oauth.js';
const credential:DriveCredential={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+600000,fileIds:['synthetic-file'],scope:DRIVE_FILE_SCOPE};
const metadata={id:'synthetic-file',name:'Synthetic qualification',mimeType:'application/vnd.google-apps.document',modifiedTime:'2026-09-01T00:00:00Z',version:'7',trashed:false,capabilities:{canDownload:true}};
describe('desktop selected Drive file reader',()=>{
 it('rejects unselected files before making any request',async()=>{
  const request=vi.fn();await expect(readSelectedDriveFile(credential,'other-file',undefined,request)).rejects.toThrow('selected');expect(request).not.toHaveBeenCalled();
 });
 it('exports a selected Google document at fixed endpoints and verifies its version again',async()=>{
  const request=vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response('Synthetic content')).mockResolvedValueOnce(Response.json(metadata));
  const file=await readSelectedDriveFile(credential,'synthetic-file',undefined,request);
  expect(file.contentType).toBe('text/plain');expect(file.bytes.toString()).toBe('Synthetic content');expect(file.sourceUrl).toBe('https://drive.google.com/file/d/synthetic-file/view');
  expect(request).toHaveBeenCalledTimes(3);
  for(const [url,options] of request.mock.calls){expect(new URL(String(url)).origin).toBe('https://www.googleapis.com');expect(options.method).toBe('GET');expect(options.redirect).toBe('error');}
  expect(String(request.mock.calls[1]![0])).toContain('/export?mimeType=text%2Fplain');
 });
 it('refuses trashed, unsupported, inaccessible, oversized or misidentified metadata before content download',async()=>{
  for(const patch of [{trashed:true},{mimeType:'application/vnd.google-apps.shortcut'},{capabilities:{canDownload:false}},{size:'999999999'},{id:'different-file'}]){
   const request=vi.fn().mockResolvedValue(Response.json({...metadata,...patch}));
   await expect(readSelectedDriveFile(credential,'synthetic-file',undefined,request)).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
  }
 });
 it('rejects content changed during download instead of attaching the wrong revision',async()=>{
  const request=vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response('Synthetic content')).mockResolvedValueOnce(Response.json({...metadata,version:'8'}));
  await expect(readSelectedDriveFile(credential,'synthetic-file',undefined,request)).rejects.toThrow('changed');
 });
 it('honors cancellation, bounds streamed bytes, and never reads a provider-supplied download URL',async()=>{
  const abort=new AbortController();abort.abort();const unused=vi.fn();await expect(readSelectedDriveFile(credential,'synthetic-file',abort.signal,unused)).rejects.toThrow();expect(unused).not.toHaveBeenCalled();
  const request=vi.fn().mockResolvedValueOnce(Response.json({...metadata,webContentLink:'https://attacker.invalid'})).mockResolvedValueOnce(new Response('x'.repeat(10*1024*1024+1)));
  await expect(readSelectedDriveFile(credential,'synthetic-file',undefined,request)).rejects.toThrow('limit');expect(request).toHaveBeenCalledTimes(2);
 });
});
