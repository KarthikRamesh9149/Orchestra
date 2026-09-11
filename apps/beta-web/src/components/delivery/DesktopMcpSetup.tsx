import {useEffect,useState} from 'react';
import {copyText} from '../../lib/clipboard';
type Pairing={id:string;projectId:string;packId:string;client:string;expiresAt:string;setup:string};
export function DesktopMcpSetup({projectId,packId,targetAgent}:{projectId:string;packId:string;targetAgent:'codex'|'claude'|'cursor'}){
 const [pairings,setPairings]=useState<Pairing[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function reload(){const result=await window.orchestra?.mcp?.inspect();if(!result?.ok)throw new Error(result?.error?.message??'Native MCP pairing is unavailable.');setPairings((result.data as Pairing[]).filter(value=>value.projectId===projectId&&value.packId===packId));}
 useEffect(()=>{void reload().catch(caught=>setError(caught.message));},[projectId,packId]);
 async function action(id?:string){if(busy)return;setBusy(true);setError('');setMessage('');try{const api=window.orchestra?.mcp;if(!api)throw new Error('Native MCP pairing is unavailable.');const result=await(id?api.revoke(id):api.pair({projectId,packId,client:targetAgent}));if(!result.ok)throw new Error(result.error?.message??'Pairing failed.');await reload();}catch(caught){setError(caught instanceof Error?caught.message:'Pairing failed.');}finally{setBusy(false);}}
 return <section aria-labelledby="desktop-mcp-heading" className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-3">
  <h3 id="desktop-mcp-heading" className="text-xs font-semibold text-[var(--text-default)]">Connect {targetAgent} to this Preflight</h3>
  <p className="mt-2 text-xs text-[var(--text-muted)]">Pairing retrieves this exact context pack and records linked Postflight evidence. It cannot accept product truth. Keys stay in OS-protected storage. Keep Orchestra open while your agent works.</p>
  <button type="button" disabled={busy||!window.orchestra?.mcp} onClick={()=>void action()} className="mt-3 rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50">{busy?'Working…':'Create desktop pairing'}</button>
  {error&&<p role="alert" className="mt-2 text-xs text-[var(--text-default)]">{error}</p>}{message&&<p role="status" className="mt-2 text-xs text-[var(--text-muted)]">{message}</p>}
  {pairings.map(pairing=><article key={pairing.id} className="mt-3 rounded-lg bg-[var(--bg-inset)] p-3"><p className="text-xs text-[var(--text-default)]">{pairing.client} · expires {new Date(pairing.expiresAt).toLocaleDateString()}</p><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">{pairing.setup}</pre><div className="mt-2 flex gap-3"><button type="button" onClick={()=>void copyText(pairing.setup).then(()=>setMessage('Agent configuration copied. Merge this entry into your client settings; preserve existing servers.')).catch(()=>setError('Configuration could not be copied.'))} className="text-xs text-[var(--terracotta-text)]">Copy agent configuration</button><button type="button" disabled={busy} onClick={()=>void action(pairing.id)} className="text-xs text-[var(--text-default)]">Revoke pairing</button></div></article>)}
 </section>;
}
