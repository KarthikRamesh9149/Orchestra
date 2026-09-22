import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUp,
  Paperclip,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SocratesLogo } from "../components/ui/SocratesLogo";
import { useToastStore } from "../components/ui/Toaster";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api/client";
import {
  cancelSocratesV1,
  getSocratesHistory,
  listSocratesSessions,
  prewarmSocratesV1,
  streamSocratesV1,
  uploadDoc,
  createDocumentUploadOperationId,
  reconcileDocumentUpload,
  type SocratesHistoryMessage,
  type SocratesScope,
  type SocratesSessionSummary,
} from "../lib/api/socrates";
import { resolveOpenTarget, targetForCitation } from "../lib/socratesPresentation";
import { saveSocratesFeedback, type SocratesFeedbackReason } from "../lib/api/feedback";
import { DeepResearchButton, DeepResearchMinimizedPill, DeepResearchModal } from "../components/socrates/DeepResearch";
import {
  chatDraftKey,
  useChatStore,
  makeMessageId,
  type Citation,
  type Conversation,
  type Message,
  type OpenTarget,
} from "../store/chatStore";

// Keeping controllers outside a route instance prevents an internal
// /chat -> /chat/:sessionId remount from orphaning the authorized request.
interface ActiveChatRequest {
  projectId: string;
  generation: number;
  baseMessages: Message[];
  controller: AbortController;
  assistantMessageId: string | null;
  partialAnswer: string;
  cancelRequested: boolean;
  cancelPromise: Promise<boolean> | null;
}

const activeChatRequests = new Map<string, ActiveChatRequest>();
const streamObservers = new Set<() => void>();
let streamPaintPending = false;
function publishStream() {
  if (streamPaintPending) return;
  streamPaintPending = true;
  requestAnimationFrame(() => {
    streamPaintPending = false;
    for (const observer of streamObservers) observer();
  });
}
// Identity resets must stop work even while no chat route is mounted.
useChatStore.subscribe((state, previous) => {
  if (state.generation === previous.generation && state.projectId === previous.projectId) return;
  for (const [id, request] of activeChatRequests) {
    if (request.generation !== state.generation || request.projectId !== state.projectId) {
      request.controller.abort();
      activeChatRequests.delete(id);
    }
  }
  publishStream();
});

const FAILED_ANSWER = "Socrates could not complete this answer. Try asking again.";
const PROVIDER_SOURCE_KEYS = new Set(["slack", "microsoft_teams", "clickup", "granola", "fireflies_ai", "zoho_mail", "zoho_cliq", "zoho_crm"]);
const SocratesMarkdown = lazy(() => import("../components/ui/SocratesMarkdown").then((module) => ({ default: module.SocratesMarkdown })));

function AnswerMarkdown({ content, streaming = false, citations, openTargets }: {
  content: string; streaming?: boolean; citations?: Citation[]; openTargets?: OpenTarget[];
}) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-[var(--text-default)]">{content}</p>}>
      <SocratesMarkdown content={content} streaming={streaming} citations={citations} openTargets={openTargets} />
    </Suspense>
  );
}

function historyMessageToUi(message: SocratesHistoryMessage): Message | null {
  if (message.role === "assistant" && message.responseStatus === "streaming" && !message.content.trim()) return null;
  const payload = message.answerPayloadJson;
  const citations = payload?.citations?.length
    ? payload.citations.map((citation) => ({
        id: citation.id,
        evidenceNumber: citation.evidenceNumber,
        label: citation.label ?? "Source",
        excerpt: citation.excerpt ?? "",
        refId: citation.refId ?? "",
        sourceType: citation.sourceType ?? "unknown",
        confidence: citation.confidence,
        openTargetId: citation.openTargetId ?? null,
      }))
    : (message.citations ?? []).map((citation) => ({
        label: citation.label,
        excerpt: citation.excerpt ?? "",
        refId: citation.refId ?? "",
        sourceType: citation.sourceType ?? "unknown",
        confidence: citation.confidence == null ? undefined : Number(citation.confidence),
      }));
  const openTargets: OpenTarget[] = payload?.open_targets?.length
    ? payload.open_targets
    : (message.openTargets ?? []).map((target) => ({
        id: target.id,
        targetType: target.targetType,
        targetRef: target.targetPayloadJson,
      }));
  return {
    id: message.id,
    role: message.role,
    content: message.content.trim() || (message.responseStatus === "failed" ? FAILED_ANSWER : ""),
    timestamp: message.createdAt,
    isError: message.responseStatus === "failed",
    citations,
    openTargets,
    suggestions: payload?.suggested_prompts ?? [],
    confidence: payload?.confidence,
    limitations: payload?.limitations ?? [],
    artifact: payload?.artifact ?? undefined,
    sourceStates: payload?.sourceStates ?? {},
    modelMetadata: payload?.modelMetadata ?? {},
    feedback: message.feedback?.[0],
  };
}

function summaryToConversation(summary: SocratesSessionSummary): Conversation {
  return {
    id: summary.id,
    title: summary.title,
    preview: summary.preview,
    timestamp: summary.updatedAt,
    messageCount: summary.messageCount,
    hasArtifacts: false,
    messages: [],
  };
}

function historyToConversation(sessionId: string, history: SocratesHistoryMessage[], summary?: SocratesSessionSummary): Conversation {
  // Treat the server response as authoritative, but normalize ordering here as
  // a final guard against cache/proxy reordering and same-timestamp rows.
  const messages = history
    .map(historyMessageToUi)
    .filter((message): message is Message => Boolean(message))
    .sort((left, right) => {
      const timestampOrder = Date.parse(left.timestamp) - Date.parse(right.timestamp);
      if (timestampOrder !== 0) return timestampOrder;
      if (left.role !== right.role) return left.role === "user" ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
  const firstUser = messages.find((message) => message.role === "user");
  const latest = messages[messages.length - 1];
  return {
    id: sessionId,
    title: summary?.title ?? firstUser?.content.slice(0, 72) ?? "Socrates chat",
    preview: summary?.preview ?? latest?.content.slice(0, 120) ?? "",
    timestamp: summary?.updatedAt ?? latest?.timestamp ?? new Date().toISOString(),
    messageCount: history.length,
    hasArtifacts: messages.some((message) => Boolean(message.artifact)),
    messages,
  };
}

function typingMessage(): Message {
  return {
    id: "typing",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    isStreaming: true,
  };
}

function streamingMessage(request: ActiveChatRequest): Message {
  return {
    id: request.assistantMessageId ?? "typing",
    role: "assistant",
    content: request.partialAnswer,
    timestamp: new Date().toISOString(),
    isStreaming: true,
  };
}

function requestServerCancellation(projectId: string, sessionId: string, request: ActiveChatRequest) {
  request.cancelRequested = true;
  if (!request.assistantMessageId || request.cancelPromise) return;
  request.cancelPromise = cancelSocratesV1(projectId, sessionId, request.assistantMessageId)
    .then((result) => result.cancelled);
  request.controller.abort(new DOMException("Cancelled", "AbortError"));
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1" role="status" aria-live="polite">
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full"
            style={{ background: "var(--teal)" }}
            animate={{ scale: [0.5, 1, 0.5], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.3, ease: "easeInOut" }}
          />
        ))}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Thinking…</span>
    </div>
  );
}

