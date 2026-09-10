import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

export type ArtifactType = "diagram" | "summary" | "api_map" | "ownership" | "timeline_view";
export type DiagramId = "auth-flow" | "system-arch";

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  diagramId?: DiagramId;
  summaryContent?: { heading: string; body?: string; items?: string[] }[];
  apiContent?: string;
  payload?: Record<string, unknown>;
  contentMd?: string;
  sourceRefs?: Array<{ sourceType: string; refId: string; label: string }>;
  generatedAt?: string;
}

export interface Citation {
  id?: string;
  label: string;
  excerpt: string;
  refId: string;
  sourceType: string;
  confidence?: number;
  openTargetId?: string | null;
}

export interface OpenTarget {
  id?: string;
  sourceType?: string;
  targetType: string;
  targetRef: Record<string, unknown>;
}

export interface SourceState {
  state: "ready" | "empty" | "not_connected" | "unavailable";
  count: number;
  message?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  artifact?: Artifact;
  citations?: Citation[];
  openTargets?: OpenTarget[];
  confidence?: "high" | "medium" | "low";
  limitations?: string[];
  sourceStates?: Record<string, SourceState>;
  modelMetadata?: { provider?: string; model?: string | null; degraded?: boolean };
  suggestions?: string[];
  feedback?: {
    id?: string;
    reason: "helpful" | "incorrect" | "outdated" | "missing_evidence" | "wrong_source" | "wrong_current_truth";
    correctionText?: string | null;
    needsHumanReview: boolean;
    updatedAt?: string;
  };
  isError?: boolean;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  messageCount: number;
  hasArtifacts: boolean;
  messages: Message[];
}

// This store is a render cache for server-owned Socrates sessions. It is
// deliberately reset when the active project changes.
export const INITIAL_CONVERSATIONS: Conversation[] = [];

interface ChatState {
  sourceScope: "All" | "Slack" | "GitHub" | "Docs";
  setSourceScope: (scope: ChatState["sourceScope"]) => void;
  identityKey: string | null;
  generation: number;
  bindIdentity: (identityKey: string) => void;
  projectId: string | null;
  conversations: Conversation[];
  activeId: string | null;
  drafts: Record<string, string>;
  lastActiveByProject: Record<string, string | null>;
  setProject: (projectId: string) => void;
  setActiveId: (id: string | null) => void;
  setDraft: (projectId: string, conversationId: string | null, value: string) => void;
  clearDraft: (projectId: string, conversationId: string | null) => void;
  resetContinuity: () => void;
  upsertConversation: (conv: Conversation) => void;
  setConversations: (conversations: Conversation[]) => void;
  updateConversation: (id: string, updater: (c: Conversation) => Conversation) => void;
  removeConversation: (projectId: string, id: string) => void;
}

export function chatDraftKey(projectId: string, conversationId: string | null | undefined) {
  return `${projectId}:${conversationId || "new"}`;
}

type PersistedChat = Pick<ChatState, "identityKey" | "projectId" | "activeId" | "conversations" | "drafts" | "lastActiveByProject">;
const DRAFT_STORAGE_KEY = "orchestra_chat_drafts_v1";
let previousPersisted: PersistedChat | null = null;
let pendingDrafts: { identityKey: string | null; drafts: Record<string, string> } | null = null;
let draftTimer: ReturnType<typeof setTimeout> | undefined;

function flushDrafts() {
  clearTimeout(draftTimer);
  draftTimer = undefined;
  if (!pendingDrafts) return;
  try { sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(pendingDrafts)); } catch { /* Memory remains usable when storage is denied/full. */ }
  pendingDrafts = null;
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushDrafts);
  window.addEventListener("blur", flushDrafts);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushDrafts(); });
}

