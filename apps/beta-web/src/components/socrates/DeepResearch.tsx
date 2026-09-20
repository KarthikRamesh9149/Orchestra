import { AnimatePresence, motion } from "framer-motion";
import { Check, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TbBrain, TbDownload, TbLock } from "react-icons/tb";
import { Link, useNavigate } from "react-router-dom";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
import { safeMarkdownUrl } from "../../lib/socratesPresentation";
import { ApiError } from "../../lib/api/client";
import {
  addDeepResearchToMemory,
  downloadDeepResearchReport,
  getDeepResearchRun,
  getDeepResearchUsage,
  startDeepResearch,
  type DeepResearchResults as DeepResearchResultsData,
  type DeepResearchSourceKey,
  type DeepResearchUsage
} from "../../lib/api/research";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeepResearchPhase = "configure" | "running" | "results" | "error";
type DeepOutputFormat = "Executive Summary" | "Full Report" | "Action Items Only";
type ReportDownloadFormat = "pdf" | "markdown";
type PrivacyMode = "internal_only" | "internal_plus_web";
type SavedArtifact = Awaited<ReturnType<typeof addDeepResearchToMemory>>;

// ─── Constants ────────────────────────────────────────────────────────────────

const RESEARCH_SOURCES: { key: DeepResearchSourceKey; label: string; detail: string; enabled: boolean }[] = [
  { key: "github", label: "GitHub", detail: "code activity and pull requests", enabled: false },
  { key: "slack", label: "Communications", detail: "connected message evidence", enabled: false },
  { key: "calendar", label: "Google Calendar", detail: "meetings and deadlines", enabled: false },
  { key: "docs", label: "Uploaded docs", detail: "project memory documents", enabled: true }
];

const PROGRESS_LABELS: Record<string, string> = {
  queued: "Queued",
  retrieving_evidence: "Retrieving selected project evidence",
  evidence_ready: "Project evidence ready",
  searching_public_web: "Searching public web queries",
  preparing_synthesis: "Preparing the evidence pack",
  synthesizing_report: "Synthesizing the report",
  completed: "Complete",
  failed: "Failed"
};
const MAX_POLL_ATTEMPTS = 120;
const MAX_CONSECUTIVE_POLL_FAILURES = 4;

