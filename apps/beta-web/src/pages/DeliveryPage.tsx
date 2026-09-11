import { useEffect, useMemo, useState, useTransition } from "react";
import {copyText} from '../lib/clipboard';
import {isDesktop} from '../lib/desktop';
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleDashed, Clipboard, Download, ExternalLink, HeartPulse, RefreshCw, Rocket, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToastStore } from "../components/ui/Toaster";
import { McpAgentSetup } from "../components/delivery/McpAgentSetup";
import {
  generateAgentPostflight,
  generateAgentPreflight,
  generateWeeklyBrief,
  getDeliveryOverview,
  type AgentPreflight,
  type BriefItem,
  type ContextHealthComponent,
  type DeliveryOverview,
  type ReleaseTruthItem,
  type WeeklyBrief
} from "../lib/api/delivery";

type Busy = "refresh" | "brief" | "preflight" | `postflight:${string}` | null;

export function DeliveryPage() {
  const { activeProject } = useAuth();
  const { add: toast } = useToastStore();
  const projectId = activeProject?.id ?? "";
  const [overview, setOverview] = useState<DeliveryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [taskPrompt, setTaskPrompt] = useState("");
  const [targetAgent, setTargetAgent] = useState<"codex" | "claude" | "cursor">("codex");
  const [preflight, setPreflight] = useState<AgentPreflight | null>(null);
  const [postflight, setPostflight] = useState<{ runId: string; summary: string; scoreLabel: string; recommendation: string; findings: Array<{ summary: string; severity: string }> } | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setError(null);
    setOverview(null);
    setPreflight(null);
    setPostflight(null);
    void getDeliveryOverview(projectId, false, controller.signal)
      .then((data) => { if (!controller.signal.aborted) startTransition(() => setOverview(data)); })
      .catch((caught) => { if (!controller.signal.aborted) setError(messageOf(caught, "Delivery intelligence could not be loaded.")); });
    return () => controller.abort();
  }, [projectId]);

  const refresh = async () => {
    if (!projectId || busy) return;
    setBusy("refresh");
    try {
      const data = await getDeliveryOverview(projectId, true);
      startTransition(() => setOverview(data));
      setError(null);
    } catch (caught) {
      setError(messageOf(caught, "Delivery intelligence could not be refreshed."));
    } finally {
      setBusy(null);
    }
  };

  const buildBrief = async () => {
    if (!projectId || busy) return;
    setBusy("brief");
    try {
      const brief = await generateWeeklyBrief(projectId);
      setOverview((current) => current ? { ...current, weeklyBrief: brief } : current);
      toast("Weekly executive brief saved from authoritative project evidence.", "success");
    } catch (caught) {
      toast(messageOf(caught, "Weekly brief could not be generated."), "error");
    } finally {
      setBusy(null);
    }
  };

  const runPreflight = async () => {
    if (!projectId || busy || taskPrompt.trim().length < 4) return;
    setBusy("preflight");
    try {
      const result = await generateAgentPreflight(projectId, { taskPrompt: taskPrompt.trim(), targetAgent, budgetPreset: "normal" });
      setPreflight(result);
      toast(result.ready ? "Agent Preflight is ready." : "Agent Preflight found decisions or safety gaps.", result.ready ? "success" : "info");
    } catch (caught) {
      toast(messageOf(caught, "Agent Preflight could not be generated."), "error");
    } finally {
      setBusy(null);
    }
  };

  const runPostflight = async (runId: string) => {
    if (!projectId || busy) return;
    setBusy(`postflight:${runId}`);
    try {
      const result = await generateAgentPostflight(projectId, runId);
      setPostflight({ runId, summary: result.review.summary, scoreLabel: result.review.scoreLabel, recommendation: result.review.recommendation, findings: result.review.findings });
      const fresh = await getDeliveryOverview(projectId, true);
      setOverview(fresh);
      toast("Agent Postflight completed. Accepted truth was not changed.", "success");
    } catch (caught) {
      toast(messageOf(caught, "Agent Postflight could not be completed."), "error");
    } finally {
      setBusy(null);
    }
  };

  const copyPreflight = async () => {
    if (!preflight) return;
    try {
      await copyText(agentHandoff(preflight, projectId, targetAgent));
      toast(`Exact ${agentLabel(targetAgent)} context pack copied.`, "success");
    } catch {
      toast("The context pack could not be copied. Download it instead.", "error");
    }
  };

  const downloadPreflight = async () => {
    if (!preflight) return;
    if(isDesktop()){
      try{
        const download=(window.orchestra as typeof window.orchestra & {downloadPreflight?:(projectId:string,packId:string)=>Promise<{ok:boolean;error?:{message:string}}>})?.downloadPreflight;
        if(!download)throw new Error('Native context pack save is unavailable.');
        const result=await download(projectId,preflight.contextPack.id);if(!result.ok)throw new Error(result.error?.message??'Save failed.');
      }catch(error){toast(error instanceof Error?error.message:'Context pack could not be saved.', 'error');}
      return;
    }
    const blob = new Blob([agentHandoff(preflight, projectId, targetAgent)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orchestra-preflight-${preflight.contextPack.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!projectId) return null;
  if (!overview && !error) return <div className="flex h-full items-center justify-center" role="status"><p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Loading delivery intelligence…</p></div>;
  if (!overview) return <div className="flex h-full items-center justify-center px-5"><div className="max-w-md rounded-xl border border-[rgba(200,74,74,0.35)] bg-[rgba(200,74,74,0.05)] p-5 text-center" role="alert"><AlertTriangle className="mx-auto text-[#C84A4A]" size={20} /><p className="mt-2 text-sm text-[var(--text-default)]">{error}</p><button type="button" onClick={() => void refresh()} className="mt-3 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)]">Try again</button></div></div>;

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)] px-4 py-5 sm:px-7 lg:px-10" aria-labelledby="delivery-heading">
      <div className="mx-auto max-w-6xl pb-12">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--terracotta-text)]">Decision to delivery</p><h1 id="delivery-heading" className="mt-1 text-2xl font-semibold text-[var(--text-default)]">Delivery Control</h1><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">Evidence-backed health, agent readiness, delivery proof, and release truth—without silently changing accepted Product Brain truth.</p></div>
          <button type="button" disabled={Boolean(busy)} onClick={() => void refresh()} className="flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-default)] disabled:opacity-50"><RefreshCw size={13} className={busy === "refresh" ? "animate-spin" : ""} aria-hidden="true" />Refresh</button>
        </header>
        {error ? <p className="mt-4 rounded-lg border border-[rgba(200,74,74,0.3)] bg-[rgba(200,74,74,0.04)] p-3 text-xs text-[#C84A4A]" role="alert">{error}</p> : null}

        <ContextHealthPanel overview={overview} />
        <ReleaseTruthPanel overview={overview} />
        <WeeklyBriefPanel brief={overview.weeklyBrief} busy={busy === "brief"} onGenerate={() => void buildBrief()} />
        <AgentPreflightPanel projectId={projectId} taskPrompt={taskPrompt} targetAgent={targetAgent} result={preflight} busy={busy === "preflight"} onPrompt={setTaskPrompt} onAgent={setTargetAgent} onRun={() => void runPreflight()} onCopy={() => void copyPreflight()} onDownload={downloadPreflight} toast={toast} />
        <AgentPostflightPanel overview={overview} busy={busy} result={postflight} onRun={(runId) => void runPostflight(runId)} />

        <p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-faint)]">Authoritative projection generated {new Date(overview.generatedAt).toLocaleString()}{overview.cached ? " · cached briefly for speed" : ""}</p>
      </div>
    </div>
  );
}

