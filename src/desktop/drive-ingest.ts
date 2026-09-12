import {createHash} from 'node:crypto';
import type {PrismaClient} from '@prisma/client';
import type {DocumentService} from '../modules/documents/service.js';
import {authorizeActiveProject,requireAuthorizedProjectRole} from '../lib/auth/authorization.js';
import {desktopDriveFileSchema} from './drive-contract.js';

export function driveIdentity(...parts:string[]){
 const hex=createHash('sha256').update(JSON.stringify(['desktop-drive-v1',...parts])).digest('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
// A single installation has exactly one native backend. Serialize a source through
// upload + finalization; deterministic IDs recover a crash between these stages.
const pending=new Map<string,Promise<unknown>>();
export async function ingestDesktopDrive(prisma:PrismaClient,actor:{id:string;orgId:string},value:unknown,documents:Pick<DocumentService,'uploadFile'>){
 const input=desktopDriveFileSchema.parse(value),key=driveIdentity(input.projectId,input.fileId);
 requireAuthorizedProjectRole(await authorizeActiveProject(prisma,{userId:actor.id,orgId:actor.orgId,projectId:input.projectId}),['manager']);
 const buffer=Buffer.from(input.base64,'base64');if(!buffer.length||buffer.length>10*1024*1024)throw new Error('Invalid Drive content size');
 const operation=(pending.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
  const old=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`desktop-drive:${input.projectId}`},0))::text`;
   const existing=await tx.projectDriveFile.findUnique({where:{projectId_driveFileId:{projectId:input.projectId,driveFileId:input.fileId}}});
   if(existing&&(existing.metadataJson as {desktop?:boolean})?.desktop!==true)throw new Error('Existing file is not desktop-managed');
   let connection=existing?{id:existing.connectionId}:await tx.projectDriveConnection.findFirst({where:{projectId:input.projectId,orgId:actor.orgId,connectedByUserId:actor.id,metadataJson:{path:['desktop'],equals:true}}});
   if(!connection)connection=await tx.projectDriveConnection.create({data:{orgId:actor.orgId,projectId:input.projectId,connectedByUserId:actor.id,status:'connected',accessMode:'selected_files',connectedAt:new Date(),grantedScopesJson:['https://www.googleapis.com/auth/drive.file'],metadataJson:{desktop:true}}});
   // Persist the exact Picker selection for the existing retrieval allowlist.
   // Never disable GOOGLE_DRIVE_REQUIRE_SYNC_ROOTS or grant a whole folder.
   await tx.projectDriveSyncRoot.upsert({where:{id:driveIdentity('root',key)},create:{id:driveIdentity('root',key),orgId:actor.orgId,projectId:input.projectId,connectionId:connection.id,rootType:'selected_file',googleFileId:input.fileId,name:input.name,selected:true,includeChildren:false,mimeTypeAllowlist:[input.mimeType],metadataJson:{desktop:true}},update:{name:input.name,selected:true,mimeTypeAllowlist:[input.mimeType]}});
   return existing??tx.projectDriveFile.create({data:{orgId:actor.orgId,projectId:input.projectId,connectionId:connection.id,driveFileId:input.fileId,name:input.name,mimeType:input.mimeType,metadataJson:{desktop:true}}});
  });
  if(old.version&&BigInt(old.version)>BigInt(input.version))return {documentId:old.documentId,documentVersionId:old.documentVersionId,unchanged:true,status:old.indexStatus};
  const hash=createHash('sha256').update(buffer).digest('hex');
  const uploaded=await documents.uploadFile({projectId:input.projectId,actorUserId:actor.id,sourceDocumentId:key,operationId:driveIdentity(key,input.version,hash),kind:'reference',title:input.name.slice(0,255),visibility:'internal',sourceLabel:'google_drive',makePrimaryLiveDoc:false,fileName:input.fileName,contentType:input.contentType,buffer});
  const version=await prisma.documentVersion.findUniqueOrThrow({where:{id:uploaded.documentVersionId},select:{status:true}});
  const indexStatus=version.status==='ready'?'indexed':['failed','partial'].includes(version.status)?'failed':'pending';
  const lastError=version.status==='partial'?'Semantic indexing is unavailable; parsed text remains readable.':version.status==='failed'?'Document processing failed; retry from Memory.':null;
  await prisma.projectDriveFile.update({where:{id:old.id},data:{name:input.name,mimeType:input.mimeType,webViewLink:`https://drive.google.com/file/d/${input.fileId}/view`,modifiedTime:new Date(input.modifiedTime),version:input.version,size:BigInt(buffer.length),contentHash:hash,documentId:uploaded.documentId,documentVersionId:uploaded.documentVersionId,indexStatus,lastIndexedAt:indexStatus==='indexed'?new Date():null,lastError,trashed:false}});
  await prisma.document.update({where:{id:uploaded.documentId},data:{title:input.name.slice(0,255)}});
  return {documentId:uploaded.documentId,documentVersionId:uploaded.documentVersionId,status:version.status,unchanged:old.documentVersionId===uploaded.documentVersionId};
 });
 pending.set(key,operation);
 try{return await operation;}finally{if(pending.get(key)===operation)pending.delete(key);}
}