function formatElapsed(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function severityStyle(severity: "HIGH" | "MEDIUM") {
  return severity === "HIGH"
    ? { color: "var(--red)", tint: "var(--tint-red)" }
    : { color: "var(--amber)", tint: "var(--tint-amber)" };
}

// ─── Results ──────────────────────────────────────────────────────────────────

function DeepResearchResults({
  results,
  doneActions,
  setDoneActions,
  onClose,
  onAddToMemory,
  onDownload,
  downloadFormat,
  onDownloadFormatChange,
  addingToMemory,
  downloading,
  savedArtifact,
  actionError,
  onOpenSaved
}: {
  results: DeepResearchResultsData;
  doneActions: Set<number>;
  setDoneActions: React.Dispatch<React.SetStateAction<Set<number>>>;
  onClose: () => void;
  onAddToMemory: () => void;
  onDownload: () => void;
  downloadFormat: ReportDownloadFormat;
  onDownloadFormatChange: (format: ReportDownloadFormat) => void;
  addingToMemory: boolean;
  downloading: boolean;
  savedArtifact: SavedArtifact | null;
  actionError: string | null;
  onOpenSaved: () => void;
}) {
  const toggleDone = (index: number) => {
    setDoneActions((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const s = results.stats;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-shrink-0 flex-col items-start gap-4 border-b border-[var(--border-soft)] px-4 py-5 sm:px-7 lg:flex-row lg:justify-between lg:gap-5">
        <div>
          <h2 id="deep-research-dialog-title" className="font-sans text-[28px] font-medium leading-none text-[var(--text-default)]">Deep Research Complete</h2>
          <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">
            Analyzed {s.totalSources} sources · {s.slackMessages} messages · {s.commits} commits · {s.docs} docs · {s.webSources} web sources
          </p>
          <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">Completed in {s.duration}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:mr-8 lg:flex-shrink-0">
          <label className="inline-flex items-center gap-2 font-sans text-[12px] text-[var(--text-muted)]">Report format
            <select value={downloadFormat} onChange={(event) => onDownloadFormatChange(event.target.value === "markdown" ? "markdown" : "pdf")} disabled={downloading} className="rounded-full border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 font-sans text-[13px] text-[var(--text-default)] disabled:opacity-60">
              <option value="pdf">PDF (.pdf)</option>
              <option value="markdown">Markdown (.md)</option>
            </select>
          </label>
          <button type="button" onClick={onDownload} disabled={downloading} className="inline-flex items-center gap-2 rounded-full border border-[var(--teal)] px-4 py-2 font-sans text-[13px] text-[var(--teal-text)] transition-opacity hover:opacity-80 disabled:opacity-60">
            <TbDownload size={15} /> {downloading ? "Downloading…" : "Download Report"}
          </button>
          <button type="button" onClick={savedArtifact ? onOpenSaved : onAddToMemory} disabled={addingToMemory} className="inline-flex items-center gap-2 rounded-full bg-[var(--teal)] px-4 py-2 font-sans text-[13px] text-white transition-opacity hover:opacity-90 disabled:opacity-60">
            <TbBrain size={15} /> {addingToMemory ? "Adding…" : savedArtifact ? "Open saved report" : "Add to Memory"}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
        <section>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--teal-text)]">Executive Summary</p>
          <p className="mt-3 max-w-[920px] font-sans text-[14px] leading-7 text-[var(--text-default)]">{results.executiveSummary}</p>
        </section>

        {results.findings.length > 0 && (
          <section className="mt-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--teal-text)]">Critical Findings</p>
            <div className="mt-3 space-y-3">
              {results.findings.map((finding, idx) => {
                const sev = severityStyle(finding.severity);
                return (
                  <article key={`${finding.title}-${idx}`} className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-4">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{finding.category}</span>
                      <span className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ background: sev.tint, color: sev.color }}>{finding.severity}</span>
                    </div>
                    <h3 className="mt-2 font-sans text-[15px] font-medium text-[var(--text-default)]">{finding.title}</h3>
                    <p className="mt-1 font-sans text-[13px] leading-6 text-[var(--text-muted)]">{finding.description}</p>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {(results.sources ?? []).length > 0 && (
          <section className="mt-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--teal-text)]">Sources</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {results.sources.map((source, index) => {
                const className = "rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-3 transition-colors hover:border-[var(--teal)]";
                const refs = source.refs?.length ? source.refs : source.ref ? [source.ref] : [];
                const content = <><span className="block font-sans text-[13px] font-medium text-[var(--text-default)]">{source.label}</span><span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{refs.length ? `${refs.join(" · ")} — ` : ""}{source.provider}</span></>;
                const safeHref = safeMarkdownUrl(source.href);
                if (!safeHref) return <div key={`${source.label}-${index}`} className={className}>{content}</div>;
                return safeHref.startsWith("/")
                  ? <Link key={`${safeHref}-${index}`} to={safeHref} className={className}>{content}</Link>
                  : <a key={`${safeHref}-${index}`} href={safeHref} target="_blank" rel="noopener noreferrer" className={className}>{content}</a>;
              })}
            </div>
          </section>
        )}

        {results.marketContext.length > 0 && (
          <section className="mt-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--teal-text)]">Domain & Market Context</p>
            <div className="mt-3 grid gap-3">
              {results.marketContext.map((item, idx) => (
                <div key={`${item.title}-${idx}`} className="rounded-xl border border-[var(--border-soft)] bg-[var(--bg-inset)] p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-sans text-[14px] font-medium text-[var(--text-default)]">{item.title}</span>
                    <span className="rounded-full border border-[var(--border-stronger)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Web Source</span>
                  </div>
                  <p className="mt-2 font-sans text-[13px] leading-6 text-[var(--text-muted)]">{item.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {results.expansionOpportunities.length > 0 && (
          <section className="mt-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--teal-text)]">Expansion Opportunities</p>
            <div className="mt-3 space-y-2">
              {results.expansionOpportunities.map((item, idx) => (
                <div key={idx} className="flex gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] p-3">
                  <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--teal)]" />
                  <p className="font-sans text-[13px] leading-6 text-[var(--text-muted)]">{item}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {results.recommendedActions.length > 0 && (
          <section className="mt-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--teal-text)]">Recommended Actions</p>
            <div className="mt-3 space-y-2">
              {results.recommendedActions.map((item, index) => {
                const done = doneActions.has(index);
                return (
                  <button key={`${item.action}-${index}`} type="button" onClick={() => toggleDone(index)} className="flex w-full items-start gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-3 text-left">
                    <motion.span
                      animate={{ scale: done ? [1, 1.16, 1] : 1 }}
                      className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border"
                      style={{ borderColor: done ? "var(--teal)" : "var(--border-stronger)", background: done ? "var(--teal)" : "transparent", color: "white" }}
                    >
                      {done ? <Check size={12} strokeWidth={2.4} /> : null}
                    </motion.span>
                    <span className="min-w-0 flex-1">
                      <span className="mr-2 rounded-full bg-[var(--bg-inset)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--teal-text)]">{item.priority}</span>
                      <span className={["font-sans text-[13px] text-[var(--text-default)]", done ? "line-through opacity-60" : ""].join(" ")}>{item.action}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-8 flex flex-col items-start gap-4 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-inset)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-sans text-[13px] text-[var(--text-muted)]">Save this report to Memory so Socrates can reference it in future conversations.</p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={savedArtifact ? onOpenSaved : onAddToMemory} disabled={addingToMemory} className="rounded-full bg-[var(--teal)] px-5 py-2.5 font-sans text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60">{addingToMemory ? "Adding…" : savedArtifact ? "Open saved report" : "Add to Memory"}</button>
            <button type="button" onClick={onClose} className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-default)]">Close</button>
          </div>
        </div>
        {savedArtifact ? <p role="status" className="mt-3 font-sans text-[12px] text-[var(--teal-text)]">Saved to Project Memory as a generated research note. It is not accepted Product Brain truth.</p> : null}
        {actionError ? <p role="alert" className="mt-3 rounded-lg border border-[var(--red)]/20 bg-[var(--tint-red)] p-3 font-sans text-[12px] text-[var(--red)]">{actionError}</p> : null}
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function DeepResearchModal({
  projectId,
  open,
  minimized,
  onClose,
  onMinimize,
  onElapsedChange
}: {
  projectId: string;
  open: boolean;
  minimized: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onElapsedChange: (seconds: number) => void;
}) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<DeepResearchPhase>("configure");
  const [focus, setFocus] = useState("");
  const [sources, setSources] = useState(() => RESEARCH_SOURCES.map((s) => ({ ...s })));
  const [format, setFormat] = useState<DeepOutputFormat>("Full Report");
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("queued");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [doneActions, setDoneActions] = useState<Set<number>>(new Set());
  const [showWebTip, setShowWebTip] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("internal_only");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [usage, setUsage] = useState<DeepResearchUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [results, setResults] = useState<DeepResearchResultsData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addingToMemory, setAddingToMemory] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadSelection, setDownloadSelection] = useState<{projectId: string; runId: string; format: ReportDownloadFormat} | null>(null);
  const [savedArtifact, setSavedArtifact] = useState<SavedArtifact | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const startInFlightRef = useRef(false);
  const downloadInFlightRef = useRef(false);
  const downloadScopeRef = useRef(0);
  const dialogRef = useAccessibleDialog<HTMLElement>(onClose, false, open && !minimized);

  const limitReached = usage ? usage.used >= usage.limit : false;
  const downloadFormat = downloadSelection?.projectId === projectId && downloadSelection.runId === runId ? downloadSelection.format : "pdf";

  useEffect(() => {
    downloadScopeRef.current += 1;
    return () => { downloadScopeRef.current += 1; };
  }, [open, projectId, runId]);

  useEffect(() => {
    if (!open) return;
    setPhase("configure");
    setFocus("");
    setSources(RESEARCH_SOURCES.map((source) => ({ ...source })));
    setPrivacyMode("internal_only");
    setWebSearchEnabled(false);
    setProgress(0);
    setProgressStage("queued");
    setStartedAt(null);
    setRunId(null);
    setResults(null);
    setErrorMsg(null);
    setActionError(null);
    setDownloadSelection(null);
    setConfigError(null);
    setStarting(false);
    startInFlightRef.current = false;
    setSavedArtifact(null);
    setUsageError(null);
    onElapsedChange(0);
    let cancelled = false;
    getDeepResearchUsage(projectId)
      .then((u) => { if (!cancelled) setUsage(u); })
      .catch((error) => { if (!cancelled) setUsageError(error instanceof Error ? error.message : "Could not load Deep Research usage."); });
    return () => { cancelled = true; };
  }, [open]); // eslint-disable-line

  useEffect(() => {
    if (phase !== "running" || !startedAt) return;
    const interval = window.setInterval(() => {
      onElapsedChange(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [phase, startedAt, onElapsedChange]);

  // Bounded backend polling. Only persisted backend stages drive progress.
  useEffect(() => {
    if (phase !== "running" || !runId) return;
    let cancelled = false;
    let timeout: number | null = null;
    let attempts = 0;
    let consecutiveFailures = 0;
    const tick = async () => {
      attempts += 1;
      if (attempts > MAX_POLL_ATTEMPTS) {
        setErrorMsg("Deep Research is taking longer than five minutes. The run remains saved; reopen it later or try again.");
        setPhase("error");
        return;
      }
      try {
        const run = await getDeepResearchRun(projectId, runId);
        if (cancelled) return;
        consecutiveFailures = 0;
        setProgress(run.progress.percent);
        setProgressStage(run.progress.stage);
        if (run.status === "completed" && run.results) {
          setResults(run.results);
          setProgress(100);
          setProgressStage("completed");
          setPhase("results");
          return;
        } else if (run.status === "failed") {
          setErrorMsg(run.error ?? "Deep Research failed.");
          setPhase("error");
          return;
        }
      } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          setErrorMsg(error instanceof Error ? error.message : "Deep Research status could not be refreshed.");
          setPhase("error");
          return;
        }
      }
      if (!cancelled) timeout = window.setTimeout(tick, 2500);
    };
    void tick();
    return () => { cancelled = true; if (timeout !== null) window.clearTimeout(timeout); };
  }, [phase, runId, projectId]);

  const runResearch = async () => {
    if (startInFlightRef.current) return;
    setErrorMsg(null);
    setConfigError(null);
    setProgress(0);
    setProgressStage("queued");
    const normalizedFocus = focus.trim();
    const selected = sources.filter((s) => s.enabled).map((s) => s.key);
    if (normalizedFocus.length < 3) {
      setConfigError("Enter a specific research focus of at least 3 characters.");
      return;
    }
    if (selected.length === 0 && !webSearchEnabled) {
      setConfigError("Select at least one internal source or explicitly enable public web search.");
      return;
    }
    const requestedSources = webSearchEnabled ? [...selected, "web" as const] : selected;
    startInFlightRef.current = true;
    setStarting(true);
    try {
      const run = await startDeepResearch(projectId, {
        researchFocus: normalizedFocus,
        sources: requestedSources,
        outputFormat: format,
        privacyMode,
        webSearchEnabled
      });
      setRunId(run.id);
      setStartedAt(Date.now());
      setProgress(run.progress.percent);
      setProgressStage(run.progress.stage);
      onElapsedChange(0);
      setPhase("running");
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "Could not start Deep Research.");
      setPhase("error");
    } finally {
      startInFlightRef.current = false;
      setStarting(false);
    }
  };

  const handleAddToMemory = async () => {
    if (!runId) return;
    setAddingToMemory(true);
    setActionError(null);
    try {
      setSavedArtifact(await addDeepResearchToMemory(projectId, runId));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save this report to Project Memory.");
    } finally {
      setAddingToMemory(false);
    }
  };

  const handleDownload = async () => {
    if (!runId || downloadInFlightRef.current) return;
    downloadInFlightRef.current = true;
    const downloadScope = downloadScopeRef.current;
    const selectedFormat = downloadFormat;
    setDownloading(true);
    setActionError(null);
    try {
      await downloadDeepResearchReport(projectId, runId, selectedFormat);
    } catch (error) {
      if (downloadScope === downloadScopeRef.current) {
        setActionError(selectedFormat === "pdf" && error instanceof ApiError && error.status === 422 && error.code === "report_pdf_unsupported_characters"
          ? "PDF cannot represent every character in this report. Choose Markdown (.md) to download the complete report."
          : error instanceof Error ? error.message : "Could not download this report.");
      }
    } finally {
      downloadInFlightRef.current = false;
      setDownloading(false);
    }
  };

  const openSavedArtifact = () => {
    if (!savedArtifact) return;
    onClose();
    navigate(savedArtifact.destination.route);
  };

  if (!open || minimized) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[500] flex items-center justify-center bg-black/55 px-2 py-3 backdrop-blur-[2px] sm:px-6 sm:py-6"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <motion.section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="deep-research-dialog-title"
          tabIndex={-1}
          layout
          initial={{ opacity: 0, scale: 0.97, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 18 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="relative overflow-hidden rounded-2xl border bg-[var(--bg-elevated)] shadow-[var(--shadow-elevated)]"
          style={{
            borderColor: "var(--border-soft)",
            width: phase === "results" ? "min(1100px, calc(100vw - 16px))" : "min(720px, calc(100vw - 16px))",
            height: phase === "results" ? "min(92vh, 900px)" : "auto",
            maxHeight: "92vh"
          }}
        >
          <button type="button" onClick={onClose} aria-label="Close Deep Research" className="absolute right-5 top-5 z-10 text-[var(--text-muted)] hover:text-[var(--text-default)]">
            <X size={16} />
          </button>

          {/* ── Configure ── */}
          {phase === "configure" && (
            <div className="max-h-[92vh] overflow-y-auto p-4 pt-12 sm:p-7">
              <h2 id="deep-research-dialog-title" className="font-sans text-[18px] font-medium text-[var(--text-default)]">Configure your Deep Research</h2>
              <p className="mt-1 font-sans text-[13px] text-[var(--text-muted)]">Choose the exact internal sources and privacy boundary Socrates may use.</p>

              <div className="mt-6 space-y-5">
                <label className="block">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Research focus</span>
                  <input
                    data-dialog-initial-focus
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    placeholder="e.g. auth flow reliability, onboarding drop-off, API latency issues"
                    className="mt-2 w-full rounded-xl border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-3 font-sans text-[13px] text-[var(--text-default)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--teal)]"
                  />
                </label>

                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Sources to include</p>
                  <div className="mt-2 space-y-2">
                    {sources.map((source) => (
                      <button
                        type="button"
                        key={source.key}
                        aria-pressed={source.enabled}
                        onClick={() => setSources((cur) => cur.map((s) => (s.key === source.key ? { ...s, enabled: !s.enabled } : s)))}
                        className="flex w-full items-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                      >
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-full border text-[var(--teal-text)]"
                          style={{ borderColor: source.enabled ? "var(--teal)" : "var(--border-stronger)", background: source.enabled ? "var(--tint-teal)" : "transparent" }}
                        >
                          {source.enabled && <Check size={12} strokeWidth={2.4} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-sans text-[13px] font-medium text-[var(--text-default)]">
                            {source.label} <span className="font-normal text-[var(--text-muted)]">— {source.detail}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <fieldset>
                  <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Privacy boundary</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {([
                      { value: "internal_only" as const, label: "Internal only", detail: "Never call public web search" },
                      { value: "internal_plus_web" as const, label: "Internal + public web", detail: "Public queries use only your focus text" }
                    ]).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={privacyMode === option.value}
                        onClick={() => {
                          setPrivacyMode(option.value);
                          if (option.value === "internal_only") setWebSearchEnabled(false);
                        }}
                        className="rounded-xl border p-3 text-left"
                        style={{ borderColor: privacyMode === option.value ? "var(--teal)" : "var(--border-soft)", background: "var(--bg-card)" }}
                      >
                        <span className="block font-sans text-[13px] font-medium text-[var(--text-default)]">{option.label}</span>
                        <span className="mt-1 block font-sans text-[11px] text-[var(--text-muted)]">{option.detail}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <button
                    type="button"
                    aria-pressed={webSearchEnabled}
                    disabled={privacyMode !== "internal_plus_web"}
                    onClick={() => setWebSearchEnabled((value) => !value)}
                    className="flex w-full items-center gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border text-[var(--teal-text)]" style={{ borderColor: webSearchEnabled ? "var(--teal)" : "var(--border-stronger)", background: webSearchEnabled ? "var(--tint-teal)" : "transparent" }}>
                      {webSearchEnabled ? <Check size={12} strokeWidth={2.4} /> : null}
                    </span>
                    <span className="min-w-0 flex-1"><span className="block font-sans text-[13px] font-medium text-[var(--text-default)]">Use public web search</span><span className="font-sans text-[11px] text-[var(--text-muted)]">Current public context and benchmarks</span></span>
                    <span className="relative" onMouseEnter={() => setShowWebTip(true)} onMouseLeave={() => setShowWebTip(false)}>
                      <Info size={14} className="text-[var(--text-muted)]" />
                      {showWebTip ? <span className="absolute bottom-6 right-0 z-20 w-[min(300px,calc(100vw-3rem))] rounded-lg border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-3 font-sans text-[11px] leading-relaxed text-[var(--text-muted)] shadow-[var(--shadow-elevated)]">Only the research focus generates public queries. Internal evidence text is never sent to web search.</span> : null}
                    </span>
                  </button>
                </div>

                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Output format</p>
                  <div className="mt-2 grid grid-cols-1 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-inset)] p-1 sm:grid-cols-3">
                    {(["Executive Summary", "Full Report", "Action Items Only"] as DeepOutputFormat[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={format === option}
                        onClick={() => setFormat(option)}
                        className="rounded-lg px-3 py-2 font-sans text-[12px] transition-colors"
                        style={{ background: format === option ? "var(--bg-card)" : "transparent", color: format === option ? "var(--teal-text)" : "var(--text-muted)" }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {configError ? <p role="alert" className="mt-4 rounded-lg border border-[var(--red)]/20 bg-[var(--tint-red)] p-3 font-sans text-[12px] text-[var(--red)]">{configError}</p> : null}
              {usageError ? <p role="alert" className="mt-4 rounded-lg border border-[var(--amber)]/20 bg-[var(--tint-amber)] p-3 font-sans text-[12px] text-[var(--amber)]">{usageError}</p> : null}

              <div className="mt-7 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" onClick={onClose} className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-default)]">Cancel</button>
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                  {limitReached ? (
                    <span className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)]">
                      <TbLock size={13} /> Limit reached · resets {usage?.resetLabel}
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">{usage ? `${usage.used}/${usage.limit} used` : "~1-2 min"}</span>
                  )}
                  <button
                    type="button"
                    onClick={runResearch}
                    disabled={limitReached || starting}
                    className="rounded-full px-5 py-2.5 font-sans text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                    style={{ background: "var(--teal)" }}
                  >
                    {starting ? "Starting…" : "Run Research"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Running ── */}
          {phase === "running" && (
            <div className="p-7">
              <h2 id="deep-research-dialog-title" className="font-sans text-[18px] font-medium text-[var(--text-default)]">Socrates is running Deep Research</h2>
              <p className="mt-1 font-sans text-[13px] text-[var(--text-muted)]">Analyzing only the sources and privacy boundary you selected.</p>

              <div className="mt-6 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-inset)] p-4">
                <div className="flex items-center gap-3 font-mono text-[13px] text-[var(--text-default)]">
                  <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }} className="h-3.5 w-3.5 rounded-full border-2 border-[var(--teal)] border-t-transparent" />
                  <span className="min-w-0 flex-1">{PROGRESS_LABELS[progressStage] ?? "Working"}</span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">{progress}%</span>
                </div>
                <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]">
                  <div role="progressbar" aria-label="Deep Research progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-full rounded-full bg-[var(--teal)] transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between gap-4">
                <p className="font-sans text-[12px] text-[var(--text-muted)]">You can minimize this and continue using Orchestra — it keeps running.</p>
                <button type="button" onClick={onMinimize} className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-default)]">Minimize</button>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {phase === "error" && (
            <div className="p-7">
              <h2 id="deep-research-dialog-title" className="font-sans text-[18px] font-medium text-[var(--text-default)]">Deep Research could not complete</h2>
              <p className="mt-2 font-sans text-[13px] text-[var(--text-muted)]">{errorMsg ?? "Something went wrong. Please try again."}</p>
              <div className="mt-6 flex items-center gap-3">
                <button type="button" onClick={() => setPhase("configure")} className="rounded-full bg-[var(--teal)] px-5 py-2.5 font-sans text-[13px] font-medium text-white hover:opacity-90">Try again</button>
                <button type="button" onClick={onClose} className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-default)]">Close</button>
              </div>
            </div>
          )}

          {/* ── Results ── */}
          {phase === "results" && results && (
            <DeepResearchResults
              results={results}
              doneActions={doneActions}
              setDoneActions={setDoneActions}
              onClose={onClose}
              onAddToMemory={handleAddToMemory}
              onDownload={handleDownload}
              downloadFormat={downloadFormat}
              onDownloadFormatChange={(selectedFormat) => { if (runId && !downloadInFlightRef.current) setDownloadSelection({projectId,runId,format:selectedFormat}); }}
              addingToMemory={addingToMemory}
              downloading={downloading}
              savedArtifact={savedArtifact}
              actionError={actionError}
              onOpenSaved={openSavedArtifact}
            />
          )}
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Minimized pill ───────────────────────────────────────────────────────────

export function DeepResearchMinimizedPill({
  visible,
  elapsedSeconds,
  onView
}: {
  visible: boolean;
  elapsedSeconds: number;
  onView: () => void;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 18 }}
          className="fixed bottom-3 left-3 right-3 z-[520] flex items-center justify-between gap-3 rounded-full bg-[#0a0a0a] px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.35)] sm:bottom-6 sm:left-auto sm:right-6 sm:justify-start"
        >
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 0.85, ease: "linear" }}
            className="h-3.5 w-3.5 rounded-full border-2 border-[var(--teal)] border-t-transparent"
          />
          <span className="font-mono text-[12px] text-white">Deep Research running · {formatElapsed(elapsedSeconds)}</span>
          <button type="button" onClick={onView} className="font-mono text-[12px] text-[var(--teal-text)] hover:underline">View</button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Trigger button (used in ChatInput) ──────────────────────────────────────

export function DeepResearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Run Deep Research"
      className="group flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-all"
      style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--teal)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-soft)"; }}
    >
      <TbBrain size={14} style={{ color: "var(--teal)" }} />
      <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
        Deep Research
      </span>
    </button>
  );
}
