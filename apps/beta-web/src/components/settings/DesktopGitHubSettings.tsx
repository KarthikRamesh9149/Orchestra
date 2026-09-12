import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../context/AuthContext';
type Result={ok:boolean;data?:unknown;error?:{message:string}};
type GitHubApi={inspect():Promise<Result>;connect():Promise<Result>;cancel():Promise<Result>;repositories():Promise<Result>;disconnect():Promise<Result>;importRepository(input:{projectId:string;repositoryId:number}):Promise<Result>};
const api=()=> (window.orchestra as unknown as {github?:GitHubApi}|undefined)?.github;
const buttonStyle='rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)] disabled:opacity-40';
export default function DesktopGitHubSettings(){
 const {activeProject}=useAuth();
 const [selected,setSelected]=useState(''),[notice,setNotice]=useState('');
 const [configured,setConfigured]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [repositories,setRepositories]=useState<Array<{id:number;full_name:string}>|null>(null);
 const running=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const service=api();if(!service){setError('Update the desktop package to configure GitHub.');return;}
  void service.inspect().then(result=>{if(!result.ok)throw new Error(result.error?.message??'GitHub status unavailable');if(mounted.current)setConfigured((result.data as {configured:boolean}).configured);}).catch(error=>{if(mounted.current)setError(error instanceof Error?error.message:'GitHub status unavailable');});
  return()=>{mounted.current=false;};
 },[]);
 async function action(kind:'connect'|'repositories'|'disconnect'|'inspect'){
  const service=api();if(!service||running.current)return;running.current=true;setBusy(true);setError('');
  try{const result=await service[kind]();if(!result.ok)throw new Error(result.error?.message??'GitHub operation failed');if(!mounted.current)return;
   if(kind==='repositories'){setRepositories(result.data as Array<{id:number;full_name:string}>);setSelected('');}
   else{const state=kind==='inspect'?result:await service.inspect();if(!state.ok)throw new Error('GitHub state could not be confirmed');if(mounted.current){setConfigured((state.data as {configured:boolean}).configured);setRepositories(null);}}
  }catch(error){if(mounted.current)setError(error instanceof Error?error.message:'GitHub operation failed');}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 async function importSelected(){
  const service=api();if(!service||running.current||!activeProject||!selected)return;
  running.current=true;setBusy(true);setError('');setNotice('');
  try{const result=await service.importRepository({projectId:activeProject.id,repositoryId:Number(selected)});if(!result.ok)throw new Error(result.error?.message??'GitHub import failed');
   const data=result.data as {cancelled?:boolean;created:number;updated:number;evidenceCount:number};
   if(mounted.current&&!data.cancelled)setNotice(`${data.evidenceCount} GitHub evidence records confirmed: ${data.created} new, ${data.updated} updated. No product truth was approved.`);
  }catch(error){if(mounted.current)setError(error instanceof Error?error.message:'GitHub import failed');}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 return <section aria-labelledby="desktop-github-heading" className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5">
  <h2 id="desktop-github-heading" className="font-sans text-lg text-[var(--text-default)]">Desktop GitHub</h2>
  <p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{busy?'Working… Check the native confirmation and GitHub browser prompt.':configured===null?(error?'GitHub status could not be confirmed.':'Reading protected GitHub settings…'):configured?'GitHub credentials saved on this Mac.':'Not connected on this Mac.'}</p>
  <p className="mt-2 text-sm text-[var(--text-muted)]">Read-only access to selected GitHub App repositories. Credentials stay encrypted on this Mac. Snapshots cover up to 200 pull requests and 200 commits, with redacted text excerpts of up to 4,000 characters. No source files or release certification. Sign-in and listing do not import content. After importing, opt in below under Selected-source refresh.</p>
  {error&&<p role="alert" className="mt-2 text-sm text-[var(--text-default)]">{error}</p>}
  <div className="mt-4 flex gap-3"><button type="button" disabled={busy||configured===null} onClick={()=>void action(configured?'disconnect':'connect')} className={buttonStyle}>{configured?'Remove GitHub from this Mac':'Connect desktop GitHub'}</button>
   {configured===null&&error&&<button type="button" disabled={busy||!api()} onClick={()=>void action('inspect')} className={buttonStyle}>Retry GitHub status</button>}
   {busy&&!configured&&<button type="button" onClick={()=>void api()?.cancel().catch(()=>setError('Cancellation could not be confirmed.'))} className={buttonStyle}>Cancel GitHub sign-in</button>}
   {configured&&<button type="button" disabled={busy} onClick={()=>void action('repositories')} className={buttonStyle}>List authorized repositories</button>}
  </div>
  {configured&&<p className="mt-2 text-sm text-[var(--text-muted)]">Local removal does not revoke the GitHub grant. Revoke Orchestra Desktop in GitHub’s Authorized GitHub Apps settings.</p>}
  {repositories&&<ul aria-label="Authorized GitHub repositories" className="mt-4 text-sm text-[var(--text-default)]">{repositories.length?repositories.map(repo=><li key={repo.id}>{repo.full_name}</li>):<li>No repositories are available through this read-only desktop installation.</li>}</ul>}
  {configured&&repositories&&repositories.length>0&&<div className="mt-4 grid gap-3">
   <label className="text-sm text-[var(--text-muted)]">Repository to import<select value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)} className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2"><option value="">Select a repository</option>{repositories.map(repo=><option key={repo.id} value={repo.id}>{repo.full_name}</option>)}</select></label>
   <button type="button" disabled={busy||!selected||!activeProject} onClick={()=>void importSelected()} className={buttonStyle}>Import selected GitHub repository</button>
  </div>}
  {notice&&<p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{notice}</p>}
 </section>;
}
