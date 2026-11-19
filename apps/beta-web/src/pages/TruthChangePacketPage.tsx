import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  GitFork,
  Layers3,
  Link2,
  MessageCircle,
  Rocket,
  ShieldCheck,
  UserRound
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useToastStore } from "../components/ui/Toaster";
import { useAuth } from "../context/AuthContext";
import {
  actOnTruthInboxItem,
  getTruthChangePacket,
  type TruthChangePacket,
  type TruthInboxAction,
  type TruthInboxEvidence,
  type TruthImpactItem,
  type TruthImpactMap,
  type TruthPacketReference
} from "../lib/api/truthInbox";
import { resolveOpenTarget } from "../lib/socratesPresentation";
import { getDecisionDeliveryTrace, issueDecisionReceipt, type DecisionDeliveryTrace, type DeliveryTraceStep } from "../lib/api/delivery";

type ComposerMode = "accept" | "reject" | "request_clarification" | "defer" | null;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "The Truth Change Packet could not be loaded.";
}

function futureDate(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function actionLabel(action: Exclude<ComposerMode, null>) {
  return ({ accept: "Accept change", reject: "Reject change", request_clarification: "Request clarification", defer: "Defer" } as const)[action];
}

export function TruthChangePacketPage() {
  const { activeProject } = useAuth();
  const { itemId } = useParams();
  if (!activeProject || !itemId) return <p className="desk-empty">Choose a project to open this change packet.</p>;
  return <PacketView key={JSON.stringify([activeProject.id, itemId])} projectId={activeProject.id} itemId={itemId} />;
}
function PacketView({ projectId, itemId }: { projectId: string; itemId: string }) {
  const navigate = useNavigate();
  const showToast = useToastStore((state) => state.add);
  const [packet, setPacket] = useState<TruthChangePacket | null>(null);
  const [trace, setTrace] = useState<DecisionDeliveryTrace | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<TruthInboxAction | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [composer, setComposer] = useState<ComposerMode>(null);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState(futureDate(72));

  const generation = useRef(0);
  const { hash } = useLocation();
  useEffect(() => {
    if (state !== "ready" || !["#decision-evidence", "#affected-areas"].includes(hash)) return;
    const section = document.getElementById(hash.slice(1));
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView?.({ block: "nearest" });
  }, [state, hash]);

  const load = useCallback(async () => {
    if (!projectId || !itemId) return;
    const request = ++generation.current;
    setError(null);
    try {
      setTraceError(null);
      const result = await getTruthChangePacket(projectId, itemId);
      if (request !== generation.current) return;
      setPacket(result);
      void getDecisionDeliveryTrace(projectId, itemId).then(value => { if (request === generation.current) setTrace(value); }, failure => {
        if (request === generation.current) { setTrace(null); setTraceError(messageOf(failure)); }
      });
      setState("ready");
    } catch (caught) {
      if (request !== generation.current) return;
      setError(messageOf(caught));
      setState("failed");
    }
  }, [itemId, projectId]);

  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  const execute = async (action: TruthInboxAction, input: { note?: string; until?: string } = {}) => {
    if (!packet || !projectId || busy) return;
    setBusy(action);
    setError(null);
    try {
      const result = await actOnTruthInboxItem(projectId, packet.item.id, action, input);
      if (action === "ask_socrates") {
        const outcome = result.outcome as { answer?: { sessionId?: string; session?: { sessionId?: string } } } | null;
        const sessionId = outcome?.answer?.sessionId ?? outcome?.answer?.session?.sessionId;
        navigate(sessionId ? `/chat/${encodeURIComponent(sessionId)}` : "/chat");
        return;
      }
      if (action === "create_review_item" && result.item?.reviewProposalId) {
        showToast("Review proposal created without changing accepted truth.", "success");
        navigate(`/truth-inbox/${encodeURIComponent(`proposal:${result.item.reviewProposalId}`)}`);
        return;
      }
      if (action === "accept" || action === "reject") {
        showToast(`${action === "accept" ? "Accepted" : "Rejected"} change saved.`, "success");
        setComposer(null);
        setTrace(null);
        setState("loading");
        await load();
        return;
      }
      showToast(`${action === "request_clarification" ? "Clarification request" : "Deferral"} saved.`, "success");
      setComposer(null);
      setNote("");
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  };

  const createReceipt = async () => {
    if (!projectId || !itemId || !trace?.receiptEligible || receiptBusy) return;
    setReceiptBusy(true);
    setError(null);
    try {
      const receipt = await issueDecisionReceipt(projectId, itemId);
      setTrace((current) => current ? { ...current, receipt } : current);
      showToast("Immutable Decision Receipt issued from verified delivery evidence.", "success");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setReceiptBusy(false);
    }
  };

  if (state === "loading") return <div className="h-full overflow-y-auto bg-[var(--bg)] p-6"><p role="status" className="text-sm text-[var(--text-muted)]">Loading change packet…</p></div>;
  if (state === "failed" || !packet) return <div className="h-full overflow-y-auto bg-[var(--bg)] p-6"><div role="alert" className="rounded-lg border border-[var(--red-text)]/20 bg-[var(--tint-red)] p-3 text-sm text-[var(--red-text)]">{error ?? "Truth Change Packet unavailable."}</div><button type="button" onClick={() => { setState("loading"); void load(); }} className="mt-3 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)]">Try again</button></div>;

  const proposalStatus = packet.proposedChange?.status;
  const decisionStatements = packet.currentAcceptedTruth.filter(ref => ref.type === "accepted_decision").map(ref => ref.detail);
  const acceptedLines = decisionStatements.length > 0 ? decisionStatements
    : packet.item.comparison?.acceptedWording ? (packet.proposedChange?.statements.length ? packet.proposedChange.statements : [packet.item.comparison.acceptedWording]) : [];
  const decided = proposalStatus === "accepted" || proposalStatus === "rejected" || proposalStatus === "superseded";
  const packetStatus = !proposalStatus ? "Review signal"
    : proposalStatus === "accepted" ? "Accepted"
    : proposalStatus === "rejected" ? "Rejected"
    : proposalStatus === "superseded" ? "Superseded" : "Pending";

  return (
    <div className="desk-scroll" aria-labelledby="packet-heading">
      <div className="desk-page desk-packet">
        <Link to="/truth-inbox" className="desk-back"><ArrowLeft size={14} /> Truth Inbox</Link>
        <header className="desk-head"><div className="desk-meta" role="group" aria-label="Packet status"><span className={proposalStatus === "accepted" ? "desk-accepted" : "desk-pending"}>{packetStatus}</span>
          <span>Change packet</span>{!decided && <span>{packet.readiness === "review_only" ? "Review only" : packet.readiness.replace(/_/g," ")}</span>}</div>
          <h1 id="packet-heading">{packet.item.title}</h1><p>{packet.item.description}</p>
        </header>
        {error && <div role="alert" className="desk-alert">{error}</div>}
        <section className="desk-pair" aria-label="Change comparison">
          <div><h2>{proposalStatus === "accepted" ? "Recorded before" : "In effect"}</h2>
            {proposalStatus === "accepted" ? <Wording lines={packet.recordedPriorUnderstanding} empty="No earlier wording recorded." /> :
              <Wording lines={packet.currentAcceptedTruth.map(ref => ref.detail || ref.label)} empty="No linked accepted decision." />}
            {proposalStatus !== "accepted" && !!packet.recordedPriorUnderstanding.length && <details><summary>Recorded prior understanding</summary><BulletList items={packet.recordedPriorUnderstanding} /></details>}
          </div>
          <div><h2>{proposalStatus === "accepted" ? "Accepted wording" : proposalStatus === "rejected" ? "Not accepted" : proposalStatus === "superseded" ? "Superseded proposal" : packet.proposedChange ? "Requested" : "Review signal"}</h2>
            <Wording lines={proposalStatus === "accepted" ? acceptedLines : packet.proposedChange?.statements.length ? packet.proposedChange.statements : [packet.proposedChange?.summary || packet.item.description]} empty="The accepted wording is not linked to this packet." />
          </div>
        </section>
        <div id="decision-evidence" className="desk-decision-byline">
          {trace?.steps.filter(step=>step.key === "human_approved" && step.status === "complete").map(step=><p key={step.key}><CheckCircle2 size={14} />{step.detail}{step.occurredAt && <time dateTime={step.occurredAt}>{new Date(step.occurredAt).toLocaleString()}</time>}</p>)}
          {packet.affected.owners.length > 0 && <p><UserRound size={14} /> Owner · {packet.affected.owners.map(o=>o.displayName).join(", ")}</p>}
        </div>
        <section className="desk-evidence" aria-label="Source evidence"><h2>New evidence</h2>
          {packet.newEvidence.length ? packet.newEvidence.map(ev=><EvidenceCard key={ev.id} evidence={ev}/>) : <EmptyState>No source evidence is linked.</EmptyState>}
        </section>
        <section className="desk-decision" aria-labelledby="decision-heading">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="decision-heading" className="text-base font-semibold text-[var(--text-default)]">{decided ? "Decision recorded" : packet.decision.required ? "Review this change" : "Next action"}</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Confidence: {Math.round(packet.confidence.score * 100)}% ({packet.confidence.label})</p></div>{packet.item.capabilities.ask_socrates && <button type="button" disabled={Boolean(busy)} onClick={() => void execute("ask_socrates")} className="flex items-center gap-1 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)] disabled:opacity-50"><MessageCircle size={13} aria-hidden="true" /> Ask Socrates</button>}</div>

          {packet.decision.blockers.length ? <div className="mt-3 rounded-lg border border-[var(--amber-text)]/20 bg-[var(--tint-amber)] p-3"><p className="text-xs font-medium text-[var(--amber-text)]">Decision blockers</p><BulletList items={packet.decision.blockers} /></div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {packet.item.capabilities.create_review_item ? <button type="button" disabled={Boolean(busy)} onClick={() => void execute("create_review_item")} className="rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50">{busy === "create_review_item" ? "Creating…" : "Create review item"}</button> : null}
            {packet.decision.options.map((action) => <button key={action} type="button" disabled={Boolean(busy)} onClick={() => { setComposer(action); setNote(""); setUntil(futureDate(72)); }} className={action === "accept" ? "rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50" : "rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)] disabled:opacity-50"}>{actionLabel(action)}</button>)}
          </div>
          {composer ? <DecisionComposer mode={composer} note={note} until={until} busy={Boolean(busy)} onNote={setNote} onUntil={setUntil} onCancel={() => setComposer(null)} onConfirm={() => void execute(composer, {
            ...(composer === "request_clarification" ? { note } : {}),
            ...(composer === "defer" ? { until: new Date(until).toISOString() } : {})
          })} /> : null}
        </section>


        <details className="desk-fold"><summary>Decision history &amp; interpretation</summary>
          <section aria-label="Truth state boundary">{packet.boundaries.map(row=><div key={row.stage} className="desk-history"><b>{row.label}</b><p>{row.detail}</p></div>)}</section>
          <PacketSection title="Current accepted truth" icon={<ShieldCheck size={15} />}>{packet.currentAcceptedTruth.map(ref=><ReferenceCard key={ref.type+ref.id} reference={ref} />)}</PacketSection>
          {packet.potentialConflict && <PacketSection title="Potential conflict" icon={<AlertTriangle size={15} />}><small>Interpretation only</small><p>{packet.potentialConflict.summary}</p><BulletList items={packet.potentialConflict.basis}/></PacketSection>}
        </details>
        <details id="affected-areas" className="desk-fold"><summary>Impact &amp; affected areas</summary>
        <section className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4" aria-labelledby="affected-heading">
          <h2 id="affected-heading" className="text-base font-semibold text-[var(--text-default)]">Affected areas</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-3">
            <div><h3 className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Product</h3>{packet.affected.productAreas.length ? <div className="mt-2 space-y-2">{packet.affected.productAreas.map((reference) => <ReferenceCard key={`${reference.type}:${reference.id}`} reference={reference} compact />)}</div> : <EmptyState>No exact product-area link.</EmptyState>}</div>
            <div><h3 className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Engineering</h3>{packet.affected.engineering.length ? <BulletList items={packet.affected.engineering} /> : <EmptyState>No verified engineering impact links are recorded yet.</EmptyState>}</div>
            <div><h3 className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Owners</h3>{packet.affected.owners.length ? <div className="mt-2 space-y-2">{packet.affected.owners.map((owner) => <div key={owner.userId} className="flex items-center gap-2 rounded-lg bg-[var(--bg-inset)] p-2 text-xs text-[var(--text-default)]"><UserRound size={13} aria-hidden="true" /> <span>{owner.displayName}</span></div>)}</div> : <EmptyState>Unassigned. No owner is guessed.</EmptyState>}</div>
          </div>
        </section>

        <ImpactMapPanel impactMap={packet.impactMap} />
        </details>
        <details className="desk-fold"><summary>Decision-to-delivery trace &amp; receipt</summary>
        {traceError && <p role="alert">{traceError} <button type="button" className="desk-link" onClick={()=>void load()}>Retry trace</button></p>}
        {!trace && !traceError && <p role="status">Loading delivery evidence…</p>}
        {trace ? <DeliveryTracePanel trace={trace} receiptBusy={receiptBusy} onReceipt={() => void createReceipt()} /> : null}

        </details>
        <details className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4"><summary className="cursor-pointer text-xs font-medium text-[var(--text-default)]">Limitations and safeguards ({packet.limitations.length})</summary><BulletList items={packet.limitations} /></details>
        <p className="mt-4 text-center font-mono text-[9px] uppercase text-[var(--text-faint)]">Packet generated {new Date(packet.generatedAt).toLocaleString()}</p>
      </div>
    </div>
  );
}

function Wording({ lines, empty }: { lines: string[]; empty: string }) {
  return lines.length ? <ul>{lines.map((line,i)=><li key={i}>{line}</li>)}</ul> : <p>{empty}</p>;
}

function DeliveryTracePanel({ trace, receiptBusy, onReceipt }: { trace: DecisionDeliveryTrace; receiptBusy: boolean; onReceipt: () => void }) {
  return <section className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4" aria-labelledby="delivery-trace-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2"><Rocket size={16} className="mt-0.5 text-[var(--terracotta-text)]" aria-hidden="true" /><div><h2 id="delivery-trace-heading" className="text-base font-semibold text-[var(--text-default)]">Decision-to-Delivery Trace</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{trace.completedSteps}/{trace.applicableSteps} applicable steps have persisted evidence.</p></div></div><span className={trace.status === "delivered" ? "rounded-full bg-[var(--tint-teal)] px-2.5 py-1 font-mono text-[9px] uppercase text-[var(--teal-text)]" : trace.status === "blocked" ? "rounded-full bg-[var(--tint-red)] px-2.5 py-1 font-mono text-[9px] uppercase text-[var(--red-text)]" : "rounded-full bg-[var(--tint-amber)] px-2.5 py-1 font-mono text-[9px] uppercase text-[var(--amber-text)]"}>{trace.status.replace(/_/g, " ")}</span></div>
    {trace.steps.length ? <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{trace.steps.map((item) => <TraceStepCard key={item.key} step={item} />)}</div> : <p className="mt-3 rounded-lg bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-muted)]">Create a persisted change proposal before delivery can be traced.</p>}
    <div className="mt-4 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--text-default)]">Decision Receipt</p><p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">A permanent evidence-backed receipt can be issued only after approval, truth update, implementation, tests, deployment, and human verification are all recorded.</p></div>{trace.receipt ? <span className="rounded-full bg-[var(--tint-teal)] px-2.5 py-1 font-mono text-[9px] uppercase text-[var(--teal-text)]">Issued</span> : <button type="button" disabled={!trace.receiptEligible || receiptBusy} onClick={onReceipt} className="rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40">{receiptBusy ? "Issuing…" : "Issue receipt"}</button>}</div>{trace.receipt ? <ReceiptCard receipt={trace.receipt} /> : trace.receiptBlockers.length ? <div className="mt-3 rounded-lg border border-[var(--amber-text)]/20 bg-[var(--tint-amber)] p-3"><p className="font-mono text-[9px] uppercase text-[var(--amber-text)]">Receipt blockers</p><BulletList items={trace.receiptBlockers} /></div> : null}</div>
    <details className="mt-3"><summary className="cursor-pointer text-[10px] uppercase text-[var(--text-muted)]">Trace safeguards ({trace.limitations.length})</summary><BulletList items={trace.limitations} /></details>
  </section>;
}

function TraceStepCard({ step }: { step: DeliveryTraceStep }) {
  const icon = step.status === "complete" ? <CheckCircle2 size={13} className="text-[var(--teal-text)]" aria-label="Complete" /> : step.status === "blocked" ? <AlertTriangle size={13} className="text-[var(--red-text)]" aria-label="Blocked" /> : <CircleDashed size={13} className="text-[var(--text-muted)]" aria-label={step.status === "not_applicable" ? "Not applicable" : "Pending"} />;
  return <article className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-[var(--text-default)]">{step.label}</h3>{icon}</div><p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">{step.detail}</p>{step.owner ? <p className="mt-2 font-mono text-[9px] text-[var(--text-muted)]">Owner · {step.owner}</p> : null}{step.remainingGap ? <p className="mt-2 text-[10px] leading-4 text-[var(--amber-text)]">Next: {step.remainingGap}</p> : null}{step.evidence.length ? <details className="mt-2"><summary className="cursor-pointer font-mono text-[9px] uppercase text-[var(--terracotta-text)]">Evidence ({step.evidence.length})</summary><ul className="mt-2 space-y-1 text-[10px] text-[var(--text-muted)]">{step.evidence.slice(0, 8).map((evidence) => <li key={evidence.id}>{evidence.label}{evidence.status ? ` · ${evidence.status.replace(/_/g, " ")}` : ""}</li>)}</ul></details> : null}<p className="mt-2 font-mono text-[8px] uppercase text-[var(--text-faint)]">{step.status.replace(/_/g, " ")}{step.occurredAt ? ` · ${new Date(step.occurredAt).toLocaleString()}` : ""}</p></article>;
}

function ReceiptCard({ receipt }: { receipt: NonNullable<DecisionDeliveryTrace["receipt"]> }) {
  return <details className="mt-3 rounded-lg bg-[var(--bg-elevated)] p-3"><summary className="cursor-pointer text-xs font-medium text-[var(--terracotta-text)]">Open immutable receipt</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><StatementGroup title="Accepted wording" items={[receipt.content.acceptedWording]} /><StatementGroup title="Approval" items={[`${receipt.content.approvedBy ?? "Authorized approver"} · ${receipt.content.approvedAt ? new Date(receipt.content.approvedAt).toLocaleString() : "time unavailable"}`]} /><StatementGroup title="Affected scope" items={receipt.content.affectedScope} /><StatementGroup title="Responsible owners" items={receipt.content.responsibleOwners} /><StatementGroup title="Known limitations" items={receipt.content.knownLimitations} /><StatementGroup title="Remaining follow-up" items={receipt.content.remainingFollowUp} /></div><p className="mt-3 break-all font-mono text-[8px] text-[var(--text-faint)]">SHA-256 {receipt.contentHash}</p></details>;
}

function ImpactMapPanel({ impactMap }: { impactMap: TruthImpactMap }) {
  const mapped = impactMap.groups.filter((group) => group.coverage === "mapped");
  const unmapped = impactMap.groups.filter((group) => group.coverage === "not_recorded");
  return <section className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4" aria-labelledby="impact-map-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2"><span className="mt-0.5 text-[var(--terracotta-text)]"><GitFork size={16} aria-hidden="true" /></span><div><h2 id="impact-map-heading" className="text-base font-semibold text-[var(--text-default)]">Change Impact Map</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">Persisted relationships show what this proposal can affect. Empty areas remain unknown—not safe by default.</p></div></div>
      <div className="flex flex-wrap gap-2" aria-label="Impact map summary"><SummaryPill label="Mapped areas" value={`${impactMap.summary.mappedGroups}/${impactMap.summary.totalGroups}`} /><SummaryPill label="Verified links" value={String(impactMap.summary.verifiedItems)} /><SummaryPill label="Recorded only" value={String(impactMap.summary.recordedItems)} /></div>
    </div>
    {impactMap.status === "review_only" ? <div className="mt-4 rounded-lg bg-[var(--bg-inset)] p-3 text-xs leading-5 text-[var(--text-muted)]">Create a review item to establish a proposal before Orchestra maps change impact.</div> : <>
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--terracotta-text)]/15 bg-[var(--tint-terracotta)] p-3 text-xs"><span className="font-medium text-[var(--text-default)]">Proposed change</span><ArrowRight size={13} className="text-[var(--terracotta-text)]" aria-hidden="true" /><span className="text-[var(--text-muted)]">direct links</span><ArrowRight size={13} className="text-[var(--text-faint)]" aria-hidden="true" /><span className="text-[var(--text-muted)]">persisted graph</span><ArrowRight size={13} className="text-[var(--text-faint)]" aria-hidden="true" /><span className="text-[var(--text-muted)]">delivery and agent context</span></div>
      {mapped.length ? <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{mapped.map((group) => <article key={group.key} className="min-w-0 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3">
        <div className="flex items-center justify-between gap-2"><h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-default)]"><Layers3 size={12} className="text-[var(--terracotta-text)]" aria-hidden="true" />{group.label}</h3><span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[9px] text-[var(--text-muted)]">{group.items.length}</span></div>
        <div className="mt-2 space-y-2">{group.items.map((item) => <ImpactItemCard key={item.id} item={item} />)}</div>
      </article>)}</div> : <div className="mt-4 rounded-lg bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-muted)]">No persisted impact relationship is recorded yet.</div>}
      {unmapped.length ? <div className="mt-3 rounded-lg border border-[var(--amber-text)]/15 bg-[var(--tint-amber)] p-3"><p className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--amber-text)]">No persisted relationship yet</p><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{unmapped.map((group) => group.label).join(" · ")}</p></div> : null}
    </>}
    <details className="mt-3"><summary className="cursor-pointer text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">Impact-map safeguards ({impactMap.limitations.length})</summary><BulletList items={impactMap.limitations} /></details>
  </section>;
}

