import {describe,it,expect,vi} from 'vitest';
import type {PrismaClient} from '@prisma/client';
import {ingestDesktopGitHub} from '../src/desktop/github-ingest.js';
import {desktopGitHubBatchSchema} from '../src/desktop/github-contract.js';
import {commandSchema} from '../apps/desktop/src/contracts.js';
const actor={id:'00000000-0000-4000-8000-000000000001',orgId:'00000000-0000-4000-8000-000000000002'};
const batch={operation:'desktop.github.ingest',projectId:'00000000-0000-4000-8000-000000000003',repository:{id:9,installationId:44,full_name:'synthetic/qualification',private:true,default_branch:'main'},items:[]};
describe('desktop GitHub persistence boundary',()=>{
 it('persists a usable canonical source target and repairs older target projections',async()=>{
  const item={evidenceType:'github_commit',providerId:'commit:9:'+'a'.repeat(40),title:'Synthetic',summary:'Test',sha:'a'.repeat(40),branch:null,pullRequestNumber:null,status:'observed',sourceUrl:'https://github.com/synthetic/qualification/commit/'+'a'.repeat(40),occurredAt:'2026-09-12T00:00:00Z'};
  const old={...item,id:'evidence',occurredAt:new Date(item.occurredAt),evidenceStatus:'active',openTargetJson:{type:item.evidenceType,url:item.sourceUrl}};
  const tx={$queryRaw:vi.fn(),gitHubInstallation:{findUnique:vi.fn().mockResolvedValue(null),upsert:vi.fn().mockResolvedValue({id:'installation'})},gitHubRepository:{upsert:vi.fn().mockResolvedValue({id:'repository'})},gitHubRepositoryProjectLink:{findUnique:vi.fn().mockResolvedValue(null),upsert:vi.fn().mockResolvedValue({id:'link'}),update:vi.fn()},gitHubEngineeringEvidence:{findMany:vi.fn().mockResolvedValue([old]),update:vi.fn(),create:vi.fn()}};
  const db={projectMember:{findFirst:vi.fn().mockResolvedValue({projectRole:'manager'})},$transaction:vi.fn(async(fn:(tx:unknown)=>Promise<unknown>)=>fn(tx))};
  const result=await ingestDesktopGitHub(db as unknown as PrismaClient,actor,{...batch,items:[item]});
  expect(result.updated).toBe(1);
  expect(tx.gitHubEngineeringEvidence.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({openTargetJson:expect.objectContaining({targetType:'github_commit',targetRef:expect.objectContaining({url:item.sourceUrl})})})}));
 });
 it('cannot forge native provider evidence via renderer commands',()=>expect(commandSchema.safeParse(batch).success).toBe(false));
 it('requires active manager membership',async()=>{
  for(const role of [null,'dev','client']){const db={projectMember:{findFirst:vi.fn().mockResolvedValue(role?{projectRole:role}:null)},$transaction:vi.fn()};
   await expect(ingestDesktopGitHub(db as unknown as PrismaClient,actor,batch)).rejects.toThrow();expect(db.$transaction).not.toHaveBeenCalled();}
 });
 it('rejects inconsistent source URLs and identity before persistence',()=>{
  const item={evidenceType:'github_commit',providerId:'commit:9:'+'a'.repeat(40),title:'Synthetic',summary:'Test',sha:'a'.repeat(40),branch:null,pullRequestNumber:null,status:'observed',sourceUrl:'https://attacker.invalid',occurredAt:'2026-09-12T00:00:00Z'};
  expect(desktopGitHubBatchSchema.safeParse({...batch,items:[item]}).success).toBe(false);
 });
 it('does not take over another organization installation',async()=>{
  const tx={$queryRaw:vi.fn(),gitHubInstallation:{findUnique:vi.fn().mockResolvedValue({orgId:'other'}),upsert:vi.fn()}};
  const db={projectMember:{findFirst:vi.fn().mockResolvedValue({projectRole:'manager'})},$transaction:vi.fn(async(fn:(tx:unknown)=>Promise<unknown>)=>fn(tx))};
  await expect(ingestDesktopGitHub(db as unknown as PrismaClient,actor,batch)).rejects.toThrow('organization');expect(tx.gitHubInstallation.upsert).not.toHaveBeenCalled();
 });
});
