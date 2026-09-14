import {useEffect,useRef,useState} from 'react';
import {apiJson} from '../../lib/api/client';

type Repository={githubRepositoryId:string;owner:string;name:string;fullName:string;installationId:string};
const buttonStyle='font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--terracotta-text)] disabled:opacity-50';

export default function SharedGitHubRepositories({projectId,onChanged}:{projectId:string;onChanged:()=>void|Promise<void>}){
 const [repos,setRepos]=useState<Repository[]|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const alive=useRef(true),running=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function run(operation:()=>Promise<void>){
  if(running.current)return;running.current=true;setBusy(true);setError('');setNotice('');
  try{await operation();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'GitHub setup failed.');}
  finally{running.current=false;if(alive.current)setBusy(false);}
 }
 async function load(){
  const installations=await apiJson<Array<{id:string;status:string}>>('/v1/github/installations');
  const lists=await Promise.all(installations.filter(i=>i.status==='active').map(async i=>(await apiJson<Repository[]>(`/v1/github/installations/${encodeURIComponent(i.id)}/repositories`)).map(r=>({...r,installationId:i.id}))));
  if(alive.current){setRepos(lists.flat());setSelected('');}
 }
 async function link(){
  const repo=repos?.find(r=>`${r.installationId}:${r.githubRepositoryId}`===selected);if(!repo)return;
  const result=await apiJson<{id:string}>(`/v1/projects/${projectId}/github/repositories/link`,{method:'POST',body:JSON.stringify({installationId:repo.installationId,githubRepositoryId:repo.githubRepositoryId,owner:repo.owner,name:repo.name})});
  const confirmed=await apiJson<{linkedRepositories:Array<{id:string;status:string}>}>(`/v1/projects/${projectId}/github`);
  if(!confirmed.linkedRepositories.some(r=>r.id===result.id&&r.status==='active'))throw new Error('Repository link could not be confirmed. Refresh and try again.');
  if(alive.current){await onChanged();if(alive.current){setNotice(`${repo.fullName} linked. Use Sync to import engineering evidence; no product truth is approved.`);setRepos(null);}}
 }
 return <div className="mt-3 text-[var(--text-muted)]">
  <button type="button" className={buttonStyle} disabled={busy} onClick={()=>void run(load)}>Choose GitHub repository</button>
  {busy&&<p role="status" className="mt-2 text-sm">Checking GitHub…</p>}
  {error&&<p role="alert" className="mt-2 text-sm">{error}</p>}
  {notice&&<p role="status" className="mt-2 text-sm">{notice}</p>}
  {repos&&(!repos.length?<p className="mt-2 text-sm">No authorized repositories. Use Connect to install the app on selected repositories first.</p>:<div className="mt-2 flex flex-col gap-2">
   <label className="text-sm">Authorized GitHub repository<select aria-label="Authorized GitHub repository" className="w-full rounded border border-[var(--border-soft)] bg-[var(--bg-inset)] p-2 text-[var(--text-default)]" disabled={busy} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select a repository</option>{repos.map(r=><option key={`${r.installationId}:${r.githubRepositoryId}`} value={`${r.installationId}:${r.githubRepositoryId}`}>{r.fullName}</option>)}</select></label>
   <button type="button" className={buttonStyle} disabled={busy||!selected} onClick={()=>void run(link)}>Link selected repository</button>
  </div>)}
 </div>;
}
