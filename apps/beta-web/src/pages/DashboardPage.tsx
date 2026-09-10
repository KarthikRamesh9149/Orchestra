import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Hash,
  MessageSquare,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SiGithub, SiGooglecalendar, SiSlack } from "react-icons/si";
import { useNavigate } from "react-router-dom";
import Avatar from "../components/ui/Avatar";
import { OperationalStateNotice } from "../components/ui/OperationalStateNotice";
import { useAuth } from "../context/AuthContext";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";
import {
  createSubscription,
  deleteSubscription,
  getDashboard,
  listSubscriptions,
  loadOperationalState,
  refreshDashboard,
  updateSubscription,
  type DashboardData,
  type OperationalState,
} from "../lib/api/dashboard";
import { ApiError } from "../lib/api/client";
import type {
  ActivityItem,
  CalendarEvent,
  DashboardStat,
  GitCommit as GitCommitType,
  RecentChange,
  SlackMessage,
  SocratesQuery,
  Subscription,
  SubscriptionInput,
  TeamMember,
} from "../lib/types/dashboard";

const CARD = "card-hover rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] p-6";
const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]";
const EYEBROW_MUTED = "font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]";
const TEAL_LINK = "font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--teal-text)] hover:underline cursor-pointer";

const MONTH_NAMES = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const offset = (firstDay + 6) % 7; // Monday-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid: number[] = [];
  for (let i = 0; i < offset; i++) grid.push(0);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);
  while (grid.length % 7 !== 0) grid.push(0);
  return grid;
}

function currentDateParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

