import {useEffect,useState} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {desktopBootstrap} from '../lib/desktop';
import DesktopSharedSettings from '../components/settings/DesktopSharedSettings';
export function DesktopOnboardingPage(){
 const {status,activeProject}=useAuth(),navigate=useNavigate(),location=useLocation();
 const [accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [startup,setStartup]=useState<{entry:string;checked:boolean;error:string|null}|null>(null),[attempt,setAttempt]=useState(0);
 const explicit=location.pathname==='/onboarding',hasActiveProject=!!activeProject;
 useEffect(()=>{
  if(status!=='authenticated'||explicit){setStartup(null);return;}
  let cancelled=false;setStartup({entry:location.key,checked:false,error:null});
  void desktopBootstrap<{onboarded:boolean}>().then(result=>{
   if(cancelled)return;
   if(typeof result?.onboarded!=='boolean')throw new Error('Saved setup status could not be confirmed. Retry startup.');
   if(result.onboarded)navigate(hasActiveProject?'/memory':'/workspaces',{replace:true});
   else setStartup({entry:location.key,checked:true,error:null});
  }).catch(reason=>{if(!cancelled)setStartup({entry:location.key,checked:false,error:reason instanceof Error?reason.message:'Saved setup status could not be checked. Retry startup.'});});
  return()=>{cancelled=true;};
 },[status,explicit,location.key,hasActiveProject,navigate,attempt]);
 async function proceed(){if(!accepted||busy)return;setBusy(true);setError(null);try{const result=await window.orchestra!.completeOnboarding();if(!result.ok)throw new Error(result.error?.message??'Setup could not be saved');navigate('/workspaces',{replace:true});}catch(reason){setError(reason instanceof Error?reason.message:'Setup failed');}finally{setBusy(false);}}
 if(!explicit&&(status!=='authenticated'||startup?.entry!==location.key||!startup.checked)){
  const startupError=startup?.entry===location.key?startup.error:null;
  return <main className="min-h-screen bg-bg px-6 py-10"><section className="mx-auto flex w-full max-w-[980px] flex-col gap-8">
   <header className="rounded-[24px] border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] px-8 py-8"><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Orchestra on your Mac</p><h1 className="mt-2 font-sans text-[38px] leading-none text-[var(--text-default)]">{startupError?'Orchestra could not finish starting':'Opening Orchestra'}</h1>
    {startupError?<><p role="alert">{startupError}</p><button onClick={()=>{setStartup(null);setAttempt(value=>value+1);}} disabled={status!=='authenticated'} className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[#1A1612] px-5 font-sans text-[13px] font-medium text-white disabled:opacity-50">Retry startup</button></>:<p role="status">{status==='authenticated'?'Checking saved setup…':'Waiting for local runtime…'}</p>}
   </header>
  </section></main>;
 }
 return <main className="min-h-screen bg-bg px-6 py-10"><section className="mx-auto flex w-full max-w-[980px] flex-col gap-8">
  <header className="rounded-[24px] border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] px-8 py-8"><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Orchestra on your Mac</p><h1 className="mt-2 font-sans text-[38px] leading-none text-[var(--text-default)]">Your product brain, locally</h1></header>
  <section aria-label="Workspace mode" className="grid gap-4 md:grid-cols-2">
   <div className="rounded-[20px] border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] p-6"><h2>Local workspace</h2><p>No hosted account required. Files, evidence and accepted decisions stay in this app’s private storage on your Mac.</p></div>
   <DesktopSharedSettings/>
  </section>
  <section className="rounded-[20px] border border-[rgba(26,22,18,0.08)] bg-[var(--bg-card)] p-6"><h2>Privacy and AI</h2><p>Credentials use macOS-protected storage. Document and database protection relies on your Mac’s disk encryption. Configuring external AI sends relevant evidence to your selected provider for processing.</p><p>Offline reading and evidence search require no AI key. You can configure or remove AI access in Settings; generated answers and research require that setup.</p>
   <label className="mt-4 flex gap-3"><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)}/>I understand how local storage and optional AI processing work.</label>
   {error?<p role="alert">{error}</p>:null}
   <button onClick={()=>void proceed()} disabled={!accepted||busy||status!=='authenticated'} className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[#1A1612] px-5 font-sans text-[13px] font-medium text-white disabled:opacity-50">{busy?'Saving setup…':'Continue locally'}</button>
  </section>
 </section></main>;
}
