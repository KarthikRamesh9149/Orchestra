import {z} from 'zod';
import {githubRead,listGitHubRepositories,type GitHubCredential} from './github-oauth.js';
import {desktopGitHubRepositorySchema,type DesktopGitHubItem} from '../../../src/desktop/github-contract.js';
import {sanitizePayload} from '../../../src/modules/github/normalizers.js';
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const pull=z.object({number:z.number().int().positive(),title:z.string().max(4000),body:z.string().max(100000).nullable(),state:z.enum(['open','closed']),updated_at:z.string().datetime(),head:z.object({sha}),base:z.object({ref:z.string().max(255)})});
const commit=z.object({sha,commit:z.object({message:z.string().max(100000),committer:z.object({date:z.string().datetime()})})});
const text=(value:string)=>String((sanitizePayload({body:value}) as {body:string}).body);

/** User-selected bounded snapshot. No secret, arbitrary URL or accepted truth crosses IPC. */
export async function readGitHubSnapshot(credential:GitHubCredential,repositoryId:number,fetcher:typeof fetch=fetch){
 z.number().int().positive().parse(repositoryId);
 const selected=(await listGitHubRepositories(credential,fetcher)).find(repo=>repo.id===repositoryId);
 if(!selected)throw new Error('Repository is not authorized for this desktop installation');
 const repository=desktopGitHubRepositorySchema.parse(selected);
 async function read(kind:'pulls'|'commits'):Promise<DesktopGitHubItem[]>{
  const items:DesktopGitHubItem[]=[],seen=new Set<string>();
  for(let page=1;page<=3;page++){
   const query=kind==='pulls'?'state=all&sort=updated&direction=desc':'';
   const rows=z.array(z.unknown()).max(100).parse(await githubRead(`/repos/${repository.full_name}/${kind}?${query}&per_page=100&page=${page}`,credential.accessToken,fetcher));
   if(items.length+rows.length>200)throw new Error('GitHub snapshot exceeds the 200-record per-kind limit');
   for(const row of rows){
    let item:DesktopGitHubItem;
    if(kind==='pulls'){
     const p=pull.parse(row);item={evidenceType:'github_pull_request',providerId:`pr:${repository.id}:${p.number}`,title:text(p.title),summary:text(p.body??''),sha:p.head.sha,branch:p.base.ref,pullRequestNumber:p.number,status:p.state,sourceUrl:`https://github.com/${repository.full_name}/pull/${p.number}`,occurredAt:p.updated_at};
    }else{
     const c=commit.parse(row);item={evidenceType:'github_commit',providerId:`commit:${repository.id}:${c.sha}`,title:text(c.commit.message.split('\n')[0]??''),summary:text(c.commit.message),sha:c.sha,branch:null,pullRequestNumber:null,status:'observed',sourceUrl:`https://github.com/${repository.full_name}/commit/${c.sha}`,occurredAt:c.commit.committer.date};
    }
    if(seen.has(item.providerId))throw new Error('GitHub pagination returned duplicate evidence');
    seen.add(item.providerId);items.push(item);
   }
   if(rows.length<100)return items;
  }
  throw new Error('GitHub snapshot pagination exceeds limit');
 }
 const [pulls,commits]=await Promise.all([read('pulls'),read('commits')]);
 return {repository,items:[...pulls,...commits]};
}
