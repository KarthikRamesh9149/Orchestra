import {useSyncExternalStore} from 'react';
const subscribe=(notify:()=>void)=>window.orchestraShared?.onOfflineChange?.(notify)??(()=>{});
const snapshot=()=>window.orchestraShared?.isOffline?.()??false;
export function SharedServerBanner(){
 const offline=useSyncExternalStore(subscribe,snapshot,()=>false);
 const shared=window.orchestraShared;if(!shared)return null;
 return <aside aria-label="Connected team server" className="flex h-9 items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-card)] px-4 text-xs text-[var(--text-default)]">
  <span className="min-w-0 truncate" title={shared.connection.origin}>Shared · {shared.connection.name} · {shared.connection.origin}</span>
  {offline?<span role="status" className="shrink-0">Cached evidence · read-only</span>:null}
  <button type="button" className="shrink-0 text-[var(--terracotta-text)]" onClick={()=>void shared.close()}>Return to local</button>
 </aside>;
}
