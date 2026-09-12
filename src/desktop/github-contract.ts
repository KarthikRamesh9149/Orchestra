import {z} from 'zod';
const repositoryName=z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).refine(value=>value.split('/').every(part=>part!=='.'&&part!=='..'));
export const desktopGitHubRepositorySchema=z.object({id:z.number().int().positive(),installationId:z.number().int().positive(),full_name:repositoryName,private:z.boolean(),default_branch:z.string().min(1).max(255)}).strict();
export const desktopGitHubItemSchema=z.object({
 evidenceType:z.enum(['github_pull_request','github_commit']),providerId:z.string().min(1).max(150),
 title:z.string().max(4000),summary:z.string().max(4000),sha:z.string().regex(/^[a-f0-9]{40}$/),
 branch:z.string().max(255).nullable(),pullRequestNumber:z.number().int().positive().nullable(),
 status:z.string().max(40),sourceUrl:z.string().url().max(1000),occurredAt:z.string().datetime()
}).strict();
export const desktopGitHubBatchSchema=z.object({operation:z.literal('desktop.github.ingest'),projectId:z.string().uuid(),repository:desktopGitHubRepositorySchema,items:z.array(desktopGitHubItemSchema).max(400)}).strict().superRefine((value,ctx)=>{
 const keys=new Set<string>();
 for(const item of value.items){
  const isPr=item.evidenceType==='github_pull_request';
  const expectedId=isPr?`pr:${value.repository.id}:${item.pullRequestNumber}`:`commit:${value.repository.id}:${item.sha}`;
  const expectedUrl=`https://github.com/${value.repository.full_name}/${isPr?'pull/'+item.pullRequestNumber:'commit/'+item.sha}`;
  if(item.providerId!==expectedId||item.sourceUrl!==expectedUrl||(isPr?item.pullRequestNumber===null:item.pullRequestNumber!==null)||keys.has(expectedId))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Inconsistent or duplicate GitHub provenance'});
  keys.add(expectedId);
 }
});
export type DesktopGitHubItem=z.infer<typeof desktopGitHubItemSchema>;
export type DesktopGitHubBatch=z.infer<typeof desktopGitHubBatchSchema>;
