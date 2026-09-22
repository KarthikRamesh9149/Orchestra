import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {encryptBackup,decryptBackup} from '../lib/storage/encrypted-backup.js';

// Reviewed scalar-field inventory. Schema additions never become exportable automatically.
export const transferFields={
 Document:'id projectId kind title currentVersionId uploadedBy visibility archivedAt createdAt updatedAt',
 DocumentVersion:'id documentId projectId fileKey checksumSha256 mimeType fileSize status parseRevision parseConfidence sourceLabel parseWarningJson uploadedBy createdAt processedAt',
 DocumentSection:'id documentVersionId projectId parseRevision sectionKey headingPath pageNumber pageStart pageEnd anchorId anchorText normalizedText charStart charEnd orderIndex metadataJson createdAt',
 DocumentChunk:'id documentVersionId sectionId projectId parseRevision chunkIndex content contextualContent lexicalContent tokenCount pageNumber metadataJson createdAt',
 ProjectLiveDocSource:'id orgId projectId documentId documentVersionId sourceKind setByUserId createdAt updatedAt',
 ArtifactVersion:'id projectId artifactType versionNumber parentVersionId status sourceRefsJson payloadJson changeSummary createdBy createdAt acceptedAt',
 BrainNode:'id artifactVersionId projectId nodeKey nodeType title summary status priority metadataJson createdAt',
 BrainEdge:'id artifactVersionId projectId fromNodeId toNodeId edgeType weight metadataJson createdAt',
 BrainSectionLink:'id projectId artifactVersionId brainNodeId documentSectionId relationship createdAt',
 SpecChangeProposal:'id projectId title summary proposalType status sourceMessageCount oldUnderstandingJson newUnderstandingJson impactSummaryJson externalEvidenceRefsJson acceptedBrainVersionId decisionRecordId acceptedBy acceptedAt createdAt updatedAt',
 SpecChangeLink:'id specChangeProposalId projectId linkType linkRefId relationship createdAt',
 DecisionRecord:'id projectId title statement status sourceSummary acceptedBy acceptedAt createdAt updatedAt',
 LiveDocSectionDraft:'id projectId artifactVersionId sectionKey sectionLabel baseContent proposedContent sourceDocumentId sourceDocumentVersionId documentSectionId anchorId status createdBy linkedProposalId createdAt updatedAt',
 LiveDocComment:'id projectId sectionKey draftId commentType bodyText authorUserId sourceLabel createdAt updatedAt',
 LiveDocSectionRevision:'id projectId sectionKey artifactVersionId draftId proposalId actorUserId sourceDocumentId sourceDocumentVersionId documentSectionId anchorId eventType previousContent nextContent changeSummary eventKey createdAt'
} as const;
export type TransferModel=keyof typeof transferFields;
export const transferModels=Object.keys(transferFields) as TransferModel[];
type Row=Record<string,unknown>;
const uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const maxBytes=128*1024*1024;
const sourceSchema=z.object({projectId:uuid,orgId:uuid,installationId:uuid,name:z.string().min(1).max(200),exportedAt:z.string().datetime()}).strict();
const actorSchema=z.object({id:uuid,displayName:z.string().max(200)}).strict();
const historySchema=z.object({digest:hash,source:sourceSchema,actors:z.array(actorSchema).max(1000),identityMap:z.record(uuid,uuid),historicalTruthAcknowledged:z.literal(true)}).strict();
const envelopeSchema=z.object({format:z.literal('orchestra-project-transfer'),version:z.literal(1),source:sourceSchema,
 actors:z.array(actorSchema).max(1000),
 history:z.array(historySchema).max(100).default([]),
 records:z.record(z.string(),z.array(z.record(z.string(),z.unknown())).max(10000)),
 files:z.array(z.object({sha256:hash,base64:z.string().max(maxBytes)}).strict()).max(1000)
}).strict();
type Transfer=z.infer<typeof envelopeSchema>;
const models=new Map(Prisma.dmmf.datamodel.models.map(model=>[model.name,model]));
const enums=new Map(Prisma.dmmf.datamodel.enums.map(value=>[value.name,new Set(value.values.map(item=>item.name))]));
const fail=(message:string):never=>{throw new Error('Project transfer: '+message);};
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function canonical(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Row)[key])).join(',')+'}';
}
function jsonValue(value:unknown,depth=0,stringLimit=2*1024*1024):void{
 if(depth>32)fail('JSON nesting exceeds supported bounds');
 if(value===null||typeof value==='boolean')return;
 if(typeof value==='string'){if(value.length>stringLimit)fail('Text exceeds supported bounds');return;}
 if(typeof value==='number'&&Number.isFinite(value))return;
 if(Array.isArray(value)){if(value.length>10000)fail('JSON array exceeds supported bounds');for(const item of value)jsonValue(item,depth+1,stringLimit);return;}
 if(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
  for(const [key,item] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))fail('Unsafe JSON key');jsonValue(item,depth+1,stringLimit);}return;
 }
 fail('Only bounded JSON data is supported');
}
function validateRow(name:TransferModel,row:Row){
 const model=models.get(name)!;const allowed=transferFields[name].split(' ');
 if(Object.keys(row).some(key=>!allowed.includes(key)))fail('Unexpected '+name+' field');
 for(const key of allowed){
  const field=model.fields.find(item=>item.name===key)!;const value=row[key];
  if(value===undefined)fail('Missing '+name+'.'+key);
  if(value===null){if(field.isRequired)fail('Required '+name+'.'+key);continue;}
  const scalar=(item:unknown)=>{
   if(field.kind==='enum'){if(typeof item!=='string'||!enums.get(field.type)?.has(item))fail('Invalid enum '+key);}
   else if(field.type==='String'){if(typeof item!=='string'||item.length>2*1024*1024)fail('Invalid text '+key);if((field.nativeType as unknown as [string])?.[0]==='Uuid')uuid.parse(item);}
   else if(field.type==='Int'){if(!Number.isInteger(item)||Number(item)<-2147483648||Number(item)>2147483647)fail('Invalid integer '+key);}
   else if(field.type==='BigInt'){if(typeof item!=='string'||!/^\d{1,18}$/.test(item))fail('Invalid bigint '+key);}
   else if(field.type==='Decimal'){if(typeof item!=='string'||! /^-?\d{1,12}(?:\.\d{1,6})?$/.test(item))fail('Invalid decimal '+key);}
   else if(field.type==='DateTime')z.string().datetime().parse(item);
   else if(field.type==='Boolean'){if(typeof item!=='boolean')fail('Invalid boolean '+key);}
   else if(field.type==='Json')jsonValue(item);
   else fail('Unreviewed field type '+field.type);
  };
  if(field.isList){if(!Array.isArray(value)||value.length>10000)fail('Invalid list '+key);for(const item of value as unknown[])scalar(item);}else scalar(value);
 }
}

