import {useEffect,useState} from 'react';

type Preferences={generationModel:string;embeddingModel:'text-embedding-3-small';embeddingDimensions:1536;maxRequestsPerDay:number;maxOutputTokens:number};
const defaults:Preferences={generationModel:'gpt-5.4-mini',embeddingModel:'text-embedding-3-small',embeddingDimensions:1536,maxRequestsPerDay:50,maxOutputTokens:2048};
const inputClass='w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-default)]';
export default function DesktopAiSettings(){
 const [preferences,setPreferences]=useState(defaults),[configured,setConfigured]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;const api=window.orchestra?.ai;if(!api){setLoading(false);setError('Update the desktop package to configure AI.');return;}
  void api.inspect().then(result=>{if(!active)return;if(!result.ok)throw new Error(result.error?.message??'AI settings could not be read.');const state=result.data as {configured:boolean;preferences:Preferences|null};setConfigured(state.configured);if(state.preferences)setPreferences(state.preferences);}).catch(caught=>{if(active)setError(caught instanceof Error?caught.message:'AI settings could not be read.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[]);
 async function change(remove=false){const api=window.orchestra?.ai;if(!api||busy)return;setBusy(true);setError('');try{const result=await(remove?api.revoke():api.configure(preferences));if(!result.ok)throw new Error(result.error?.message??'AI settings were not saved.');}catch(caught){setError(caught instanceof Error?caught.message:'AI settings were not saved.');}finally{setBusy(false);}}
 return <section aria-labelledby="desktop-ai-heading" className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5">
  <h2 id="desktop-ai-heading" className="font-sans text-lg text-[var(--text-default)]">Desktop AI</h2>
  <p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{loading?'Reading protected settings…':configured?'OpenAI key saved on this Mac.':'Offline evidence search is available. No AI key is saved.'}</p>
  <p className="mt-2 text-sm text-[var(--text-muted)]">AI sends relevant evidence to OpenAI using your API account. Your key is imported by a native prompt, encrypted by macOS, and never entered in this page. Saving or removing access restarts Orchestra.</p>
  <form onSubmit={event=>{event.preventDefault();void change();}} className="mt-4 grid gap-3">
   <label className="text-sm text-[var(--text-muted)]">Generation model<input required maxLength={100} pattern="[a-zA-Z0-9][a-zA-Z0-9._:\-]*" disabled={loading||busy} className={inputClass} value={preferences.generationModel} onChange={event=>setPreferences({...preferences,generationModel:event.target.value})}/></label>
   <label className="text-sm text-[var(--text-muted)]">Maximum requests per 24 hours<input type="number" required min={1} max={1000} disabled={loading||busy} className={inputClass} value={preferences.maxRequestsPerDay} onChange={event=>setPreferences({...preferences,maxRequestsPerDay:Number(event.target.value)})}/></label>
   <label className="text-sm text-[var(--text-muted)]">Maximum output tokens per request<input type="number" required min={128} max={8192} disabled={loading||busy} className={inputClass} value={preferences.maxOutputTokens} onChange={event=>setPreferences({...preferences,maxOutputTokens:Number(event.target.value)})}/></label>
   <p className="text-xs text-[var(--text-muted)]">The shared request allowance includes generation and embeddings, including failed attempts. It is not a dollar spending cap. Embeddings are currently fixed to text-embedding-3-small / 1536 dimensions; switching embedding models is not yet available.</p>
   {error&&<p role="alert" className="text-sm text-[var(--text-default)]">{error}</p>}
   <div className="flex flex-wrap gap-3"><button type="submit" disabled={loading||busy||!window.orchestra?.ai} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)] disabled:opacity-40">{busy?'Working…':'Import key, test and restart'}</button>{configured&&<button type="button" disabled={busy} onClick={()=>void change(true)} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)] disabled:opacity-40">Remove AI access</button>}</div>
  </form>
 </section>;
}
