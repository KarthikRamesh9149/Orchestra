import {Prisma,type PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import type {StorageDriver} from '../lib/storage/types.js';
import {transferFields,transferModels,type TransferModel,prepareProjectImport,sealProjectTransfer,openProjectTransfer} from './project-transfer.js';

type Row=Record<string,unknown>;
type Actor={userId:string;orgId:string};
type DB=Prisma.TransactionClient;
type Delegate={findMany(args:unknown):Promise<Row[]>;count(args:unknown):Promise<number>;create(args:unknown):Promise<unknown>};
const delegate=(db:DB,name:TransferModel)=>(db as unknown as Record<string,Delegate>)[name[0]!.toLowerCase()+name.slice(1)]!;
const metadata=new Map(Prisma.dmmf.datamodel.models.map(model=>[model.name,model]));
const serialise=(input:unknown)=>JSON.parse(JSON.stringify(input,(_key,value)=>typeof value==='bigint'?String(value):value)) as Row;
async function manager(db:DB,projectId:string,actor:Actor){
 const member=await db.projectMember.findFirst({where:{projectId,userId:actor.userId,isActive:true,projectRole:'manager',user:{isActive:true},project:{orgId:actor.orgId,organization:{memberships:{some:{userId:actor.userId,isActive:true}}}}},include:{project:true}});
 if(!member)throw new Error('Live project manager and truth-approval authority required');return member;
}

/** Private desktop/self-host adapter; no hosted route or renderer authority is added. */
export class ProjectTransferService{
 constructor(private readonly prisma:PrismaClient,private readonly storage:StorageDriver,private readonly installationId:string){}
 async exportProject(projectId:string,actor:Actor,passphrase:string){
  const snapshot=await this.prisma.$transaction(async db=>{
   const membership=await manager(db,projectId,actor);const records:Record<string,Row[]>={},actors=new Set<string>();
   let size=0,count=0;
   for(const name of transferModels){
    records[name]=[];let cursor:string|undefined;
    for(;;){
     const page=await delegate(db,name).findMany({where:{projectId},orderBy:{id:'asc'},take:100,...(cursor?{cursor:{id:cursor},skip:1}:{}),select:Object.fromEntries(transferFields[name].split(' ').map(key=>[key,true]))});
     for(const raw of page){const row=serialise(raw);size+=Buffer.byteLength(JSON.stringify(row));if(++count>20000||size>64*1024*1024||records[name]!.length>=10000)throw new Error('Project exceeds bounded transfer size');records[name]!.push(row);}
     if(page.length<100)break;cursor=String(page.at(-1)!.id);
    }
    for(const row of records[name]!)for(const relation of metadata.get(name)!.fields.filter(field=>field.kind==='object'&&field.type==='User'))for(const key of relation.relationFromFields??[])if(row[key])actors.add(String(row[key]));
   }
   const identities=await db.user.findMany({where:{id:{in:[...actors]}},select:{id:true,displayName:true}});
   const imports=await db.auditEvent.findMany({where:{projectId,eventType:'desktop.project_transfer.imported'},orderBy:{createdAt:'asc'},take:101,select:{payloadJson:true}});
   const history=imports.flatMap(event=>{const {history=[],...receipt}=event.payloadJson as Row;return [...(Array.isArray(history)?history:[]),receipt];});
   return {format:'orchestra-project-transfer',version:1,source:{projectId,orgId:actor.orgId,installationId:this.installationId,name:membership.project.name,exportedAt:new Date().toISOString()},actors:identities,history,records};
  },{isolationLevel:'RepeatableRead',timeout:30000});
  const files=new Map<string,{sha256:string;base64:string}>();let total=0;
  for(const row of snapshot.records.DocumentVersion!){
   if(!files.has(String(row.checksumSha256))){
    if(BigInt(String(row.fileSize))>25n*1024n*1024n)throw new Error('A source exceeds the 25 MiB transfer limit');
    const bytes=await this.storage.getObject(String(row.fileKey));if((total+=bytes.length)>64*1024*1024)throw new Error('Sources exceed the 64 MiB transfer limit');
    files.set(String(row.checksumSha256),{sha256:String(row.checksumSha256),base64:bytes.toString('base64')});
   }
   row.fileKey='sha256/'+String(row.checksumSha256);
  }
  // Recheck after file reads so a known revocation during export cannot release data.
  await manager(this.prisma,projectId,actor);
  return sealProjectTransfer({...snapshot,files:[...files.values()]},passphrase);
 }
 async previewImport(archive:Buffer,passphrase:string,targetProjectId:string,actor:Actor){
  await manager(this.prisma,targetProjectId,actor);const {transfer,digest}=openProjectTransfer(archive,passphrase);
  const members=await this.prisma.projectMember.findMany({where:{projectId:targetProjectId,isActive:true,user:{isActive:true,organizationMemberships:{some:{organizationId:actor.orgId,isActive:true}}}},select:{userId:true,user:{select:{displayName:true}}}});
  return {digest,source:transfer.source,actors:transfer.actors,targetIdentities:members.map(row=>({id:row.userId,displayName:row.user.displayName})),counts:Object.fromEntries(transferModels.map(name=>[name,transfer.records[name]!.length])),exclusions:['credentials','memberships and permission grants','private chats','connector configuration','non-core project workflows'],requiresHistoricalTruthAcknowledgement:true};
 }
 async importProject(input:{archive:Buffer;passphrase:string;targetProjectId:string;actor:Actor;digest:string;identityMap:Record<string,string>;acknowledgeHistoricalTruth:boolean}){
  const {transfer}=openProjectTransfer(input.archive,input.passphrase);
  await manager(this.prisma,input.targetProjectId,input.actor);
  const eligible=await this.prisma.projectMember.findMany({where:{projectId:input.targetProjectId,isActive:true,user:{isActive:true,organizationMemberships:{some:{organizationId:input.actor.orgId,isActive:true}}}},select:{userId:true}});
  const attempt=randomUUID(),fileKeys=new Map<string,string>();
  // Private, immutable attempt namespace. Interrupted attempts can leave orphan
  // files, never partial DB truth. Do not delete on an uncertain commit outcome.
  const preliminary=prepareProjectImport(transfer,{digest:input.digest,targetProjectId:input.targetProjectId,targetOrgId:input.actor.orgId,identityMap:input.identityMap,allowedTargetUserIds:eligible.map(row=>row.userId),acknowledgeHistoricalTruth:input.acknowledgeHistoricalTruth});
  const completed=await this.prisma.auditEvent.findFirst({where:{projectId:input.targetProjectId,eventType:'desktop.project_transfer.imported',payloadJson:{path:['digest'],equals:input.digest}}});
  if(completed)return {projectId:input.targetProjectId,digest:input.digest,replayed:true};
  for(const file of preliminary.files){const key=`transfers/${input.targetProjectId}/${attempt}/${file.sha256}`;await this.storage.putObject({key,body:Buffer.from(file.base64,'base64'),contentType:'application/octet-stream'});fileKeys.set(file.sha256,key);}
  return this.prisma.$transaction(async db=>{
   await db.$queryRaw`SELECT id FROM projects WHERE id = ${input.targetProjectId}::uuid FOR UPDATE`;
   await manager(db,input.targetProjectId,input.actor);
   const previous=await db.auditEvent.findFirst({where:{projectId:input.targetProjectId,eventType:'desktop.project_transfer.imported',payloadJson:{path:['digest'],equals:input.digest}}});
   if(previous)return {projectId:input.targetProjectId,digest:input.digest,replayed:true};
   const members=await db.projectMember.findMany({where:{projectId:input.targetProjectId,isActive:true,user:{isActive:true,organizationMemberships:{some:{organizationId:input.actor.orgId,isActive:true}}}},select:{userId:true}});
   const plan=prepareProjectImport(transfer,{digest:input.digest,targetProjectId:input.targetProjectId,targetOrgId:input.actor.orgId,identityMap:input.identityMap,allowedTargetUserIds:members.map(member=>member.userId),acknowledgeHistoricalTruth:input.acknowledgeHistoricalTruth});
   for(const name of transferModels)if(await delegate(db,name).count({where:{projectId:input.targetProjectId}}))throw new Error('Import requires an empty destination core; existing data is never replaced');
   const order:TransferModel[]=['Document','DocumentVersion','DocumentSection','DocumentChunk','ArtifactVersion','BrainNode','BrainEdge','BrainSectionLink','DecisionRecord','SpecChangeProposal','SpecChangeLink','ProjectLiveDocSource','LiveDocSectionDraft','LiveDocComment','LiveDocSectionRevision'];
   for(const name of order){
    let pending=[...plan.records[name]!];const inserted=new Set<string>();
    while(pending.length){
     const ready=name==='ArtifactVersion'?pending.filter(row=>row.parentVersionId===null||inserted.has(String(row.parentVersionId))):pending;
     if(!ready.length)throw new Error('Cyclic artifact ancestry');
     for(const record of ready){
      const data={...record};if(name==='DocumentVersion')data.fileKey=fileKeys.get(String(data.checksumSha256));
      for(const field of metadata.get(name)!.fields){if(!(field.name in data))continue;if(field.type==='Json'&&data[field.name]===null)data[field.name]=Prisma.DbNull;}
      await delegate(db,name).create({data});inserted.add(String(record.id));
     }
     pending=pending.filter(row=>!inserted.has(String(row.id)));
    }
   }
   await db.auditEvent.create({data:{orgId:input.actor.orgId,projectId:input.targetProjectId,actorUserId:input.actor.userId,eventType:'desktop.project_transfer.imported',entityType:'project',entityId:input.targetProjectId,payloadJson:{digest:plan.digest,...plan.provenance} as Prisma.InputJsonValue}});
   return {projectId:input.targetProjectId,digest:plan.digest,replayed:false};
  },{isolationLevel:'Serializable',timeout:60000});
 }
}
