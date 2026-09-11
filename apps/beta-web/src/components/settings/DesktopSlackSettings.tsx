import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../context/AuthContext';
type Result={ok:boolean;data?:unknown;error?:{message:string}};
type SlackApi={inspect():Promise<Result>;connect():Promise<Result>;cancel():Promise<Result>;revoke():Promise<Result>;channels():Promise<Result>;importChannel(input:{projectId:string;channelId:string}):Promise<Result>};
type State={connected:boolean;teamName:string|null};
const api=()=> (window.orchestra as unknown as {slack?:SlackApi}|undefined)?.slack;
export default function DesktopSlackSettings(){
 const {activeProject}=useAuth();
 const [channels,setChannels]=useState<Array<{id:string;name:string}>>([]),[selected,setSelected]=useState(''),[notice,setNotice]=useState('');
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const running=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const service=api();if(!service){setError('Update the desktop package to configure Slack.');return;}
  void service.inspect().then(result=>{if(!result.ok)throw new Error(result.error?.message??'Slack status unavailable');if(mounted.current)setState(result.data as State);}).catch(err=>{if(mounted.current)setError(err instanceof Error?err.message:'Slack status unavailable');});
  return()=>{mounted.current=false;};
 },[]);
 async function change(){const service=api();if(!service||running.current)return;running.current=true;setBusy(true);setError('');
  try{const result=await(state?.connected?service.revoke():service.connect());if(!result.ok)throw new Error(result.error?.message??'Slack action failed');const latest=await service.inspect();if(!latest.ok)throw new Error('Could not confirm Slack state.');if(mounted.current)setState(latest.data as State);}
  catch(err){if(mounted.current)setError(err instanceof Error?err.message:'Slack action failed');}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 async function source(importing=false){const service=api();if(!service||running.current||!activeProject)return;running.current=true;setBusy(true);setError('');setNotice('');try{
  const result=await(importing?service.importChannel({projectId:activeProject.id,channelId:selected}):service.channels());if(!result.ok)throw new Error(result.error?.message??'Slack request failed');
  if(!mounted.current)return;
  if(importing){const data=result.data as {cancelled?:boolean;messageCount:number};if(!data.cancelled)setNotice(`${data.messageCount} Slack messages saved as evidence. Local indexing continues in the worker.`);}
  else{setChannels(result.data as Array<{id:string;name:string}>);setSelected('');}
 }catch(err){if(mounted.current)setError(err instanceof Error?err.message:'Slack request failed');}finally{running.current=false;if(mounted.current)setBusy(false);}}
 return <section aria-labelledby="desktop-slack-heading" className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-5">
  <h2 id="desktop-slack-heading" className="font-sans text-lg text-[var(--text-default)]">Desktop Slack</h2>
  <p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{busy?'Working… Check any native confirmation or Slack browser prompt.':state?.connected?`Credentials saved for ${state.teamName}.`:state?'Not connected on this Mac.':'Reading protected Slack settings…'}</p>
  <p className="mt-2 text-sm text-[var(--text-muted)]">Read-only public-channel access. Credentials stay encrypted on this Mac. Explicit imports cover up to 200 messages and replies from the past 30 days. Reimport updates existing evidence without accepting it as truth. Automatic background sync is not yet available.</p>
  {error&&<p role="alert" className="mt-2 text-sm text-[var(--text-default)]">{error}</p>}
  <div className="mt-4 flex gap-3"><button type="button" disabled={!state||busy||!api()} onClick={()=>void change()} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)] disabled:opacity-40">{state?.connected?'Disconnect desktop Slack':'Connect desktop Slack'}</button>
   {busy&&!state?.connected&&<button type="button" onClick={()=>{void api()?.cancel().catch(()=>setError('Cancellation could not be confirmed.'));}} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)]">Cancel sign-in</button>}
  </div>
  {state?.connected&&<div className="mt-4 grid gap-3"><button disabled={busy||!activeProject} type="button" onClick={()=>void source()} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)]">List public channels</button>
   <label className="text-sm text-[var(--text-muted)]">Channel to import<select disabled={busy} value={selected} onChange={event=>setSelected(event.target.value)} className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2"><option value="">Select a channel</option>{channels.map(channel=><option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select></label>
   <button disabled={busy||!selected||!activeProject} type="button" onClick={()=>void source(true)} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-sm text-[var(--text-default)]">Import selected Slack channel</button>
  </div>}
  {notice&&<p role="status" className="mt-2 text-sm text-[var(--text-muted)]">{notice}</p>}
 </section>;
}
