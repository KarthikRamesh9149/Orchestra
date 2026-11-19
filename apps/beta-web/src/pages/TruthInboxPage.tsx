import {
  ArrowRight,
  ChevronDown,
  Clock3,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  SlidersHorizontal,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  actOnTruthInboxItem,
  getTruthInbox,
  type TruthInboxAction,
  type TruthInboxActionResponse,
  type TruthInboxFilters,
  type TruthInboxItem,
  type TruthInboxResponse
} from "../lib/api/truthInbox";
import { resolveOpenTarget } from "../lib/socratesPresentation";
import { useToastStore } from "../components/ui/Toaster";

type LoadState = "loading" | "refreshing" | "ready" | "empty" | "failed";
type ComposerMode = "clarification" | "defer" | "snooze" | "dismiss" | "accept" | "reject" | null;

const CATEGORY_OPTIONS = [
  "merge_conflicts",
  "spec_drift",
  "stalled_work",
  "risk_flags",
  "decision_conflicts",
  "ownership_gaps",
  "missing_evidence",
  "connector_health",
  "agent_drift",
  "safe_to_touch"
];

const STATUS_OPTIONS = ["active", "deferred", "snoozed", "dismissed", "resolved", "converted_to_review", "converted_to_timeline"];

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "The Truth Inbox request failed.";
}

function actionLabel(action: TruthInboxAction) {
  return ({
    ask_socrates: "Ask Socrates",
    assign_owner: "Assign owner",
    request_clarification: "Request clarification",
    create_review_item: "Create review item",
    accept: "Accept change",
    reject: "Reject change",
    defer: "Defer",
    snooze: "Snooze",
    dismiss: "Dismiss",
    promote_to_timeline: "Promote to Timeline"
  } satisfies Record<TruthInboxAction, string>)[action];
}

function matchesFilters(item: TruthInboxItem, filters: TruthInboxFilters, actorUserId: string | null) {
  if (filters.category && item.category !== filters.category) return false;
  if (filters.severity && item.severity !== filters.severity) return false;
  if (filters.source && item.sourceType !== filters.source) return false;
  if (item.status !== (filters.status ?? "active")) return false;
  if (!filters.owner) return true;
  if (filters.owner === "unassigned") return !item.owner;
  return item.owner?.userId === (filters.owner === "me" ? actorUserId : filters.owner);
}

function reconcileMutation(payload: TruthInboxResponse | null, result: TruthInboxActionResponse) {
  if (!payload || !result.item) return payload;
  const summary = result.summaryDelta
    ? {
        active: payload.summary.active + result.summaryDelta.active,
        critical: payload.summary.critical + result.summaryDelta.critical,
        awaitingDecision: payload.summary.awaitingDecision + result.summaryDelta.awaitingDecision,
        assignedToMe: payload.summary.assignedToMe + result.summaryDelta.assignedToMe
      }
    : payload.summary;
  const countsByStatus = { ...payload.countsByStatus };
  if (result.statusDelta) {
    countsByStatus[result.statusDelta.from] = Math.max(0, (countsByStatus[result.statusDelta.from] ?? 0) - 1);
    countsByStatus[result.statusDelta.to] = (countsByStatus[result.statusDelta.to] ?? 0) + 1;
  }
  return { ...payload, summary, countsByStatus, cached: false };
}

