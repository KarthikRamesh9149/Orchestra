// Run only inside the disposable self-host qualification stack. No hosted credentials.
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {PrismaClient} from '@prisma/client';
import {ProjectTransferService} from '../../dist/src/desktop/project-transfer-service.js';
import {PrivateLocalStorageDriver} from '../../dist/src/lib/storage/private-local.js';
import {sealProjectTransfer,openProjectTransfer} from '../../dist/src/desktop/project-transfer.js';
if(process.env.ORCHESTRA_SYNTHETIC_TRANSFER_TEST!=='yes')throw new Error('Explicit synthetic qualification required');
const password=(await readFile('/run/secrets/runtime_password','utf8')).trim();
if(!/^[a-f0-9]{64}$/.test(password))throw new Error('Invalid qualification credential');
const db=new PrismaClient({datasourceUrl:`postgresql://orchestra_runtime:${password}@postgres:5432/orchestra_shared?schema=public`});
const checks=[];
try{
 const user=await db.user.findUniqueOrThrow({where:{normalizedEmail:'owner@qualification.invalid'}});
 const membership=await db.organizationMembership.findFirstOrThrow({where:{userId:user.id,isActive:true}});
 const actor={userId:user.id,orgId:membership.organizationId};
 const newProject=async()=>db.project.create({data:{orgId:actor.orgId,name:'Synthetic transfer qualification',slug:'transfer-'+randomUUID(),status:'active',createdBy:user.id,members:{create:{userId:user.id,projectRole:'manager'}}}});
 const destination=await newProject();
 const source=randomUUID(),author=randomUUID(),document=randomUUID(),version=randomUUID(),decision=randomUUID(),date=new Date().toISOString();
 const bytes=Buffer.from('Synthetic migration acceptance: preserve exact source bytes.'),hash=createHash('sha256').update(bytes).digest('hex');
 const data={format:'orchestra-project-transfer',version:1,source:{projectId:source,orgId:randomUUID(),installationId:randomUUID(),name:'Synthetic foreign installation',exportedAt:date},actors:[{id:author,displayName:'Synthetic original approver'}],records:{
  Document:[{id:document,projectId:source,kind:'prd',title:'Synthetic transfer PRD',currentVersionId:version,uploadedBy:author,visibility:'internal',archivedAt:null,createdAt:date,updatedAt:date}],
  DocumentVersion:[{id:version,documentId:document,projectId:source,fileKey:'sha256/'+hash,checksumSha256:hash,mimeType:'text/plain',fileSize:String(bytes.length),status:'ready',parseRevision:1,parseConfidence:null,sourceLabel:'manual',parseWarningJson:null,uploadedBy:author,createdAt:date,processedAt:date}],
  DecisionRecord:[{id:decision,projectId:source,title:'Synthetic accepted requirement',statement:'Preserve the source bytes',status:'accepted',sourceSummary:'Synthetic evidence',acceptedBy:author,acceptedAt:date,createdAt:date,updatedAt:date}]
 },files:[{sha256:hash,base64:bytes.toString('base64')}]};
 const passphrase='synthetic-transfer-'+randomUUID(),archive=sealProjectTransfer(data,passphrase);
 const storage=new PrivateLocalStorageDriver('/var/lib/orchestra/files');
 const service=new ProjectTransferService(db,storage,randomUUID());
 const preview=await service.previewImport(archive,passphrase,destination.id,actor);
 const input={archive,passphrase,targetProjectId:destination.id,actor,digest:preview.digest,identityMap:{[author]:user.id},acknowledgeHistoricalTruth:true};
 await assert.rejects(service.importProject({...input,actor:{...actor,userId:randomUUID()}}));
 await assert.rejects(service.importProject({...input,identityMap:{[author]:randomUUID()}}));
 await assert.rejects(service.importProject({...input,acknowledgeHistoricalTruth:false}));
 assert.equal(await db.document.count({where:{projectId:destination.id}}),0);checks.push('unauthorized identity and unapproved truth rejected without DB effects');
 assert.equal((await service.importProject(input)).replayed,false);
 const stored=await db.documentVersion.findUniqueOrThrow({where:{id:version}});
 assert.deepEqual(await storage.getObject(stored.fileKey),bytes);
 const accepted=await db.decisionRecord.findUniqueOrThrow({where:{id:decision}});
 assert.equal(accepted.acceptedBy,user.id);assert.equal(accepted.status,'accepted');
 const audit=await db.auditEvent.findFirstOrThrow({where:{projectId:destination.id,eventType:'desktop.project_transfer.imported'}});
 assert.equal(audit.payloadJson.source.projectId,source);assert.equal(audit.payloadJson.identityMap[author],user.id);
 checks.push('real restricted-role transaction preserved bytes and accepted decision with original provenance');
 assert.equal((await service.importProject(input)).replayed,true);
 assert.equal(await db.document.count({where:{projectId:destination.id}}),1);checks.push('retry has one authoritative imported effect');
 const roundtrip=openProjectTransfer(await service.exportProject(destination.id,actor,passphrase),passphrase);
 assert.equal(roundtrip.transfer.files[0].base64,bytes.toString('base64'));
 assert.equal(roundtrip.transfer.history[0].source.projectId,source);
 assert.equal(roundtrip.transfer.history[0].identityMap[author],user.id);
 checks.push('real database export roundtrip preserves original import lineage');
 // A late ID collision must roll back earlier source inserts, not partially import.
 const second=await newProject(),bad=structuredClone(data),newDoc=randomUUID(),newVersion=randomUUID();
 Object.assign(bad.records.Document[0],{id:newDoc,currentVersionId:newVersion});
 Object.assign(bad.records.DocumentVersion[0],{id:newVersion,documentId:newDoc});
 const badArchive=sealProjectTransfer(bad,passphrase),badPreview=await service.previewImport(badArchive,passphrase,second.id,actor);
 await assert.rejects(service.importProject({...input,archive:badArchive,digest:badPreview.digest,targetProjectId:second.id}));
 assert.equal(await db.document.count({where:{projectId:second.id}}),0);assert.equal(await db.auditEvent.count({where:{projectId:second.id,eventType:'desktop.project_transfer.imported'}}),0);
 checks.push('late accepted-decision collision rolls back documents and audit atomically');
 await db.projectMember.update({where:{projectId_userId:{projectId:destination.id,userId:user.id}},data:{projectRole:'dev'}});
 await assert.rejects(service.exportProject(destination.id,actor,passphrase));checks.push('live manager revocation blocks export');
 await db.projectMember.update({where:{projectId_userId:{projectId:destination.id,userId:user.id}},data:{projectRole:'manager'}});
 await db.$disconnect();await db.$connect();
 assert.equal((await db.decisionRecord.findUniqueOrThrow({where:{id:decision}})).status,'accepted');checks.push('fresh database connection reads persisted decision');
 console.log(JSON.stringify({passed:checks.length,checks,scope:'synthetic single-server integration; not native UI or two-computer qualification'},null,2));
}finally{await db.$disconnect();}