function ImpactItemCard({ item }: { item: TruthImpactItem }) {
  const resolved = item.openTarget ? resolveOpenTarget({ id: item.id, sourceType: item.group, ...item.openTarget }) : null;
  const confidenceClass = item.confidence === "verified" ? "text-[var(--teal-text)]" : item.confidence === "recorded" ? "text-[var(--amber-text)]" : "text-[var(--text-muted)]";
  return <div className="rounded-md bg-[var(--bg-elevated)] p-2.5">
    <div className="flex items-start justify-between gap-2"><p className="min-w-0 text-xs font-medium text-[var(--text-default)]">{item.label}</p>{resolved ? resolved.external ? <a href={resolved.href} target="_blank" rel="noreferrer" className="shrink-0 text-[var(--terracotta-text)]" aria-label={`${resolved.label}: ${item.label}`}><ExternalLink size={12} aria-hidden="true" /></a> : <Link to={resolved.href} className="shrink-0 text-[var(--terracotta-text)]" aria-label={`${resolved.label}: ${item.label}`}><Link2 size={12} aria-hidden="true" /></Link> : null}</div>
    <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{item.detail}</p>
    <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{item.relationship.reason}</p>
    <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[8px] uppercase"><span className={confidenceClass}>{item.confidence}</span><span className="text-[var(--text-faint)]">·</span><span className="text-[var(--text-muted)]">{item.relationship.label}</span>{item.status ? <><span className="text-[var(--text-faint)]">·</span><span className="text-[var(--text-muted)]">{item.status.replace(/_/g, " ")}</span></> : null}</div>
  </div>;
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return <span className="rounded-full bg-[var(--bg-inset)] px-2.5 py-1 font-mono text-[9px] text-[var(--text-muted)]"><span className="text-[var(--text-default)]">{value}</span> {label}</span>;
}

function PacketSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4"><div className="flex items-center gap-2"><span className="text-[var(--terracotta-text)]">{icon}</span><h2 className="text-base font-semibold text-[var(--text-default)]">{title}</h2></div><div className="mt-3">{children}</div></section>;
}

function EvidenceCard({ evidence }: { evidence: TruthInboxEvidence }) {
  const resolved = evidence.openTarget ? resolveOpenTarget({ id: evidence.id, sourceType: evidence.source, ...evidence.openTarget }) : null;
  return <div className="rounded-lg bg-[var(--bg-inset)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="text-xs font-medium text-[var(--text-default)]">{evidence.label}</p>{resolved ? resolved.external ? <a href={resolved.href} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-[var(--terracotta-text)]">{resolved.label}<ExternalLink size={11} aria-hidden="true" /></a> : <Link to={resolved.href} className="text-xs text-[var(--terracotta-text)]">{resolved.label}</Link> : null}</div>{evidence.excerpt ? <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{evidence.excerpt}</p> : null}<p className="mt-2 font-mono text-[9px] uppercase text-[var(--text-muted)]">{evidence.source.replace(/_/g, " ")}{evidence.occurredAt ? ` · ${new Date(evidence.occurredAt).toLocaleString()}` : ""}</p></div>;
}

function ReferenceCard({ reference, compact = false }: { reference: TruthPacketReference; compact?: boolean }) {
  const resolved = reference.openTarget ? resolveOpenTarget({ id: reference.id, sourceType: reference.type, ...reference.openTarget }) : null;
  return <div className="rounded-lg bg-[var(--bg-inset)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="text-xs font-medium text-[var(--text-default)]">{reference.label}</p>{resolved ? <Link to={resolved.href} className="text-xs text-[var(--terracotta-text)]">{resolved.label}</Link> : null}</div>{!compact ? <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{reference.detail}</p> : null}<p className="mt-2 font-mono text-[9px] uppercase text-[var(--text-muted)]">{reference.authority.replace(/_/g, " ")}{reference.status ? ` · ${reference.status.replace(/_/g, " ")}` : ""}</p></div>;
}