export function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function monthlyEquivalent(subscription: Subscription) {
  if (subscription.status !== "active") return 0;
  if (subscription.billingType === "monthly") return subscription.cost;
  if (subscription.billingType === "annual") return subscription.cost / 12;
  return 0;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function errorLabel(error: unknown) {
  if (error instanceof ApiError) return `[${error.code}] ${error.message}`;
  return error instanceof Error ? error.message : "The operation failed.";
}

function useCountUp(target: string, duration = 700) {
  const match = target.match(/\d+/);
  const endNum = match ? parseInt(match[0], 10) : null;
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (endNum === null) return;
    setCurrent(0);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setCurrent(Math.round(eased * endNum));
      if (t < 1) frame = requestAnimationFrame(tick);
      else setCurrent(endNum);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, endNum]);
  if (endNum === null) return target;
  return target.replace(match![0], String(current));
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 200;
  const H = 32;
  const series = Array.isArray(data) ? data.filter((v) => Number.isFinite(v)) : [];

  // Not enough points to draw a trend — show a flat baseline instead of crashing.
  if (series.length < 2) {
    return (
      <div className="mt-3">
        <p className="mb-1 text-right font-mono text-[9px] text-[var(--text-muted)]">— no trend yet</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" height={H}>
          <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke={color} strokeWidth={1.5} strokeOpacity={0.35} strokeDasharray="3 3" />
        </svg>
      </div>
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const pts = series.map((v, i) => ({
    x: (i / (series.length - 1)) * W,
    y: H - 4 - ((v - min) / range) * (H - 8),
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");
  const fillD = `${pathD} L ${W},${H} L 0,${H} Z`;
  const last = pts[pts.length - 1];
  const first = series[0];
  const pct = first !== 0 ? Math.round(((series[series.length - 1] - first) / first) * 100) : 0;
  const isUp = pct >= 0;
  const gradId = `spark-${color.replace("#", "")}`;

  return (
    <div className="mt-3">
      <p className="mb-1 text-right font-mono text-[9px]" style={{ color: isUp ? "var(--teal-text)" : "var(--terracotta-text)" }}>
        {isUp ? "↑" : "↓"} {Math.abs(pct)}% vs last week
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" height={H}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.1} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={fillD} fill={`url(#${gradId})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r={3} fill={color} />
      </svg>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

const STAT_ICONS = [GitPullRequest, MessageSquare, GitCommit, Users];

function StatCard({ stat, index }: { stat: DashboardStat; index: number }) {
  const navigate = useNavigate();
  const Icon = STAT_ICONS[index] ?? GitPullRequest;
  const displayed = useCountUp(stat.value);

  return (
    <button
      type="button"
      className={`${CARD} group flex w-full cursor-pointer flex-col text-left transition-all duration-150 hover:-translate-y-px hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]`}
      onClick={() => navigate(stat.route)}
    >
      <div className="flex items-start justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: stat.iconBg }}>
          <Icon size={18} strokeWidth={1.7} style={{ color: stat.iconColor }} />
        </div>
        <ExternalLink size={12} strokeWidth={1.7} className="mt-1 opacity-0 transition-opacity duration-150 group-hover:opacity-40" style={{ color: stat.iconColor }} />
      </div>
      <p className="mt-3 font-sans text-[28px] font-medium leading-none text-[var(--text-default)]">{displayed}</p>
      <p className={`mt-1 ${EYEBROW_MUTED}`}>{stat.label}</p>
      <Sparkline data={stat.trend} color={stat.iconColor} />
    </button>
  );
}

// ─── Mini Calendar ────────────────────────────────────────────────────────────

const CAL_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

function MiniCalendar({
  year, month, selectedDay, today, eventCounts, onSelect, onPrev, onNext,
}: {
  year: number; month: number; selectedDay: number;
  today: { year: number; month: number; day: number };
  eventCounts: Record<number, number>;
  onSelect: (d: number) => void; onPrev: () => void; onNext: () => void;
}) {
  const grid = getMonthGrid(year, month);
  const isCurrentMonth = year === today.year && month === today.month;

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={onPrev} aria-label="Previous month" className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-default)]">
          <ChevronLeft size={12} strokeWidth={2} />
        </button>
        <p className={`text-center text-[10px] ${EYEBROW_MUTED}`}>{MONTH_NAMES[month]} {year}</p>
        <button type="button" onClick={onNext} aria-label="Next month" className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-default)]">
          <ChevronRight size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {CAL_HEADERS.map((h, i) => (
          <div key={i} className="flex h-6 items-center justify-center font-mono text-[10px] text-[var(--text-muted)]">{h}</div>
        ))}
        {grid.map((day, i) => {
          if (day === 0) return <div key={i} />;
          const isToday = isCurrentMonth && day === today.day;
          const isSelected = day === selectedDay;
          const eventCount = eventCounts[day] ?? 0;

          let circleClass = "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] text-[var(--text-default)] transition-colors hover:bg-[var(--bg-hover)]";
          if (isSelected) {
            circleClass = "flex h-6 w-6 items-center justify-center rounded-full bg-[var(--teal)] font-mono text-[11px] font-medium text-white";
          } else if (isToday) {
            circleClass = "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] text-[var(--teal-text)] ring-1 ring-[var(--teal)] transition-colors hover:bg-[var(--tint-teal)]";
          }

          return (
            <div key={i} className="relative flex h-6 items-center justify-center">
              <button type="button" className={circleClass} onClick={() => onSelect(day)} aria-label={`Select ${MONTH_NAMES[month]} ${day}, ${year}`}>{day}</button>
              {eventCount === 1 && (
                <span className="pointer-events-none absolute bottom-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--terracotta)]" />
              )}
              {eventCount >= 2 && (
                <div className="pointer-events-none absolute bottom-0 left-1/2 flex -translate-x-1/2 gap-[2px]">
                  <span className="h-1 w-1 rounded-full bg-[var(--terracotta)]" />
                  <span className="h-1 w-1 rounded-full bg-[var(--terracotta)]" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Team Card ────────────────────────────────────────────────────────────────

function TeamCard({ members, events }: { members: TeamMember[]; events: CalendarEvent[] }) {
  const navigate = useNavigate();
  const managers = members.filter((m) => m.role === "manager").length;
  const devs = members.filter((m) => m.role === "dev").length;
  const clients = members.filter((m) => m.role === "client").length;
  const total = members.length || 1;

  const today = useMemo(currentDateParts, []);
  const [calYear, setCalYear] = useState(today.year);
  const [calMonth, setCalMonth] = useState(today.month);
  const [selectedDay, setSelectedDay] = useState(today.day);
  const monthEvents = useMemo(() => events.filter((event) => {
    const date = new Date(event.startsAt);
    return !Number.isNaN(date.getTime()) && date.getFullYear() === calYear && date.getMonth() === calMonth;
  }), [calMonth, calYear, events]);
  const selectedEvents = monthEvents.filter((event) => new Date(event.startsAt).getDate() === selectedDay);
  const eventCounts = monthEvents.reduce<Record<number, number>>((counts, event) => {
    const day = new Date(event.startsAt).getDate();
    counts[day] = (counts[day] ?? 0) + 1;
    return counts;
  }, {});
  const isSelectedToday = calYear === today.year && calMonth === today.month && selectedDay === today.day;
  const dayLabel = isSelectedToday
    ? "TODAY"
    : new Date(calYear, calMonth, selectedDay).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); } else setCalMonth(m => m - 1);
    setSelectedDay(1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); } else setCalMonth(m => m + 1);
    setSelectedDay(1);
  };

  return (
    <div className={`${CARD} col-span-12 flex flex-col gap-5 xl:col-span-8`}>
      <div className="flex items-center justify-between">
        <p className={EYEBROW}>Team</p>
        <button type="button" onClick={() => navigate("/settings#workspace")} className={TEAL_LINK}>MANAGE →</button>
      </div>

      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex items-center">
          {members.map((m, i) => (
            <div key={m.id} aria-label={m.name} className="rounded-full ring-2 ring-[var(--bg-card)]" style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 20 - i }}>
              <Avatar seed={m.name} size={36} name={m.name} />
            </div>
          ))}
        </div>
        <div>
          <p className="font-sans text-2xl font-medium text-[var(--text-default)]">{members.length}</p>
          <p className={EYEBROW_MUTED}>CURRENT TEAM SIZE</p>
        </div>
        <div className="flex-1">
          <div className="flex h-2 w-full overflow-hidden rounded-full">
            <div className="bg-[#7C6FD9]" style={{ width: `${(managers / total) * 100}%` }} />
            <div className="bg-[#2A9D8F]" style={{ width: `${(devs / total) * 100}%` }} />
            <div className="bg-[#E5A663]" style={{ width: `${(clients / total) * 100}%` }} />
          </div>
          <div className="mt-2 flex gap-4">
            {[{ color: "#7C6FD9", label: "MANAGERS" }, { color: "#2A9D8F", label: "DEVS" }, { color: "#E5A663", label: "CLIENTS" }].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                <span className={EYEBROW_MUTED}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="h-px bg-[#F2EDE6]" />

      <div className="flex flex-col gap-5 lg:flex-row lg:gap-6">
        <MiniCalendar year={calYear} month={calMonth} selectedDay={selectedDay} today={today} eventCounts={eventCounts} onSelect={setSelectedDay} onPrev={prevMonth} onNext={nextMonth} />
        <div className="h-px bg-[#F2EDE6] lg:h-auto lg:w-px" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className={EYEBROW}>{dayLabel}</p>
          {selectedEvents.length > 0 ? (
            selectedEvents.map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 rounded-lg border border-[var(--border-soft)] p-3">
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[#2A9D8F]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">{ev.time}</span>
                    <span className="truncate font-sans text-[13px] font-medium text-[var(--text-default)]">{ev.title}</span>
                  </div>
                </div>
                {ev.duration && <span className="flex-shrink-0 rounded-full bg-[#F2EDE6] px-2 py-0.5 font-mono text-[10px] text-[var(--text-default)]">{ev.duration}</span>}
              </div>
            ))
          ) : (
            <p className="font-sans text-[12px] text-[var(--text-muted)]">No meetings on this day</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Recent Changes ───────────────────────────────────────────────────────────

function RecentChangesCard({ changes }: { changes: RecentChange[] }) {
  const navigate = useNavigate();
  return (
    <div className={`${CARD} col-span-12 flex flex-col gap-4 sm:col-span-6 xl:col-span-4`}>
      <div className="flex items-center justify-between">
        <p className={EYEBROW}>Recent Changes</p>
        <button type="button" onClick={() => navigate("/memory?panel=timeline")} className={TEAL_LINK}>VIEW ALL →</button>
      </div>
      <div className="flex flex-col gap-2">
        {changes.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => navigate(`/memory?panel=timeline&event=${c.id}`)}
            className="flex items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--bg-inset)]"
          >
            <div
              className="mt-1 w-[3px] flex-shrink-0 self-stretch rounded-full"
              style={{ background: c.status === "accepted" ? `linear-gradient(to bottom, #2A9D8F, rgba(42,157,143,0.7))` : `linear-gradient(to bottom, #C84A1F, rgba(200,74,31,0.7))`, minHeight: 36 }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-[13px] font-medium leading-snug text-[var(--text-default)]">{c.title}</p>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">{c.timeAgo}</p>
            </div>
            <span
              className="mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]"
              style={c.status === "accepted" ? { background: "rgba(42,157,143,0.08)", color: "#2A9D8F" } : { background: "rgba(200,74,31,0.08)", color: "#C84A1F" }}
            >
              {c.status}
            </span>
          </button>
        ))}
        {changes.length === 0 && <p className="font-sans text-[12px] text-[var(--text-muted)]">No recent review items.</p>}
      </div>
    </div>
  );
}

// ─── Integration Cards ────────────────────────────────────────────────────────

function CalendarCard({ events }: { events: CalendarEvent[] }) {
  const navigate = useNavigate();
  return (
    <div className={`${CARD} col-span-12 flex flex-col gap-4 sm:col-span-6 xl:col-span-4`}>
      <button type="button" onClick={() => navigate("/settings#integrations")} className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left">
        <SiGooglecalendar aria-hidden="true" focusable="false" size={14} color="#4285F4" />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-default)]">Google Calendar</p>
      </button>
      <div className="flex items-center justify-between">
        <p className="font-sans text-[14px] font-medium text-[var(--text-default)]">Upcoming</p>
      </div>
      <div className="flex flex-col gap-2">
        {events.map((e) => (
          <div key={e.id} className="flex items-center gap-3">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#2A9D8F]" />
            <p className="flex-1 truncate font-sans text-[13px] font-medium text-[var(--text-default)]">{e.title}</p>
            <div className="flex-shrink-0 text-right">
              <p className="font-mono text-[10px] uppercase text-[var(--text-muted)]">{e.day}</p>
              <p className="font-mono text-[11px] text-[var(--text-default)]">{e.time}</p>
            </div>
          </div>
        ))}
        {events.length === 0 && <p className="font-sans text-[12px] text-[var(--text-muted)]">No upcoming calendar events.</p>}
      </div>
    </div>
  );
}

function SlackCard({ messages }: { messages: SlackMessage[] }) {
  const navigate = useNavigate();
  return (
    <div className={`${CARD} col-span-12 flex flex-col gap-4 sm:col-span-6 xl:col-span-4`}>
      <button type="button" onClick={() => navigate("/settings#integrations")} className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left">
        <SiSlack aria-hidden="true" focusable="false" size={14} color="#4A154B" />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-default)]">Slack</p>
      </button>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] text-[var(--text-default)]">{messages[0]?.channelName ? `#${messages[0].channelName}` : "No channel connected"}</span>
        <span className="rounded-full bg-[rgba(200,74,31,0.08)] px-2 py-0.5 font-mono text-[10px] text-[var(--terracotta-text)]">{messages.length} recent</span>
      </div>
      <div className="flex flex-col gap-3">
        {messages.map((m) => (
          <button key={m.id} type="button" onClick={() => navigate("/memory?panel=timeline&source=slack")} className="flex items-start gap-3 text-left hover:opacity-80 transition-opacity">
            <Avatar seed={m.authorName} size={28} name={m.authorName} />
            <div className="min-w-0">
              <p className="font-sans text-[12px]">
                <span className="font-medium text-[var(--text-default)]">{m.authorName}</span>
                <span className="ml-1 font-mono text-[10px] text-[var(--text-muted)]">· {m.timeAgo}</span>
              </p>
              <p className="truncate font-sans text-[12px] text-[var(--text-default)]">{m.preview}</p>
            </div>
          </button>
        ))}
        {messages.length === 0 && <p className="font-sans text-[12px] text-[var(--text-muted)]">No recent Slack messages.</p>}
      </div>
    </div>
  );
}