function ContextHealthPanel({ overview }: { overview: DeliveryOverview }) {
  const health = overview.contextHealth;
  return <section className="mt-5 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4" aria-labelledby="context-health-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2"><HeartPulse size={17} className="mt-0.5 text-[var(--terracotta-text)]" aria-hidden="true" /><div><h2 id="context-health-heading" className="text-base font-semibold text-[var(--text-default)]">Context Health</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Separate evidence-backed components—never an opaque AI score.</p></div></div><StateBadge state={health.state} /></div>
    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{health.components.map((item) => <HealthCard key={item.key} item={item} />)}</div>
    <Limitations items={health.limitations} />
  </section>;
}

function HealthCard({ item }: { item: ContextHealthComponent }) {
  const destination = targetHref(item.openTarget);
  return <article className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-[var(--text-default)]">{item.label}</h3><StateDot state={item.state} /></div><p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{item.summary}</p>{item.detail.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-[10px] leading-4 text-[var(--text-muted)]">{item.detail.slice(0, 4).map((line) => <li key={line}>{line}</li>)}</ul> : null}{destination ? <TargetLink href={destination} label="Open evidence" /> : null}</article>;
}

function ReleaseTruthPanel({ overview }: { overview: DeliveryOverview }) {
  const release = overview.releaseTruth;
  const groups = useMemo(() => [
    ["Accepted changes", release.acceptedChanges],
    ["Implementation evidence", release.implementationEvidence],
    ["Unresolved decisions", release.unresolvedDecisions],
    ["Missing tests", release.missingTests],
    ["Unsafe areas", release.unsafeAreas],
    ["Stale agent context", release.staleAgentContext],
    ["Deployment evidence", release.deploymentEvidence]
  ] as Array<[string, ReleaseTruthItem[]]>, [release]);
  const assessedTarget = release.assessedRevision && release.assessedRepository && release.assessedEnvironment ? `Assessing ${release.assessedRepository}@${release.assessedRevision} in ${release.assessedEnvironment}.` : "No assessable production revision is recorded.";
  return <section className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4" aria-labelledby="release-truth-heading"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2"><Rocket size={17} className="mt-0.5 text-[var(--terracotta-text)]" aria-hidden="true" /><div><h2 id="release-truth-heading" className="text-base font-semibold text-[var(--text-default)]">Release Truth</h2><p className="mt-1 text-xs text-[var(--text-muted)]">What is approved, evidenced, unresolved, unsafe, tested, and deployed.</p></div></div><StateBadge state={release.readiness === "ready" ? "healthy" : release.readiness === "blocked" ? "blocked" : "attention"} label={release.readiness.replace(/_/g, " ")} /></div><p className="mt-3 rounded-lg bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-muted)]">{release.summary}</p><p className="mt-2 font-mono text-[9px] text-[var(--text-muted)]">{assessedTarget} Scope: {release.assessmentScope}</p>{release.blockers.length ? <div className="mt-3 rounded-lg border border-[var(--amber-text)]/20 bg-[var(--tint-amber)] p-3"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--amber-text)]">Release blockers</p><BulletList items={release.blockers} /></div> : null}<div className="mt-3 grid gap-3 md:grid-cols-2">{groups.map(([label, items]) => <ReleaseGroup key={label} label={label} items={items} />)}</div><Limitations items={release.limitations} /></section>;
}