function defaultUntil(hours: number) {
  const value = new Date(Date.now() + hours * 60 * 60 * 1000);
  value.setMinutes(0, 0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function TruthInboxPage() {
  const { activeProject, user } = useAuth();
  return <ScopedInbox key={JSON.stringify([user?.id, user?.orgId, activeProject?.id])} />;
}

function ScopedInbox() {
  const { activeProject, user } = useAuth();
  const projectId = activeProject?.id ?? null;
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.add);
  const [payload, setPayload] = useState<TruthInboxResponse | null>(null);
  const [items, setItems] = useState<TruthInboxItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TruthInboxFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ itemId: string; mode: ComposerMode } | null>(null);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState(defaultUntil(24));
  const requestGeneration = useRef(0);
  const scopeKey = JSON.stringify([projectId, filters]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;

  const load = useCallback(async (refresh = false, append = false, cursor?: string) => {
    if (!projectId) return;
    const generation = ++requestGeneration.current;
    const isCurrent = () => generation === requestGeneration.current && currentScope.current === scopeKey;
    setState(append || items.length > 0 ? "refreshing" : "loading");
    setError(null);
    try {
      const result = await getTruthInbox(projectId, { ...filters, cursor, refresh, limit: 30 });
      if (!isCurrent()) return;
      setPayload(result);
      setItems((current) => append ? [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))] : result.items);
      setState((append ? items.length + result.items.length : result.items.length) === 0 ? "empty" : "ready");
    } catch (caught) {
      if (!isCurrent()) return;
      setError(messageOf(caught));
      setState(items.length > 0 ? "ready" : "failed");
    }
  }, [filters, items.length, projectId, scopeKey]);

  useEffect(() => {
    setItems([]); setPayload(null); setComposer(null); setBusy(null);
    void load(false, false);
    return () => { requestGeneration.current += 1; };
  }, [filters.category, filters.owner, filters.severity, filters.source, filters.status, projectId]);

  const execute = useCallback(async (
    item: TruthInboxItem,
    action: TruthInboxAction,
    input: { assignedUserId?: string | null; note?: string; until?: string } = {}
  ) => {
    if (!projectId || busy) return;
    const isCurrent = () => currentScope.current === scopeKey;
    setBusy(`${item.id}:${action}`);
    setError(null);
    try {
      const result = await actOnTruthInboxItem(projectId, item.id, action, input);
      if (!isCurrent()) return;
      if (action === "ask_socrates") {
        const outcome = result.outcome as { answer?: { sessionId?: string; session?: { sessionId?: string } } } | null;
        const sessionId = outcome?.answer?.sessionId ?? outcome?.answer?.session?.sessionId;
        showToast("Conversation opened.", "success");
        navigate(sessionId ? `/chat/${encodeURIComponent(sessionId)}` : "/chat");
        return;
      }
      showToast(`${actionLabel(action)} saved.`, "success");
      setComposer(null);
      setNote("");
      if (!result.item) {
        await load(true, false);
        return;
      }
      setPayload((current) => reconcileMutation(current, result));
      setItems((current) => {
        if (!matchesFilters(result.item!, filters, user?.id ?? null)) return current.filter((candidate) => candidate.id !== result.item!.id);
        return current.map((candidate) => candidate.id === result.item!.id ? result.item! : candidate);
      });
    } catch (caught) {
      if (!isCurrent()) return;
      setError(messageOf(caught));
    } finally {
      if (isCurrent()) setBusy(null);
    }
  }, [busy, filters, load, navigate, projectId, scopeKey, showToast, user?.id]);

  const summary = payload?.summary;
  const view = filters.status === "resolved" ? "resolved" : filters.owner === "me" && (!filters.status || filters.status === "active") ? "mine" : !filters.status || filters.status === "active" ? "needs" : "";
  const activeFilters = [filters.category, filters.source, filters.severity, filters.owner && filters.owner !== "me", filters.status && !["active", "resolved"].includes(filters.status)].filter(Boolean).length;
  const selectView = (key: string) => setFilters((prior) => ({ ...prior, status: key === "resolved" ? "resolved" : undefined, owner: key === "mine" ? "me" : undefined, cursor: undefined }));
  const degradedSources = useMemo(() => Object.values(payload?.sourceStates ?? {}).filter((source) => source.state === "degraded"), [payload]);

  const openComposer = (itemId: string, mode: Exclude<ComposerMode, null>) => {
    setComposer({ itemId, mode });
    setNote("");
    setUntil(defaultUntil(mode === "snooze" ? 24 : 72));
  };

  const updateFilter = (key: keyof TruthInboxFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value || undefined, cursor: undefined }));
  };

  return (
    <div className="desk-scroll" aria-labelledby="truth-inbox-heading">
      <div className="desk-page desk-inbox">
        <header className="desk-head"><h1 id="truth-inbox-heading">Truth Inbox</h1></header>
        <div className="desk-toolbar">
          <div className="desk-views" role="group" aria-label="Queue views">
            {([["needs", "Needs review", summary?.active], ["mine", "Assigned to me", summary?.assignedToMe], ["resolved", "Resolved", payload ? payload.countsByStatus.resolved ?? 0 : undefined]] as const).map(([key, label, count]) =>
              <button key={key} type="button" aria-pressed={view === key} onClick={() => selectView(key)}>{label}{typeof count === "number" && <small>{count}</small>}</button>)}
          </div>
          <div className="desk-tools"><button type="button" aria-label="Refresh review queue" title="Refresh" onClick={() => void load(true)} disabled={state === "loading" || state === "refreshing"}><RefreshCw size={14} /></button>
          <button type="button" aria-expanded={filtersOpen} aria-controls="inbox-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={14} /> Filter{activeFilters ? ` (${activeFilters})` : ""}</button></div>
        </div>

        {degradedSources.length > 0 ? <div role="status" className="mt-3 rounded-lg border border-[var(--amber-text)]/20 bg-[var(--tint-amber)] p-3 text-xs text-[var(--amber-text)]">{degradedSources.map((source) => `${source.label}: ${source.detail ?? "degraded"}`).join(" · ")}</div> : null}

        <div id="inbox-filters" hidden={!filtersOpen}><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Truth Inbox filters">
          <FilterSelect label="Category" value={filters.category ?? ""} onChange={(value) => updateFilter("category", value)} options={CATEGORY_OPTIONS} />
          <FilterSelect label="Severity" value={filters.severity ?? ""} onChange={(value) => updateFilter("severity", value)} options={["low", "medium", "high", "critical"]} />
          <FilterSelect label="Status" value={filters.status ?? ""} onChange={(value) => updateFilter("status", value)} options={STATUS_OPTIONS} />
          <FilterSelect label="Source" value={filters.source ?? ""} onChange={(value) => updateFilter("source", value)} options={["suggestion", "proposal", "fde", "agent_drift", "connector"]} />
          <FilterSelect label="Owner" value={filters.owner ?? ""} onChange={(value) => updateFilter("owner", value)} options={["me", "unassigned", ...(payload?.members.map((member) => member.userId) ?? [])]} labels={Object.fromEntries(payload?.members.map((member) => [member.userId, member.displayName]) ?? [])} />
        </div>

        </div>
        {error ? <div role="alert" className="mt-4 rounded-lg border border-[var(--red-text)]/20 bg-[var(--tint-red)] p-3 text-sm text-[var(--red-text)]">{error}</div> : null}
        {state === "loading" ? <p role="status" className="mt-8 text-sm text-[var(--text-muted)]">Loading review queue…</p> : null}
        {state === "failed" ? <button type="button" onClick={() => void load(true, false)} className="mt-4 rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white">Try again</button> : null}
        {state === "empty" ? <p role="status" className="mt-8 rounded-xl border border-[var(--border-soft)] p-5 text-sm text-[var(--text-muted)]">Nothing currently matches these filters. Deferred, snoozed, and completed items remain available through Status.</p> : null}

        {items.length > 0 ? <section className="mt-7" aria-labelledby="truth-queue-heading">
          <h2 className="sr-only" id="truth-queue-heading">Review queue</h2>
          <div className="desk-queue">
            {items.map((item,index) => (
              <article key={item.id} className="desk-row">
                <div className="desk-row-main">
                  <p className="desk-meta">{item.sourceType.replace(/_/g, " ")} <span aria-hidden="true">—</span> {item.category.replace(/_/g, " ")}
                    {item.severity === "critical" && <strong>Critical</strong>}{item.status !== "active" && <span>{item.comparison?.status ?? item.status.replace(/_/g, " ")}</span>}</p>
                  <h3><Link to={`/truth-inbox/${encodeURIComponent(item.id)}`}>{item.title}</Link></h3>
                  <QueueComparison item={item} />
                </div>
                <div className="desk-row-action"><Link className={index === 0 ? "desk-primary" : "desk-link"} to={`/truth-inbox/${encodeURIComponent(item.id)}`}>{item.status === "resolved" ? "View decision" : item.sourceType === "proposal" ? "Review change" : "Review signal"} <ArrowRight size={14} /></Link>
                  <small>Owner · {item.owner?.displayName ?? "Unassigned"}</small>
                </div>
                <details className="desk-row-more"><summary>Evidence &amp; actions <ChevronDown size={12} /></summary>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                  <label className="flex items-center gap-2">
                    <UserRound size={13} aria-hidden="true" />
                    <span className="sr-only">Owner for {item.title}</span>
                    <select
                      aria-label={`Owner for ${item.title}`}
                      value={item.owner?.userId ?? ""}
                      disabled={!item.capabilities.assign_owner || Boolean(busy)}
                      onChange={(event) => void execute(item, "assign_owner", { assignedUserId: event.target.value || null })}
                      className="max-w-[190px] rounded-md border border-[var(--border-soft)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--text-default)] disabled:opacity-60"
                    >
                      <option value="">Unassigned</option>
                      {payload?.members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                    </select>
                  </label>
                  {item.snoozedUntil ? <span className="flex items-center gap-1"><Clock3 size={12} aria-hidden="true" /> Snoozed until {new Date(item.snoozedUntil).toLocaleString()}</span> : null}
                  {item.clarification ? <span>Clarification requested: {item.clarification.note}</span> : null}
                </div>

                <details className="mt-3 group">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-[var(--text-default)]">View evidence ({item.evidence.length}) <ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
                  {item.evidence.length === 0 ? <p className="mt-2 rounded-lg bg-[var(--bg-inset)] p-2 text-xs text-[var(--text-muted)]">No directly openable citation is stored. Review the limitation before acting.</p> : <ul className="mt-2 space-y-2">{item.evidence.map((evidence) => <EvidenceRow key={evidence.id} item={item} evidence={evidence} />)}</ul>}
                  {item.limitations.length > 0 ? <p className="mt-2 text-[11px] text-[var(--text-faint)]">Limitation: {item.limitations.join(" ")}</p> : null}
                </details>

                <div className="mt-4 flex flex-wrap gap-2">
                  {item.capabilities.ask_socrates ? <ActionButton item={item} action="ask_socrates" busy={busy} onClick={() => void execute(item, "ask_socrates")} icon={<MessageCircle size={13} aria-hidden="true" />} /> : null}
                  {item.capabilities.create_review_item ? <ActionButton item={item} action="create_review_item" busy={busy} onClick={() => void execute(item, "create_review_item")} primary /> : null}
                  {item.capabilities.accept ? <ActionButton item={item} action="accept" busy={busy} onClick={() => openComposer(item.id, "accept")} primary /> : null}
                  {item.capabilities.reject ? <ActionButton item={item} action="reject" busy={busy} onClick={() => openComposer(item.id, "reject")} /> : null}
                  {item.capabilities.promote_to_timeline ? <ActionButton item={item} action="promote_to_timeline" busy={busy} onClick={() => void execute(item, "promote_to_timeline")} /> : null}
                  {item.capabilities.request_clarification ? <ActionButton item={item} action="request_clarification" busy={busy} onClick={() => openComposer(item.id, "clarification")} /> : null}
                  {item.capabilities.defer ? <ActionButton item={item} action="defer" busy={busy} onClick={() => openComposer(item.id, "defer")} /> : null}
                  {item.capabilities.snooze ? <ActionButton item={item} action="snooze" busy={busy} onClick={() => openComposer(item.id, "snooze")} /> : null}
                  {item.capabilities.dismiss ? <ActionButton item={item} action="dismiss" busy={busy} onClick={() => openComposer(item.id, "dismiss")} /> : null}
                </div>

                {composer?.itemId === item.id ? <ActionComposer
                  mode={composer.mode}
                  note={note}
                  until={until}
                  busy={Boolean(busy)}
                  onNote={setNote}
                  onUntil={setUntil}
                  onCancel={() => setComposer(null)}
                  onSubmit={() => {
                    const mode = composer.mode;
                    if (!mode) return;
                    const action: TruthInboxAction = mode === "clarification" ? "request_clarification" : mode;
                    void execute(item, action, {
                      ...(mode === "clarification" || mode === "dismiss" ? { note } : {}),
                      ...(mode === "defer" || mode === "snooze" ? { until: new Date(until).toISOString() } : {})
                    });
                  }}
                /> : null}
                </details>
              </article>
            ))}
          </div>
        </section> : null}

        {payload?.page.hasMore ? <div className="mt-5 flex justify-center"><button type="button" disabled={state === "refreshing"} onClick={() => void load(false, true, payload.page.nextCursor ?? undefined)} className="rounded-lg border border-[var(--border-soft)] px-4 py-2 text-xs text-[var(--text-default)] disabled:opacity-50">{state === "refreshing" ? "Loading…" : "Load more"}</button></div> : null}
        {payload && <details className="desk-safeguards"><summary>Queue coverage and safeguards</summary>
          <p>Only an authorized truth approver can accept a change. A source or suggestion is not an approval.</p>
          {payload.limitations.map(text => <p key={text}>{text}</p>)}<p>Updated {new Date(payload.generatedAt).toLocaleString()}</p></details>}
      </div>
    </div>
  );
}