// Serialization happens here, not in createJSONStorage/partialize on every
// keystroke. Draft checkpoints and transcript checkpoints are independent.
const continuityStorage: PersistStorage<PersistedChat> = {
  getItem(name) {
    try {
      const raw = sessionStorage.getItem(name);
      if (!raw) return null;
      const saved = JSON.parse(raw) as StorageValue<PersistedChat>;
      const draftRaw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      const draft = draftRaw ? JSON.parse(draftRaw) : null;
      if (draft?.identityKey === saved.state.identityKey) saved.state.drafts = draft.drafts ?? {};
      previousPersisted = null;
      return saved;
    } catch { return null; }
  },
  setItem(name, value) {
    const state = value.state;
    const prior = previousPersisted;
    const identityChanged = prior?.identityKey !== state.identityKey;
    if (identityChanged) {
      clearTimeout(draftTimer);
      pendingDrafts = null;
      try { sessionStorage.removeItem(name); sessionStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* denied storage */ }
    }
    if (!prior || identityChanged || prior.projectId !== state.projectId || prior.activeId !== state.activeId || prior.conversations !== state.conversations || prior.lastActiveByProject !== state.lastActiveByProject) {
      // Bound total serialized cache size, including citation metadata. Server
      // history restores anything omitted; never truncate accepted server data.
      const conversations: Conversation[] = [];
      let bytes = 0;
      for (const conversation of state.conversations.slice(0, 5)) {
        const cached = { ...conversation, messages: conversation.messages.slice(-20).map((message) => ({ ...message, content: message.content.slice(0, 20_000) })) };
        let size = new TextEncoder().encode(JSON.stringify(cached)).byteLength;
        while (cached.messages.length && bytes + size > 250_000) {
          cached.messages.shift();
          size = new TextEncoder().encode(JSON.stringify(cached)).byteLength;
        }
        if (bytes + size > 250_000) continue;
        conversations.push(cached);
        bytes += size;
      }
      try { sessionStorage.setItem(name, JSON.stringify({ ...value, state: { ...state, conversations, drafts: {}, lastActiveByProject: Object.fromEntries(Object.entries(state.lastActiveByProject).slice(-100)) } })); } catch { /* Reload can retrieve authoritative history. */ }
    }
    if (!prior || identityChanged || prior.drafts !== state.drafts) {
      const drafts: Record<string, string> = {};
      let bytes = 0;
      for (const [key, text] of Object.entries(state.drafts).reverse()) {
        const size = new TextEncoder().encode(key + text).byteLength;
        if (bytes + size > 64_000) continue;
        drafts[key] = text;
        bytes += size;
      }
      pendingDrafts = { identityKey: state.identityKey, drafts };
      clearTimeout(draftTimer);
      // Deletions and identity resets flush immediately so a reload never
      // resurrects a submitted draft or a previous user's text.
      if (identityChanged || Object.keys(state.drafts).length < Object.keys(prior?.drafts ?? {}).length) flushDrafts();
      else draftTimer = setTimeout(flushDrafts, 250);
    }
    previousPersisted = state;
  },
  removeItem(name) {
    clearTimeout(draftTimer);
    pendingDrafts = null;
    previousPersisted = null;
    try { sessionStorage.removeItem(name); sessionStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* denied storage */ }
  }
};

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      sourceScope: "All",
      setSourceScope: (sourceScope) => set({ sourceScope }),
      identityKey: null,
      generation: 0,
      bindIdentity: (identityKey) => set((state) => state.identityKey === identityKey ? state : ({
        identityKey, generation: state.generation + 1, projectId: null, sourceScope: "All", conversations: [], activeId: null, drafts: {}, lastActiveByProject: {},
      })),
      projectId: null,
      conversations: INITIAL_CONVERSATIONS,
      activeId: null,
      drafts: {},
      lastActiveByProject: {},

      setProject: (projectId) => set((state) =>
        state.projectId === projectId
          ? state
          : {
              projectId,
              sourceScope: "All",
              conversations: [],
              activeId: state.lastActiveByProject[projectId] ?? null,
            }
      ),

      setActiveId: (id) => set((state) => ({
        activeId: id,
        lastActiveByProject: state.projectId
          ? { ...state.lastActiveByProject, [state.projectId]: id }
          : state.lastActiveByProject,
      })),

      setDraft: (projectId, conversationId, value) => set((state) => {
        const key = chatDraftKey(projectId, conversationId);
        const next = value.slice(0, 8_000);
        if (state.drafts[key] === next) return state;
        const drafts = { ...state.drafts };
        delete drafts[key];
        drafts[key] = next;
        return { drafts };
      }),

      clearDraft: (projectId, conversationId) => set((state) => {
        const key = chatDraftKey(projectId, conversationId);
        if (!(key in state.drafts)) return state;
        const drafts = { ...state.drafts };
        delete drafts[key];
        return { drafts };
      }),

      resetContinuity: () => set((state) => ({
        identityKey: null,
        sourceScope: "All",
        generation: state.generation + 1,
        projectId: null,
        conversations: [],
        activeId: null,
        drafts: {},
        lastActiveByProject: {},
      })),

      upsertConversation: (conv) => set((state) => ({
        conversations: [conv, ...state.conversations.filter((item) => item.id !== conv.id)]
      })),

      setConversations: (conversations) => set((state) => ({
        conversations: [
          ...state.conversations.filter((existing) =>
            !conversations.some((conversation) => conversation.id === existing.id) &&
            existing.messages.length > 0 &&
            (existing.id === state.activeId || existing.messages.some((message) => message.isStreaming) || Date.now() - Date.parse(existing.timestamp) < 120_000)
          ),
          ...conversations.map((conversation) => {
          const existing = state.conversations.find((item) => item.id === conversation.id);
          return existing?.messages.length ? { ...conversation, messages: existing.messages } : conversation;
          }),
        ]
      })),

      updateConversation: (id, updater) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? updater(c) : c)),
        })),

      removeConversation: (projectId, id) => set((state) => {
        const drafts = { ...state.drafts };
        delete drafts[chatDraftKey(projectId, id)];
        const lastActiveByProject = state.lastActiveByProject[projectId] === id
          ? { ...state.lastActiveByProject, [projectId]: null }
          : state.lastActiveByProject;
        return {
          conversations: state.conversations.filter((conversation) => conversation.id !== id),
          activeId: state.activeId === id ? null : state.activeId,
          drafts,
          lastActiveByProject,
        };
      }),
    }),
    {
      name: "orchestra_chat_continuity_v1",
      storage: continuityStorage,
      partialize: (state) => ({
        identityKey: state.identityKey,
        projectId: state.projectId,
        activeId: state.activeId,
        // Keep a small render cache in the signed-in tab so switching routes or
        // reloading never blanks a conversation. The API remains authoritative
        // and ChatPage reconciles this cache in the background.
        conversations: state.conversations,
        drafts: state.drafts,
        lastActiveByProject: state.lastActiveByProject,
      }),
    }
  )
);

let _msgCounter = 0;
export function makeMessageId() {
  _msgCounter += 1;
  return `msg-${_msgCounter}-${Date.now()}`;
}