function ReleaseGroup({ label, items }: { label: string; items: ReleaseTruthItem[] }) {
  return <details className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3" open={label === "Unresolved decisions" || label === "Deployment evidence"}><summary className="cursor-pointer text-xs font-semibold text-[var(--text-default)]">{label} <span className="font-mono text-[9px] text-[var(--text-muted)]">({items.length})</span></summary>{items.length ? <div className="mt-2 space-y-2">{items.slice(0, 12).map((item) => <EvidenceRow key={item.id} item={item} />)}</div> : <p className="mt-2 text-[11px] text-[var(--text-muted)]">No persisted record in this category.</p>}</details>;
}

function EvidenceRow({ item }: { item: ReleaseTruthItem }) {
  const href = targetHref(item.openTarget);
  return <div className="rounded-md bg-[var(--bg-elevated)] p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium text-[var(--text-default)]">{item.label}</p>{href ? <TargetLink href={href} label="Open" compact /> : null}</div><p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{item.detail}</p><p className="mt-2 font-mono text-[8px] uppercase text-[var(--text-muted)]">{item.status.replace(/_/g, " ")}{item.occurredAt ? ` · ${new Date(item.occurredAt).toLocaleString()}` : ""}</p></div>;
}

function WeeklyBriefPanel({ brief, busy, onGenerate }: { brief: WeeklyBrief | null; busy: boolean; onGenerate: () => void }) {
  const sections: Array<[string, BriefItem[]]> = brief ? [["What changed", brief.content.whatChanged], ["Approved", brief.content.approved], ["Rejected", brief.content.rejected], ["Implemented", brief.content.implemented], ["Blocked", brief.content.blocked], ["Needs a decision", brief.content.needsDecision], ["Possible drift", brief.content.possibleDrift], ["Missing evidence", brief.content.missingEvidence]] : [];
  return <section className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4" aria-labelledby="weekly-brief-heading"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2"><Sparkles size={17} className="mt-0.5 text-[var(--terracotta-text)]" aria-hidden="true" /><div><h2 id="weekly-brief-heading" className="text-base font-semibold text-[var(--text-default)]">Weekly executive brief</h2><p className="mt-1 text-xs text-[var(--text-muted)]">A source-openable summary for the current project week.</p></div></div><button type="button" disabled={busy} onClick={onGenerate} className="rounded-lg bg-[var(--terracotta)] px-3 py-2 text-xs text-white disabled:opacity-50">{busy ? "Generating…" : brief ? "Regenerate brief" : "Generate brief"}</button></div>{brief ? <><p className="mt-3 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{brief.weekStart} to {brief.weekEnd} · saved {new Date(brief.generatedAt).toLocaleString()}</p><div className="mt-3 grid gap-3 md:grid-cols-2">{sections.map(([label, items]) => <details key={label} className="rounded-lg bg-[var(--bg-inset)] p-3"><summary className="cursor-pointer text-xs font-semibold text-[var(--text-default)]">{label} ({items.length})</summary>{items.length ? <div className="mt-2 space-y-2">{items.slice(0, 10).map((item) => <BriefRow key={item.id} item={item} />)}</div> : <p className="mt-2 text-[11px] text-[var(--text-muted)]">No evidenced item this week.</p>}</details>)}</div><Limitations items={brief.content.limitations} /></> : <p className="mt-3 rounded-lg bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-muted)]">Generate the first brief from current proposals, Timeline, FDE, engineering evidence, and release truth.</p>}</section>;
}

