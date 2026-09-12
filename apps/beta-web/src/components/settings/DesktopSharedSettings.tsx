import {useEffect,useState} from 'react';
import type {SharedServer} from '../../lib/desktop';
const inputClass='w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-default)]';
const buttonClass='rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)] disabled:opacity-40';
export default function DesktopSharedSettings(){
 const [servers,setServers]=useState<SharedServer[]>([]),[name,setName]=useState(''),[origin,setOrigin]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const bridge=window.orchestra?.shared;
 useEffect(()=>{let active=true;if(!bridge){setLoading(false);setError('Update the desktop package to connect a shared server.');return;}
  void bridge.list().then(result=>{if(!active)return;if(!result.ok)throw new Error(result.error?.message??'Saved servers could not be read.');setServers(result.data as SharedServer[]);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Saved servers could not be read.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[bridge]);
 async function run(action:'connect'|'open'|'remove',id?:string){
  if(!bridge||busy)return;setBusy(true);setError('');
  try{const result=await(action==='connect'?bridge.connect({name,origin}):action==='open'?bridge.open(id!):bridge.remove(id!));if(!result.ok)throw new Error(result.error?.message??'The server action was not confirmed.');const current=await bridge.list();if(!current.ok)throw new Error(current.error?.message??'Saved servers could not be refreshed.');setServers(current.data as SharedServer[]);}
  catch(cause){setError(cause instanceof Error?cause.message:'The server action was not confirmed.');}finally{setBusy(false);}
 }
 return <section aria-labelledby="desktop-shared-heading" className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5">
  <h2 id="desktop-shared-heading" className="font-sans text-lg text-[var(--text-default)]">Shared team servers</h2>
  <p className="mt-2 text-sm text-[var(--text-muted)]">A shared workspace opens in a separate window and uses its server’s account, roles and storage. Local evidence and credentials are never published automatically. Shared offline caching is disabled.</p>
  {loading&&<p role="status">Reading saved servers…</p>}
  <form onSubmit={event=>{event.preventDefault();void run('connect');}} className="mt-4 grid gap-3">
   <label className="text-sm text-[var(--text-muted)]">Server name<input required maxLength={100} value={name} onChange={event=>setName(event.target.value)} disabled={busy||loading} className={inputClass}/></label>
   <label className="text-sm text-[var(--text-muted)]">Server HTTPS address<input required type="url" maxLength={2048} placeholder="https://orchestra.your-team.example" value={origin} onChange={event=>setOrigin(event.target.value)} disabled={busy||loading} className={inputClass}/></label>
   <button type="submit" disabled={!bridge||busy||loading} className={buttonClass}>{busy?'Working…':'Connect team server'}</button>
  </form>
  {error&&<p role="alert" className="mt-3 text-sm text-[var(--text-default)]">{error}</p>}
  {servers.length>0&&<ul className="mt-4 grid gap-3">{servers.map(server=><li key={server.id} className="rounded-lg border border-[var(--border-soft)] p-3"><p className="text-sm text-[var(--text-default)]">{server.name}</p><p className="break-all text-xs text-[var(--text-muted)]">{server.origin}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={()=>void run('open',server.id)}>Open {server.name}</button><button type="button" disabled={busy} className={buttonClass} onClick={()=>void run('remove',server.id)}>Sign out and remove</button></div></li>)}</ul>}
 </section>;
}