function GitBranchCard({ commits }: { commits: GitCommitType[] }) {
  const navigate = useNavigate();
  return (
    <div className={`${CARD} col-span-12 flex flex-col gap-4 sm:col-span-6 xl:col-span-4`}>
      <button type="button" onClick={() => navigate("/settings#integrations")} className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left">
        <SiGithub aria-hidden="true" focusable="false" size={14} className="github-dark-invert text-[var(--text-default)]" />
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-default)]">GitHub</p>
      </button>
      <div className="flex items-center justify-between">
        <span className="truncate font-mono text-[12px] text-[var(--text-default)]">{commits[0]?.repository ?? "No repository connected"}</span>
        {commits[0]?.branch && <span className="rounded-full bg-[rgba(200,74,31,0.08)] px-2 py-0.5 font-mono text-[10px] text-[var(--terracotta-text)]">{commits[0].branch}</span>}
      </div>
      <div className="flex flex-col gap-3">
        {commits.map((c) => (
          <button key={c.hash} type="button" onClick={() => navigate(`/memory?panel=timeline&source=github&ref=${encodeURIComponent(c.hash)}`)} className="flex flex-col gap-0.5 text-left hover:opacity-80 transition-opacity">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[var(--teal-text)]">{c.hash}</span>
              <p className="truncate font-sans text-[12px] font-medium text-[var(--text-default)]">{c.message}</p>
            </div>
            <p className="font-mono text-[10px] text-[var(--text-muted)]">{c.author} · {c.timeAgo}</p>
          </button>
        ))}
        {commits.length === 0 && <p className="font-sans text-[12px] text-[var(--text-muted)]">No GitHub commit evidence.</p>}
      </div>
    </div>
  );
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