function inboxEvidenceLink(item: TruthInboxItem, evidence: TruthInboxItem["evidence"][number]) {
  if (!evidence.openTarget) return null;
  if (item.sourceType === "proposal" && evidence.openTarget.targetType === "live_doc_section") {
    // The queue only has the section ID; the packet resolves the document, revision and anchor.
    return { href: `/truth-inbox/${encodeURIComponent(item.id)}#affected-areas`, label: "Linked document sections", external: false };
  }
  return resolveOpenTarget({ id: evidence.id, sourceType: evidence.source, ...evidence.openTarget });
}

function QueueComparison({ item }: {item: TruthInboxItem}) {
  const c = item.comparison;
  const accepted = c?.status === "accepted";
  const title = c?.decision ? (c.status === "superseded" ? "Earlier decision" : "Accepted decision")
    : accepted ? "Accepted wording" : "Recorded before";
  const secondTitle = accepted ? "Previously" : c?.status === "rejected" ? "Not accepted" : c?.status === "superseded" ? "Superseded" : "Requested";
  const primary = item.evidence.find(e => inboxEvidenceLink(item, e));
  const target = primary && inboxEvidenceLink(item, primary);
  return <dl className="desk-comparison">
    {c && <div><dt>{title}</dt><dd>{c.decision?.statement || (accepted ? c.acceptedWording : c.prior) || (accepted ? "No accepted wording linked" : "No earlier wording recorded")}
      {c.decision && <Link className="desk-citation" to={`/truth-inbox/${encodeURIComponent(item.id)}#decision-evidence`}>Decision record ↗</Link>}</dd></div>}
    <div><dt>{c ? secondTitle : item.sourceType === "proposal" ? "Proposal" : "Signal"}</dt><dd>{c ? (accepted ? c.prior ?? "No earlier wording recorded" : c.requested) : item.description}
      {!accepted && primary && target && (target.external ? <a className="desk-citation" href={target.href} rel="noreferrer" target="_blank">{target.label === "Linked document sections" ? target.label : primary.label} ↗</a> : <Link className="desk-citation" to={target.href}>{target.label === "Linked document sections" ? target.label : primary.label} ↗</Link>)}</dd></div>
  </dl>;
}