function BriefRow({ item }: { item: BriefItem }) { const href = targetHref(item.openTarget); return <div className="rounded-md bg-[var(--bg-elevated)] p-2.5"><div className="flex justify-between gap-2"><p className="text-xs font-medium text-[var(--text-default)]">{item.sourceLabel}</p>{href ? <TargetLink href={href} label="Source" compact /> : null}</div><p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{item.statement}</p></div>; }

function AgentPreflightPanel({ projectId, taskPrompt, targetAgent, result, busy, onPrompt, onAgent, onRun, onCopy, onDownload, toast }: { projectId: string; taskPrompt: string; targetAgent: "codex" | "claude" | "cursor"; result: AgentPreflight | null; busy: boolean; onPrompt: (value: string) => void; onAgent: (value: "codex" | "claude" | "cursor") => void; onRun: () => void; onCopy: () => void; onDownload: () => void; toast: (message: string, kind: "success" | "error" | "info") => void }) {
  return <section id="agent-preflight" className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4" aria-labelledby="agent-preflight-heading">
    <div className="flex items-start gap-2"><ShieldCheck size={17} className="mt-0.5 text-[var(--terracotta-text)]" aria-hidden="true" /><div><h2 id="agent-preflight-heading" className="text-base font-semibold text-[var(--text-default)]">Agent Preflight</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Prepare current truth, evidence, constraints, safety boundaries, and required tests before an agent starts.</p></div></div>
    <label className="mt-4 block text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Implementation task<textarea value={taskPrompt} onChange={(event) => onPrompt(event.target.value)} maxLength={6000} placeholder="Describe the exact task the agent should implement…" className="mt-1 min-h-24 w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3 text-sm text-[var(--text-default)] outline-none focus:border-[var(--terracotta)]" /></label>
    <div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Target agent<select value={targetAgent} onChange={(event) => onAgent(event.target.value as "codex" | "claude" | "cursor")} className="mt-1 block rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2 text-xs text-[var(--text-default)]"><option value="codex">Codex</option><option value="claude">Claude</option><option value="cursor">Cursor</option></select></label><button type="button" disabled={busy || taskPrompt.trim().length < 4} onClick={onRun} className="rounded-lg bg-[var(--terracotta)] px-4 py-2.5 text-xs text-white disabled:opacity-50">{busy ? "Building preflight…" : "Build preflight"}</button></div>
    {result ? <div className="mt-4 rounded-lg bg-[var(--bg-inset)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold text-[var(--text-default)]">{result.ready ? "Task ready for an AI agent" : "Task is not ready yet"}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{result.contextPack.title} · {result.contextPack.evidenceCount} evidence records</p><p className="mt-1 font-mono text-[9px] text-[var(--text-faint)]">Pack ID: {result.contextPack.id}</p></div><StateBadge state={result.ready ? "healthy" : result.readinessLabel === "blocked" ? "blocked" : "attention"} label={result.readinessLabel.replace(/_/g, " ")} /></div>
      {result.blockers.length ? <div className="mt-3 rounded-lg border border-[var(--amber-text)]/20 bg-[var(--tint-amber)] p-3"><p className="font-mono text-[9px] uppercase text-[var(--amber-text)]">Resolve before implementation</p><BulletList items={result.blockers} /><div className="mt-3 flex flex-wrap gap-3"><TargetLink href="/truth-inbox" label="Review in Truth Inbox" /><TargetLink href="/memory" label="Add current truth or acceptance criteria" /><TargetLink href="/chat" label="Ask Socrates" /></div></div> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2"><ResultList title="Current accepted truth" items={result.currentAcceptedTruth} emptyText="No accepted Product Brain truth matches this task yet." /><ResultList title="Technical constraints" items={result.technicalConstraints} emptyText="No task-specific technical constraints are recorded." /><ResultList title="Known conflicts" items={result.knownConflicts} emptyText="No unresolved conflict is linked to this task." /><ResultList title="Required tests" items={result.requiredTests} emptyText="No task-specific acceptance or test requirement is recorded." /><ResultList title="Implementation boundaries" items={result.implementationBoundaries} emptyText="No additional implementation boundary is recorded." /><ResultList title="Open questions" items={result.openQuestions} emptyText="No additional open question is recorded." /></div>
      <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-3"><p className="text-xs font-semibold text-[var(--text-default)]">Give this exact pack to {agentLabel(targetAgent)}</p><p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">Connect {agentLabel(targetAgent)} to Orchestra MCP, then call <span className="font-mono text-[10px] text-[var(--text-default)]">orchestra.get_context_pack</span> with project <span className="font-mono text-[10px]">{projectId}</span> and pack <span className="font-mono text-[10px]">{result.contextPack.id}</span>. After implementation, record the run through <span className="font-mono text-[10px] text-[var(--text-default)]">orchestra.record_agent_run</span> so Postflight can review the evidence.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onCopy} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)]"><Clipboard size={12} aria-hidden="true" />Copy for {agentLabel(targetAgent)}</button><button type="button" onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 py-2 text-xs text-[var(--text-default)]"><Download size={12} aria-hidden="true" />Download Markdown</button></div></div>
      <McpAgentSetup projectId={projectId} packId={result.contextPack.id} targetAgent={targetAgent} toast={toast} />
      <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-[var(--terracotta-text)]">Open generated context pack</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-elevated)] p-3 font-mono text-[10px] leading-5 text-[var(--text-muted)]">{result.contextPack.bodyMarkdown}</pre></details>
    </div> : null}
  </section>;
}

