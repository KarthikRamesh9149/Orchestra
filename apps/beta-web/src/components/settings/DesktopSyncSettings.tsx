import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../context/AuthContext';
type Target={id:string;projectId:string;provider:'drive'|'github'|'slack';resourceIds:string[];enabled:boolean;lastSuccessAt?:string;lastAttemptAt?:string;error?:string|null};
type Result={ok:boolean;data?:{targets?:Target[];running?:boolean};error?:{message:string}};
type Api={inspect():Promise<Result>;update(input:{id:string;action:'enable'|'pause'|'remove'|'refresh'}):Promise<Result>;cancel():Promise<Result>};
const api=()=> (window.orchestra as unknown as {sync?:Api}|undefined)?.sync;
export default function DesktopSyncSettings(){
 const {activeProject}=useAuth();const [targets,setTargets]=useState<Target[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[running,setRunning]=useState(false);
 const mounted=useRef(true),locked=useRef(false);
 const reload=async()=>{const service=api();if(!service)throw new Error('Update the desktop package for selected-source refresh');const result=await service.inspect();if(!result.ok)throw new Error(result.error?.message??'Refresh status unavailable');if(mounted.current){setTargets(result.data?.targets??[]);setRunning(!!result.data?.running);}};
 useEffect(()=>{mounted.current=true;const read=()=>void reload().catch(e=>{if(mounted.current)setError(e.message);});read();const timer=setInterval(read,15000);return()=>{mounted.current=false;clearInterval(timer);};},[]);
 async function action(id:string,action:'enable'|'pause'|'remove'|'refresh'){
  const service=api();if(!service||locked.current)return;locked.current=true;setBusy(true);setError('');
  try{const result=await service.update({id,action});if(!result.ok)throw new Error(result.error?.message??'Refresh operation failed');await reload();}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Refresh operation failed');}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 const shown=targets.filter(t=>t.projectId===activeProject?.id),names={drive:'Google Drive',github:'GitHub',slack:'Slack'};
 const button='rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)] disabled:opacity-40';
 return <section aria-labelledby="desktop-sync-heading" className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5">
  <h2 id="desktop-sync-heading" className="text-sm font-semibold text-[var(--text-default)]">Selected-source refresh</h2>
  <p className="mt-2 text-xs text-[var(--text-muted)]">Import a source first, then opt in to automatic checks about every five minutes while Orchestra is open and after wake. Existing snapshot limits apply. Pausing or removing a selection keeps its imported evidence.</p>
  {error&&<p role="alert" className="mt-3 text-xs text-[var(--text-default)]">{error}</p>}
  {!shown.length&&<p className="mt-3 text-xs text-[var(--text-muted)]">No saved refresh selections in this workspace yet.</p>}
  <ul className="mt-3 grid gap-3">{shown.map(t=><li key={t.id} aria-label={`${names[t.provider]} refresh selection`}>
   <p role="status" className="text-xs text-[var(--text-muted)]">{names[t.provider]} · {t.resourceIds.length} selected · {t.enabled?'Automatic checks enabled':'Automatic checks paused'} · {t.error?'Last check failed; reconnect or retry.':t.lastSuccessAt?`Last successful check ${new Date(t.lastSuccessAt).toLocaleString()}`:'Not checked yet'}</p>
   <div className="mt-2 flex gap-3"><button className={button} disabled={busy||running} onClick={()=>void action(t.id,'refresh')}>Refresh now</button><button className={button} disabled={busy||running} onClick={()=>void action(t.id,t.enabled?'pause':'enable')}>{t.enabled?'Pause automatic refresh':'Enable automatic refresh'}</button><button className={button} disabled={busy||running} onClick={()=>void action(t.id,'remove')}>Remove refresh selection</button></div>
  </li>)}</ul>
  {running&&<button className={button} onClick={()=>void api()?.cancel().catch(()=>setError('Cancellation could not be confirmed'))}>Cancel current refresh</button>}
 </section>;
}