// ─── Message components ───────────────────────────────────────────────────────

function formatTime(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m} ${d.getHours() >= 12 ? "PM" : "AM"}`;
}

const UserMessage = memo(function UserMessage({ msg }: { msg: Message }) {
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
      className="flex justify-end"
    >
      <div className="max-w-[90%] sm:max-w-[65%]">
        <div className="rounded-2xl rounded-br-md px-4 py-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border-soft)" }}>
          <p className="font-sans text-[14px] leading-relaxed text-[var(--text-default)]">{msg.content}</p>
        </div>
        <p className="mt-1 text-right font-mono text-[10px] text-[var(--text-muted)]">{formatTime(msg.timestamp)}</p>
      </div>
    </motion.div>
  );
});

function OpenTargetLink({ target, label }: { target: OpenTarget; label?: string }) {
  const resolved = resolveOpenTarget(target);
  if (!resolved) return null;
  const className = "font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--teal-text)] underline decoration-1 underline-offset-2";
  const ariaLabel = `${resolved.label}${label ? `: ${label}` : ""}`;
  return resolved.external ? (
    <a
      href={resolved.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={ariaLabel}
    >
      {resolved.label}
    </a>
  ) : (
    <Link to={resolved.href} className={className} aria-label={ariaLabel}>
      {resolved.label}
    </Link>
  );
}

const AssistantMessage = memo(function AssistantMessage({
  msg,
  isTyping,
  onSuggestion,
  projectId,
  sessionId,
}: {
  msg: Message;
  isTyping?: boolean;
  onSuggestion?: (prompt: string) => void;
  projectId?: string;
  sessionId?: string;
}) {
  const prefersReducedMotion = useReducedMotion();
  const [citationOpen, setCitationOpen] = useState<number | null>(null);
  const [feedback, setFeedback] = useState(msg.feedback);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState<Exclude<SocratesFeedbackReason, "helpful">>("incorrect");
  const [correctionText, setCorrectionText] = useState(msg.feedback?.correctionText ?? "");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const openTargets = msg.openTargets ?? [];
  const citationTargetIds = new Set(
    (msg.citations ?? [])
      .map((citation) => targetForCitation(citation, openTargets)?.id)
      .filter((id): id is string => Boolean(id))
  );
  const standaloneTargets = openTargets.filter((target) => !target.id || !citationTargetIds.has(target.id));
  const unavailableSources = Object.entries(msg.sourceStates ?? {})
    .filter(([, state]) => state.state !== "ready" && state.message && state.message !== "Not searched for this question." && !/did not need|was skipped/i.test(state.message));
  const providerSpecificSources = unavailableSources.filter(([source]) => PROVIDER_SOURCE_KEYS.has(source));
  const sourceGaps = Array.from(new Set(
    (providerSpecificSources.length > 0 ? providerSpecificSources : unavailableSources).map(([, state]) => state.message!)
  )).slice(0, 3);

  const submitFeedback = async (reason: SocratesFeedbackReason, correction?: string) => {
    if (!projectId || !sessionId || feedbackBusy) return;
    setFeedbackBusy(true);
    setFeedbackError(null);
    try {
      const saved = await saveSocratesFeedback(projectId, sessionId, msg.id, {
        reason,
        correctionText: correction?.trim() || null,
      });
      setFeedback(saved);
      setFeedbackOpen(false);
    } catch (caught) {
      setFeedbackError(caught instanceof Error ? caught.message : "Feedback could not be saved.");
    } finally {
      setFeedbackBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2">
        <SocratesLogo size={9} className="text-[var(--text-default)]" />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Socrates</span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span className="font-mono text-[10px] text-[var(--text-muted)]">{formatTime(msg.timestamp)}</span>
      </div>
      <div className="max-w-[92%] sm:max-w-[75%]">
        {isTyping && !msg.content ? (
          <TypingIndicator />
        ) : (
          <>
            {msg.isError ? (
              <div
                className="flex items-start gap-2.5 rounded-xl border px-4 py-3"
                style={{ borderColor: "rgba(200,74,74,0.35)", background: "rgba(200,74,74,0.05)" }}
              >
                <TriangleAlert size={15} strokeWidth={1.8} className="mt-0.5 flex-shrink-0" style={{ color: "#C84A4A" }} />
                <p className="font-sans text-[13.5px] leading-relaxed text-[var(--text-default)]">{msg.content}</p>
              </div>
            ) : (
              <AnswerMarkdown content={msg.content} streaming={msg.isStreaming} citations={msg.citations} openTargets={openTargets} />
            )}
            {msg.isStreaming && msg.content ? (
              <span className="mt-2 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]" role="status">Writing answer…</span>
            ) : null}
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {msg.citations.map((c: Citation, i: number) => {
                  const target = targetForCitation(c, openTargets);
                  return (
                  <div
                    key={c.id ?? `${c.sourceType}:${c.refId}:${i}`}
                    className="rounded-lg border px-3 py-2 text-left transition-colors hover:border-[var(--teal)]"
                    style={{ borderColor: "var(--border-soft)", background: "var(--bg-page)" }}
                  >
                    <button
                      type="button"
                      aria-expanded={citationOpen === i}
                      onClick={() => setCitationOpen(citationOpen === i ? null : i)}
                      className="block max-w-[420px] text-left"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{c.label}</span>
                    </button>
                    {citationOpen === i && c.excerpt && (
                      <p className="mt-0.5 max-w-[420px] font-sans text-[11px] italic text-[var(--text-muted)]">"{c.excerpt}"</p>
                    )}
                    {target ? <div className="mt-1.5"><OpenTargetLink target={target} label={c.label} /></div> : null}
                  </div>
                );})}
              </div>
            )}
            {standaloneTargets.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-3" aria-label="Evidence links">
                {standaloneTargets.map((target, index) => (
                  <OpenTargetLink key={target.id ?? `${target.targetType}-${index}`} target={target} />
                ))}
              </div>
            )}
            {!msg.isStreaming && (msg.confidence || msg.modelMetadata?.degraded) && (
              <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Answer status">
                {msg.confidence ? (
                  <span className="rounded-full bg-[var(--bg-inset)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    {msg.confidence} confidence
                  </span>
                ) : null}
                {msg.modelMetadata?.degraded ? (
                  <span className="rounded-full border border-[var(--border-soft)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    Evidence-only fallback
                  </span>
                ) : null}
              </div>
            )}
            {!msg.isStreaming && sourceGaps.length > 0 && (
              <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2" aria-label="Unavailable evidence sources">
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Source coverage</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-[var(--text-muted)]">
                  {sourceGaps.map((gap) => <li key={gap}>{gap}</li>)}
                </ul>
              </div>
            )}
            {!msg.isStreaming && msg.limitations && msg.limitations.length > 0 && (
              <details className="mt-3 rounded-lg border border-[var(--border-soft)] px-3 py-2">
                <summary className="cursor-pointer font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Limitations ({msg.limitations.length})</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-[var(--text-muted)]">
                  {msg.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
                </ul>
              </details>
            )}
            {!msg.isStreaming && msg.artifact && (
              <section className="mt-3 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-4" aria-label={`Artifact: ${msg.artifact.title}`}>
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--terracotta-text)]">{msg.artifact.type.replace(/_/g, " ")} artifact</p>
                <h3 className="mt-1 font-sans text-[14px] font-semibold text-[var(--text-default)]">{msg.artifact.title}</h3>
                {msg.artifact.contentMd ? <div className="mt-2"><AnswerMarkdown content={msg.artifact.contentMd} /></div> : null}
                <p className="mt-2 font-mono text-[9px] text-[var(--text-muted)]">{msg.artifact.sourceRefs?.length ?? 0} supporting source{msg.artifact.sourceRefs?.length === 1 ? "" : "s"}</p>
              </section>
            )}
            {msg.suggestions && msg.suggestions.length > 0 && onSuggestion && (
              <div className="mt-3 flex flex-wrap gap-2">
                {msg.suggestions.slice(0, 3).map((prompt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSuggestion(prompt)}
                    className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition-all duration-150 hover:-translate-y-px hover:border-[var(--terracotta)]"
                    style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
                  >
                    <Sparkles size={11} strokeWidth={1.8} style={{ color: "var(--terracotta)" }} />
                    <span className="font-sans text-[12px] text-[var(--text-default)]">{prompt}</span>
                  </button>
                ))}
              </div>
            )}
            {!msg.isStreaming && !msg.isError && projectId && sessionId ? (
              <div className="mt-3 border-t border-[var(--border-soft)] pt-2" aria-label="Socrates answer feedback">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Was this useful?</span>
                  <button type="button" disabled={feedbackBusy} aria-pressed={feedback?.reason === "helpful"} onClick={() => void submitFeedback("helpful")} className={feedback?.reason === "helpful" ? "rounded-md bg-[var(--tint-teal)] p-1.5 text-[var(--teal-text)]" : "rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-inset)] hover:text-[var(--text-default)]"} aria-label="Mark answer helpful"><ThumbsUp size={13} aria-hidden="true" /></button>
                  <button type="button" disabled={feedbackBusy} aria-pressed={Boolean(feedback && feedback.reason !== "helpful")} onClick={() => setFeedbackOpen((open) => !open)} className={feedback && feedback.reason !== "helpful" ? "rounded-md bg-[var(--tint-amber)] p-1.5 text-[var(--amber-text)]" : "rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-inset)] hover:text-[var(--text-default)]"} aria-label="Report an answer problem"><ThumbsDown size={13} aria-hidden="true" /></button>
                  {feedback ? <span className="text-[10px] text-[var(--text-muted)]">Feedback saved{feedback.needsHumanReview ? " · queued for human review" : ""}</span> : null}
                </div>
                {feedbackOpen ? <div className="mt-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3"><label className="block font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">What went wrong?<select value={feedbackReason} onChange={(event) => setFeedbackReason(event.target.value as Exclude<SocratesFeedbackReason, "helpful">)} className="mt-1 block w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-elevated)] px-2.5 py-2 font-sans text-xs normal-case tracking-normal text-[var(--text-default)]"><option value="incorrect">Incorrect</option><option value="outdated">Outdated</option><option value="missing_evidence">Missing evidence</option><option value="wrong_source">Wrong source</option><option value="wrong_current_truth">Wrong current truth</option></select></label><label className="mt-2 block font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Correction or context (optional)<textarea value={correctionText} maxLength={2000} onChange={(event) => setCorrectionText(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg-elevated)] p-2.5 font-sans text-xs normal-case tracking-normal text-[var(--text-default)]" placeholder="What should Socrates have said or cited?" /></label><p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">This creates a review case. It never changes accepted Product Brain truth automatically.</p><div className="mt-2 flex justify-end gap-2"><button type="button" disabled={feedbackBusy} onClick={() => setFeedbackOpen(false)} className="rounded-md border border-[var(--border-soft)] px-3 py-1.5 text-xs text-[var(--text-default)]">Cancel</button><button type="button" disabled={feedbackBusy} onClick={() => void submitFeedback(feedbackReason, correctionText)} className="rounded-md bg-[var(--terracotta)] px-3 py-1.5 text-xs text-white disabled:opacity-50">{feedbackBusy ? "Saving…" : "Save feedback"}</button></div></div> : null}
                {feedbackError ? <p className="mt-2 text-[10px] text-[#C84A4A]" role="alert">{feedbackError}</p> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </motion.div>
  );
});

// ─── Chat input ───────────────────────────────────────────────────────────────

const SOURCE_SCOPES: SocratesScope[] = ["All", "Slack", "GitHub", "Docs"];

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  isGenerating: boolean;
  onDeepResearch: () => void;
  scope: SocratesScope;
  onScopeChange: (scope: SocratesScope) => void;
  onAttach: (file: File) => void;
  attachDisabled: boolean;
  isUploading: boolean;
}

function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  isGenerating,
  onDeepResearch,
  scope,
  onScopeChange,
  onAttach,
  attachDisabled,
  isUploading,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (isGenerating) onStop();
      else onSend();
    }
  };

  return (
    <div
      className="flex-shrink-0 pb-3 pt-3 sm:pb-6"
      style={{ background: "linear-gradient(to top, var(--bg-page) 60%, transparent)" }}
    >
      <div className="mx-auto max-w-[720px] px-3 sm:px-6">
        <div
          className="rounded-2xl border transition-all duration-150"
          style={{
            background: "var(--bg-card)",
            borderColor: focused ? "var(--terracotta)" : "var(--border-soft)",
            boxShadow: focused
              ? "0 2px 12px rgba(0,0,0,0.06)"
              : "0 2px 8px rgba(0,0,0,0.04)",
            padding: "12px 16px",
          }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Ask Socrates anything about your project…"
            rows={1}
            className="w-full resize-none bg-transparent font-sans text-[14px] outline-none"
            style={{
              color: "var(--text-default)",
              maxHeight: 144,
              overflowY: "auto",
            }}
          />
          <div className="mt-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            {/* Source scope toggles + Deep Research */}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {SOURCE_SCOPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => onScopeChange(s)}
                  title={s === "All" ? "Search all project memory" : `Limit answers to ${s} evidence`}
                  className="h-6 rounded px-2 font-mono text-[10px] transition-colors"
                  style={{
                    background: scope === s ? "var(--teal)" : "var(--bg-inset)",
                    color: scope === s ? "#fff" : "var(--text-muted)",
                  }}
                >
                  {s}
                </button>
              ))}
              <span className="mx-0.5 h-3 w-px" style={{ background: "var(--border-soft)" }} />
              <DeepResearchButton onClick={onDeepResearch} />
            </div>

            <div className="flex items-center gap-1.5 self-end">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onAttach(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                aria-label={attachDisabled ? "Add a document after opening a project" : "Add a PDF or DOCX to project memory"}
                title={attachDisabled ? "Open a project to add documents" : "Add a PDF or DOCX to project memory"}
                disabled={attachDisabled || isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-default)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isUploading ? (
                  <motion.span
                    className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
                  />
                ) : (
                  <Paperclip size={14} strokeWidth={1.7} />
                )}
              </button>
              <motion.button
                type="button"
                aria-label={isGenerating ? "Stop generating response" : "Send message"}
                whileHover={{ scale: value.trim() || isGenerating ? 1.06 : 1 }}
                whileTap={{ scale: 0.94 }}
                onClick={isGenerating ? onStop : onSend}
                disabled={!value.trim() && !isGenerating}
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white transition-all"
                style={{
                  background: value.trim() || isGenerating ? "var(--terracotta)" : "var(--text-default)",
                  opacity: !value.trim() && !isGenerating ? 0.25 : 1,
                  cursor: !value.trim() && !isGenerating ? "not-allowed" : "pointer",
                }}
              >
                {isGenerating ? (
                  <Square size={11} strokeWidth={0} className="fill-white" />
                ) : (
                  <ArrowUp size={16} strokeWidth={2.5} />
                )}
              </motion.button>
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
          Check sources before acting.
        </p>
      </div>
    </div>
  );
}

// ─── Hero animation ────────────────────────────────────────────────────────────

const HERO_WORD = "Socrates";

function ArtifactsHero() {
  const prefersReducedMotion = useReducedMotion();
  const [visibleCount, setVisibleCount] = useState(prefersReducedMotion ? HERO_WORD.length : 0);
  const [underlineWidth, setUnderlineWidth] = useState(prefersReducedMotion ? "200px" : "0px");
  const [eyebrowPulse, setEyebrowPulse] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (prefersReducedMotion) {
      setVisibleCount(HERO_WORD.length);
      setUnderlineWidth("200px");
      setEyebrowPulse(false);
      return;
    }
    mountedRef.current = true;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const run = async () => {
      while (mountedRef.current) {
        for (let i = 1; i <= HERO_WORD.length; i++) {
          if (!mountedRef.current) return;
          setVisibleCount(i);
          await sleep(80);
        }
        await sleep(100);
        if (!mountedRef.current) return;
        setUnderlineWidth("200px");
        await sleep(450);
        if (!mountedRef.current) return;
        setEyebrowPulse(true);
        await sleep(2000);
        setEyebrowPulse(false);
        setUnderlineWidth("0px");
        for (let i = HERO_WORD.length - 1; i >= 0; i--) {
          if (!mountedRef.current) return;
          setVisibleCount(i);
          await sleep(50);
        }
        await sleep(400);
      }
    };

    void run();
    return () => { mountedRef.current = false; };
  }, [prefersReducedMotion]);

  return (
    <div className="flex select-none flex-col items-center">
      <motion.p
        animate={eyebrowPulse ? { opacity: [0.8, 1, 0.8] } : { opacity: 1 }}
        transition={eyebrowPulse ? { duration: 1.4, repeat: Infinity } : {}}
        className="mb-5 font-mono text-[9px] uppercase tracking-[0.3em] sm:text-[11px] sm:tracking-[0.4em]"
        style={{ color: "var(--text-muted)" }}
      >
        ASK YOUR PROJECT
      </motion.p>
      <div data-testid="socrates-hero-word" className="flex max-w-full items-baseline">
        {HERO_WORD.split("").map((letter, i) => (
          <motion.span
            key={i}
            animate={{ opacity: i < visibleCount ? 1 : 0, y: i < visibleCount ? 0 : 6 }}
            transition={{ duration: 0.07, ease: "easeOut" }}
            className="font-mono text-[38px] font-medium leading-none tracking-[0.04em] sm:text-[72px] lg:text-[96px] lg:tracking-wide"
            style={{ color: "var(--text-default)" }}
          >
            {letter}
          </motion.span>
        ))}
      </div>
      <motion.div
        animate={{ width: underlineWidth }}
        transition={{ duration: underlineWidth === "0px" ? 0.22 : 0.35, ease: underlineWidth === "0px" ? "easeIn" : "easeOut" }}
        className="mt-5 h-0.5 rounded-full"
        style={{ background: "var(--terracotta)" }}
      />
    </div>
  );
}

// ─── Rotating suggestion ──────────────────────────────────────────────────────

const SUGGESTION_POOL = [
  { display: "SUMMARIZE THE PROJECT MEMORY", prompt: "Summarize the project memory." },
  { display: "WHAT DECISIONS ARE STILL OPEN?", prompt: "What decisions are still open?" },
  { display: "SUMMARIZE THIS WEEK'S CHANGES", prompt: "Summarize this week's changes." },
  { display: "WHAT'S BLOCKING THE NEXT RELEASE?", prompt: "What's blocking the next release?" },
  { display: "WHAT DO THE UPLOADED DOCS COVER?", prompt: "What do the uploaded docs cover?" },
  { display: "WHAT REQUIREMENTS ARE IN MEMORY?", prompt: "What requirements are in project memory?" },
  { display: "WHAT SHOULD A PM REVIEW NEXT?", prompt: "What should a PM review next?" },
  { display: "WHO OWNS THE AUTH MODULE?", prompt: "Who owns the auth module?" },
];

function RotatingSuggestion({ paused, onSelect }: { paused: boolean; onSelect: (p: string) => void }) {
  const [index, setIndex] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (paused || focused || prefersReducedMotion) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % SUGGESTION_POOL.length), 3500);
    return () => clearInterval(t);
  }, [paused, focused, prefersReducedMotion]);

  const current = SUGGESTION_POOL[index];

  return (
    <div className="mb-3 flex justify-center">
      <AnimatePresence mode="popLayout">
        <motion.button
          key={index}
          type="button"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.25 }}
          onClick={() => onSelect(current.prompt)}
          className="flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 transition-all duration-150 hover:-translate-y-px"
          style={{ borderColor: "var(--border-soft)", background: "var(--bg-card)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-card)"; }}
        >
          <Sparkles size={13} strokeWidth={1.8} style={{ color: "var(--terracotta)" }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--text-default)" }}>
            {current.display}
          </span>
        </motion.button>
      </AnimatePresence>
    </div>
  );
}

// ─── Chat page ────────────────────────────────────────────────────────────────

export function ChatPage() {
  const chatParams = useParams<{ "*": string }>();
  const conversationId = chatParams["*"]?.split("/")[0] || undefined;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeProject } = useAuth();
  const projectId = activeProject?.id ?? null;
  const draftConversationId = conversationId ?? null;
  const updateConversation = useChatStore((state) => state.updateConversation);
  const upsertConversation = useChatStore((state) => state.upsertConversation);
  const setConversations = useChatStore((state) => state.setConversations);
  const setProject = useChatStore((state) => state.setProject);
  const setActiveId = useChatStore((state) => state.setActiveId);
  const setDraft = useChatStore((state) => state.setDraft);
  const clearDraft = useChatStore((state) => state.clearDraft);
  const storedDraft = useChatStore((state) =>
    projectId ? state.drafts[chatDraftKey(projectId, draftConversationId)] ?? "" : ""
  );
  const routedConversation = useChatStore((state) =>
    conversationId && state.projectId === projectId
      ? state.conversations.find((conversation) => conversation.id === conversationId) ?? null
      : null
  );
  const addToast = useToastStore((s) => s.add);
  const prefersReducedMotion = useReducedMotion();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [input, setInput] = useState(storedDraft);
  const scope = useChatStore((state) => state.sourceScope);
  const setScope = useChatStore((state) => state.setSourceScope);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const uploadRef = useRef<{ projectId: string; file: File; operationId: string; controller: AbortController | null } | null>(null);
  useEffect(() => {
    setIsUploading(false);
    setUploadNotice(null);
    setUploadFailed(false);
    return () => { uploadRef.current?.controller?.abort(); uploadRef.current = null; };
  }, [projectId]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [deepResearchOpen, setDeepResearchOpen] = useState(false);
  const [deepResearchMinimized, setDeepResearchMinimized] = useState(false);
  const [deepResearchElapsed, setDeepResearchElapsed] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const requestInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  useLayoutEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const visibleRoute = useRef({ projectId, conversationId });
  visibleRoute.current = { projectId, conversationId };
  const hasMessages = messages.length > 0;

  // Each route instance observes the authorized request, rather than relying
  // on callbacks captured by the instance that initiated it. Transient tokens
  // are frame-batched and never persisted to storage.
  useEffect(() => {
    const paint = () => {
      const state = useChatStore.getState();
      if (!projectId || state.projectId !== projectId) return;
      // A first message can receive its server ID while this route is away.
      // Follow the remembered selection on remount, not a stale route callback.
      if (!conversationId && state.activeId) {
        navigate(`/chat/${state.activeId}`, { replace: true });
        return;
      }
      const pending = activeChatRequests.get(conversationId ?? `pending:${projectId}`);
      if (pending && pending.projectId === projectId && pending.generation === state.generation) {
        setMessages([...pending.baseMessages, streamingMessage(pending)]);
        setIsTyping(true);
      } else {
        setIsTyping(false);
      }
    };
    streamObservers.add(paint);
    paint();
    return () => { streamObservers.delete(paint); };
  }, [projectId, conversationId, navigate]);

  // Clear the render cache before paint when the active tenant changes.
  useLayoutEffect(() => {
    if (!projectId) return;
    if (useChatStore.getState().projectId === projectId) return;
    setProject(projectId);
    setMessages([]);
    setIsTyping(false);
    setActiveConvId(null);
    setHistoryError(null);
  }, [projectId, setProject]);

  // Warm the short-lived, project-scoped evidence snapshot while the user is
  // reading or typing. This never blocks chat rendering and performs no model
  // call; it only coalesces the reads Socrates would otherwise repeat.
  useEffect(() => {
    if (!projectId || historyLoading) return;
    const controller = new AbortController();
    const windowWithIdle = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => { void prewarmSocratesV1(projectId, controller.signal).catch(() => undefined); };
    if (windowWithIdle.requestIdleCallback) {
      const idleId = windowWithIdle.requestIdleCallback(run, { timeout: 1500 });
      return () => { controller.abort(); windowWithIdle.cancelIdleCallback?.(idleId); };
    }
    const timeoutId = window.setTimeout(run, 700);
    return () => { controller.abort(); window.clearTimeout(timeoutId); };
  }, [historyLoading, projectId]);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    const loadSessions = async () => {
      try {
        const summaries = await listSocratesSessions(projectId, controller.signal);
        if (!controller.signal.aborted) setConversations(summaries.map(summaryToConversation));
      } catch (caught) {
        if (!controller.signal.aborted && caught instanceof ApiError && [401, 403].includes(caught.status)) {
          for (const request of activeChatRequests.values()) request.controller.abort();
          activeChatRequests.clear();
          useChatStore.getState().resetContinuity();
          setMessages([]);
          setInput("");
        }
        if (!controller.signal.aborted && !conversationId) {
          setHistoryError(caught instanceof Error ? caught.message : "Conversation history could not be loaded.");
        }
      } finally {
        if (!controller.signal.aborted && !conversationId) setHistoryLoading(false);
      }
    };

    const loadHistory = async () => {
      if (!conversationId) return;
      // Capture the optimistic/remount-safe cache before a later session-list
      // response replaces summaries. History is intentionally loaded first so
      // the active conversation paints without waiting for the 30-chat rail.
      const cachedConversation = useChatStore.getState().conversations.find((item) => item.id === conversationId);
      try {
        const history = await getSocratesHistory(projectId, conversationId, controller.signal);
        if (controller.signal.aborted) return;
        const summary = useChatStore.getState().conversations.find((item) => item.id === conversationId);
        const serverConversation = historyToConversation(conversationId, history, summary ? {
          id: summary.id,
          projectId,
          pageContext: "dashboard_project",
          title: summary.title,
          preview: summary.preview,
          messageCount: summary.messageCount,
          createdAt: summary.timestamp,
          updatedAt: summary.timestamp,
        } : undefined);
        const local = cachedConversation ?? useChatStore.getState().conversations.find((item) => item.id === conversationId);
        const activeRequest = activeChatRequests.get(conversationId);
        const reconciled = (local?.messages.filter((message) => !message.isStreaming).length ?? 0) > serverConversation.messages.length
          ? local!
          : serverConversation;
        upsertConversation(reconciled);
        setMessages(activeRequest ? [...reconciled.messages, streamingMessage(activeRequest)] : reconciled.messages);
        setIsTyping(Boolean(activeRequest));
        setActiveConvId(conversationId);
        setActiveId(conversationId);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
          useChatStore.getState().removeConversation(projectId, conversationId);
          activeChatRequests.get(conversationId)?.controller.abort();
          activeChatRequests.delete(conversationId);
          setMessages([]);
        } else if (!cachedConversation?.messages.length) setMessages([]);
        setIsTyping(false);
        setHistoryError(caught instanceof Error ? caught.message : "This conversation could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    };

    if (conversationId) {
      void loadHistory().finally(() => {
        if (!controller.signal.aborted) void loadSessions();
      });
    } else {
      void loadSessions();
    }

    return () => controller.abort();
  }, [conversationId, projectId, setActiveId, setConversations, setProject, upsertConversation]);

  // Render cached state immediately while the authoritative history loads.
  useEffect(() => {
    if (conversationId) {
      const conv = routedConversation;
      if (conv) {
        const pending = activeChatRequests.get(conv.id);
        setMessages(pending ? [...conv.messages, streamingMessage(pending)] : conv.messages);
        setIsTyping(Boolean(pending));
        setActiveConvId(conv.id);
        setActiveId(conv.id);
      } else {
        setMessages([]);
        setIsTyping(false);
        setActiveConvId(conversationId);
      }
    } else {
      setMessages([]);
      setIsTyping(false);
      setActiveConvId(null);
    }
  }, [conversationId, routedConversation, setActiveId]);

  // Keep drafts scoped to both workspace and conversation. The persisted
  // store survives route unmounts and reloads within the signed-in tab.
  useEffect(() => {
    setInput(storedDraft);
  }, [draftConversationId, projectId, storedDraft]);

  // Handle prefill from dashboard links
  useEffect(() => {
    const prefill = searchParams.get("prefill");
    if (prefill) {
      const value = prefill;
      setInput(value);
      if (projectId) setDraft(projectId, draftConversationId, value);
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    if (pinnedToBottom.current) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, isTyping]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    const currentConvId = activeConvId ?? conversationId ?? null;
    const submittedDraftId = draftConversationId;
    if (!trimmed || requestInFlightRef.current || activeChatRequests.has(currentConvId ?? `pending:${projectId}`)) return;

    if (!projectId) {
      addToast("Open or create a project before asking Socrates.", "info");
      return;
    }

    requestInFlightRef.current = true;
    const generation = useChatStore.getState().generation;
    const selectionAtSubmit = useChatStore.getState().lastActiveByProject;
    const isCurrentIdentity = () => generation === useChatStore.getState().generation && useChatStore.getState().projectId === projectId;
    const isVisible = () => mountedRef.current && isCurrentIdentity() && visibleRoute.current.projectId === projectId &&
      (visibleRoute.current.conversationId ?? null) === (convId ?? null);
    let convId = currentConvId;
    const userMsg: Message = {
      id: makeMessageId(),
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    const baseMessages = [...messages.filter((message) => message.id !== "typing"), userMsg];

    setInput("");
    clearDraft(projectId, submittedDraftId);

    const controller = new AbortController();
    const activeRequest: ActiveChatRequest = {
      projectId,
      generation,
      baseMessages,
      controller,
      assistantMessageId: null,
      partialAnswer: "",
      cancelRequested: false,
      cancelPromise: null,
    };
    const pendingRequestId = convId ?? `pending:${projectId}`;
    activeChatRequests.set(pendingRequestId, activeRequest);
    publishStream();
    const typingPlaceholder = typingMessage();
    setMessages([...baseMessages, typingPlaceholder]);
    setIsTyping(true);

    let assistantMsg: Message;
    try {
      const answer = await streamSocratesV1(projectId, trimmed, convId, {
        scope,
        signal: controller.signal,
        handlers: {
          onMessageCreated: (message) => {
            if (!isCurrentIdentity()) { controller.abort(); return; }
            activeRequest.assistantMessageId = message.assistantMessageId;
            const acceptedSessionId = message.sessionId ?? convId;
            if (!acceptedSessionId) return;
            if (!convId) {
              const stillOnNewChat = isVisible();
              convId = acceptedSessionId;
              activeChatRequests.delete(pendingRequestId);
              activeChatRequests.set(convId, activeRequest);
              upsertConversation({
                id: convId,
                title: trimmed.slice(0, 40),
                preview: trimmed.slice(0, 80),
                timestamp: message.createdAt,
                messageCount: baseMessages.length,
                hasArtifacts: false,
                messages: baseMessages,
              });
              // Preserve the accepted chat across navigation, but never steal
              // selection after the user explicitly chose another/new chat.
              const selectionUnchanged = useChatStore.getState().lastActiveByProject === selectionAtSubmit;
              if (selectionUnchanged) setActiveId(convId);
              if (stillOnNewChat && selectionUnchanged) {
                setActiveConvId(convId);
                setActiveId(convId);
                navigate(`/chat/${convId}`, { replace: true });
              }
            } else {
              updateConversation(convId, (conversation: Conversation) => ({
                ...conversation,
                title: conversation.messageCount === 0 ? trimmed.slice(0, 40) : conversation.title,
                messages: baseMessages,
                messageCount: baseMessages.length,
                preview: trimmed.slice(0, 80),
              }));
            }
            if (activeRequest.cancelRequested) requestServerCancellation(projectId, acceptedSessionId, activeRequest);
            publishStream();
          },
          onDelta: (_delta, accumulated) => {
            if (!isCurrentIdentity()) { controller.abort(); return; }
            activeRequest.partialAnswer = accumulated;
            publishStream();
          },
          onReconnect: (attempt, maxAttempts) => {
            addToast(`Reconnecting to Socrates (${attempt}/${maxAttempts})…`, "info");
          }
        }
      });
      if (controller.signal.aborted || !convId) return;
      assistantMsg = {
        id: answer.message.assistantMessageId,
        role: "assistant",
        content: answer.answer_md?.trim() || "I couldn't find anything in project memory to answer that.",
        timestamp: new Date().toISOString(),
        citations: answer.citations ?? [],
        openTargets: answer.open_targets ?? [],
        confidence: answer.confidence ?? "medium",
        limitations: answer.limitations ?? [],
        artifact: answer.artifact ?? undefined,
        sourceStates: answer.sourceStates ?? {},
        modelMetadata: answer.modelMetadata ?? {},
        suggestions: answer.suggested_prompts,
      };
    } catch (error) {
      if (!isCurrentIdentity()) return;
      if (!activeRequest.assistantMessageId) {
        if (isVisible()) {
          setMessages(messages.filter((message) => message.id !== "typing"));
          setInput(text);
        }
        setDraft(projectId, submittedDraftId, text);
        addToast(error instanceof Error ? error.message : "Socrates could not accept that message.", "error");
        return;
      }
      if (controller.signal.aborted || (error as Error)?.name === "AbortError") {
        let cancellationConfirmed = false;
        try {
          cancellationConfirmed = Boolean(await activeRequest.cancelPromise);
        } catch {
          addToast("Cancellation wasn’t confirmed. Reload to check the response.", "error");
        }
        assistantMsg = {
          id: activeRequest.assistantMessageId ?? makeMessageId(),
          role: "assistant",
          content: cancellationConfirmed
            ? "Response stopped."
            : "Cancellation wasn’t confirmed. Reload to check the response.",
          timestamp: new Date().toISOString(),
          isError: true,
        };
      } else {
      assistantMsg = {
        id: makeMessageId(),
        role: "assistant",
        content:
          "I couldn't reach project memory just now. Check that documents are uploaded and try again in a moment.",
        timestamp: new Date().toISOString(),
        isError: true,
      };
      }
    } finally {
      requestInFlightRef.current = false;
      if (activeChatRequests.get(pendingRequestId) === activeRequest) activeChatRequests.delete(pendingRequestId);
      if (convId && activeChatRequests.get(convId) === activeRequest) activeChatRequests.delete(convId);
      publishStream();
      if (isVisible()) setIsTyping(false);
    }

    if (!convId || !isCurrentIdentity()) return;
    const settledConvId = convId;
    const finalMessages = [...baseMessages, assistantMsg];
    const storeFinalMessages = (nextMessages: Message[]) => {
      if (!isCurrentIdentity()) return;
      updateConversation(settledConvId, (c: Conversation) => ({
        ...c,
        title: c.messageCount === 0 ? trimmed.slice(0, 40) : c.title,
        messages: nextMessages,
        messageCount: nextMessages.length,
        hasArtifacts: Boolean(assistantMsg.artifact) || c.hasArtifacts,
        preview: assistantMsg.content.slice(0, 80),
      }));
    };

    // The completed stream response is authoritative and already persisted by
    // the API. Paint it immediately; a cross-region history read must never
    // hold the visible final answer or its metadata behind another round trip.
    if (isVisible()) setMessages(finalMessages);
    storeFinalMessages(finalMessages);

    void getSocratesHistory(projectId, settledConvId).then((authoritative) => {
      const persistedMessages = historyToConversation(settledConvId, authoritative).messages;
      const hasUnfinishedAssistant = authoritative.some(
        (message) => message.role === "assistant" && message.responseStatus === "streaming"
      );
      if (hasUnfinishedAssistant || persistedMessages.length < finalMessages.length) return;
      storeFinalMessages(persistedMessages);
      if (isVisible()) setMessages(persistedMessages);
    }).catch(() => {
      // The completed mutation response remains authoritative; route hydration retries this read.
    });
  };

  // Settled rows keep a stable callback while its implementation sees current
  // state. Streaming a new answer need not rerender old Markdown/citations.
  const sendRef = useRef(sendMessage);
  useLayoutEffect(() => { sendRef.current = sendMessage; });
  const onSuggestion = useCallback((prompt: string) => { void sendRef.current(prompt); }, []);

  const stopGeneration = () => {
    const convId = activeConvId ?? conversationId;
    if (convId && projectId) {
      const request = activeChatRequests.get(convId);
      if (request) {
        requestServerCancellation(projectId, convId, request);
        addToast(request.assistantMessageId ? "Stopping Socrates…" : "Waiting for Socrates to accept the response, then stopping it…", "info");
      }
    }
  };

  const handleAttach = async (file: File, retry = false) => {
    const projectId = activeProject?.id;
    if (uploadRef.current?.controller) return;
    if (!projectId) {
      addToast("Open or create a project first.", "info");
      return;
    }
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      addToast("Only PDF or DOCX files can be added to memory.", "error");
      return;
    }
    if (file.size > 25 * 1024 * 1024) { addToast("File must be under 25 MB.", "error"); return; }
    const prior = uploadRef.current;
    const attempt = retry && prior?.projectId === projectId ? prior : { projectId, file, operationId: createDocumentUploadOperationId(), controller: null as AbortController | null };
    const controller = new AbortController();
    attempt.controller = controller;
    uploadRef.current = attempt;
    const current = () => mountedRef.current && uploadRef.current === attempt && visibleRoute.current.projectId === projectId;
    setIsUploading(true);
    setUploadFailed(false);
    setUploadNotice(retry ? "Checking previous upload…" : "0% uploaded");
    try {
      let received = false;
      if (retry) {
        try {
          const result = await reconcileDocumentUpload(projectId, attempt.operationId, controller.signal);
          if (result.status === "failed") throw new Error("The file was received but processing failed. Open Memory to review it; it has not been uploaded again.");
          received = true;
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        }
      }
      if (!received) await uploadDoc(projectId, file, {
        signal: controller.signal, operationId: attempt.operationId,
        onProgress: ({ percent, phase }) => { if (current()) setUploadNotice(phase === "processing" ? "File sent — waiting for server confirmation…" : `${percent ?? 0}% uploaded`); },
      });
      if (current()) { setUploadNotice("File received. Open Memory for processing status."); addToast(`Received "${file.name}" in project memory.`, "success"); uploadRef.current = null; }
    } catch (error) {
      if (current()) {
        const code = error && typeof error === "object" && "code" in error ? error.code : null;
        setUploadNotice(code === "cancelled" ? "Upload stopped. The server may already have received the file; check before retrying." : error instanceof Error ? error.message : "Upload failed.");
        setUploadFailed(true);
      }
    } finally {
      attempt.controller = null;
      if (mountedRef.current && visibleRoute.current.projectId === projectId) setIsUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--bg-page)" }}>
      {/* Scrollable chat area */}
      <div className="flex-1 overflow-y-auto" onScroll={(event) => {
        const node = event.currentTarget;
        pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        setShowJumpToLatest(!pinnedToBottom.current);
      }}>
        <AnimatePresence mode="wait">
          {historyLoading && conversationId && !hasMessages ? (
            <div className="flex h-full items-center justify-center" role="status">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Loading conversation…</p>
            </div>
          ) : historyError && !hasMessages ? (
            <div className="flex h-full items-center justify-center px-6" role="alert">
              <div className="max-w-md rounded-xl border border-[rgba(200,74,74,0.35)] bg-[rgba(200,74,74,0.05)] px-5 py-4 text-center">
                <TriangleAlert className="mx-auto mb-2" size={18} style={{ color: "#C84A4A" }} />
                <p className="font-sans text-[14px] text-[var(--text-default)]">{historyError}</p>
              </div>
            </div>
          ) : !hasMessages ? (
            <motion.div
              key="hero"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -12 }}
              transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.2 }}
              className="flex h-full min-h-[300px] items-center justify-center"
            >
              <ArtifactsHero />
            </motion.div>
          ) : (
            <motion.div
              key="messages"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.15 }}
              className="mx-auto max-w-[760px] px-4 py-6 sm:px-6 sm:py-8"
            >
              <div className="flex flex-col gap-6">
                <AnimatePresence mode="sync">
                  {messages.map((msg) =>
                    msg.isStreaming ? (
                      <AssistantMessage key={msg.id} msg={msg} isTyping={isTyping} />
                    ) : msg.role === "user" ? (
                      <UserMessage key={msg.id} msg={msg} />
                    ) : (
                      <AssistantMessage key={msg.id} msg={msg} projectId={projectId ?? undefined} sessionId={conversationId ?? undefined} onSuggestion={onSuggestion} />
                    )
                  )}
                </AnimatePresence>
                <div ref={bottomRef} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {hasMessages && showJumpToLatest ? <button type="button" className="mx-auto rounded-full border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-default)]" onClick={() => {
        pinnedToBottom.current = true;
        setShowJumpToLatest(false);
        bottomRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
      }}>Jump to latest</button> : null}

      {/* Rotating suggestion — shown when no messages yet */}
      {!hasMessages && !historyLoading && !historyError && (
        <RotatingSuggestion
          paused={input.length > 0}
          onSelect={(prompt) => setInput(prompt)}
        />
      )}

      {/* Input bar */}
      {uploadNotice && <div className="mx-auto flex w-full max-w-[820px] items-center gap-3 px-6 font-sans text-[12px] text-[var(--text-muted)]">
        <p role={uploadFailed ? "alert" : "status"}>{uploadNotice}</p>
        {isUploading && <button type="button" onClick={() => uploadRef.current?.controller?.abort()} className="text-[var(--terracotta-text)]">Cancel upload</button>}
        {uploadFailed && !isUploading && <button type="button" onClick={() => { const attempt = uploadRef.current; if (attempt) void handleAttach(attempt.file, true); }} className="text-[var(--terracotta-text)]">Check upload and retry</button>}
      </div>}
      <ChatInput
        value={input}
        onChange={(value) => {
          setInput(value);
          if (projectId) setDraft(projectId, draftConversationId, value);
        }}
        onSend={() => void sendMessage(input)}
        onStop={stopGeneration}
        isGenerating={isTyping}
        onDeepResearch={() => { setDeepResearchOpen(true); setDeepResearchMinimized(false); }}
        scope={scope}
        onScopeChange={setScope}
        onAttach={(file) => void handleAttach(file)}
        attachDisabled={!activeProject?.id}
        isUploading={isUploading}
      />

      <DeepResearchModal
        projectId={activeProject?.id ?? ""}
        open={deepResearchOpen}
        minimized={deepResearchMinimized}
        onClose={() => { setDeepResearchOpen(false); setDeepResearchMinimized(false); }}
        onMinimize={() => setDeepResearchMinimized(true)}
        onElapsedChange={setDeepResearchElapsed}
      />
      <DeepResearchMinimizedPill
        visible={deepResearchOpen && deepResearchMinimized}
        elapsedSeconds={deepResearchElapsed}
        onView={() => setDeepResearchMinimized(false)}
      />
    </div>
  );
}
