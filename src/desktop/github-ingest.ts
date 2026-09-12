import type {PrismaClient} from '@prisma/client';
import {desktopGitHubBatchSchema} from './github-contract.js';
import {authorizeActiveProject,requireAuthorizedProjectRole} from '../lib/auth/authorization.js';

/** Private native-parent command only; never accepts provider payloads from a renderer route. */
export async function ingestDesktopGitHub(prisma:PrismaClient,actor:{id:string;orgId:string},value:unknown){
 const input=desktopGitHubBatchSchema.parse(value),repo=input.repository;
 requireAuthorizedProjectRole(await authorizeActiveProject(prisma,{userId:actor.id,orgId:actor.orgId,projectId:input.projectId}),['manager']);
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`desktop-github:${repo.installationId}`},0))::text`;
  const old=await tx.gitHubInstallation.findUnique({where:{githubInstallationId:String(repo.installationId)}});
  if(old&&old.orgId!==actor.orgId)throw new Error('GitHub installation belongs to another organization');
  const [owner,name]=repo.full_name.split('/');
  const installation=await tx.gitHubInstallation.upsert({where:{githubInstallationId:String(repo.installationId)},create:{orgId:actor.orgId,githubInstallationId:String(repo.installationId),githubAccountLogin:owner,status:'active',installedAt:new Date()},update:{status:'active',archivedAt:null,suspendedAt:null}});
  const repository=await tx.gitHubRepository.upsert({where:{installationId_githubRepositoryId:{installationId:installation.id,githubRepositoryId:String(repo.id)}},create:{orgId:actor.orgId,installationId:installation.id,githubRepositoryId:String(repo.id),owner:owner!,name:name!,fullName:repo.full_name,private:repo.private,defaultBranch:repo.default_branch,htmlUrl:`https://github.com/${repo.full_name}`,status:'active'},update:{owner:owner!,name:name!,fullName:repo.full_name,private:repo.private,defaultBranch:repo.default_branch,status:'active',archivedAt:null,lastSyncedAt:new Date()}});
  const key={projectId:input.projectId,repositoryId:repository.id};
  const previous=await tx.gitHubRepositoryProjectLink.findUnique({where:{projectId_repositoryId:key}});
  if(previous&&(previous.syncCursorJson as {desktop?:boolean})?.desktop!==true)throw new Error('Existing repository link is not desktop-managed');
  const link=await tx.gitHubRepositoryProjectLink.upsert({where:{projectId_repositoryId:key},create:{...key,orgId:actor.orgId,installationId:installation.id,linkedByUserId:actor.id,status:'active',syncCursorJson:{desktop:true}},update:{status:'active',archivedAt:null,lastSyncedAt:new Date()}});
  const existing=await tx.gitHubEngineeringEvidence.findMany({where:{repositoryLinkId:link.id,providerId:{in:input.items.map(item=>item.providerId)}}});
  const byKey=new Map(existing.map(item=>[item.evidenceType+':'+item.providerId,item]));
  let created=0,updated=0;
  for(const item of input.items){
   const oldItem=byKey.get(item.evidenceType+':'+item.providerId),occurredAt=new Date(item.occurredAt);
   if(oldItem?.occurredAt&&oldItem.occurredAt>occurredAt)continue;
   const targetRef={url:item.sourceUrl,repository:repo.full_name,sha:item.sha,pullRequestNumber:item.pullRequestNumber};
   const data={title:item.title,summary:item.summary,branch:item.branch,sha:item.sha,pullRequestNumber:item.pullRequestNumber,status:item.status,sourceUrl:item.sourceUrl,occurredAt,citationJson:{source:'github',evidenceType:item.evidenceType,providerId:item.providerId,repository:repo.full_name},openTargetJson:{type:item.evidenceType,url:item.sourceUrl,repository:repo.full_name,targetType:item.evidenceType,targetRef},payloadJson:{desktop:true,excerpt:true},evidenceStatus:'active' as const};
   if(oldItem){
    const oldTarget=oldItem.openTargetJson as {targetType?:string;targetRef?:{url?:string}}|null;
    if(oldItem.title===item.title&&oldItem.summary===item.summary&&oldItem.sha===item.sha&&oldItem.branch===item.branch&&oldItem.status===item.status&&oldItem.sourceUrl===item.sourceUrl&&oldItem.occurredAt?.getTime()===occurredAt.getTime()&&oldItem.evidenceStatus==='active'&&oldTarget?.targetType===item.evidenceType&&oldTarget.targetRef?.url===item.sourceUrl)continue;
    await tx.gitHubEngineeringEvidence.update({where:{id:oldItem.id},data});updated++;
   }else{
    await tx.gitHubEngineeringEvidence.create({data:{...data,orgId:actor.orgId,projectId:input.projectId,installationId:installation.id,repositoryId:repository.id,repositoryLinkId:link.id,githubRepositoryId:String(repo.id),repositoryOwner:owner!,repositoryName:name!,evidenceType:item.evidenceType,providerId:item.providerId}});created++;
   }
  }
  await tx.gitHubRepositoryProjectLink.update({where:{id:link.id},data:{lastSyncedAt:new Date(),syncCursorJson:{desktop:true,snapshotKinds:['pull_requests','commits'],snapshotCount:input.items.length}}});
  return {repositoryLinkId:link.id,repository:repo.full_name,evidenceCount:input.items.length,created,updated};
 },{timeout:30000});
}