/** Pure validation: no database, network or filesystem authority. */
export function validateProjectTransfer(input:unknown){
 jsonValue(input,0,maxBytes);if(Buffer.byteLength(canonical(input))>maxBytes)fail('Archive exceeds 128 MiB');
 const transfer=envelopeSchema.parse(input);
 if(Object.keys(transfer.records).some(name=>!transferModels.includes(name as TransferModel)))fail('Unreviewed record family');
 const actors=new Set(transfer.actors.map(actor=>actor.id));if(actors.size!==transfer.actors.length)fail('Duplicate actor');
 const ids=new Map<string,TransferModel>();let count=0;
 for(const name of transferModels){transfer.records[name]??=[];for(const row of transfer.records[name]!){
  if(++count>20000)fail('Too many records');validateRow(name,row);const id=uuid.parse(row.id);if(ids.has(id))fail('Duplicate record');ids.set(id,name);
  if(row.projectId!==transfer.source.projectId||('orgId'in row&&row.orgId!==transfer.source.orgId))fail('Mixed project or organization');
 }}
 const reference=(value:unknown,type:string)=>{
  if(value===null)return;
  if(type==='User'){if(!actors.has(String(value)))fail('Missing source actor');}
  else if(type==='Project'){if(value!==transfer.source.projectId)fail('Foreign project');}
  else if(type==='Organization'){if(value!==transfer.source.orgId)fail('Foreign organization');}
  else if(ids.get(String(value))!==type)fail('Dangling '+type+' reference');
 };
 for(const name of transferModels)for(const row of transfer.records[name]!){
  for(const field of models.get(name)!.fields.filter(field=>field.kind==='object'&&field.relationFromFields?.length)){
   for(const key of field.relationFromFields!)reference(row[key],field.type);
  }
  if(name==='Document')reference(row.currentVersionId,'DocumentVersion');
  // These application-level links are not all declared as Prisma relations.
  for(const [key,type] of Object.entries({sourceDocumentId:'Document',sourceDocumentVersionId:'DocumentVersion',documentSectionId:'DocumentSection'}))if(key in row)reference(row[key],type);
 }
 const files=new Map<string,Buffer>();let total=0;
 for(const file of transfer.files){
  const bytes=Buffer.from(file.base64,'base64');if(bytes.toString('base64')!==file.base64||sha(bytes)!==file.sha256||files.has(file.sha256))fail('Invalid or duplicate source bytes');
  if((total+=bytes.length)>maxBytes)fail('Sources exceed bound');files.set(file.sha256,bytes);
 }
 const used=new Set<string>();
 for(const row of transfer.records.DocumentVersion!){const digest=hash.parse(row.checksumSha256),bytes=files.get(digest);
  if(!bytes||row.fileKey!=='sha256/'+digest||row.fileSize!==String(bytes.length))fail('Missing source, wrong size or unsafe file key');used.add(digest);
 }
 if(used.size!==files.size)fail('Unreferenced file');
 const versions=new Map(transfer.records.DocumentVersion!.map(row=>[row.id,row]));
 const sections=new Map(transfer.records.DocumentSection!.map(row=>[row.id,row]));
 // Existence alone does not bind independent foreign keys to the same source.
 // Nullable pointers and historical versions/revisions remain valid; compare
 // only populated pointers, never require the document's current version.
 const documentSource=(name:TransferModel,documentId:unknown,versionId:unknown,sectionId:unknown=null)=>{
  if(documentId!==null&&versionId!==null&&versions.get(versionId)?.documentId!==documentId)fail(name+' version belongs to another document');
  if(sectionId!==null){
   const sectionVersionId=sections.get(sectionId)?.documentVersionId;
   if(versionId!==null&&sectionVersionId!==versionId)fail(name+' section belongs to another document version');
   if(documentId!==null&&versions.get(sectionVersionId)?.documentId!==documentId)fail(name+' section belongs to another document');
  }
 };
 for(const row of transfer.records.Document!)if(row.currentVersionId!==null&&versions.get(row.currentVersionId)?.documentId!==row.id)fail('Current version belongs to another document');
 for(const row of transfer.records.ProjectLiveDocSource!)documentSource('ProjectLiveDocSource',row.documentId,row.documentVersionId);
 for(const name of ['LiveDocSectionDraft','LiveDocSectionRevision'] as const)for(const row of transfer.records[name]!)documentSource(name,row.sourceDocumentId,row.sourceDocumentVersionId,row.documentSectionId);
 for(const row of transfer.records.DocumentChunk!)if(row.sectionId!==null){
  const section=sections.get(row.sectionId)!;
  if(section.documentVersionId!==row.documentVersionId)fail('DocumentChunk section belongs to another document version');
  if(section.parseRevision!==row.parseRevision)fail('DocumentChunk section belongs to another parse revision');
 }
 const nodes=new Map(transfer.records.BrainNode!.map(row=>[row.id,row]));
 for(const row of transfer.records.BrainEdge!)if([row.fromNodeId,row.toNodeId].some(id=>nodes.get(id)?.artifactVersionId!==row.artifactVersionId))fail('Brain edge crosses artifact versions');
 for(const row of transfer.records.BrainSectionLink!)if(nodes.get(row.brainNodeId)?.artifactVersionId!==row.artifactVersionId)fail('BrainSectionLink node belongs to another artifact version');
 return {transfer,digest:sha(Buffer.from(canonical(transfer)))};
}
export function sealProjectTransfer(input:unknown,passphrase:string){z.string().min(16).max(1024).parse(passphrase);return encryptBackup(Buffer.from(canonical(validateProjectTransfer(input).transfer)),passphrase);}
export function openProjectTransfer(archive:Buffer,passphrase:string){
 z.string().min(16).max(1024).parse(passphrase);
 if(archive.length>maxBytes+52)fail('Archive exceeds supported bound');
 return validateProjectTransfer(JSON.parse(decryptBackup(archive,passphrase).toString('utf8')));
}