function FilterSelect({ label, value, options, labels = {}, onChange }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onChange: (value: string) => void }) {
  return <label className="text-[10px] text-[var(--text-muted)]"><span className="mb-1 block font-mono uppercase tracking-[0.1em]">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] px-2 py-2 text-xs text-[var(--text-default)]"><option value="">{label === "Status" ? "Needs attention" : `All ${label.toLowerCase()}`}</option>{options.map((option) => <option key={option} value={option}>{labels[option] ?? option.replace(/_/g, " ")}</option>)}</select></label>;
}

function EvidenceRow({ item, evidence }: { item: TruthInboxItem; evidence: TruthInboxItem["evidence"][number] }) {
  const resolved = inboxEvidenceLink(item, evidence);
  return <li className="rounded-lg bg-[var(--bg-inset)] p-2 text-xs text-[var(--text-muted)]"><div className="flex flex-wrap items-start justify-between gap-2"><span className="font-medium text-[var(--text-default)]">{evidence.label}</span>{resolved ? resolved.external ? <a href={resolved.href} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[var(--terracotta-text)]">{resolved.label}<ExternalLink size={11} aria-hidden="true" /></a> : <Link to={resolved.href} className="text-[var(--terracotta-text)]">{resolved.label}</Link> : null}</div>{evidence.excerpt ? <p className="mt-1 leading-5">{evidence.excerpt}</p> : null}{evidence.occurredAt ? <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">{new Date(evidence.occurredAt).toLocaleString()}</p> : null}</li>;
}