const SOURCE_STYLES: Partial<Record<ActivityItem["source"], { bg: string; color: string; Icon: typeof Brain }>> = {
  socrates: { bg: "rgba(42,157,143,0.1)", color: "#2A9D8F", Icon: Brain },
  github: { bg: "rgba(200,74,31,0.08)", color: "#C84A1F", Icon: GitBranch },
  slack: { bg: "rgba(124,111,217,0.1)", color: "#7C6FD9", Icon: Hash },
  manual: { bg: "rgba(120,113,108,0.08)", color: "#8A8378", Icon: MessageSquare },
};
const DEFAULT_SOURCE_STYLE = { bg: "rgba(120,113,108,0.08)", color: "#8A8378", Icon: MessageSquare };

function ActivityFeedCard({ items }: { items: ActivityItem[] }) {
  const navigate = useNavigate();
  return (
    <div className={`${CARD} col-span-12 flex flex-col gap-4 xl:col-span-7`}>
      <p className={EYEBROW}>Recent Activity</p>
      <div className="flex flex-col divide-y divide-[#F2EDE6]">
        {items.map((item) => {
          const style = SOURCE_STYLES[item.source] ?? DEFAULT_SOURCE_STYLE;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.route)}
              className="group flex items-center gap-3 py-2.5 text-left transition-colors first:pt-0 last:pb-0 hover:opacity-80"
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full" style={{ background: style.bg }}>
                <style.Icon size={13} strokeWidth={1.8} style={{ color: style.color }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-[13px] text-[var(--text-default)]">{item.text}</p>
                <p className="font-mono text-[10px] text-[var(--text-muted)]">{item.source} · {item.timeAgo}</p>
              </div>
              <span className="flex-shrink-0 font-sans text-[var(--text-faint)] opacity-0 transition-opacity group-hover:opacity-100">→</span>
            </button>
          );
        })}
        {items.length === 0 && <p className="font-sans text-[12px] text-[var(--text-muted)]">No recent customer-facing activity.</p>}
      </div>
    </div>
  );
}

