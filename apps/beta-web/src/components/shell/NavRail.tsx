import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Database,
  LayoutGrid,
  MessageCircle,
  MonitorSmartphone,
  Moon,
  Radar,
  Workflow,
  Plus,
  Settings2,
  Sun,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { create } from "zustand";
import Avatar from "../ui/Avatar";
import { OmniLogo } from "../socrates/OmniLogo";
import { useAuth } from "../../context/AuthContext";
import { useThemeStore, type ThemeMode } from "../../store/themeStore";
import { getAppearancePreference, updateAppearancePreference } from "../../lib/api/settings";
import { useToastStore } from "../ui/Toaster";
import { useChatStore } from "../../store/chatStore";
import { formatDistanceToNow } from "../../lib/dateUtils";
import { prefetchPrimaryRoute } from "../../lib/performance/prefetch";
import { deleteSocratesSession } from "../../lib/api/socrates";
import { ApiError } from "../../lib/api/client";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

// ─── Rail store ───────────────────────────────────────────────────────────────

type RailState = { isExpanded: boolean; setExpanded: (v: boolean) => void };
export const useRailStore = create<RailState>((set) => ({
  isExpanded: false,
  setExpanded: (isExpanded) => set({ isExpanded }),
}));

// ─── Dimensions ───────────────────────────────────────────────────────────────

export const COLLAPSED_WIDTH = 52;
export const EXPANDED_WIDTH = 240;

// ─── Nav items ────────────────────────────────────────────────────────────────

type NavItem = {
  key: string;
  Icon: LucideIcon;
  route: string;
  label: string;
  checkActive: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    key: "dashboard",
    Icon: LayoutGrid,
    route: "/dashboard",
    label: "Dashboard",
    checkActive: (p) => p === "/dashboard" || p === "/dashboard/",
  },
  {
    key: "chat",
    Icon: MessageCircle,
    route: "/chat",
    label: "Chat",
    checkActive: (p) => p === "/chat" || p.startsWith("/chat/"),
  },
  {
    key: "memory",
    Icon: Database,
    route: "/memory",
    label: "Memory",
    checkActive: (p) =>
      p === "/memory" || p === "/memory/" || p.startsWith("/memory/"),
  },
  {
    key: "truth-inbox",
    Icon: Radar,
    route: "/truth-inbox",
    label: "Truth Inbox",
    checkActive: (p) => p === "/truth-inbox" || p.startsWith("/truth-inbox/"),
  },
  {
    key: "delivery",
    Icon: Workflow,
    route: "/delivery",
    label: "Delivery",
    checkActive: (p) => p === "/delivery" || p === "/delivery/",
  },
  {
    key: "settings",
    Icon: Settings2,
    route: "/settings",
    label: "Settings",
    checkActive: (p) => p === "/settings" || p === "/settings/",
  },
];

const SPRING = { type: "spring", stiffness: 300, damping: 30 } as const;
const INDICATOR_SPRING = { type: "spring", stiffness: 400, damping: 30 } as const;

// ─── NavRail ──────────────────────────────────────────────────────────────────

