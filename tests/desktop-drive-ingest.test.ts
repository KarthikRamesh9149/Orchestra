import {describe,it,expect,vi} from 'vitest';
import {ingestDesktopDrive,driveIdentity} from '../src/desktop/drive-ingest.js';
import {desktopDriveFileSchema} from '../src/desktop/drive-contract.js';
import {commandSchema} from '../apps/desktop/src/contracts.js';
const actor={id:'00000000-0000-4000-8000-000000000001',orgId:'00000000-0000-4000-8000-000000000002'};
const input={operation:'desktop.drive.ingest',projectId:'00000000-0000-4000-8000-000000000003',fileId:'synthetic_drive_file',name:'Same title',mimeType:'text/plain',modifiedTime:'2026-09-12T00:00:00Z',version:'2',contentType:'text/plain',fileName:'Same title.txt',base64:Buffer.from('Synthetic evidence only').toString('base64')};
function fixture(old:unknown=null){
 const tx={$queryRaw:vi.fn(),projectDriveSyncRoot:{upsert:vi.fn()},projectDriveConnection:{findFirst:vi.fn().mockResolvedValue({id:'connection'}),create:vi.fn(),update:vi.fn()},projectDriveFile:{findUnique:vi.fn().mockResolvedValue(old),create:vi.fn().mockResolvedValue({id:'file',connectionId:'connection'}),update:vi.fn()}};
 const db={projectMember:{findFirst:vi.fn().mockResolvedValue({projectRole:'manager'})},$transaction:vi.fn(async(fn:any)=>fn(tx)),projectDriveFile:tx.projectDriveFile,document:{update:vi.fn()},documentVersion:{findUniqueOrThrow:vi.fn().mockResolvedValue({status:'pending'})}};
 const upload=vi.fn().mockResolvedValue({documentId:driveIdentity(input.projectId,input.fileId),documentVersionId:'version',status:'pending'});
 return {tx,db,upload};
}
describe('native Drive persistence',()=>{
 it('does not admit private provider ingestion through renderer commands',()=>expect(commandSchema.safeParse(input).success).toBe(false));
 it('rejects arbitrary provider URLs and invalid base64',()=>{
  expect(desktopDriveFileSchema.safeParse({...input,sourceUrl:'https://attacker.invalid'}).success).toBe(false);
  expect(desktopDriveFileSchema.safeParse({...input,base64:'!bad'}).success).toBe(false);
 });
 it('uses file identity, canonical provenance and honest pending state',async()=>{
  const f=fixture();await ingestDesktopDrive(f.db as any,actor,input,{uploadFile:f.upload} as any);
  expect(f.upload).toHaveBeenCalledWith(expect.objectContaining({sourceDocumentId:driveIdentity(input.projectId,input.fileId),sourceLabel:'google_drive',makePrimaryLiveDoc:false,visibility:'internal'}));
  expect(f.tx.projectDriveFile.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({webViewLink:'https://drive.google.com/file/d/synthetic_drive_file/view',indexStatus:'pending',lastIndexedAt:null})}));
  expect(driveIdentity(input.projectId,'different_file')).not.toBe(driveIdentity(input.projectId,input.fileId));
  expect(f.tx.projectDriveSyncRoot.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({rootType:'selected_file',googleFileId:input.fileId,includeChildren:false,selected:true})}));
 });
 it('checks membership before touching provider persistence',async()=>{
  const f=fixture();f.db.projectMember.findFirst.mockResolvedValue(null as any);
  await expect(ingestDesktopDrive(f.db as any,actor,input,{uploadFile:f.upload} as any)).rejects.toThrow();expect(f.db.$transaction).not.toHaveBeenCalled();
 });
 it('does not relabel an unchanged partially indexed source as pending',async()=>{
  const f=fixture({id:'file',connectionId:'connection',metadataJson:{desktop:true},version:'2',documentVersionId:'version'});
  f.db.documentVersion.findUniqueOrThrow.mockResolvedValue({status:'partial'});
  expect(await ingestDesktopDrive(f.db as any,actor,input,{uploadFile:f.upload} as any)).toMatchObject({unchanged:true,status:'partial'});
  expect(f.tx.projectDriveFile.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({indexStatus:'failed',lastIndexedAt:null,lastError:expect.stringContaining('parsed text remains readable')})}));
 });
 it('refuses to take over a hosted file',async()=>{
  const f=fixture({id:'file',metadataJson:{},version:'1'});
  await expect(ingestDesktopDrive(f.db as any,actor,input,{uploadFile:f.upload} as any)).rejects.toThrow('desktop');expect(f.upload).not.toHaveBeenCalled();
 });
 it('ignores older revisions and retries the same revision with a stable operation ID',async()=>{
  const stale=fixture({id:'file',metadataJson:{desktop:true},version:'3',documentId:'doc',documentVersionId:'ver'});
  expect(await ingestDesktopDrive(stale.db as any,actor,input,{uploadFile:stale.upload} as any)).toMatchObject({unchanged:true});expect(stale.upload).not.toHaveBeenCalled();
  const f=fixture();await ingestDesktopDrive(f.db as any,actor,input,{uploadFile:f.upload} as any);await ingestDesktopDrive(f.db as any,actor,input,{uploadFile:f.upload} as any);
  expect(f.upload.mock.calls[0][0].operationId).toBe(f.upload.mock.calls[1][0].operationId);
 });
});