// ─── Socrates Queries ─────────────────────────────────────────────────────────

function SocratesQueriesCard({ queries }: { queries: SocratesQuery[] }) {
  const navigate = useNavigate();
  return (
    <div className={`${CARD} col-span-12 flex flex-col gap-4 xl:col-span-5`}>
      <p className={EYEBROW}>Recent Socrates Queries</p>
      <div className="flex flex-col gap-2">
        {queries.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => navigate(`/chat/${q.sessionId}`)}
            className="flex items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--bg-inset)]"
          >
            <span className="mt-0.5 flex-shrink-0 font-serif text-[16px] leading-none text-[var(--terracotta-text)]">"</span>
            <div className="min-w-0">
              <p className="font-sans text-[13px] italic text-[var(--text-default)]">{q.query}</p>
              <p className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">asked by {q.askedBy} · {q.timeAgo}</p>
            </div>
          </button>
        ))}
        {queries.length === 0 && <p className="font-sans text-[12px] text-[var(--text-muted)]">No recent Socrates queries.</p>}
      </div>
    </div>
  );
}

// ─── Subscription mutation modal ─────────────────────────────────────────────

function SubscriptionModal({ initial, onClose, onSave }: {
  initial: Subscription | null;
  onClose: () => void;
  onSave: (input: SubscriptionInput) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "INFRASTRUCTURE");
  const [cost, setCost] = useState(initial ? String(initial.cost) : "");
  const [billingType, setBillingType] = useState<SubscriptionInput["billingType"]>(initial?.billingType ?? "monthly");
  const [status, setStatus] = useState<SubscriptionInput["status"]>(initial?.status ?? "active");
  const [provider, setProvider] = useState(initial?.provider ?? "");
  const [externalRef, setExternalRef] = useState(initial?.externalRef ?? "");
  const [renewsAt, setRenewsAt] = useState(initial?.renewsAt?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useAccessibleDialog<HTMLDivElement>(onClose, saving);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const numericCost = Number(cost);
    if (!name.trim() || !Number.isFinite(numericCost) || numericCost < 0) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        category: category.trim(),
        cost: numericCost,
        billingType,
        status,
        provider: provider.trim() || null,
        externalRef: externalRef.trim() || null,
        // Renewal is a calendar date, so normalize it at UTC midnight rather
        // than allowing the browser timezone to move it to another day.
        renewsAt: renewsAt ? `${renewsAt}T00:00:00.000Z` : null,
      });
      onClose();
    } catch (caught) {
      setError(errorLabel(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-[#1A1714]/40" onClick={() => { if (!saving) onClose(); }} />
      <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="subscription-dialog-title" tabIndex={-1} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.15 }}
        className="relative z-10 max-h-full w-full max-w-[440px] overflow-y-auto rounded-2xl bg-[var(--bg-card)] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.12)] sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <h2 id="subscription-dialog-title" className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">{initial ? "Edit Subscription" : "Add Subscription"}</h2>
          <button type="button" disabled={saving} onClick={onClose} aria-label="Close subscription form" className="text-[var(--text-muted)] hover:text-[var(--text-default)] disabled:opacity-50"><X size={15} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input data-dialog-initial-focus aria-label="Service name" value={name} onChange={e => setName(e.target.value)} placeholder="Service name" required
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2.5 font-sans text-[13px] text-[var(--text-default)] outline-none focus:border-[#C84A1F]" />
          <select aria-label="Category" value={category} onChange={e => setCategory(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2.5 font-mono text-[12px] text-[var(--text-default)] outline-none focus:border-[#C84A1F]">
            {["INFRASTRUCTURE","DATABASE","PAYMENTS","NOTIFICATIONS","HOSTING","MONITORING","ANALYTICS","OTHER"].map(c => <option key={c}>{c}</option>)}
          </select>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input aria-label="Cost" value={cost} onChange={e => setCost(e.target.value)} placeholder="Cost" type="number" min="0" step="0.01" required
              className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2.5 font-sans text-[13px] text-[var(--text-default)] outline-none focus:border-[#C84A1F]" />
            <select aria-label="Billing type" value={billingType} onChange={e => setBillingType(e.target.value as SubscriptionInput["billingType"])} className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2.5 font-mono text-[11px] text-[var(--text-default)]">
              <option value="monthly">Monthly</option><option value="annual">Annual</option><option value="usage_based">Usage based</option><option value="per_transaction">Per transaction</option><option value="one_time">One time</option>
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value as SubscriptionInput["status"])} className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2.5 font-mono text-[11px] text-[var(--text-default)]">
              <option value="active">Active</option><option value="paused">Paused</option><option value="cancelled">Cancelled</option>
            </select>
          <input aria-label="Renewal date" value={renewsAt} onInput={e => setRenewsAt(e.currentTarget.value)} type="date" className="rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2.5 font-mono text-[11px] text-[var(--text-default)]" />
          </div>
          <input aria-label="Provider" value={provider} onChange={e => setProvider(e.target.value)} placeholder="Provider (optional)" className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2.5 font-sans text-[13px] text-[var(--text-default)]" />
          <input aria-label="External reference" value={externalRef} onChange={e => setExternalRef(e.target.value)} placeholder="Provider URL or external reference (optional)" className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-2.5 font-sans text-[13px] text-[var(--text-default)]" />
          {error && <p role="alert" className="font-mono text-[11px] text-[var(--terracotta-text)]">{error}</p>}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={saving} className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-default)]">Cancel</button>
            <button type="submit" disabled={saving || !name.trim() || cost === ""} className="rounded-full bg-[#C84A1F] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white hover:opacity-90 disabled:opacity-40">
              {saving ? "Saving…" : initial ? "Save Changes" : "Add Subscription"}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

function billingLabel(subscription: Subscription) {
  const labels = { monthly: "/mo", annual: "/yr", usage_based: "usage", per_transaction: "/txn", one_time: "once" };
  return labels[subscription.billingType];
}

function SubscriptionsCard({ subs, canManage, mutatingId, onAddSub, onEdit, onDelete }: {
  subs: Subscription[];
  canManage: boolean;
  mutatingId: string | null;
  onAddSub: () => void;
  onEdit: (subscription: Subscription) => void;
  onDelete: (subscription: Subscription) => void;
}) {
  const totalMo = subs.reduce((sum, subscription) => sum + monthlyEquivalent(subscription), 0);

  return (
    <div className={`${CARD} col-span-12 flex flex-col gap-5`}>
      <div className="flex items-center justify-between">
        <p className={EYEBROW}>Project Subscriptions</p>
        <span className="rounded-full border border-[var(--border-soft)] bg-[var(--bg-inset)] px-3 py-1 font-mono text-[11px] text-[var(--text-default)]">
          ${totalMo.toFixed(0)} /mo
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {subs.map((s) => {
          const externalUrl = safeExternalUrl(s.externalRef);
          return (
          <div key={s.id} className="group rounded-lg border border-[#F2EDE6] bg-[var(--bg-inset)] p-4 transition-all hover:-translate-y-px hover:border-[var(--border-soft)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-[16px]" style={{ background: s.iconBg, color: s.iconTextColor }}>
                {s.iconLabel}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-[13px] font-medium text-[var(--text-default)]">{s.name}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${s.status === "active" ? "bg-[#2A9D8F]" : "bg-[#8A8378]"}`} />
                {externalUrl && <a href={externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.name} provider reference`}><ExternalLink size={12} strokeWidth={1.7} className="text-[var(--text-muted)]" /></a>}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className={EYEBROW_MUTED}>{s.category}</p>
              <p className="font-sans text-[13px]">
                <span className="font-medium text-[var(--text-default)]">${s.cost.toFixed(2)}</span>
                <span className="ml-0.5 text-[var(--text-muted)]"> {billingLabel(s)}</span>
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[var(--border-soft)] pt-3">
              <span className="font-mono text-[9px] uppercase text-[var(--text-muted)]">{s.status}{s.renewsAt ? ` · renews ${new Date(s.renewsAt).toLocaleDateString()}` : ""}</span>
              {canManage && <div className="flex gap-2">
                <button type="button" onClick={() => onEdit(s)} aria-label={`Edit ${s.name}`} disabled={mutatingId === s.id}><Pencil size={13} /></button>
                <button type="button" onClick={() => onDelete(s)} aria-label={`Delete ${s.name}`} disabled={mutatingId === s.id} className="text-[var(--terracotta-text)]"><Trash2 size={13} /></button>
              </div>}
            </div>
          </div>
        );})}
      </div>
      {subs.length === 0 && <p className="font-sans text-[13px] text-[var(--text-muted)]">No project subscriptions have been added.</p>}
      {canManage && <button
        type="button"
        onClick={onAddSub}
        className="flex w-full items-center justify-center rounded-lg border border-dashed border-[var(--border-soft)] py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] transition-colors hover:border-[#C84A1F] hover:text-[var(--terracotta-text)]"
      >
        + Add Subscription
      </button>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { activeProject } = useAuth();
  const projectId = activeProject?.id;
  const canManage = activeProject?.projectRole === "manager";

  const [data, setData] = useState<DashboardData | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dashboardState, setDashboardState] = useState<OperationalState<DashboardData>>({ state: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [subscriptionModal, setSubscriptionModal] = useState<Subscription | null | undefined>(undefined);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [shimmer, setShimmer] = useState(false);

  const acceptDashboard = useCallback((result: DashboardData) => {
    setData(result);
    setSubscriptions(result.subscriptions);
  }, []);

  const loadDashboard = useCallback(async (id: string) => {
    const state = await loadOperationalState(() => getDashboard(id), () => false);
    setDashboardState(state);
    if (state.state === "ready") acceptDashboard(state.data);
  }, [acceptDashboard]);

  useEffect(() => {
    if (!projectId) return;
    setData(null);
    setSubscriptions([]);
    setDashboardState({ state: "loading" });
    void loadDashboard(projectId);
  }, [loadDashboard, projectId]);

  const handleRefresh = async () => {
    if (!projectId) return;
    setRefreshing(true);
    setShimmer(true);
    const state = await loadOperationalState(() => refreshDashboard(projectId), () => false);
    setDashboardState(state);
    if (state.state === "ready") acceptDashboard(state.data);
    setRefreshing(false);
    setShimmer(false);
  };

  const reloadSubscriptions = async () => {
    if (!projectId) return;
    setSubscriptions(await listSubscriptions(projectId));
  };

  const handleSaveSubscription = async (input: SubscriptionInput) => {
    if (!projectId) return;
    setMutationError(null);
    if (subscriptionModal) await updateSubscription(projectId, subscriptionModal.id, input);
    else await createSubscription(projectId, input);
    await reloadSubscriptions();
  };

  const handleDeleteSubscription = async (subscription: Subscription) => {
    if (!projectId || !window.confirm(`Delete ${subscription.name}? This cannot be undone.`)) return;
    setMutatingId(subscription.id);
    setMutationError(null);
    try {
      await deleteSubscription(projectId, subscription.id);
      await reloadSubscriptions();
    } catch (caught) {
      setMutationError(errorLabel(caught));
    } finally {
      setMutatingId(null);
    }
  };

  if (!data && dashboardState.state === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Loading...</p>
      </div>
    );
  }

  if (!data) {
    return <div className="flex h-full items-center justify-center p-8"><OperationalStateNotice value={dashboardState} onRetry={() => projectId && void loadDashboard(projectId)} /></div>;
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div>
          <h1 className="font-sans text-[36px] font-medium leading-none tracking-tight text-[var(--text-default)] sm:text-[46px]">Dashboard</h1>
          <div className="mt-2.5 flex flex-col gap-1">
            <div className="h-px w-20 bg-[#C84A1F]" />
            <div className="h-px w-10 bg-[var(--border-soft)]" />
          </div>
          <p className="mt-3 font-sans text-[14px] text-[var(--text-muted)]">Everything happening across your project, in one view.</p>
        </div>
        <button type="button" onClick={() => void handleRefresh()} disabled={refreshing} className="mt-1 flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-default)] disabled:opacity-60">
          <RefreshCw size={13} strokeWidth={1.7} style={{ transform: refreshing ? "rotate(360deg)" : "rotate(0deg)", transition: "transform 600ms ease" }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Updated {formatUpdatedAt(data.updatedAt)}</span>
        </button>
      </header>

      {dashboardState.state !== "ready" && <div className="mt-6"><OperationalStateNotice value={dashboardState} onRetry={() => void handleRefresh()} /></div>}
      {mutationError && <p role="alert" className="mt-6 rounded-lg border border-[#C84A1F]/30 bg-[#C84A1F]/5 px-4 py-3 font-mono text-[11px] text-[var(--terracotta-text)]">{mutationError}</p>}

      <div className={`mt-8 grid grid-cols-12 gap-4 transition-opacity duration-300 sm:gap-6 ${shimmer ? "opacity-70" : "opacity-100"}`}>
        {data.stats.map((stat, i) => (
          <div key={stat.id} className="col-span-12 sm:col-span-6 xl:col-span-3">
            <StatCard stat={stat} index={i} />
          </div>
        ))}
        <TeamCard members={data.team} events={data.calendarEvents} />
        <RecentChangesCard changes={data.changes} />
        <CalendarCard events={data.calendarEvents} />
        <SlackCard messages={data.slackMessages} />
        <GitBranchCard commits={data.gitCommits} />
        <ActivityFeedCard items={data.activity} />
        <SocratesQueriesCard queries={data.socratesQueries} />
        <SubscriptionsCard subs={subscriptions} canManage={canManage} mutatingId={mutatingId} onAddSub={() => setSubscriptionModal(null)} onEdit={setSubscriptionModal} onDelete={(subscription) => void handleDeleteSubscription(subscription)} />
      </div>

      <AnimatePresence>
        {subscriptionModal !== undefined && (
          <SubscriptionModal
            initial={subscriptionModal}
            onClose={() => setSubscriptionModal(undefined)}
            onSave={handleSaveSubscription}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
