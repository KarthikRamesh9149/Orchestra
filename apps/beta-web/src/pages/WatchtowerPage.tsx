import { AlertTriangle, CheckCircle2, Eye, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  createWatchtowerReview,
  dismissWatchtowerSuggestion,
  getWatchtowerFde,
  getWatchtowerSuggestions,
  promoteWatchtowerSuggestion,
  type FdeFinding,
  type WatchtowerSuggestion
} from "../lib/api/watchtower";

type LoadState = "loading" | "ready" | "empty" | "failed";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "The Watchtower request failed.";
}

function severityClass(severity: string) {
  if (severity === "critical" || severity === "blocking") return "bg-[#9E3B2E]/10 text-[#9E3B2E]";
  if (severity === "high" || severity === "watch") return "bg-[#B47A1F]/10 text-[#8A5A10]";
  return "bg-[var(--bg-inset)] text-[var(--text-muted)]";
}

export function WatchtowerPage() {
  const { activeProject } = useAuth();
  const projectId = activeProject?.id ?? null;
  const [suggestions, setSuggestions] = useState<WatchtowerSuggestion[]>([]);
  const [findings, setFindings] = useState<FdeFinding[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [fdeNotice, setFdeNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setState("loading");
    setError(null);
    const [suggestionResult, fdeResult] = await Promise.allSettled([
      getWatchtowerSuggestions(projectId, true),
      getWatchtowerFde(projectId)
    ]);
    if (suggestionResult.status === "rejected") {
      setState("failed");
      setError(messageOf(suggestionResult.reason));
      return;
    }
    setSuggestions(suggestionResult.value.items);
    if (fdeResult.status === "fulfilled") {
      setFindings(fdeResult.value.items);
      setFdeNotice(null);
    } else {
      setFindings([]);
      setFdeNotice(messageOf(fdeResult.reason));
    }
    setState(suggestionResult.value.items.length === 0 && (fdeResult.status !== "fulfilled" || fdeResult.value.items.length === 0) ? "empty" : "ready");
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (suggestion: WatchtowerSuggestion, action: "dismiss" | "timeline" | "review") => {
    if (!projectId || busyId) return;
    setBusyId(suggestion.id);
    setError(null);
    try {
      if (action === "dismiss") await dismissWatchtowerSuggestion(projectId, suggestion.id, "Dismissed from the beta Watchtower after evidence review.");
      if (action === "timeline") await promoteWatchtowerSuggestion(projectId, suggestion.id);
      if (action === "review") await createWatchtowerReview(projectId, suggestion.id);
      await load();
    } catch (caught) {
      setError(messageOf(caught));
      setState("ready");
    } finally {
      setBusyId(null);
    }
  }, [busyId, load, projectId]);

  const counts = useMemo(() => ({
    active: suggestions.filter((item) => item.status === "active").length,
    conflicts: findings.filter((item) => item.findingType === "conflict").length,
    safe: findings.filter((item) => item.findingType === "safe_to_touch").length
  }), [findings, suggestions]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)] px-4 py-5 sm:px-7 lg:px-10" aria-labelledby="watchtower-heading">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Operational intelligence</p>
            <h1 id="watchtower-heading" className="mt-1 font-sans text-2xl font-semibold text-[var(--text-default)]">Watchtower</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">Evidence-backed drift, conflict, coverage, and Safe-to-Touch signals. Suggestions never become accepted truth automatically.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={state === "loading"} className="flex items-center gap-2 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)] disabled:opacity-50">
            <RefreshCw size={14} aria-hidden="true" /> {state === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3" aria-label="Watchtower summary">
          {[["Active reviews", counts.active], ["Conflict signals", counts.conflicts], ["Safe-to-Touch", counts.safe]].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-3"><p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)]">{label}</p><p className="mt-1 text-xl font-semibold text-[var(--text-default)]">{value}</p></div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-[#2A9D8F]/20 bg-[#2A9D8F]/5 p-3 text-xs text-[var(--text-default)]">
          <ShieldCheck size={15} className="mt-0.5 flex-shrink-0 text-[#2A9D8F]" aria-hidden="true" />
          <p>Review creates a pending proposal for an authorized truth approver. Promote creates a manual timeline event. Neither action accepts or edits Product Brain truth.</p>
        </div>

        {error ? <div role="alert" className="mt-4 rounded-lg border border-[#9E3B2E]/20 bg-[#9E3B2E]/5 p-3 text-sm text-[#9E3B2E]">{error}</div> : null}
        {state === "loading" ? <p role="status" className="mt-8 text-sm text-[var(--text-muted)]">Loading authoritative Watchtower evidence…</p> : null}
        {state === "empty" ? <p role="status" className="mt-8 rounded-xl border border-[var(--border-soft)] p-5 text-sm text-[var(--text-muted)]">No current drift, conflict, missing-evidence, or Safe-to-Touch signals were found.</p> : null}

        {suggestions.length > 0 ? <section className="mt-7" aria-labelledby="review-signals-heading">
          <h2 id="review-signals-heading" className="text-base font-semibold text-[var(--text-default)]">Review signals</h2>
          <div className="mt-3 grid gap-3">
            {suggestions.map((item) => <article key={item.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap gap-2"><span className={`rounded-full px-2 py-1 font-mono text-[9px] uppercase ${severityClass(item.severity)}`}>{item.severity}</span><span className="rounded-full bg-[var(--bg-inset)] px-2 py-1 font-mono text-[9px] uppercase text-[var(--text-muted)]">{item.category.replace(/_/g, " ")}</span><span className="rounded-full bg-[var(--bg-inset)] px-2 py-1 font-mono text-[9px] uppercase text-[var(--text-muted)]">{item.status.replace(/_/g, " ")}</span></div><h3 className="mt-2 text-sm font-semibold text-[var(--text-default)]">{item.title}</h3><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{item.description}</p></div><span className="font-mono text-[10px] text-[var(--text-faint)]">{Math.round(item.confidence * 100)}% confidence</span></div>
              <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-[var(--text-default)]">Evidence chain ({item.evidence.length})</summary><ul className="mt-2 space-y-2">{item.evidence.map((evidence) => <li key={`${evidence.source}:${evidence.refId}`} className="rounded-lg bg-[var(--bg-inset)] p-2 text-xs text-[var(--text-muted)]"><span className="font-medium text-[var(--text-default)]">{evidence.label}</span>{evidence.excerpt ? <p className="mt-1">{evidence.excerpt}</p> : null}</li>)}</ul>{item.limitations.length ? <p className="mt-2 text-[11px] text-[var(--text-faint)]">Limitation: {item.limitations.join(" ")}</p> : null}</details>
              {item.status === "active" ? <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busyId === item.id} onClick={() => void act(item, "review")} className="rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50">Create review item</button><button type="button" disabled={busyId === item.id} onClick={() => void act(item, "timeline")} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)] disabled:opacity-50">Promote to timeline</button><button type="button" disabled={busyId === item.id} onClick={() => void act(item, "dismiss")} className="rounded-lg px-3 py-2 text-xs text-[var(--text-muted)] disabled:opacity-50">Dismiss</button></div> : item.createdProposalId ? <p className="mt-3 flex items-center gap-2 text-xs text-[#2A9D8F]"><CheckCircle2 size={13} aria-hidden="true" /> Pending review created; truth remains unchanged until approval.</p> : item.promotedTimelineEventId ? <p className="mt-3 text-xs text-[#2A9D8F]">Saved to the project timeline. <Link to={`/timeline?event=${encodeURIComponent(item.promotedTimelineEventId)}`} className="underline">Open timeline</Link></p> : null}
            </article>)}
          </div>
        </section> : null}

        <section className="mt-8 pb-8" aria-labelledby="fde-heading"><div className="flex items-center gap-2"><Eye size={16} className="text-[var(--terracotta-text)]" aria-hidden="true" /><h2 id="fde-heading" className="text-base font-semibold text-[var(--text-default)]">Engineering readiness</h2></div>
          {fdeNotice ? <div role="alert" className="mt-3 flex gap-2 rounded-lg border border-[#B47A1F]/20 bg-[#B47A1F]/5 p-3 text-xs text-[#8A5A10]"><AlertTriangle size={14} aria-hidden="true" /> Engineering readiness is unavailable: {fdeNotice}</div> : null}
          {findings.length === 0 && !fdeNotice && state !== "loading" ? <p className="mt-3 text-sm text-[var(--text-muted)]">No current engineering-readiness findings.</p> : <div className="mt-3 grid gap-3 md:grid-cols-2">{findings.map((finding) => <article key={finding.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4"><div className="flex justify-between gap-2"><span className={`rounded-full px-2 py-1 font-mono text-[9px] uppercase ${severityClass(finding.severity)}`}>{finding.findingType === "safe_to_touch" ? `Safe-to-Touch ${finding.findingSubType}` : finding.findingSubType.replace(/_/g, " ")}</span><span className="font-mono text-[9px] text-[var(--text-faint)]">{finding.confidence}</span></div><h3 className="mt-2 text-sm font-semibold text-[var(--text-default)]">{finding.summary}</h3>{finding.targetRef ? <p className="mt-1 break-all font-mono text-[10px] text-[var(--text-faint)]">{finding.targetRef}</p> : null}{finding.whyItMatters ? <p className="mt-2 text-xs text-[var(--text-muted)]">{finding.whyItMatters}</p> : null}{finding.reasons.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--text-muted)]">{finding.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}<p className="mt-3 text-[10px] text-[var(--text-faint)]">Operational evidence only · truth mutation disabled</p></article>)}</div>}
        </section>
      </div>
    </div>
  );
}
