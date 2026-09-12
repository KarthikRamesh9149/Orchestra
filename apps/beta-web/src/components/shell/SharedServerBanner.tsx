export function SharedServerBanner(){
 const shared=window.orchestraShared;if(!shared)return null;
 return <aside aria-label="Connected team server" className="flex h-9 items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[var(--bg-card)] px-4 text-xs text-[var(--text-default)]">
  <span className="min-w-0 truncate" title={shared.connection.origin}>Shared · {shared.connection.name} · {shared.connection.origin}</span>
  <button type="button" className="shrink-0 text-[var(--terracotta-text)]" onClick={()=>void shared.close()}>Return to local</button>
 </aside>;
}