function ActionButton({ item, action, busy, onClick, primary = false, icon }: { item: TruthInboxItem; action: TruthInboxAction; busy: string | null; onClick: () => void; primary?: boolean; icon?: React.ReactNode }) {
  const isBusy = busy === `${item.id}:${action}`;
  return <button type="button" disabled={Boolean(busy)} onClick={onClick} className={primary ? "flex items-center gap-1 rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50" : "flex items-center gap-1 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)] disabled:opacity-50"}>{icon}{isBusy ? "Saving…" : actionLabel(action)}</button>;
}

function ActionComposer({ mode, note, until, busy, onNote, onUntil, onCancel, onSubmit }: { mode: ComposerMode; note: string; until: string; busy: boolean; onNote: (value: string) => void; onUntil: (value: string) => void; onCancel: () => void; onSubmit: () => void }) {
  if (!mode) return null;
  const needsNote = mode === "clarification" || mode === "dismiss";
  const needsUntil = mode === "defer" || mode === "snooze";
  const destructive = mode === "reject" || mode === "dismiss";
  return <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3" role="group" aria-label={`${mode.replace(/_/g, " ")} confirmation`}><p className="text-xs font-medium text-[var(--text-default)]">{mode === "accept" ? "Confirm this evidence-backed change as accepted truth?" : mode === "reject" ? "Reject this proposed change?" : mode === "clarification" ? "What must be clarified?" : `${mode.charAt(0).toUpperCase()}${mode.slice(1)} this item`}</p>{needsNote ? <textarea autoFocus value={note} onChange={(event) => onNote(event.target.value)} placeholder={mode === "clarification" ? "Describe the missing decision or evidence…" : "Optional reason…"} className="mt-2 min-h-20 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-default)]" /> : null}{needsUntil ? <label className="mt-2 block text-[10px] uppercase text-[var(--text-muted)]">Until<input type="datetime-local" value={until} onChange={(event) => onUntil(event.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-default)]" /></label> : null}<div className="mt-3 flex gap-2"><button type="button" disabled={busy || (mode === "clarification" && !note.trim()) || (needsUntil && !until)} onClick={onSubmit} className={destructive ? "rounded-lg border border-[var(--red-text)]/30 px-3 py-2 text-xs text-[var(--red-text)] disabled:opacity-50" : "rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50"}>{busy ? "Saving…" : "Confirm"}</button><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)]">Cancel</button></div></div>;
}