function StatementGroup({ title, items }: { title: string; items: string[] }) {
  return <div className="mt-3 rounded-lg bg-[var(--bg-inset)] p-3"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{title}</p><BulletList items={items} /></div>;
}

function BulletList({ items }: { items: string[] }) {
  return <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-[var(--text-muted)]">{items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 rounded-lg bg-[var(--bg-inset)] p-3 text-xs leading-5 text-[var(--text-muted)]">{children}</p>;
}

function DecisionComposer({ mode, note, until, busy, onNote, onUntil, onCancel, onConfirm }: { mode: Exclude<ComposerMode, null>; note: string; until: string; busy: boolean; onNote: (value: string) => void; onUntil: (value: string) => void; onCancel: () => void; onConfirm: () => void }) {
  return <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3" role="group" aria-label={`${actionLabel(mode)} confirmation`}><p className="text-xs font-medium text-[var(--text-default)]">{mode === "accept" ? "Confirm this evidence-backed proposal as accepted truth?" : mode === "reject" ? "Reject this proposed change?" : mode === "request_clarification" ? "What evidence or decision is missing?" : "Defer this decision until when?"}</p>{mode === "request_clarification" ? <textarea autoFocus value={note} onChange={(event) => onNote(event.target.value)} aria-label="Clarification request" className="mt-2 min-h-20 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-default)]" /> : null}{mode === "defer" ? <label className="mt-2 block text-[10px] uppercase text-[var(--text-muted)]">Until<input type="datetime-local" value={until} onChange={(event) => onUntil(event.target.value)} className="mt-1 block w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-2 text-xs text-[var(--text-default)]" /></label> : null}<div className="mt-3 flex gap-2"><button type="button" disabled={busy || (mode === "request_clarification" && !note.trim()) || (mode === "defer" && !until)} onClick={onConfirm} className="rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50">{busy ? "Saving…" : "Confirm"}</button><button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)]">Cancel</button></div></div>;
}
