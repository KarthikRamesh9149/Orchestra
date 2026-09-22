import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {validateProjectTransfer,prepareProjectImport,sealProjectTransfer,openProjectTransfer} from '../src/desktop/project-transfer.js';
import {ProjectTransferService} from '../src/desktop/project-transfer-service.js';
import {encryptBackup} from '../src/lib/storage/encrypted-backup.js';
const project='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',document='33333333-3333-4333-8333-333333333333',version='44444444-4444-4444-8444-444444444444',target='55555555-5555-4555-8555-555555555555';
const date='2026-09-12T00:00:00.000Z',bytes=Buffer.from('Synthetic source bytes'),hash=createHash('sha256').update(bytes).digest('hex');
const secondDocument='66666666-6666-4666-8666-666666666666',secondVersion='77777777-7777-4777-8777-777777777777',liveSource='88888888-8888-4888-8888-888888888888';
const recordId=(n:number)=>'99999999-9999-4999-8999-'+String(n).padStart(12,'0');
const section=recordId(1),secondSection=recordId(2),chunk=recordId(3),draft=recordId(4),revision=recordId(5),artifact=recordId(6),secondArtifact=recordId(7),node=recordId(8),secondNode=recordId(9),brainLink=recordId(10),newerVersion=recordId(11);
function fixture(){return {format:'orchestra-project-transfer',version:1,source:{projectId:project,orgId:project,installationId:project,name:'Synthetic project',exportedAt:date},actors:[{id:actor,displayName:'Synthetic author'}],records:{Document:[{id:document,projectId:project,kind:'prd',title:'Synthetic requirements',currentVersionId:version,uploadedBy:actor,visibility:'internal',archivedAt:null,createdAt:date,updatedAt:date}],DocumentVersion:[{id:version,documentId:document,projectId:project,fileKey:'sha256/'+hash,checksumSha256:hash,mimeType:'text/plain',fileSize:String(bytes.length),status:'ready',parseRevision:1,parseConfidence:null,sourceLabel:'manual',parseWarningJson:null,uploadedBy:actor,createdAt:date,processedAt:date}]},files:[{sha256:hash,base64:bytes.toString('base64')}]};}
function sourceFixture(){
 const data=fixture();
 data.records.Document.push({...data.records.Document[0]!,id:secondDocument,currentVersionId:secondVersion});
 data.records.DocumentVersion.push({...data.records.DocumentVersion[0]!,id:secondVersion,documentId:secondDocument});
 return {...data,records:{...data.records,ProjectLiveDocSource:[{id:liveSource,orgId:project,projectId:project,documentId:document,documentVersionId:version as string|null,sourceKind:'uploaded_prd',setByUserId:actor,createdAt:date,updatedAt:date}]}};
}
function graphFixture(){
 const data=sourceFixture(),records:Record<string,Record<string,unknown>[]>=data.records;
 const newerBytes=Buffer.from('Newer synthetic source bytes'),newerHash=createHash('sha256').update(newerBytes).digest('hex');
 records.DocumentVersion!.push({...records.DocumentVersion![0]!,id:newerVersion,fileKey:'sha256/'+newerHash,checksumSha256:newerHash,fileSize:String(newerBytes.length)});
 data.files.push({sha256:newerHash,base64:newerBytes.toString('base64')});
 records.DocumentSection=[{id:section,documentVersionId:version,projectId:project,parseRevision:1,sectionKey:'requirements',headingPath:['Requirements'],pageNumber:null,pageStart:null,pageEnd:null,anchorId:'requirements',anchorText:null,normalizedText:'Synthetic requirements',charStart:null,charEnd:null,orderIndex:0,metadataJson:null,createdAt:date}];
 records.DocumentSection.push({...records.DocumentSection[0]!,id:secondSection,documentVersionId:secondVersion});
 records.DocumentChunk=[{id:chunk,documentVersionId:version,sectionId:section,projectId:project,parseRevision:1,chunkIndex:0,content:'Synthetic requirements',contextualContent:null,lexicalContent:'Synthetic requirements',tokenCount:2,pageNumber:null,metadataJson:null,createdAt:date}];
 records.ArtifactVersion=[{id:artifact,projectId:project,artifactType:'product_brain',versionNumber:1,parentVersionId:null,status:'accepted',sourceRefsJson:null,payloadJson:{},changeSummary:null,createdBy:actor,createdAt:date,acceptedAt:date}];
 records.ArtifactVersion.push({...records.ArtifactVersion[0]!,id:secondArtifact,versionNumber:2,parentVersionId:artifact});
 records.BrainNode=[{id:node,artifactVersionId:artifact,projectId:project,nodeKey:'requirements',nodeType:'module',title:'Requirements',summary:'Synthetic requirements',status:'active',priority:null,metadataJson:null,createdAt:date}];
 records.BrainNode.push({...records.BrainNode[0]!,id:secondNode,artifactVersionId:secondArtifact});
 records.BrainSectionLink=[{id:brainLink,projectId:project,artifactVersionId:artifact,brainNodeId:node,documentSectionId:section,relationship:'supports',createdAt:date}];
 const source={sourceDocumentId:document,sourceDocumentVersionId:version,documentSectionId:section,anchorId:'requirements'};
 records.LiveDocSectionDraft=[{id:draft,projectId:project,artifactVersionId:null,sectionKey:'doc:'+section,sectionLabel:'Requirements',baseContent:'Original requirements',proposedContent:'Updated requirements',...source,status:'draft',createdBy:actor,linkedProposalId:null,createdAt:date,updatedAt:date}];
 records.LiveDocSectionRevision=[{id:revision,projectId:project,sectionKey:'doc:'+section,artifactVersionId:null,draftId:draft,proposalId:null,actorUserId:actor,...source,eventType:'draft_created',previousContent:'Original requirements',nextContent:'Updated requirements',changeSummary:null,eventKey:null,createdAt:date}];
 return {...data,records};
}
describe('scoped project transfer boundary',()=>{
 it('rejects a Live Doc source whose pinned version belongs to another document',()=>{
  const data=sourceFixture();
  expect(()=>validateProjectTransfer(data)).not.toThrow();
  data.records.ProjectLiveDocSource[0]!.documentVersionId=secondVersion;
  expect(()=>validateProjectTransfer(data)).toThrow(/ProjectLiveDocSource.*another document/);
 });
 it('preserves historical versions and parse revisions through encryption and import planning',()=>{
  const data=graphFixture();
  data.records.Document![0]!.currentVersionId=newerVersion;
  data.records.DocumentVersion![0]!.parseRevision=2;
  const loaded=openProjectTransfer(sealProjectTransfer(data,'synthetic-passphrase-not-production'),'synthetic-passphrase-not-production');
  const plan=prepareProjectImport(loaded.transfer,{digest:loaded.digest,targetProjectId:target,targetOrgId:target,identityMap:{[actor]:target},allowedTargetUserIds:[target],acknowledgeHistoricalTruth:true});
  expect(plan.records.ProjectLiveDocSource![0]).toMatchObject({documentId:document,documentVersionId:version});
  expect(plan.records.DocumentChunk![0]).toMatchObject({sectionId:section,documentVersionId:version,parseRevision:1});
  expect(plan.records.LiveDocSectionRevision![0]).toMatchObject({sourceDocumentId:document,sourceDocumentVersionId:version,documentSectionId:section});
  expect(plan.files).toEqual(data.files);
 });
 it('preserves unpinned Live Doc sources and chunks without a section',()=>{
  const data=graphFixture();
  data.records.ProjectLiveDocSource![0]!.documentVersionId=null;
  data.records.DocumentChunk![0]!.sectionId=null;
  expect(()=>validateProjectTransfer(data)).not.toThrow();
 });
 it.each(['LiveDocSectionDraft','LiveDocSectionRevision'])('rejects inconsistent source ownership in %s',name=>{
  const cases=[
   {sourceDocumentVersionId:secondVersion},
   {documentSectionId:secondSection},
   {sourceDocumentVersionId:newerVersion},
   {sourceDocumentVersionId:null,documentSectionId:secondSection},
   {sourceDocumentId:null,documentSectionId:secondSection}
  ];
  for(const changes of cases){
   const data=graphFixture();Object.assign(data.records[name]![0]!,changes);
   expect(()=>validateProjectTransfer(data)).toThrow(new RegExp(name+'.*another document'));
  }
 });
 it.each(['LiveDocSectionDraft','LiveDocSectionRevision'])('preserves every coherent nullable source tuple in %s',name=>{
  const keys=['sourceDocumentId','sourceDocumentVersionId','documentSectionId'];
  for(let mask=0;mask<8;mask++){
   const data=graphFixture();
   keys.forEach((key,index)=>{if(mask&(1<<index))data.records[name]![0]![key]=null;});
   if(mask===7){data.records[name]![0]!.artifactVersionId=artifact;data.records[name]![0]!.anchorId=null;}
   expect(()=>validateProjectTransfer(data)).not.toThrow();
  }
 });
 it('preserves revision provenance after its mutable draft changes source',()=>{
  const data=graphFixture();
  Object.assign(data.records.LiveDocSectionDraft![0]!,{sourceDocumentId:secondDocument,sourceDocumentVersionId:secondVersion,documentSectionId:secondSection});
  expect(()=>validateProjectTransfer(data)).not.toThrow();
 });
 it('rejects chunks linked to another version or parse revision',()=>{
  for(const changes of [{sectionId:secondSection},{documentVersionId:newerVersion},{parseRevision:2}]){
   const data=graphFixture();Object.assign(data.records.DocumentChunk![0]!,changes);
   expect(()=>validateProjectTransfer(data)).toThrow(/DocumentChunk.*another (document version|parse revision)/);
  }
 });
 it('rejects brain section links whose node belongs to another artifact version',()=>{
  const data=graphFixture();data.records.BrainSectionLink![0]!.brainNodeId=secondNode;
  expect(()=>validateProjectTransfer(data)).toThrow(/BrainSectionLink.*another artifact version/);
 });
 it('preserves exact source bytes and stable record IDs through authenticated encryption',()=>{
  const data=fixture();const archive=sealProjectTransfer(data,'synthetic-passphrase-not-production');
  const loaded=openProjectTransfer(archive,'synthetic-passphrase-not-production');expect(loaded.transfer.files[0]?.base64).toBe(bytes.toString('base64'));expect(loaded.transfer.records.Document[0]?.id).toBe(document);
  expect(()=>openProjectTransfer(archive,'different-synthetic-passphrase')).toThrow();archive[archive.length-1]^=1;expect(()=>openProjectTransfer(archive,'synthetic-passphrase-not-production')).toThrow();
 });
 it.each(['User','RefreshToken','CommunicationConnector','SocratesSession','SocratesMessage'])('rejects forbidden %s records instead of silently importing them',model=>{const data=fixture();Object.assign(data.records,{[model]:[]});expect(()=>validateProjectTransfer(data)).toThrow();});
 it('rejects unknown fields, mixed projects, missing actors and dangling document versions',()=>{
  for(const mutate of [(d:any)=>d.records.Document[0].passwordHash='secret',(d:any)=>d.records.Document[0].projectId=target,(d:any)=>d.actors=[],(d:any)=>d.records.DocumentVersion=[]]){const data=fixture();mutate(data);expect(()=>validateProjectTransfer(data)).toThrow();}
 });
 it('rejects bad file hashes, noncanonical encoding, arbitrary storage paths and duplicate records',()=>{
  for(const mutate of [(d:any)=>d.files[0].base64=Buffer.from('changed').toString('base64'),(d:any)=>d.files[0].base64+='!',(d:any)=>d.records.DocumentVersion[0].fileKey='../../private',(d:any)=>d.records.Document.push({...d.records.Document[0]})]){const data=fixture();mutate(data);expect(()=>validateProjectTransfer(data)).toThrow();}
 });
 it('requires an exact reviewed digest and explicit one-to-one, authorised identity mapping',()=>{
  const validated=validateProjectTransfer(fixture());const input={digest:validated.digest,targetProjectId:target,targetOrgId:target,identityMap:{[actor]:target},allowedTargetUserIds:[target],acknowledgeHistoricalTruth:true};
  expect(()=>prepareProjectImport(validated.transfer,{...input,digest:'0'.repeat(64)})).toThrow();expect(()=>prepareProjectImport(validated.transfer,{...input,identityMap:{}})).toThrow();expect(()=>prepareProjectImport(validated.transfer,{...input,allowedTargetUserIds:[]})).toThrow();
  const plan=prepareProjectImport(validated.transfer,input);expect(plan.records.Document[0]?.projectId).toBe(target);expect(plan.records.Document[0]?.uploadedBy).toBe(target);expect(plan.records.Document[0]?.id).toBe(document);expect(plan.provenance.source.projectId).toBe(project);expect(plan.provenance.identityMap).toEqual({[actor]:target});
 });
});

