import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../context/AuthContext';
type Result={ok:boolean;data?:any;error?:{message:string}};
type API={export(id:string):Promise<Result>;preview(id:string):Promise<Result>;commit(input:unknown):Promise<Result>};
type Preview={previewId:string;source:{name:string};actors:{id:string;displayName:string}[];targetIdentities:{id:string;displayName:string}[];counts:Record<string,number>;exclusions:string[]};
const button='rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)] disabled:opacity-50';
export default function DesktopTransferSettings(){
 const {activeProject}=useAuth();
 const bridge=((window as any).orchestraShared?.transfer??(window as any).orchestra?.transfer) as API|undefined;
 const [preview,setPreview]=useState<Preview|null>(null),[mapping,setMapping]=useState<Record<string,string>>({}),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const running=useRef(false),current=useRef(activeProject?.id);current.current=activeProject?.id;
 useEffect(()=>{setPreview(null);setMapping({});setAck(false);setError('');setNotice('');},[activeProject?.id]);
 if(!bridge)return null;
 async function action(kind:'export'|'preview'|'commit'){
  if(!bridge||!activeProject||running.current)return;const id=activeProject.id;running.current=true;setBusy(true);setError('');setNotice('');
  try{
   const result=await(kind==='commit'?bridge.commit({projectId:id,previewId:preview?.previewId,identityMap:mapping,acknowledgeHistoricalTruth:ack}):bridge[kind](id));
   if(current.current!==id)return;if(!result.ok)throw new Error(result.error?.message??'Transfer not confirmed');if(result.data?.cancelled)return;
   if(kind==='preview'){setPreview(result.data);setMapping({});setAck(false);}
   else if(kind==='export')setNotice('Encrypted archive saved. Keep its passphrase separately in your password manager.');
   else {setPreview(null);setNotice('Core import confirmed by the server. Reload Memory and Product Brain to view it. Other workflows and integrations were not transferred.');}
  }catch(e){if(current.current===id)setError(e instanceof Error?e.message:'Transfer not confirmed');}finally{running.current=false;setBusy(false);}
 }
 const complete=!!preview&&preview.actors.every(actor=>!!mapping[actor.id])&&new Set(Object.values(mapping)).size===preview.actors.length;
 return <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5" aria-label="Project core transfer">
  <h3 className="text-base font-medium text-[var(--text-default)]">Encrypted project transfer</h3>
  <p className="mt-2 text-sm text-[var(--text-muted)]">Transfer documents and accepted product history to an empty workspace you manage. Private chats, credentials, connectors and other workflows are not included. Archives are limited to 16 MiB. This is not a full-workspace backup.</p>
  <div className="mt-3 flex flex-wrap gap-3"><button className={button} disabled={busy||!activeProject} onClick={()=>void action('export')}>Export project core</button><button className={button} disabled={busy||!activeProject} onClick={()=>void action('preview')}>Choose archive to review</button></div>
  {busy&&<p role="status" className="mt-3 text-sm text-[var(--text-muted)]">Complete the native dialog; checking the transfer…</p>}
  {preview&&<div className="mt-4 space-y-3">
   <p>Import from {preview.source.name} into {activeProject?.name}. Preview expires after five minutes.</p>
   <p className="text-sm text-[var(--text-muted)]">{Object.entries(preview.counts).filter(([,n])=>n>0).map(([name,n])=>`${n} ${name}`).join(', ')||'No core records'}</p>
   {preview.actors.map(actor=><label key={actor.id} className="block text-sm">Map {actor.displayName} ({actor.id}) to<select aria-label={`Map ${actor.displayName}`} className="mt-1 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2" disabled={busy} value={mapping[actor.id]??''} onChange={event=>setMapping(old=>({...old,[actor.id]:event.target.value}))}><option value="">Choose an active member</option>{preview.targetIdentities.map(person=><option key={person.id} value={person.id}>{person.displayName} ({person.id})</option>)}</select></label>)}
   <label className="flex gap-2 text-sm"><input type="checkbox" disabled={busy} checked={ack} onChange={event=>setAck(event.target.checked)}/>I reviewed the mappings and approve importing this historical accepted truth. This does not grant new permissions.</label>
   <button className={button} disabled={busy||!complete||!ack} onClick={()=>void action('commit')}>Import reviewed core</button>
  </div>}
  {error&&<p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}{notice&&<p role="status" className="mt-3 text-sm text-[var(--text-muted)]">{notice}</p>}
 </section>;
}
