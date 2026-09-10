import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SocratesMarkdown } from "../components/ui/SocratesMarkdown";
import { useAuth } from "../context/AuthContext";
import { getProjectContextEntry, type ProjectContextEntry } from "../lib/api/research";

export function MemoryContextPage() {
  const { contextId = "" } = useParams();
  const { activeProject } = useAuth();
  const [entry, setEntry] = useState<ProjectContextEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!activeProject?.id || !contextId) return;
    setEntry(null);
    setError(null);
    void getProjectContextEntry(activeProject.id, contextId)
      .then((value) => { if (!cancelled) setEntry(value); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not open this Memory artifact."); });
    return () => { cancelled = true; };
  }, [activeProject?.id, contextId]);

  return (
    <div className="h-full overflow-y-auto bg-bg px-8 py-10">
      <div className="mx-auto max-w-[980px]">
        <Link to="/memory" className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--teal-text)] hover:underline">← Project Memory</Link>
        {error ? <p role="alert" className="mt-8 rounded-xl border border-[var(--red)]/20 bg-[var(--tint-red)] p-4 font-sans text-[13px] text-[var(--red)]">{error}</p> : null}
        {!entry && !error ? <p className="mt-8 font-sans text-[13px] text-[var(--text-muted)]">Loading saved research…</p> : null}
        {entry ? (
          <article className="mt-7 rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-7">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--teal-text)]">Saved Deep Research · {new Date(entry.createdAt).toLocaleString()}</p>
            <h1 className="mt-3 font-sans text-[32px] font-medium text-[var(--text-default)]">{entry.title}</h1>
            <div className="mt-6"><SocratesMarkdown content={entry.body} /></div>
          </article>
        ) : null}
      </div>
    </div>
  );
}
