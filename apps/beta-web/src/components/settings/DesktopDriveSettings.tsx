import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../context/AuthContext';
type Result={ok:boolean;data?:{connected?:boolean;clientConfigured?:boolean;selectedFileCount?:number;cancelled?:boolean;saved?:number};error?:{message:string}};
type DriveApi={inspect():Promise<Result>;configure():Promise<Result>;connect():Promise<Result>;cancel():Promise<Result>;revoke():Promise<Result>;importFiles(projectId:string):Promise<Result>};
const api=()=> (window.orchestra as unknown as {drive?:DriveApi}|undefined)?.drive;
export default function DesktopDriveSettings(){
 const {activeProject}=useAuth();
 const [notice,setNotice]=useState('');
 const [state,setState]=useState<Result['data']>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const running=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const service=api();
  if(service)void service.inspect().then(result=>{if(!result.ok)throw new Error(result.error?.message??'Drive status unavailable');if(mounted.current)setState(result.data);}).catch(e=>{if(mounted.current)setError(e.message);});
  else setError('Update the desktop package to configure Google Drive.');
  return()=>{mounted.current=false;};
 },[]);
 async function action(kind:'inspect'|'configure'|'connect'|'revoke'|'importFiles'){
  const service=api();if(!service||running.current)return;running.current=true;setBusy(true);setError('');
  setNotice('');
  try{if(kind==='importFiles'&&!activeProject)throw new Error('Select a workspace first');
   const result=kind==='importFiles'?await service.importFiles(activeProject!.id):await service[kind]();if(!result.ok)throw new Error(result.error?.message??'Drive operation failed');
   if(kind==='importFiles'&&!result.data?.cancelled&&mounted.current)setNotice(`${result.data?.saved??0} file(s) confirmed saved to Memory. Processing status is shown in Memory; these are evidence, not accepted product truth.`);
   const confirmed=await service.inspect();if(!confirmed.ok)throw new Error('Drive status could not be confirmed');if(mounted.current)setState(confirmed.data);
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Drive operation failed');}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 const button='rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)] disabled:opacity-40';
 return <section aria-labelledby="desktop-drive-heading" className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5">
  <h2 id="desktop-drive-heading" className="font-sans text-lg text-[var(--text-default)]">Desktop Google Drive</h2>
  <p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{busy?'Working… Check the native confirmation and Google browser window.':!state?'Drive status not yet confirmed.':state.connected?`${state.selectedFileCount} selected file${state.selectedFileCount===1?'':'s'} authorized on this Mac.`:'Not connected on this Mac.'}</p>
  <p className="mt-2 text-sm text-[var(--text-muted)]">Choose files in Google’s own Picker. Credentials stay encrypted on this Mac. Authorization alone does not import content. Import selected Docs, Slides, Sheets, text, Markdown, PDF or DOCX files into Memory, up to 10 MB each. Re-import to check for changes, or opt in below under Selected-source refresh.</p>
  {error&&<p role="alert" className="mt-2 text-sm text-[var(--text-default)]">{error}</p>}
  <div className="mt-4 flex gap-3">
   {!state?.connected&&<button className={button} disabled={busy||!state} onClick={()=>void action('configure')}>Import Google Desktop client</button>}
   <button className={button} disabled={busy||!state?.clientConfigured} onClick={()=>void action('connect')}>Select Google Drive files</button>
   {state?.connected&&<button className={button} disabled={busy} onClick={()=>void action('revoke')}>Revoke desktop Drive access</button>}
   {state?.connected&&<button className={button} disabled={busy||!activeProject} onClick={()=>void action('importFiles')}>Import selected Drive files</button>}
   {!state&&error&&<button className={button} disabled={busy||!api()} onClick={()=>void action('inspect')}>Retry Drive status</button>}
   {busy&&<button className={button} onClick={()=>void api()?.cancel().catch(()=>setError('Drive cancellation could not be confirmed.'))}>Cancel Drive operation</button>}
  </div>
  {notice&&<p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{notice}</p>}
 </section>;
}