describe('project transfer service authorization boundary',()=>{
 const passphrase='synthetic-passphrase-not-production';
 function setup(){
  const prisma:any={projectMember:{findFirst:vi.fn().mockResolvedValue({project:{name:'Synthetic'}}),findMany:vi.fn().mockResolvedValue([{userId:target}])},auditEvent:{findFirst:vi.fn().mockResolvedValue(null)},$transaction:vi.fn()};
  const storage:any={putObject:vi.fn(),getObject:vi.fn()};
  const archive=sealProjectTransfer(fixture(),passphrase),{digest}=openProjectTransfer(archive,passphrase);
  const service=new ProjectTransferService(prisma,storage,project);
  const input={archive,passphrase,targetProjectId:target,actor:{userId:target,orgId:target},digest,identityMap:{[actor]:target},acknowledgeHistoricalTruth:true};
  return {prisma,storage,service,input};
 }
 it('does not write files or open a mutation transaction for a revoked manager',async()=>{
  const x=setup();x.prisma.projectMember.findFirst.mockResolvedValue(null);
  await expect(x.service.importProject(x.input)).rejects.toThrow(/authority/);
  expect(x.storage.putObject).not.toHaveBeenCalled();expect(x.prisma.$transaction).not.toHaveBeenCalled();
 });
 it('rejects invalid mapping and changed preview before file staging',async()=>{
  const x=setup();
  await expect(x.service.importProject({...x.input,identityMap:{[actor]:project}})).rejects.toThrow();
  await expect(x.service.importProject({...x.input,digest:'0'.repeat(64)})).rejects.toThrow();
  expect(x.storage.putObject).not.toHaveBeenCalled();
 });
 it('rejects an authenticated archive with inconsistent source ownership before import writes',async()=>{
  const x=setup(),data=sourceFixture();data.records.ProjectLiveDocSource[0]!.documentVersionId=secondVersion;
  // Authenticate malformed external input without going through the export validator.
  const archive=encryptBackup(Buffer.from(JSON.stringify(data)),passphrase);
  await expect(x.service.previewImport(archive,passphrase,target,x.input.actor)).rejects.toThrow(/ProjectLiveDocSource.*another document/);
  await expect(x.service.importProject({...x.input,archive})).rejects.toThrow(/ProjectLiveDocSource.*another document/);
  expect(x.storage.putObject).not.toHaveBeenCalled();expect(x.prisma.$transaction).not.toHaveBeenCalled();
 });
 it('does not create orphan copies on a known successful retry',async()=>{
  const x=setup();x.prisma.auditEvent.findFirst.mockResolvedValue({id:project});
  await expect(x.service.importProject(x.input)).resolves.toMatchObject({replayed:true});
  expect(x.storage.putObject).not.toHaveBeenCalled();expect(x.prisma.$transaction).not.toHaveBeenCalled();
 });
});
