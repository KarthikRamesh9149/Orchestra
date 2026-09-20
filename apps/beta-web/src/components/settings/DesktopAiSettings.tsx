import {useEffect,useState} from 'react';
import {isSharedDesktop,type DesktopAiPreferences,type DesktopAiProvider,type DesktopAiState} from '../../lib/desktop';

const defaults:DesktopAiPreferences={provider:'openai',generationModel:'gpt-5.4-mini',embeddingProvider:'none',embeddingModel:'text-embedding-3-small',embeddingDimensions:1536,maxRequestsPerDay:50,maxOutputTokens:2048};
const providers:Record<DesktopAiProvider,string>={openai:'OpenAI',anthropic:'Anthropic',google:'Google Gemini','openai-compatible':'OpenAI-compatible API'};
const destinations:Record<DesktopAiProvider,string>={openai:'https://api.openai.com/v1/responses',anthropic:'https://api.anthropic.com/v1/messages',google:'https://generativelanguage.googleapis.com/v1beta','openai-compatible':''};
const inputClass='w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2 text-sm text-[var(--text-default)]';
const buttonClass='rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)] disabled:opacity-40';
const modelPattern='[a-zA-Z0-9][a-zA-Z0-9._:\\/+\\-]*';

export default function DesktopAiSettings(){
 const shared=isSharedDesktop();
 const [preferences,setPreferences]=useState(defaults),[saved,setSaved]=useState<DesktopAiState|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [generationKeyReady,setGenerationKeyReady]=useState(false),[embeddingKeyReady,setEmbeddingKeyReady]=useState(false),[tested,setTested]=useState(false);
 const provider=preferences.provider??'openai';
 const embeddingProvider=preferences.embeddingProvider??(provider==='openai'?'openai':'none');
 const needsEmbeddingKey=embeddingProvider==='openai-compatible'||(embeddingProvider==='openai'&&provider!=='openai');
 const api=window.orchestra?.ai;
 const available=!!api?.importKey&&!!api?.test&&!!api?.discardDraft;
 useEffect(()=>{
  if(shared){setLoading(false);return;}
  let active=true;const bridge=window.orchestra?.ai;
  if(!bridge?.importKey||!bridge.test||!bridge.discardDraft){setLoading(false);setError('Update the desktop package to configure AI.');return;}
  void bridge.inspect().then(result=>{
   if(!active)return;
   if(!result.ok)throw new Error(result.error?.message??'AI settings could not be read.');
   const state=result.data as DesktopAiState;setSaved(state);
   if(state.preferences)setPreferences(state.preferences);
   setGenerationKeyReady(state.configured);setEmbeddingKeyReady(state.configured);
  }).catch(caught=>{if(active)setError(caught instanceof Error?caught.message:'AI settings could not be read.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;void bridge.discardDraft().catch(()=>{});};
 },[shared]);
 function edit(next:DesktopAiPreferences,connectionChanged:false|'generation'|'embedding'=false){
  setPreferences(next);setTested(false);setNotice('');setError('');
  if(connectionChanged){
   if(connectionChanged==='generation')setGenerationKeyReady(false);setEmbeddingKeyReady(false);
   void api?.discardDraft(connectionChanged==='embedding'?'embedding':undefined).then(result=>{if(!result.ok)setError('Could not discard the pending key. Reopen settings before continuing.');}).catch(()=>setError('Could not discard the pending key. Reopen settings before continuing.'));
  }
 }
 async function act(action:'generation'|'embedding'|'test'|'save'|'revoke'){
  if(!api||!available||busy||shared||!saved)return;
  setBusy(true);setError('');setNotice('');
  if(action!=='save'&&action!=='revoke')setTested(false);
  try{
   const result=await(action==='generation'||action==='embedding'?api.importKey({target:action,preferences}):action==='test'?api.test(preferences):action==='save'?api.configure(preferences):api.revoke());
   if(!result.ok)throw new Error(result.error?.message??'AI settings could not be updated.');
   const data=result.data as {cancelled?:boolean;imported?:boolean;tested?:boolean;restarting?:boolean}|undefined;
   if(data?.cancelled){setNotice('Cancelled. Saved AI settings are unchanged.');return;}
   if(data?.imported){if(action==='generation')setGenerationKeyReady(true);else setEmbeddingKeyReady(true);setNotice('API key added in native memory. Test connection, then save within 15 minutes.');}
   if(action==='test'&&data?.tested){setTested(true);setNotice('Connection test passed for these settings. Save to use them. Other models and workflows are not certified by this test.');}
   if(data?.restarting)setNotice('Settings confirmed. Orchestra is restarting.');
  }catch(caught){setError(caught instanceof Error?caught.message:'AI settings could not be updated.');}finally{setBusy(false);}
 }
 const disabled=loading||busy||!available||!saved;
 return <section aria-labelledby="desktop-ai-heading" className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5">
  <h2 id="desktop-ai-heading" className="font-sans text-lg text-[var(--text-default)]">Desktop AI</h2>
  {shared?<p role="status" className="mt-2 text-sm text-[var(--text-muted)]">AI in this shared workspace is configured by your team server administrator. Local API keys are not sent to the shared server and cannot configure its AI. Open your local Orchestra window to add an API key for local workspaces.</p>:<>
   <p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{loading?'Reading protected settings…':!saved?'AI key status could not be read. Saved settings have not been confirmed.':saved.configured?`${providers[saved.preferences?.provider??'openai']} key saved on this Mac.`:'Offline evidence search is available. No AI key is saved.'}</p>
   {!loading&&<p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{saved?.semanticSearchAvailable===true&&saved.semanticSearchReason===null?'Semantic search is available with the current embedding identity. Lexical evidence search remains available.':saved?.semanticSearchAvailable===false&&saved.semanticSearchReason==='embedding_reindex_required'?'Lexical-only search: embedding reindex required. The saved embedding identity differs from the local index. Semantic search remains disabled until a verified reindex is completed. Saving or testing an API key does not reindex existing evidence.':saved?.semanticSearchAvailable===false&&saved.semanticSearchReason==='not_configured'?'Lexical-only search: embeddings are not configured. AI generation can still use your saved provider.':'Search capability status could not be confirmed from the local engine. A saved API key does not mean semantic search is available. Reopen Orchestra to retry.'}</p>}
   <p className="mt-2 text-sm text-[var(--text-muted)]">Select provider → Add API key → choose model → Test connection → Save. Keys are imported by a native clipboard prompt, encrypted by macOS when saved, and never entered in this page. Saving or removing access restarts Orchestra.</p>
   <form onSubmit={event=>{event.preventDefault();void act('test');}} className="mt-4 grid gap-3">
    <label className="text-sm text-[var(--text-muted)]">Select provider<select disabled={disabled} className={inputClass} value={provider} onChange={event=>{
     const nextProvider=event.target.value as DesktopAiProvider;
     edit({...preferences,provider:nextProvider,baseUrl:nextProvider==='openai-compatible'?'':undefined,generationModel:'',embeddingProvider:'none',embeddingBaseUrl:undefined,embeddingModel:'text-embedding-3-small'},'generation');
    }}>{Object.entries(providers).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    {provider==='openai-compatible'&&<label className="text-sm text-[var(--text-muted)]">API base URL<input type="url" required maxLength={2048} placeholder="https://api.example.com/v1" disabled={disabled} className={inputClass} value={preferences.baseUrl??''} onChange={event=>edit({...preferences,baseUrl:event.target.value},'generation')}/></label>}
    <p className="text-xs text-[var(--text-muted)]">Generation destination: {provider==='openai-compatible'?(preferences.baseUrl?`${preferences.baseUrl.replace(/\/$/,'')}/chat/completions`:'Enter your provider’s public HTTPS API base URL.'):destinations[provider]}. Compatible APIs must support Chat Completions; a valid key alone does not guarantee model compatibility.</p>
    <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={disabled} onClick={()=>void act('generation')} className={buttonClass}>{generationKeyReady?'Replace API key':'Add API key'}</button><span className="text-xs text-[var(--text-muted)]">{generationKeyReady?'Key available in the native app.':'Copy your provider key, then add it here. No key is shown in this page.'}</span></div>
    <label className="text-sm text-[var(--text-muted)]">Generation model<input required maxLength={200} pattern={modelPattern} placeholder="Exact model ID from your provider" disabled={disabled} className={inputClass} value={preferences.generationModel} onChange={event=>edit({...preferences,generationModel:event.target.value})}/></label>
    <label className="text-sm text-[var(--text-muted)]">Embeddings (optional)<select disabled={disabled} className={inputClass} value={embeddingProvider} onChange={event=>edit({...preferences,embeddingProvider:event.target.value as DesktopAiPreferences['embeddingProvider'],embeddingBaseUrl:event.target.value==='openai-compatible'?'':undefined,embeddingModel:'text-embedding-3-small'},'embedding')}><option value="none">Disabled · lexical evidence search</option><option value="openai">OpenAI · text-embedding-3-small</option><option value="openai-compatible">OpenAI-compatible embeddings API</option></select></label>
    {embeddingProvider==='openai-compatible'&&<>
     <label className="text-sm text-[var(--text-muted)]">Embedding API base URL<input type="url" required maxLength={2048} placeholder="https://api.example.com/v1" disabled={disabled} className={inputClass} value={preferences.embeddingBaseUrl??''} onChange={event=>edit({...preferences,embeddingBaseUrl:event.target.value},'embedding')}/></label>
     <label className="text-sm text-[var(--text-muted)]">Embedding model<input required maxLength={200} pattern={modelPattern} disabled={disabled} className={inputClass} value={preferences.embeddingModel} onChange={event=>edit({...preferences,embeddingModel:event.target.value})}/></label>
    </>}
    {embeddingProvider!=='none'&&<p className="text-xs text-[var(--text-muted)]">Embedding destination: {embeddingProvider==='openai'?'https://api.openai.com/v1/embeddings':preferences.embeddingBaseUrl?`${preferences.embeddingBaseUrl.replace(/\/$/,'')}/embeddings`:'Enter a public HTTPS embedding API base URL.'}. Exactly 1536 dimensions are required. Changing embedding identity requires safe reindexing; lexical search remains available.{!needsEmbeddingKey?' Your OpenAI generation key is reused for embeddings.':''}</p>}
    {needsEmbeddingKey&&<button type="button" disabled={disabled} onClick={()=>void act('embedding')} className={`${buttonClass} justify-self-start`}>{embeddingKeyReady?'Replace embedding API key':'Add embedding API key'}</button>}
    <label className="text-sm text-[var(--text-muted)]">Maximum requests per 24 hours<input type="number" required min={1} max={1000} disabled={disabled} className={inputClass} value={preferences.maxRequestsPerDay} onChange={event=>edit({...preferences,maxRequestsPerDay:Number(event.target.value)})}/></label>
    <label className="text-sm text-[var(--text-muted)]">Maximum output tokens per request<input type="number" required min={128} max={8192} disabled={disabled} className={inputClass} value={preferences.maxOutputTokens} onChange={event=>edit({...preferences,maxOutputTokens:Number(event.target.value)})}/></label>
    <p className="text-xs text-[var(--text-muted)]">Relevant evidence is sent to the destinations above using your API accounts. The saved request allowance includes generation and embeddings, including failed attempts; it is not a dollar spending cap. Connection tests are separate and make up to two small billable requests with synthetic content only.</p>
    {error&&<p role="alert" className="text-sm text-[var(--text-default)]">{error}</p>}
    {notice&&<p role="status" className="text-sm text-[var(--text-muted)]">{notice}</p>}
    <div className="flex flex-wrap gap-3"><button type="submit" disabled={disabled||!generationKeyReady||(needsEmbeddingKey&&!embeddingKeyReady)} className={buttonClass}>{busy?'Working…':'Test connection'}</button><button type="button" disabled={disabled||!tested} onClick={()=>void act('save')} className={buttonClass}>Save and restart</button>{saved?.configured&&<button type="button" disabled={disabled} onClick={()=>void act('revoke')} className={buttonClass}>Remove AI access</button>}</div>
   </form>
  </>}
 </section>;
}
