import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeftRight,
  ChevronDown,
  FileText,
  GitCommit,
  Link2,
  MessageSquare,
  Plus,
  Scale,
  SearchX,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Avatar from "../components/ui/Avatar";
import { OperationalStateNotice } from "../components/ui/OperationalStateNotice";
import { useAuth } from "../context/AuthContext";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";
import {
  acceptTimelineProposal,
  createProjectTimelineEvent,
  getProjectTimeline,
  loadOperationalState,
  rejectTimelineProposal,
  type OperationalState,
} from "../lib/api/timeline";
import type { TimelineEvent, TimelineSource } from "../lib/types/timeline";
import type { FilterAnimState, FilterChip } from "../store/timelineFilterStore";
import { useTimelineFilterStore } from "../store/timelineFilterStore";

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_META: Record<TimelineSource, { label: string; color: string; bg: string }> = {
  manual: { label: "Manual", color: "var(--text-default)", bg: "rgba(42,157,143,0.08)" },
  calendar: { label: "Calendar", color: "var(--text-default)", bg: "rgba(66,133,244,0.08)" },
  slack: { label: "Slack", color: "var(--text-default)", bg: "rgba(124,111,217,0.08)" },
  clickup: { label: "ClickUp", color: "var(--text-default)", bg: "rgba(123,104,238,0.08)" },
  granola: { label: "Granola", color: "var(--text-default)", bg: "rgba(180,122,31,0.08)" },
  fireflies_ai: { label: "Fireflies.ai", color: "var(--text-default)", bg: "rgba(119,85,204,0.08)" },
  manual_import: { label: "Imported file", color: "var(--text-default)", bg: "rgba(90,84,80,0.08)" },
  microsoft_teams: { label: "Microsoft Teams", color: "var(--text-default)", bg: "rgba(98,100,167,0.08)" },
  zoho_mail: { label: "Zoho Mail", color: "var(--text-default)", bg: "rgba(232,93,74,0.08)" },
  zoho_cliq: { label: "Zoho Cliq", color: "var(--text-default)", bg: "rgba(232,93,74,0.08)" },
  zoho_crm: { label: "Zoho CRM", color: "var(--text-default)", bg: "rgba(232,93,74,0.08)" },
  github: { label: "GitHub", color: "var(--text-default)", bg: "rgba(217,119,87,0.08)" },
  google_drive: { label: "Google Drive", color: "var(--text-default)", bg: "rgba(52,168,83,0.08)" },
  notion: { label: "Notion", color: "var(--text-default)", bg: "rgba(26,23,20,0.06)" },
  socrates: { label: "Socrates", color: "var(--text-default)", bg: "rgba(168,155,224,0.1)" },
  vscode: { label: "VS Code", color: "var(--text-default)", bg: "rgba(0,122,204,0.08)" },
  document: { label: "Document", color: "var(--text-default)", bg: "rgba(200,74,31,0.08)" },
  approval: { label: "Approval", color: "var(--text-default)", bg: "rgba(180,122,31,0.08)" },
  system: { label: "System", color: "var(--text-default)", bg: "rgba(138,131,120,0.08)" },
};

const SOURCE_COLORS = Object.fromEntries(Object.entries(SOURCE_META).map(([key, value]) => [key, value.color])) as Record<TimelineSource, string>;

const TYPE_ICONS: Partial<Record<TimelineEvent["type"], typeof FileText>> = {
  decision: Scale,
  change: ArrowLeftRight,
  commit: GitCommit,
  message: MessageSquare,
  note: FileText,
};

const SUPPORTED_TIMELINE_SOURCES = new Set(Object.keys(SOURCE_META));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEventDate(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const day = d.getDate();
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${month} ${day} · ${h % 12 || 12}:${m} ${ampm}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// ─── Source Badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: TimelineSource }) {
  return (
    <span
      className="rounded-full px-2.5 py-[3px] font-mono text-[9px] uppercase tracking-[0.14em]"
      style={{ background: SOURCE_META[source].bg, color: SOURCE_META[source].color }}
    >
      {SOURCE_META[source].label}
    </span>
  );
}

// ─── Diff Block ───────────────────────────────────────────────────────────────