export function NavRail() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, activeProject } = useAuth();
  const { isExpanded: expandedPreference, setExpanded } = useRailStore();
  const [wideScreen, setWideScreen] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  const isExpanded = wideScreen && expandedPreference;
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setWideScreen(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const { mode: themeMode, setMode } = useThemeStore();
  const [themeBusy, setThemeBusy] = useState(false);
  const { add: showToast } = useToastStore();
  const conversations = useChatStore((state) => state.conversations);
  const activeChatId = useChatStore((state) => state.activeId);
  const setChatProject = useChatStore((state) => state.setProject);
  const setActiveId = useChatStore((state) => state.setActiveId);
  const removeConversation = useChatStore((state) => state.removeConversation);
  const prefersReducedMotion = useReducedMotion();
  const [deleteTarget, setDeleteTarget] = useState<(typeof conversations)[number] | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isChat = pathname === "/chat" || pathname.startsWith("/chat/");

  useEffect(() => {
    if (isChat && window.matchMedia("(min-width: 768px)").matches) setExpanded(true);
  }, [isChat, setExpanded]);

  const ThemeIcon =
    themeMode === "dark" ? Sun : themeMode === "auto" ? MonitorSmartphone : Moon;
  const themeLabel =
    themeMode === "dark" ? "DARK" : themeMode === "auto" ? "AUTO" : "LIGHT";

  const displayName = user?.displayName ?? "Account";
  const chatDestination = activeChatId ? `/chat/${activeChatId}` : "/chat";

  useEffect(() => {
    if (activeProject?.id) setChatProject(activeProject.id);
  }, [activeProject?.id, setChatProject]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void getAppearancePreference()
      .then((preference) => { if (active) setMode(preference.theme); })
      .catch((caught) => { if (active) showToast(caught instanceof Error ? caught.message : "Could not load appearance preference", "error"); });
    return () => { active = false; };
  }, [setMode, showToast, user]);

  const handleThemeCycle = async () => {
    if (themeBusy) return;
    const next: ThemeMode = themeMode === "light" ? "dark" : themeMode === "dark" ? "auto" : "light";
    setThemeBusy(true);
    try {
      const saved = await updateAppearancePreference(next);
      setMode(saved.theme);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Could not update appearance preference", "error");
    } finally {
      setThemeBusy(false);
    }
  };

  const LabelIn = ({
    children,
    delay = 0,
  }: {
    children: React.ReactNode;
    delay?: number;
  }) => (
    <AnimatePresence>
      {isExpanded && (
        <motion.span
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={
            prefersReducedMotion ? { duration: 0 } : { duration: 0.14, delay }
          }
          className="min-w-0 overflow-hidden"
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );

  const handleNewChat = () => {
    setActiveId(null);
    navigate("/chat");
  };

  const closeDeleteDialog = () => {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };
  const deleteDialogRef = useAccessibleDialog<HTMLDivElement>(closeDeleteDialog, deleteBusy, Boolean(deleteTarget));

  const confirmDeleteChat = async () => {
    if (!activeProject?.id || !deleteTarget || deleteBusy) return;
    const targetId = deleteTarget.id;
    const wasCurrent = pathname === `/chat/${targetId}` || activeChatId === targetId;
    const finishLocalDelete = () => {
      removeConversation(activeProject.id, targetId);
      setDeleteTarget(null);
      if (wasCurrent) navigate("/chat");
    };
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const result = await deleteSocratesSession(activeProject.id, targetId);
      if (!result.deleted || result.sessionId !== targetId) throw new Error("Socrates did not confirm that the chat was deleted.");
      finishLocalDelete();
      showToast("Chat deleted.", "success");
    } catch (caught) {
      // A prior request may have completed on the server even if its browser
      // response was interrupted. Treat an already-absent session as an
      // idempotent success so stale render-cache entries cannot become zombies.
      if (caught instanceof ApiError && caught.status === 404 && caught.code === "session_not_found") {
        finishLocalDelete();
        showToast("Chat deleted.", "success");
        return;
      }
      setDeleteError(caught instanceof Error ? caught.message : "This chat could not be deleted.");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <motion.nav
      aria-label="Primary navigation"
      className="relative flex h-full flex-shrink-0 flex-col"
      animate={{ width: isExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH }}
      transition={prefersReducedMotion ? { duration: 0 } : SPRING}
      style={{
        background: "var(--bg-elevated)",
        borderRight: "1px solid var(--border-soft)",
      }}
    >
      {/* ── Brand ── */}
      <div
        className="flex h-12 flex-shrink-0 items-center overflow-hidden px-3"
        style={{ borderBottom: "1px solid var(--border-soft)" }}
      >
        <div className="flex h-9 w-[28px] flex-shrink-0 items-center justify-center">
          <OmniLogo size={14} className="text-[var(--text-default)]" />
        </div>
        <LabelIn delay={0.04}>
          <div className="ml-2 whitespace-nowrap">
            <p className="font-sans text-[12px] font-semibold leading-none text-[var(--text-default)]">
              OrchestraOS
            </p>
          </div>
        </LabelIn>
      </div>

      {/* ── Nav items ── */}
      <div className="flex flex-col gap-px px-1.5 pt-2">
        {NAV_ITEMS.map((item, index) => {
          const active = item.checkActive(pathname);
          return (
            <div key={item.key} className="relative">
              {active && (
                <motion.span
                  layoutId="rail-active-bar"
                  transition={INDICATOR_SPRING}
                  className="pointer-events-none absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-r-full"
                  style={{ background: "var(--terracotta)" }}
                />
              )}
              <button
                type="button"
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                title={isExpanded ? undefined : item.label}
                onClick={() => navigate(item.key === "chat" ? chatDestination : item.route)}
                onPointerEnter={() => {
                  if (activeProject?.id) void prefetchPrimaryRoute(item.route, activeProject.id, activeProject.projectRole === "manager");
                }}
                onFocus={() => {
                  if (activeProject?.id) void prefetchPrimaryRoute(item.route, activeProject.id, activeProject.projectRole === "manager");
                }}
                className={[
                  "flex h-9 w-full items-center gap-3 rounded-lg transition-colors duration-150",
                  isExpanded ? "px-2.5" : "justify-center",
                  active
                    ? "bg-[var(--tint-terracotta)]"
                    : "hover:bg-[var(--bg-hover)]",
                ].join(" ")}
              >
                <item.Icon
                  size={18}
                  strokeWidth={1.6}
                  style={{
                    color: active ? "var(--terracotta)" : "var(--text-muted)",
                    flexShrink: 0,
                  }}
                />
                <LabelIn delay={0.08 + index * 0.025}>
                  <span
                    className="whitespace-nowrap font-sans text-[13px]"
                    style={{
                      color: active ? "var(--terracotta)" : "var(--text-default)",
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {item.label}
                  </span>
                </LabelIn>
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Chat history sub-list (only on /chat) ── */}
      <AnimatePresence>
        {isChat && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.15 }}
            className="flex flex-col overflow-hidden px-1.5 pt-1"
            style={{ maxHeight: "calc(100vh - 280px)" }}
          >
            {/* New chat button */}
            <button
              type="button"
              aria-label="New chat"
              onClick={handleNewChat}
              className={[
                "mb-1 flex h-7 w-full items-center rounded-md transition-colors hover:bg-[var(--bg-hover)]",
                isExpanded ? "gap-2 px-2" : "justify-center",
              ].join(" ")}
            >
              <Plus
                size={13}
                strokeWidth={1.8}
                style={{ color: "var(--text-muted)", flexShrink: 0 }}
              />
              <AnimatePresence>
                {isExpanded && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="whitespace-nowrap font-sans text-[11px] text-[var(--text-muted)]"
                  >
                    New chat
                  </motion.span>
                )}
              </AnimatePresence>
            </button>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto">
              {isExpanded && conversations.length > 0 ? (
                <p className="px-2 pb-1 pt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
                  Recent chats
                </p>
              ) : null}
              {conversations.slice(0, 20).map((conv) => (
                <div key={conv.id} className="group relative">
                  <NavLink
                    to={`/chat/${conv.id}`}
                    aria-label={conv.title || "Untitled chat"}
                    onClick={() => setActiveId(conv.id)}
                    className={({ isActive }) =>
                      [
                        "block rounded-md transition-colors",
                        isExpanded ? "px-2 py-1.5 pr-8" : "p-1.5",
                        isActive
                          ? "bg-[var(--bg-inset)]"
                          : "hover:bg-[var(--bg-hover)]",
                      ].join(" ")
                    }
                  >
                    {isExpanded ? (
                      <>
                        <span className="block truncate font-sans text-[11px] text-[var(--text-default)]">
                          {conv.title}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--text-faint)]">
                          {formatDistanceToNow(conv.timestamp)}
                        </span>
                      </>
                    ) : (
                      <span
                        className="block h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--border-stronger)" }}
                      />
                    )}
                  </NavLink>
                  {isExpanded ? (
                    <button
                      type="button"
                      aria-label={`Delete chat ${conv.title}`}
                      title="Delete chat"
                      onClick={() => { setDeleteError(null); setDeleteTarget(conv); }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[#C84A4A] focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 size={12} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Spacer ── */}
      <div className="flex-1" />

      {/* ── Bottom controls ── */}
      <div
        className="flex flex-col gap-px px-1.5 pb-3 pt-2"
        style={{ borderTop: "1px solid var(--border-soft)" }}
      >
        {/* Theme toggle */}
        <button
          type="button"
          aria-label={`Theme: ${themeLabel}`}
          title={isExpanded ? undefined : `Theme: ${themeLabel}`}
          onClick={() => void handleThemeCycle()}
          disabled={themeBusy}
          className={[
            "flex h-9 w-full items-center gap-3 rounded-lg transition-colors hover:bg-[var(--bg-hover)]",
            isExpanded ? "px-2.5" : "justify-center",
          ].join(" ")}
        >
          <ThemeIcon
            size={18}
            strokeWidth={1.6}
            style={{ color: "var(--text-muted)", flexShrink: 0 }}
          />
          <AnimatePresence>
            {isExpanded && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="whitespace-nowrap font-sans text-[13px] text-[var(--text-default)]"
              >
                Theme{" "}
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  · {themeLabel}
                </span>
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Avatar / profile */}
        <button
          type="button"
          aria-label="Profile"
          title={isExpanded ? undefined : displayName}
          onClick={() => navigate("/settings")}
          className={[
            "flex h-9 w-full items-center gap-3 rounded-lg transition-colors hover:bg-[var(--bg-hover)]",
            isExpanded ? "px-2.5" : "justify-center",
          ].join(" ")}
        >
          <div
            className="overflow-hidden rounded-full flex-shrink-0"
            style={{
              outline:
                pathname === "/settings"
                  ? "2px solid var(--terracotta)"
                  : "2px solid transparent",
              outlineOffset: 2,
            }}
          >
            <Avatar seed={displayName} size={22} name={displayName} />
          </div>
          <AnimatePresence>
            {isExpanded && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="min-w-0 truncate whitespace-nowrap font-sans text-[12px] font-medium text-[var(--text-default)]"
              >
                {displayName}
              </motion.p>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* ── Expand/collapse toggle ── */}
      <button
        type="button"
        aria-label={isExpanded ? "Collapse navigation" : "Expand navigation"}
        hidden={!wideScreen}
        aria-expanded={isExpanded}
        onClick={() => setExpanded(!isExpanded)}
        className="absolute right-[-12px] top-[14px] z-[70] flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--bg-elevated)] text-[var(--text-muted)] shadow-[var(--shadow-elevated)] transition-colors hover:text-[var(--text-default)]"
        style={{ fontSize: 10, display: wideScreen ? undefined : "none" }}
      >
        {isExpanded ? "‹" : "›"}
      </button>

      <AnimatePresence>
        {deleteTarget ? (
          <div className="fixed inset-0 z-[500] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-[#1A1714]/40" onClick={closeDeleteDialog} />
            <motion.div
              ref={deleteDialogRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-chat-title"
              aria-describedby="delete-chat-description"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="relative z-10 w-full max-w-[400px] rounded-2xl bg-[var(--bg-card)] p-8 shadow-[0_24px_64px_rgba(0,0,0,0.12)]"
            >
              <h2 id="delete-chat-title" className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--terracotta-text)]">Delete chat</h2>
              <p id="delete-chat-description" className="mt-3 font-sans text-[14px] leading-relaxed text-[var(--text-default)]">
                Permanently delete <strong>{deleteTarget.title}</strong> and its messages? This cannot be undone.
              </p>
              {deleteError ? <p role="alert" className="mt-3 font-sans text-[12px] text-[#C84A4A]">{deleteError}</p> : null}
              <div className="mt-6 flex items-center justify-end gap-3">
                <button data-dialog-initial-focus type="button" disabled={deleteBusy} onClick={closeDeleteDialog} className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-default)] disabled:opacity-50">Cancel</button>
                <button type="button" disabled={deleteBusy} onClick={() => void confirmDeleteChat()} className="rounded-full bg-[#C84A4A] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white hover:opacity-90 disabled:opacity-60">
                  {deleteBusy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </motion.nav>
  );
}
