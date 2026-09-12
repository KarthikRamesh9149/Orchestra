import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {validateProjectTransfer,prepareProjectImport,sealProjectTransfer,openProjectTransfer} from '../src/desktop/project-transfer.js';
import {ProjectTransferService} from '../src/desktop/project-transfer-service.js';
const project='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',document='33333333-3333-4333-8333-333333333333',version='44444444-4444-4444-8444-444444444444',target='55555555-5555-4555-8555-555555555555';
const date='2026-09-12T00:00:00.000Z',bytes=Buffer.from('Synthetic source bytes'),hash=createHash('sha256').update(bytes).digest('hex');
function fixture(){return {format:'orchestra-project-transfer',version:1,source:{projectId:project,orgId:project,installationId:project,name:'Synthetic project',exportedAt:date},actors:[{id:actor,displayName:'Synthetic author'}],records:{Document:[{id:document,projectId:project,kind:'prd',title:'Synthetic requirements',currentVersionId:version,uploadedBy:actor,visibility:'internal',archivedAt:null,createdAt:date,updatedAt:date}],DocumentVersion:[{id:version,documentId:document,projectId:project,fileKey:'sha256/'+hash,checksumSha256:hash,mimeType:'text/plain',fileSize:String(bytes.length),status:'ready',parseRevision:1,parseConfidence:null,sourceLabel:'manual',parseWarningJson:null,uploadedBy:actor,createdAt:date,processedAt:date}]},files:[{sha256:hash,base64:bytes.toString('base64')}]};}
describe('scoped project transfer boundary',()=>{
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
 it('does not create orphan copies on a known successful retry',async()=>{
  const x=setup();x.prisma.auditEvent.findFirst.mockResolvedValue({id:project});
  await expect(x.service.importProject(x.input)).resolves.toMatchObject({replayed:true});
  expect(x.storage.putObject).not.toHaveBeenCalled();expect(x.prisma.$transaction).not.toHaveBeenCalled();
 });
});