function AgentPostflightPanel({ overview, busy, result, onRun }: { overview: DeliveryOverview; busy: Busy; result: { runId: string; summary: string; scoreLabel: string; recommendation: string; findings: Array<{ summary: string; severity: string }> } | null; onRun: (runId: string) => void }) {
  return <section className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-4" aria-labelledby="agent-postflight-heading"><div className="flex items-start gap-2"><Workflow size={17} className="mt-0.5 text-[var(--terracotta-text)]" aria-hidden="true" /><div><h2 id="agent-postflight-heading" className="text-base font-semibold text-[var(--text-default)]">Agent Postflight</h2><p className="mt-1 text-xs text-[var(--text-muted)]">Review recorded files, requirements, tests, assumptions, documentation, risks, and product drift after an agent finishes.</p></div></div>{overview.recentAgentRuns.length ? <div className="mt-4 space-y-2">{overview.recentAgentRuns.map((run) => <article key={run.id} className="rounded-lg bg-[var(--bg-inset)] p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-[var(--text-default)]">{run.title}</p><p className="mt-1 font-mono text-[9px] uppercase text-[var(--text-muted)]">{run.status.replace(/_/g, " ")} · {run.provider ?? "agent"}{run.testStatus ? ` · tests ${run.testStatus}` : ""}</p>{run.prUrl ? <a href={run.prUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] text-[var(--terracotta-text)]">Open PR <ExternalLink size={10} aria-hidden="true" /></a> : run.commitSha ? <p className="mt-2 font-mono text-[9px] text-[var(--text-muted)]">{run.commitSha.slice(0, 12)}</p> : null}</div><div className="flex items-center gap-2">{run.review ? <StateBadge state={run.review.needsFollowUp ? "attention" : "healthy"} label={run.review.scoreLabel.replace(/_/g, " ")} /> : null}<button type="button" disabled={Boolean(busy)} onClick={() => onRun(run.id)} className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-default)] disabled:opacity-50">{busy === `postflight:${run.id}` ? "Reviewing…" : run.review ? "Refresh review" : "Run postflight"}</button></div></div>{run.review ? <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">{run.review.summary}</p> : null}{result?.runId === run.id ? <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-3"><p className="text-xs font-medium text-[var(--text-default)]">{result.scoreLabel.replace(/_/g, " ")} · {result.recommendation.replace(/_/g, " ")}</p><p className="mt-1 text-[11px] text-[var(--text-muted)]">{result.summary}</p><BulletList items={result.findings.map((finding) => `${finding.severity}: ${finding.summary}`)} /></div> : null}</article>)}</div> : <p className="mt-3 rounded-lg bg-[var(--bg-inset)] p-3 text-xs text-[var(--text-muted)]">No agent run is recorded yet. Build a Preflight context pack, record the agent run through MCP or the agent-run API, then return here for Postflight.</p>}<p className="mt-3 text-[10px] text-[var(--text-muted)]">Postflight output remains implementation evidence. It never becomes accepted truth automatically.</p></section>;
}