/** Produces a reviewable plan only. The storage adapter must recheck live authority,
 * empty destination and collisions transactionally before applying any record. */
export function prepareProjectImport(input:unknown,options:{digest:string;targetProjectId:string;targetOrgId:string;identityMap:Record<string,string>;allowedTargetUserIds:string[];acknowledgeHistoricalTruth:boolean}){
 const {transfer,digest}=validateProjectTransfer(input);if(options.digest!==digest)fail('Archive differs from reviewed preview');
 uuid.parse(options.targetProjectId);uuid.parse(options.targetOrgId);
 if(options.acknowledgeHistoricalTruth!==true)fail('Explicit historical truth acknowledgement required');
 const mapped=Object.entries(options.identityMap),allowed=new Set(options.allowedTargetUserIds);
 if(mapped.length!==transfer.actors.length||new Set(mapped.map(([,value])=>value)).size!==mapped.length)fail('Complete one-to-one identity mapping required');
 for(const actor of transfer.actors){const target=options.identityMap[actor.id];if(!target||!allowed.has(target))fail('Target identity is not authorised');uuid.parse(target);}
 const records=structuredClone(transfer.records);
 for(const name of transferModels)for(const row of records[name]!){
  row.projectId=options.targetProjectId;if('orgId'in row)row.orgId=options.targetOrgId;
  for(const relation of models.get(name)!.fields.filter(field=>field.kind==='object'&&field.type==='User'))for(const key of relation.relationFromFields??[])if(row[key]!==null)row[key]=options.identityMap[String(row[key])];
 }
 return {digest,records,files:transfer.files,provenance:{source:transfer.source,actors:transfer.actors,identityMap:{...options.identityMap},historicalTruthAcknowledged:true,history:transfer.history}};
}
