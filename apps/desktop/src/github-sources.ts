import {z} from 'zod';
import {githubRead,listGitHubRepositories,type GitHubCredential} from './github-oauth.js';
import {desktopGitHubRepositorySchema,type DesktopGitHubItem} from '../../../src/desktop/github-contract.js';
import {sanitizePayload} from '../../../src/modules/github/normalizers.js';
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const pull=z.object({number:z.number().int().positive(),title:z.string().max(4000),body:z.string().max(100000).nullable(),state:z.enum(['open','closed']),updated_at:z.string().datetime(),head:z.object({sha}),base:z.object({ref:z.string().max(255)})});
const commit=z.object({sha,commit:z.object({message:z.string().max(100000),committer:z.object({date:z.string().datetime()})})});
const text=(value:string)=>String((sanitizePayload({body:value}) as {body:string}).body);
const page=z.object({next:z.number().int().min(1).max(1_000_000),last:z.string().max(200).optional()}).strict();
export const githubCheckpointSchema=z.object({pulls:page.nullable(),commits:page.nullable(),commitHead:sha.optional()}).strict();
export type GitHubCheckpoint=z.infer<typeof githubCheckpointSchema>;

/** User-selected bounded snapshot. No secret, arbitrary URL or accepted truth crosses IPC. */
export async function readGitHubSnapshot(credential:GitHubCredential,repositoryId:number,fetcher:typeof fetch=fetch,resume?:GitHubCheckpoint){
 z.number().int().positive().parse(repositoryId);
 const selected=(await listGitHubRepositories(credential,fetcher)).find(repo=>repo.id===repositoryId);
 if(!selected)throw new Error('Repository is not authorized for this desktop installation');
 const repository=desktopGitHubRepositorySchema.parse(selected);
 const state:GitHubCheckpoint=resume?githubCheckpointSchema.parse(resume):{pulls:{next:1},commits:{next:1}};
 // New pull requests append after this ascending cursor; updates cannot
 // shift earlier pages. Commit history is pinned to the initial head SHA.
 async function read(kind:'pulls'|'commits'){
  const items:DesktopGitHubItem[]=[],seen=new Set<string>();
  let cursor=state[kind];
  if(cursor?.last)seen.add(cursor.last);
  for(let pages=0;cursor&&pages<2;pages++){
   const query=kind==='pulls'?'state=all&sort=created&direction=asc&':state.commitHead?`sha=${state.commitHead}&`:'';
   const rows=z.array(z.unknown()).max(100).parse(await githubRead(`/repos/${repository.full_name}/${kind}?${query}per_page=100&page=${cursor.next}`,credential.accessToken,fetcher));
   for(const row of rows){
    let item:DesktopGitHubItem;
    if(kind==='pulls'){
     const p=pull.parse(row);item={evidenceType:'github_pull_request',providerId:`pr:${repository.id}:${p.number}`,title:text(p.title),summary:text(p.body??''),sha:p.head.sha,branch:p.base.ref,pullRequestNumber:p.number,status:p.state,sourceUrl:`https://github.com/${repository.full_name}/pull/${p.number}`,occurredAt:p.updated_at};
    }else{
     const c=commit.parse(row);state.commitHead??=c.sha;
     item={evidenceType:'github_commit',providerId:`commit:${repository.id}:${c.sha}`,title:text(c.commit.message.split('\n')[0]??''),summary:text(c.commit.message),sha:c.sha,branch:null,pullRequestNumber:null,status:'observed',sourceUrl:`https://github.com/${repository.full_name}/commit/${c.sha}`,occurredAt:c.commit.committer.date};
    }
    if(seen.has(item.providerId))throw new Error('GitHub pagination returned duplicate evidence');
    seen.add(item.providerId);items.push(item);
   }
   cursor=rows.length===100?{next:cursor.next+1,last:items.at(-1)!.providerId}:null;
  }
  state[kind]=cursor;
  return items;
 }
 const [pulls,commits]=await Promise.all([read('pulls'),read('commits')]);
 return {repository,items:[...pulls,...commits],checkpoint:state.pulls||state.commits?githubCheckpointSchema.parse(state):null};
}