function ResultList({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) { return <div className="rounded-lg bg-[var(--bg-elevated)] p-3"><p className="font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{title} ({items.length})</p>{items.length ? <BulletList items={items.slice(0, 12)} /> : <p className="mt-2 text-[11px] text-[var(--text-muted)]">{emptyText}</p>}</div>; }
function BulletList({ items }: { items: string[] }) { return <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-4 text-[var(--text-muted)]">{items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>; }
function Limitations({ items }: { items: string[] }) { return <details className="mt-3"><summary className="cursor-pointer text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Safeguards and limitations ({items.length})</summary><BulletList items={items} /></details>; }
function StateBadge({ state, label }: { state: "healthy" | "attention" | "blocked" | "unknown"; label?: string }) { const classes = state === "healthy" ? "bg-[var(--tint-teal)] text-[var(--teal-text)]" : state === "attention" ? "bg-[var(--tint-amber)] text-[var(--amber-text)]" : state === "blocked" ? "bg-[rgba(200,74,74,0.08)] text-[#C84A4A]" : "bg-[var(--bg-inset)] text-[var(--text-muted)]"; return <span className={`rounded-full px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] ${classes}`}>{label ?? state}</span>; }
function StateDot({ state }: { state: "healthy" | "attention" | "blocked" | "unknown" }) { return state === "healthy" ? <CheckCircle2 size={13} className="text-[var(--teal-text)]" aria-label="Healthy" /> : state === "blocked" ? <AlertTriangle size={13} className="text-[#C84A4A]" aria-label="Blocked" /> : state === "attention" ? <AlertTriangle size={13} className="text-[var(--amber-text)]" aria-label="Needs attention" /> : <CircleDashed size={13} className="text-[var(--text-muted)]" aria-label="Unknown" />; }
function TargetLink({ href, label, compact = false }: { href: string; label: string; compact?: boolean }) { const external = /^https?:\/\//.test(href); const classes = `${compact ? "mt-0" : "mt-2"} inline-flex items-center gap-1 text-[10px] text-[var(--terracotta-text)]`; return external ? <a href={href} target="_blank" rel="noreferrer" className={classes}>{label}<ExternalLink size={10} aria-hidden="true" /></a> : <Link to={href} className={classes}>{label}{compact ? <ExternalLink size={10} aria-hidden="true" /> : null}</Link>; }
function targetHref(target: { targetType: string; targetRef: Record<string, unknown> } | null) { if (!target) return null; if (target.targetType === "external_url" && typeof target.targetRef.url === "string") return target.targetRef.url; if (target.targetType === "change_proposal" && typeof target.targetRef.proposalId === "string") return `/truth-inbox/${encodeURIComponent(`proposal:${target.targetRef.proposalId}`)}`; if (["truth_inbox", "fde_finding"].includes(target.targetType)) return "/truth-inbox"; if (["memory", "product_brain"].includes(target.targetType)) return "/memory"; if (["integrations", "settings"].includes(target.targetType)) return "/settings"; if (target.targetType === "socrates") return "/chat"; if (["agent_context", "agent_context_pack", "agent_run"].includes(target.targetType)) return "/delivery#agent-preflight"; return null; }
function agentLabel(agent: "codex" | "claude" | "cursor") { return agent === "codex" ? "Codex" : agent === "claude" ? "Claude" : "Cursor"; }
function agentHandoff(result: AgentPreflight, projectId: string, agent: "codex" | "claude" | "cursor") { return [`# Orchestra Agent Preflight for ${agentLabel(agent)}`, "", `Project ID: ${projectId}`, `Context pack ID: ${result.contextPack.id}`, `Readiness: ${result.readinessLabel}`, "", "Retrieve the authoritative pack from Orchestra MCP before implementation:", `orchestra.get_context_pack({ projectId: \"${projectId}\", packId: \"${result.contextPack.id}\" })`, "", "After implementation, record files, tests, assumptions, limitations, commit/PR evidence, and this contextPackId through orchestra.record_agent_run so Orchestra Postflight can review the run.", "", result.contextPack.bodyMarkdown].join("\n"); }
function messageOf(value: unknown, fallback: string) { return value instanceof Error && value.message ? value.message : fallback; }

export default DeliveryPage;