function DiffBlock({ diffs }: { diffs: NonNullable<TimelineEvent["diff"]> }) {
  return (
    <div className="mt-2 rounded-md bg-[var(--bg-inset)] px-2.5 py-1.5">
      {diffs.map((d, i) => (
        <div key={i} className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-[11px]">
          {d.field && <span className="text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{d.field}:</span>}
          <span className="text-[var(--text-muted)] line-through">{d.old}</span>
          <span className="text-[var(--text-muted)]">→</span>
          <span className="font-medium text-[var(--text-default)]">{d.new}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Attribution ──────────────────────────────────────────────────────────────

function Attribution({
  event,
  approved,
}: {
  event: TimelineEvent;
  approved: boolean;
}) {
  const safeSourceRef = event.sourceRef && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(event.sourceRef)
    ? event.sourceRef
    : `${SOURCE_META[event.source].label} evidence`;
  const displayRef = approved
    ? `approved by ${event.approvedBy ?? "authorized reviewer"}`
    : event.metadataSummary ?? safeSourceRef;
  return (
    <div className="mt-2.5 border-t border-[#F2EDE6] pt-2.5">
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <Avatar seed={event.author.name} size={18} name={event.author.name} />
        <span className="flex-shrink-0 font-sans text-[11px] font-medium text-[var(--text-default)]">{event.author.name}</span>
        <span className="flex-shrink-0 text-[var(--text-faint)]">·</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-muted)]">{displayRef}</span>
        <span className="ml-1 flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)]">{timeAgo(event.timestamp)}</span>
      </div>
    </div>
  );
}

// ─── Pending Actions ──────────────────────────────────────────────────────────

function PendingActions({
  onApprove,
  onReject,
  pending,
}: {
  onApprove: () => void;
  onReject: () => void;
  pending: boolean;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        type="button"
        onClick={onApprove}
        disabled={pending}
        className="rounded-full bg-[#2A9D8F] px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white transition-opacity hover:opacity-90"
      >
        {pending ? "Saving…" : "Approve"}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={pending}
        className="rounded-full border border-[rgba(158,59,46,0.2)] px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#9E3B2E] transition-colors hover:border-[#9E3B2E]"
      >
        {pending ? "Saving…" : "Reject"}
      </button>
    </div>
  );
}

// ─── Category Metadata ───────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; bg: string; text: string }> = {
  frontend: { label: "FRONTEND", bg: "#ECE9FB", text: "#7C6FD9" },
  backend: { label: "BACKEND", bg: "#E0F2F0", text: "#2A9D8F" },
  database: { label: "DATABASE", bg: "#FAEEDB", text: "#B47A1F" },
  design: { label: "DESIGN", bg: "#FBEEE8", text: "#C84A1F" },
  product: { label: "PRODUCT", bg: "#E8F0E0", text: "#5A8A3A" },
};
const ALL_CATEGORIES = Object.keys(CATEGORY_META);

function eventMatchesChips(event: TimelineEvent, chips: FilterChip[]): boolean {
  if (chips.length === 0) return true;
  return chips.some((chip) => {
    if (chip.type === "category") {
      const cats = event.categories ?? (event.category ? [event.category] : []);
      return cats.includes(chip.value as any);
    }
    const q = chip.value.toLowerCase();
    const names = ["maya", "sarah", "devraj", "priya"];
    const matched = names.find((n) => q.includes(n));
    if (matched) return event.author.name.toLowerCase().includes(matched);
    if (q.includes("auth") || q.includes("oauth"))
      return event.title.toLowerCase().includes("auth") || event.description.toLowerCase().includes("auth");
    if (q.includes("pending")) return event.status === "pending";
    if (q.includes("socrates")) return event.source === "socrates";
    return event.title.toLowerCase().includes(q) || event.description.toLowerCase().includes(q);
  });
}

// ─── Filter Chips Bar ─────────────────────────────────────────────────────────

function FilterChipsBar({
  chips, animState, onRemove, onClearAll, onAddChip,
}: {
  chips: FilterChip[]; animState: FilterAnimState;
  onRemove: (v: string) => void; onClearAll: () => void;
  onAddChip: (chip: FilterChip) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const usedCategories = chips.filter((c) => c.type === "category").map((c) => c.value);
  const remaining = ALL_CATEGORIES.filter((c) => !usedCategories.includes(c));

  useEffect(() => {
    const h = (e: MouseEvent) => { if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="mb-6 rounded-xl bg-[#FBEEE8] px-5 py-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={12} strokeWidth={1.8} className="text-[var(--terracotta-text)]" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">
            {animState === "thinking" ? "Slicing timeline…" : "Filtered View"}
          </p>
          {animState === "thinking" && (
            <div className="flex items-center gap-1">
              {[0,1,2].map((i) => (
                <motion.span key={i} className="h-1 w-1 rounded-full bg-[#C84A1F]"
                  animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.25 }} />
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={onClearAll} className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--terracotta-text)] hover:underline">
          Clear All ✕
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {chips.map((chip) => {
          const meta = chip.type === "category" ? CATEGORY_META[chip.value] : null;
          return (
            <span key={chip.value} className="flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[9px] uppercase tracking-[0.12em]"
              style={{ background: meta?.bg ?? "#F0E9DC", color: meta?.text ?? "#5A5450" }}>
              {chip.type === "text" ? `"${chip.label}"` : chip.label}
              <button type="button" onClick={() => onRemove(chip.value)} className="hover:opacity-70">✕</button>
            </span>
          );
        })}
        {remaining.length > 0 && (
          <div ref={addRef} className="relative">
            <button type="button" onClick={() => setAddOpen((o) => !o)}
              className="flex items-center gap-1 rounded-full border border-[rgba(200,74,31,0.3)] bg-[var(--bg-card)] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--terracotta-text)] hover:bg-[#FBEEE8]">
              + Stack Another <ChevronDown size={10} strokeWidth={2} />
            </button>
            <AnimatePresence>
              {addOpen && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.1 }}
                  className="absolute left-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
                  {remaining.map((cat) => {
                    const m = CATEGORY_META[cat];
                    return (
                      <button key={cat} type="button" onClick={() => { onAddChip({ type: "category", value: cat, label: m.label }); setAddOpen(false); }}
                        className="flex w-full items-center gap-2 whitespace-nowrap px-4 py-2.5 hover:bg-[var(--bg-inset)]">
                        <span className="h-2 w-2 rounded-full" style={{ background: m.text }} />
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: m.text }}>{m.label}</span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Slice Empty State ────────────────────────────────────────────────────────

function SliceEmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-24">
      <SearchX size={32} strokeWidth={1.4} className="text-[var(--text-faint)]" />
      <p className="font-sans text-[14px] text-[var(--text-muted)]">No events match these filters</p>
      <button type="button" onClick={onClearFilters}
        className="rounded-full border border-[#C84A1F]/30 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--terracotta-text)] transition-colors hover:border-[#C84A1F]">
        Clear filters
      </button>
    </div>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({
  event,
  isRight,
  isDetailed,
  approved,
  onApprove,
  onReject,
  dimmed = false,
  pulseIndex = -1,
  selected,
  actionPending,
  onSelect,
}: {
  event: TimelineEvent;
  isRight: boolean;
  isDetailed: boolean;
  approved: boolean;
  onApprove: () => void;
  onReject: () => void;
  dimmed?: boolean;
  pulseIndex?: number;
  selected: boolean;
  actionPending: boolean;
  onSelect: () => void;
}) {
  const sourceColor = SOURCE_COLORS[event.source];
  const isPending = event.status === "pending" && !approved && Boolean(event.proposalId);
  const TypeIcon = TYPE_ICONS[event.type] ?? FileText;
  const pad = isDetailed ? "px-[14px] py-3" : "px-[18px] py-4";

  return (
    <motion.div
      layout
      animate={{ opacity: dimmed ? 0.15 : 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={[
        "relative w-full max-w-[520px] rounded-xl transition-colors duration-300",
        isRight ? "border-l-[3px]" : "border-r-[3px]",
        isPending
          ? "border border-dashed bg-[#FDF8F4]"
          : "border border-[var(--border-soft)] bg-[var(--bg-card)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)]",
        selected ? "ring-2 ring-[#C84A1F]/30" : "",
        pad,
      ].join(" ")}
      style={{ borderColor: sourceColor }}
    >
      {pulseIndex >= 0 && (
        <motion.div
          initial={{ boxShadow: "0 0 0 0 rgba(200,74,31,0.45)" }}
          animate={{ boxShadow: "0 0 0 10px rgba(200,74,31,0)" }}
          transition={{ duration: 0.55, ease: "easeOut", delay: pulseIndex * 0.08 }}
          className="pointer-events-none absolute -inset-px rounded-xl"
        />
      )}
      {/* Top row */}
      <div className="flex items-center justify-between gap-2">
        <SourceBadge source={event.source} />
        <div className="flex items-center gap-2">
          {isPending && (
            <span className="rounded-full bg-[rgba(200,74,31,0.08)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--terracotta-text)]">
              Pending approval
            </span>
          )}
          <button type="button" onClick={onSelect} aria-label={`Link to ${event.title}`} className="text-[var(--text-faint)] hover:text-[var(--terracotta-text)]">
            <Link2 size={12} strokeWidth={1.8} />
          </button>
          <TypeIcon size={13} strokeWidth={1.7} className="text-[var(--text-faint)]" />
        </div>
      </div>

      {/* Title */}
      <p className={["mt-2 font-sans font-medium text-[var(--text-default)]", isDetailed ? "text-[13px]" : "text-[14px]"].join(" ")}>
        {event.title}
      </p>

      {/* Description */}
      <p className={["mt-1 leading-relaxed text-[var(--text-muted)] line-clamp-2", isDetailed ? "text-[12px]" : "text-[13px]"].join(" ")}>
        {event.description}
      </p>

      {/* Diff */}
      {event.diff && event.diff.length > 0 && <DiffBlock diffs={event.diff} />}

      {/* Pending actions */}
      {isPending && <PendingActions onApprove={onApprove} onReject={onReject} pending={actionPending} />}

      {/* Attribution */}
      <Attribution event={event} approved={approved} />
    </motion.div>
  );
}

// ─── Add Event Modal ──────────────────────────────────────────────────────────

type NewEvent = {
  title: string;
  description: string;
  tier: "milestone" | "atomic";
  sourceRef: string;
};

function AddEventModal({
  onClose,
  onSubmit,
  initialForm,
}: {
  onClose: () => void;
  onSubmit: (e: NewEvent) => Promise<void>;
  initialForm?: Partial<NewEvent>;
}) {
  const [form, setForm] = useState<NewEvent>({
    title: initialForm?.title ?? "",
    description: initialForm?.description ?? "",
    tier: initialForm?.tier ?? "milestone",
    sourceRef: initialForm?.sourceRef ?? "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useAccessibleDialog<HTMLDivElement>(onClose, submitting);

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!form.title.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(form);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not add this timeline event.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-[#1A1714]/40" onClick={() => { if (!submitting) onClose(); }} />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-event-dialog-title"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.18 }}
        className="relative z-10 max-h-[calc(100vh-1.5rem)] w-full max-w-[520px] overflow-y-auto rounded-2xl bg-[var(--bg-card)] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.12)] sm:max-h-[calc(100vh-3rem)] sm:p-8"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id="add-event-dialog-title" className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Add Event</h2>
          <button type="button" aria-label="Close add event" disabled={submitting} onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-default)] disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            data-dialog-initial-focus
            aria-label="Event title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Event title"
            className="w-full border-0 border-b border-[var(--border-soft)] bg-transparent pb-2 font-sans text-[20px] text-[var(--text-default)] outline-none placeholder:text-[var(--text-faint)] focus:border-[#C84A1F]"
          />
          <textarea
            aria-label="Event description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="What changed? Why does it matter?"
            rows={3}
            className="w-full resize-none rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] p-3 font-sans text-[13px] text-[var(--text-default)] outline-none placeholder:text-[var(--text-faint)] focus:border-[#C84A1F]"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Source</p>
              <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2 font-mono text-[12px] text-[var(--text-default)]">Manual</div>
              <p className="mt-1 font-sans text-[10px] text-[var(--text-muted)]">Provider evidence is created only by connector sync.</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Tier</p>
              <div className="flex rounded-lg border border-[var(--border-soft)] p-0.5">
                {(["milestone", "atomic"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={form.tier === t}
                    onClick={() => setForm((f) => ({ ...f, tier: t }))}
                    className={[
                      "flex-1 rounded-md py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-all",
                      form.tier === t ? "bg-[#1A1714] text-white shadow-sm" : "text-[var(--text-muted)]",
                    ].join(" ")}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <input
            aria-label="Manual reference"
            value={form.sourceRef}
            onChange={(e) => setForm((f) => ({ ...f, sourceRef: e.target.value }))}
            placeholder="Manual reference label or URL (optional)"
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2 font-mono text-[12px] text-[var(--text-default)] outline-none placeholder:text-[var(--text-faint)] focus:border-[#C84A1F]"
          />
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-default)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!form.title.trim() || submitting}
              className="rounded-full bg-[#C84A1F] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Saving…" : "+ Add to timeline"}
            </button>
          </div>
          {submitError ? <p role="alert" className="font-sans text-[12px] text-[var(--terracotta-text)]">{submitError}</p> : null}
        </form>
      </motion.div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 py-24">
      <svg width="40" height="56" viewBox="0 0 40 56" fill="none">
        <circle cx="20" cy="8" r="5" fill="#E8E0D3" />
        <line x1="20" y1="13" x2="20" y2="23" stroke="#E8E0D3" strokeWidth="2" />
        <circle cx="20" cy="28" r="5" fill="#E8E0D3" />
        <line x1="20" y1="33" x2="20" y2="43" stroke="#E8E0D3" strokeWidth="2" />
        <circle cx="20" cy="48" r="5" fill="#E8E0D3" />
      </svg>
      <p className="font-sans text-[14px] text-[var(--text-muted)]">No events match this filter</p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full border border-[#2A9D8F]/30 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--teal-text)] transition-colors hover:border-[#2A9D8F]"
      >
        Clear filters
      </button>
    </div>
  );
}

// ─── Source Filter Dropdown ───────────────────────────────────────────────────

function SourceFilter({
  value,
  onChange,
  sources,
}: {
  value: string;
  onChange: (v: string) => void;
  sources: TimelineSource[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const optionSources = value !== "all" && SUPPORTED_TIMELINE_SOURCES.has(value) && !sources.includes(value as TimelineSource)
    ? [value as TimelineSource, ...sources]
    : sources;
  const options = [
    { value: "all", label: "All Sources" },
    ...optionSources.map((source) => ({ value: source, label: SOURCE_META[source].label })),
  ];
  const label = options.find((option) => option.value === value)?.label ?? "All Sources";

  return (
    <div ref={ref} className="relative" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="flex h-[38px] items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-default)] transition-colors hover:border-[#C84A1F]"
      >
        {label}
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Timeline source filter"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={value === opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={[
                  "flex w-full items-center px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-[var(--bg-inset)]",
                  value === opt.value ? "text-[var(--terracotta-text)]" : "text-[var(--text-default)]",
                ].join(" ")}
              >
                {opt.value !== "all" && (
                  <span className="mr-2 h-1.5 w-1.5 rounded-full" style={{ background: SOURCE_COLORS[opt.value as TimelineSource] }} />
                )}
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function TimelineList({
  events,
  isDetailed,
  isNarrow,
  onApprove,
  onReject,
  matchingIds,
  animState,
  chips,
  actionPendingIds,
  selectedEventId,
  onSelectEvent,
}: {
  events: TimelineEvent[];
  isDetailed: boolean;
  isNarrow: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  matchingIds: Set<string>;
  animState: FilterAnimState;
  chips: FilterChip[];
  actionPendingIds: Set<string>;
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
}) {
  // Title sits at: top-padding(16) + badge(~18) + margin(8) = ~42px from card top
  const NODE_OFFSET = 42;
  const gap = isDetailed ? "gap-3" : "gap-5";
  const isHighlighting = chips.length > 0 && animState === "highlighting";
  const matchingArr = Array.from(matchingIds);

  if (isNarrow) {
    return (
      <div className="relative pl-8">
        {/* Spine */}
        <div
          className="absolute left-3 top-0 w-0.5 bg-[var(--border-soft)]"
          style={{
            height: "100%",
            WebkitMaskImage: "linear-gradient(to bottom, transparent, black 32px, black calc(100% - 32px), transparent)",
            maskImage: "linear-gradient(to bottom, transparent, black 32px, black calc(100% - 32px), transparent)",
          }}
        />
        <div className={`flex flex-col ${gap}`}>
          <AnimatePresence mode="popLayout">
            {events.map((event) => {
              const sourceColor = SOURCE_COLORS[event.source];
              return (
                <motion.div
                  key={event.id}
                  id={`event-${event.id}`}
                  layout
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.18 }}
                  className="relative"
                >
                  {/* Node aligned with title row */}
                  <div
                    className="absolute -left-5 flex h-3 w-3 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-card)]"
                    style={{ border: `2px solid ${sourceColor}`, top: NODE_OFFSET + "px", transform: "translateY(-50%)" }}
                  />
                  {/* Date above card */}
                  <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    {formatEventDate(event.timestamp)}
                  </span>
                  <EventCard
                    event={event}
                    isRight={true}
                    isDetailed={isDetailed}
                    approved={event.status === "approved" && Boolean(event.approvedBy)}
                    onApprove={() => onApprove(event.id)}
                    onReject={() => onReject(event.id)}
                    dimmed={isHighlighting && !matchingIds.has(event.id)}
                    pulseIndex={isHighlighting && matchingIds.has(event.id) ? matchingArr.indexOf(event.id) : -1}
                    selected={selectedEventId === event.id}
                    actionPending={actionPendingIds.has(event.id)}
                    onSelect={() => onSelectEvent(event.id)}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Spine */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 w-0.5 -translate-x-1/2 bg-[var(--border-soft)]"
        style={{
          height: "100%",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, black 32px, black calc(100% - 32px), transparent)",
          maskImage: "linear-gradient(to bottom, transparent, black 32px, black calc(100% - 32px), transparent)",
        }}
      />

      <div className={`flex flex-col ${gap}`}>
        <AnimatePresence mode="popLayout">
          {events.map((event, index) => {
            const isRight = index % 2 === 0;
            const sourceColor = SOURCE_COLORS[event.source];

            return (
              <motion.div
                key={event.id}
                id={`event-${event.id}`}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="grid"
                style={{ gridTemplateColumns: "1fr 40px 1fr" }}
              >
                {/* Left side */}
                <div className="flex items-start justify-end">
                  {isRight ? (
                    /* Date — aligned with card's title row */
                    <span
                      className="whitespace-nowrap pr-5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]"
                      style={{ paddingTop: NODE_OFFSET + "px", transform: "translateY(-50%)" }}
                    >
                      {formatEventDate(event.timestamp)}
                    </span>
                  ) : (
                    <div className="flex items-start justify-end">
                      <EventCard
                        event={event}
                        isRight={false}
                        isDetailed={isDetailed}
                        approved={event.status === "approved" && Boolean(event.approvedBy)}
                        onApprove={() => onApprove(event.id)}
                        onReject={() => onReject(event.id)}
                        dimmed={isHighlighting && !matchingIds.has(event.id)}
                        pulseIndex={isHighlighting && matchingIds.has(event.id) ? matchingArr.indexOf(event.id) : -1}
                        selected={selectedEventId === event.id}
                        actionPending={actionPendingIds.has(event.id)}
                        onSelect={() => onSelectEvent(event.id)}
                      />
                      {/* Connector line at title height */}
                      <div
                        className="h-0.5 w-5 flex-shrink-0"
                        style={{ background: sourceColor, marginTop: NODE_OFFSET + "px", transform: "translateY(-50%)" }}
                      />
                    </div>
                  )}
                </div>

                {/* Node — aligned with title row */}
                <div className="flex justify-center">
                  <div
                    className="h-3.5 w-3.5 flex-shrink-0 rounded-full bg-[var(--bg-card)] transition-shadow hover:shadow-[0_0_0_4px_rgba(0,0,0,0.06)]"
                    style={{ border: `2px solid ${sourceColor}`, marginTop: NODE_OFFSET + "px", transform: "translateY(-50%)" }}
                  />
                </div>

                {/* Right side */}
                <div className="flex items-start">
                  {isRight ? (
                    <div className="flex items-start">
                      {/* Connector line at title height */}
                      <div
                        className="h-0.5 w-5 flex-shrink-0"
                        style={{ background: sourceColor, marginTop: NODE_OFFSET + "px", transform: "translateY(-50%)" }}
                      />
                      <EventCard
                        event={event}
                        isRight={true}
                        isDetailed={isDetailed}
                        approved={event.status === "approved" && Boolean(event.approvedBy)}
                        onApprove={() => onApprove(event.id)}
                        onReject={() => onReject(event.id)}
                        dimmed={isHighlighting && !matchingIds.has(event.id)}
                        pulseIndex={isHighlighting && matchingIds.has(event.id) ? matchingArr.indexOf(event.id) : -1}
                        selected={selectedEventId === event.id}
                        actionPending={actionPendingIds.has(event.id)}
                        onSelect={() => onSelectEvent(event.id)}
                      />
                    </div>
                  ) : (
                    /* Date — aligned with card's title row */
                    <span
                      className="whitespace-nowrap pl-5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]"
                      style={{ paddingTop: NODE_OFFSET + "px", transform: "translateY(-50%)" }}
                    >
                      {formatEventDate(event.timestamp)}
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TimelinePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const prefersReducedMotion = useReducedMotion();
  const { chips, animState, addChip, removeChip, clearAll, setAnimState } = useTimelineFilterStore();
  const { activeProject } = useAuth();
  const projectId = activeProject?.id;
  const [isNarrow, setIsNarrow] = useState(false);
  const [viewMode, setViewMode] = useState<"summary" | "detailed">("summary");
  const [sourceFilter, setSourceFilter] = useState(() => searchParams.get("source") ?? "all");
  const [showModal, setShowModal] = useState(false);
  const [modalInitialForm, setModalInitialForm] = useState<Partial<NewEvent> | undefined>();
  const [allEvents, setAllEvents] = useState<TimelineEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [timelineState, setTimelineState] = useState<OperationalState<TimelineEvent[]>>({ state: "loading" });
  const [actionPendingIds, setActionPendingIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [matchingIds, setMatchingIds] = useState<Set<string>>(new Set());
  // Proactive suggestion — pulse panel once after scrolling past 3 events
  const panelPulsedRef = useRef(false);
  const scrollCountRef = useRef(0);

  const loadTimeline = useCallback(async () => {
    if (!projectId) {
      setAllEvents([]);
      return;
    }
    setIsLoading(true);
    try {
      const state = await loadOperationalState(
        () => getProjectTimeline(projectId),
        (events) => events.length === 0
      );
      setTimelineState(state);
      if (state.state === "ready" || state.state === "empty") setAllEvents(state.data);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  useEffect(() => {
    const requestedSource = searchParams.get("source");
    if (requestedSource) {
      setSourceFilter(SUPPORTED_TIMELINE_SOURCES.has(requestedSource) ? requestedSource : "all");
      setViewMode("detailed");
    } else {
      setSourceFilter("all");
    }
  }, [searchParams]);

  useEffect(() => {
    const eventId = searchParams.get("event");
    if (!eventId || allEvents.length === 0) return;
    setTimeout(() => {
      document.getElementById(`event-${eventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }, [allEvents, searchParams]);

  useEffect(() => {
    if (searchParams.get("addEvent") !== "1") return;
    setModalInitialForm({
      title: searchParams.get("title") ?? "",
      description: searchParams.get("description") ?? "",
      tier: "milestone",
      sourceRef: searchParams.get("reference") ?? ""
    });
    setShowModal(true);
  }, [searchParams]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setIsNarrow(entry.contentRect.width < 860));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Cleanup store on unmount
  useEffect(() => () => { clearAll(); }, []); // eslint-disable-line

  // Scroll-based proactive suggestion
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = () => {
      if (panelPulsedRef.current || chips.length > 0) return;
      const items = el.querySelectorAll("[id^='event-']");
      let visible = 0;
      items.forEach((item) => {
        const rect = item.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) visible++;
      });
      if (visible >= 3 && scrollCountRef.current === 0) {
        scrollCountRef.current = 1;
        panelPulsedRef.current = true;
        window.dispatchEvent(new CustomEvent("timeline:suggest-filter"));
      }
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [chips.length]);

  const computeMatchingIds = useCallback(() => {
    return new Set(allEvents.filter((e) => eventMatchesChips(e, chips)).map((e) => e.id));
  }, [allEvents, chips]);

  // 2-stage animation pipeline
  useEffect(() => {
    if (animState === "thinking") {
      if (prefersReducedMotion) {
        setMatchingIds(computeMatchingIds());
        setAnimState("filtered");
        return;
      }
      const t = setTimeout(() => setAnimState("highlighting"), 1200);
      return () => clearTimeout(t);
    }
    if (animState === "highlighting") {
      setMatchingIds(computeMatchingIds());
      if (prefersReducedMotion) { setAnimState("filtered"); return; }
      const t = setTimeout(() => setAnimState("filtered"), 900);
      return () => clearTimeout(t);
    }
    if (animState === "idle") setMatchingIds(new Set());
  }, [animState, computeMatchingIds, prefersReducedMotion, setAnimState]);

  const preFilteredEvents = useMemo(() => {
    let events = allEvents;
    if (sourceFilter !== "all") events = events.filter((e) => e.source === sourceFilter);
    if (viewMode === "summary") events = events.filter((e) => e.tier === "milestone" || e.type === "decision");
    return events;
  }, [allEvents, sourceFilter, viewMode]);

  const availableSources = useMemo(() => Array.from(new Set(allEvents.map((event) => event.source)))
    .sort((left, right) => SOURCE_META[left].label.localeCompare(SOURCE_META[right].label)), [allEvents]);

  const selectedEventId = searchParams.get("event");
  const selectEvent = (eventId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("event", eventId);
    setSearchParams(next, { replace: true });
  };

  const clearSelectedEvent = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("event");
    setSearchParams(next, { replace: true });
  };

  const changeSourceFilter = (source: string) => {
    const next = new URLSearchParams(searchParams);
    if (source === "all") next.delete("source");
    else next.set("source", source);
    setSearchParams(next, { replace: true });
    setSourceFilter(source);
  };

  const filteredEvents = useMemo(() => {
    if (chips.length > 0 && animState === "filtered") {
      return preFilteredEvents.filter((e) => eventMatchesChips(e, chips));
    }
    return preFilteredEvents;
  }, [preFilteredEvents, chips, animState]);

  const handleApprove = async (id: string) => {
    const event = allEvents.find((e) => e.id === id);
    if (projectId && event?.proposalId) {
      setActionError(null);
      setActionPendingIds((prev) => new Set([...prev, id]));
      try {
        await acceptTimelineProposal(projectId, event.proposalId);
        await loadTimeline();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Could not approve this proposal.");
      } finally {
        setActionPendingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      }
      return;
    }
  };

  const handleReject = async (id: string) => {
    const event = allEvents.find((e) => e.id === id);
    if (projectId && event?.proposalId) {
      setActionError(null);
      setActionPendingIds((prev) => new Set([...prev, id]));
      try {
        await rejectTimelineProposal(projectId, event.proposalId);
        await loadTimeline();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Could not reject this proposal.");
      } finally {
        setActionPendingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      }
      return;
    }
  };

  const handleAddEvent = async (form: {
    title: string;
    description: string;
    tier: TimelineEvent["tier"];
    sourceRef: string;
  }) => {
    if (!projectId) return;
    await createProjectTimelineEvent(projectId, {
      title: form.title,
      description: form.description,
      source: "manual",
      tier: form.tier,
      sourceRef: form.sourceRef || undefined,
    });
    await loadTimeline();
  };

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">
      {/* Header */}
      <header className="flex flex-col items-start gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Timeline</p>
          <h1 className="mt-1.5 font-sans text-[30px] font-medium leading-none tracking-tight text-[var(--text-default)] sm:text-[36px]">
            Project memory
          </h1>
          <div className="mt-2 flex flex-col gap-1">
            <div className="h-px w-16 bg-[#C84A1F]" />
            <div className="h-px w-8 bg-[var(--border-soft)]" />
          </div>
          <p className="mt-2 font-sans text-[13px] text-[var(--text-muted)]">
            Every decision, every change, every source. One thread of truth.
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto lg:flex-shrink-0">
          {/* View mode toggle */}
          <div className="flex h-[38px] items-center rounded-full border border-[var(--border-soft)] bg-[var(--bg-inset)] px-0.5">
            {(["summary", "detailed"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={[
                  "h-[30px] rounded-full px-3 font-mono text-[10px] uppercase tracking-[0.12em] transition-all duration-150",
                  viewMode === mode
                    ? "bg-[var(--bg-card)] font-medium text-[var(--text-default)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text-default)]",
                ].join(" ")}
              >
                {mode}
              </button>
            ))}
          </div>

          <SourceFilter value={sourceFilter} onChange={changeSourceFilter} sources={availableSources} />

          <button
            type="button"
            onClick={() => {
              setModalInitialForm(undefined);
              setShowModal(true);
            }}
            className="flex h-[38px] items-center gap-1.5 rounded-full bg-[#C84A1F] px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-white transition-opacity hover:opacity-90"
          >
            <Plus size={12} strokeWidth={2.2} />
            Add Event
          </button>

        </div>
      </header>

      <div className="mt-6">
        {actionError ? <p role="alert" className="mb-4 rounded-lg border border-[#C84A1F]/20 bg-[#FBEEE8] px-4 py-3 font-sans text-[12px] text-[var(--terracotta-text)]">{actionError}</p> : null}

        {selectedEventId ? (
          <div className="mb-4 flex flex-col items-start gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-sans text-[12px] text-[var(--text-default)]">
              {allEvents.some((event) => event.id === selectedEventId) ? "Linked event highlighted." : "The linked event is unavailable in this project or filter."}
            </p>
            <button type="button" onClick={clearSelectedEvent} className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--terracotta-text)]">Clear event link</button>
          </div>
        ) : null}

        {/* Filter chips bar */}
        <AnimatePresence>
          {chips.length > 0 && (
            <FilterChipsBar
              chips={chips}
              animState={animState}
              onRemove={removeChip}
              onClearAll={clearAll}
              onAddChip={(chip) => addChip(chip, false)}
            />
          )}
        </AnimatePresence>

        {/* Timeline or empty state */}
        {!["loading", "ready", "empty"].includes(timelineState.state) ? (
          <OperationalStateNotice value={timelineState} onRetry={() => void loadTimeline()} />
        ) : isLoading && allEvents.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24">
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-[#C84A1F]"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Loading timeline…</p>
          </div>
        ) : filteredEvents.length === 0 && chips.length > 0 && animState === "filtered" ? (
          <SliceEmptyState onClearFilters={clearAll} />
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            onClear={() => {
              setSourceFilter("all");
              changeSourceFilter("all");
            }}
          />
        ) : (
          <TimelineList
            events={filteredEvents}
            isDetailed={viewMode === "detailed"}
            isNarrow={isNarrow}
            onApprove={handleApprove}
            onReject={handleReject}
            matchingIds={matchingIds}
            animState={animState}
            chips={chips}
            actionPendingIds={actionPendingIds}
            selectedEventId={selectedEventId}
            onSelectEvent={selectEvent}
          />
        )}
      </div>

      {/* Add event modal */}
      <AnimatePresence>
        {showModal && (
          <AddEventModal onClose={() => setShowModal(false)} onSubmit={handleAddEvent} initialForm={modalInitialForm} />
        )}
      </AnimatePresence>
    </div>
  );
}
