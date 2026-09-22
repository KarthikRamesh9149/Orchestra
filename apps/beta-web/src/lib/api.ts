import { useWorkspaceStore } from "../store/workspaceStore";
import { useChatStore } from "../store/chatStore";
import { isSharedDesktop } from "./desktop";
import type { AnchorProvenance, Doc, DocViewerPayload, IntegrationStatus, UserRole } from "./types";
import type { TimelineEvent } from "./types/timeline";
import type { LinkedAccount, Session, User } from "./types/profile";
import type { Integration, Member, MemberRole, Workspace, WorkspaceInvite } from "./types/integrations";
import {
  API_BASE_URL,
  apiBlob,
  apiJson,
  apiUploadJson,
  bootstrapBrowserSession,
  ensureCsrfToken,
  rawJson,
  refreshAccessToken,
  resetApiSession
} from "./api/client";
export { ApiError } from "./api/client";
export type { UploadProgress } from "./api/client";
export type { OperationalError, OperationalState } from "./api/operationalState";
export { loadOperationalState, operationalError } from "./api/operationalState";

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  displayName: string;
  globalRole: string;
  workspaceRoleDefault: "manager" | "dev" | "client";
  emailVerified: boolean;
  emailVerifiedAt?: string | null;
  lastLoginAt?: string | null;
  organization?: { id: string; name: string; slug: string } | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  projectRole?: "manager" | "dev" | "client";
  organizationId?: string;
  organizationName?: string;
  organizationSlug?: string;
  current?: boolean;
  members?: Array<{ userId: string; projectRole: "manager" | "dev" | "client"; isActive: boolean }>;
}

export interface ProjectJoinCode {
  id: string;
  projectId: string;
  code?: string;
  codePrefix: string;
  projectRole: "manager" | "dev" | "client";
  maxUses: number;
  useCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface CommunicationConnectorReadiness {
  provider: string;
  metadata: { label?: string; description?: string; category?: string };
  connectorId: string | null;
  connectorStatus: string | null;
  readiness: {
    state: string;
    canConnect: boolean;
    canSync: boolean;
    canDisconnect?: boolean;
    canWebhook: boolean;
    reasons: string[];
    missingConfig: string[];
    deferredFeatures: string[];
  };
}

export interface CommunicationConnector {
  id: string;
  projectId: string;
  provider: string;
  accountLabel: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  readiness?: CommunicationConnectorReadiness["readiness"];
  config?: Record<string, unknown>;
  configSummary?: { threadCount: number; messageCount: number; syncRunCount: number };
  counts?: { threads: number; messages: number };
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isArchived: boolean;
  memberCount?: number | null;
}

export interface CommunicationThreadSummary {
  threadId: string;
  connectorId: string;
  provider: string;
  providerThreadId?: string;
  accountLabel: string;
  subject: string | null;
  lastMessageAt: string | null;
  latestMessage: {
    id: string;
    senderLabel: string;
    sentAt: string;
    excerpt: string | null;
    sourceSubType?: string | null;
  } | null;
  openTarget?: { targetType: "thread"; targetRef: { threadId: string } };
  providerOpenTarget?: {
    targetType: "provider_evidence";
    provider: string;
    url: string | null;
    unavailable?: boolean;
  };
}

interface AuthPayload {
  user: AuthUser;
}

export type JoinWorkspaceInput =
  | { accountType: "existing"; email: string; code?: string; inviteToken?: string; password: string }
  | { accountType: "new"; email: string; code?: string; inviteToken?: string; password: string; displayName: string };

export function clearAuth() {
  resetApiSession();
  useChatStore.getState().resetContinuity();
  if (typeof window !== "undefined") {
    // One-way cleanup for tokens written by pre-Fix-9 builds. New builds never read or write them.
    window.sessionStorage.removeItem("orchestra_beta_access_token");
    window.sessionStorage.removeItem("orchestra_beta_refresh_token");
  }
  useWorkspaceStore.getState().resetWorkspace();
}

function applyUser(user: AuthUser) {
  useChatStore.getState().bindIdentity(`${user.id}:${user.orgId}`);
  const role: UserRole = user.workspaceRoleDefault === "dev" ? "developer" : user.workspaceRoleDefault;
  useWorkspaceStore.getState().setUserRole(role);
  useWorkspaceStore.getState().setProfile(user.displayName, user.email);
}

export async function login(input: { email: string; password: string }) {
  const token = await ensureCsrfToken();
  const result = await rawJson<AuthPayload>("/v1/auth/login", {
    method: "POST",
    headers: { "X-CSRF-Token": token },
    body: JSON.stringify({ ...input, sessionMode: "browser" })
  });
  applyUser(result.user);
  return result.user;
}

export async function signup(input: { orgName: string; email: string; password: string; displayName: string }) {
  const token = await ensureCsrfToken();
  const result = await rawJson<AuthPayload>("/v1/auth/signup", {
    method: "POST",
    headers: { "X-CSRF-Token": token },
    body: JSON.stringify({ ...input, sessionMode: "browser" })
  });
  applyUser(result.user);
  return result.user;
}

export async function joinWorkspace(input: JoinWorkspaceInput) {
  const token = await ensureCsrfToken();
  const result = await rawJson<AuthPayload>("/v1/auth/invitations/redeem", {
    method: "POST",
    headers: { "X-CSRF-Token": token },
    body: JSON.stringify({ ...input, sessionMode: "browser" })
  });
  applyUser(result.user);
  return result.user;
}

export const confirmEmailVerification = (token: string) => apiJson<{ verified: true; emailVerifiedAt: string }>("/v1/auth/email-verification/confirm", { method: "POST", body: JSON.stringify({ token }) });
export const requestEmailVerification = (projectId: string) => apiJson<{ status: string; provider?: string | null; errorCode?: string | null; expiresAt?: string | null }>("/v1/auth/email-verification/request", { method: "POST", body: JSON.stringify({ projectId }) });
export const changePassword = (currentPassword: string, newPassword: string) => apiJson<{ changed: true; sessionsRevoked: true }>("/v1/auth/password/change", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });

export async function getMe() {
  const user = await apiJson<AuthUser>("/v1/auth/me");
  applyUser(user);
  return user;
}

export async function logout() {
  let confirmed=false;
  try {
    const token = await ensureCsrfToken();
    await rawJson("/v1/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": token }
    });
    confirmed=true;
  } finally {
    // Native shared grants live in main; do not imply sign-out while one remains active.
    if(confirmed||!isSharedDesktop())clearAuth();
  }
}

export async function listProjects() {
  return apiJson<ProjectSummary[]>("/v1/projects");
}

type WorkspacePayload = {
  projectId: string;
  name: string;
  slug: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: "manager" | "dev" | "client";
  current: boolean;
};

type WorkspaceSwitchPayload = {
  workspace: WorkspacePayload;
  user: AuthUser;
};

function toProjectSummary(workspace: WorkspacePayload): ProjectSummary {
  return {
    id: workspace.projectId,
    name: workspace.name,
    projectRole: workspace.role,
    organizationId: workspace.organizationId,
    organizationName: workspace.organizationName,
    organizationSlug: workspace.organizationSlug,
    current: workspace.current
  };
}

export async function loadBootstrap() {
  const result = await bootstrapBrowserSession<{ user: AuthUser; workspaces: WorkspacePayload[] }>();
  const projects = result.workspaces.map(toProjectSummary);
  const activeProject = projects.find(project => project.current) ?? null;
  applyUser(result.user);
  if (activeProject) useWorkspaceStore.getState().setActiveProject(activeProject.id, activeProject.name);
  else useWorkspaceStore.getState().clearActiveProject();
  return { user: result.user, projects, activeProject };
}

export async function listWorkspaces() {
  const workspaces = await apiJson<WorkspacePayload[]>("/v1/me/workspaces");
  return workspaces.map(toProjectSummary);
}

export async function createProject(input: { name: string; description?: string | null }) {
  return apiJson<ProjectSummary>("/v1/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function loadActiveProject() {
  const projects = await listWorkspaces();
  const project = projects.find((item) => item.current) ?? null;
  if (project) {
    useWorkspaceStore.getState().setActiveProject(project.id, project.name);
  } else {
    useWorkspaceStore.getState().clearActiveProject();
  }
  return { projects, activeProject: project };
}

export function setActiveProject(project: ProjectSummary) {
  useWorkspaceStore.getState().setActiveProject(project.id, project.name);
}

export async function switchWorkspace(projectId: string) {
  const result = await apiJson<WorkspaceSwitchPayload>("/v1/me/workspaces/switch", {
    method: "POST",
    body: JSON.stringify({ projectId })
  });
  const project = toProjectSummary({ ...result.workspace, current: true });
  applyUser(result.user);
  useWorkspaceStore.getState().setActiveProject(project.id, project.name);
  return { project, user: result.user };
}

export async function createJoinCode(projectId: string) {
  return apiJson<ProjectJoinCode>(`/v1/projects/${projectId}/join-codes`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function listJoinCodes(projectId: string): Promise<ProjectJoinCode[]> {
  return apiJson<ProjectJoinCode[]>(`/v1/projects/${projectId}/join-codes`);
}

export async function revokeJoinCode(projectId: string, codeId: string) {
  return apiJson<ProjectJoinCode | null>(`/v1/projects/${projectId}/join-codes/${codeId}/revoke`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export const getDocs = async (projectId: string, page = 1): Promise<Doc[]> => {
  const rows = await apiJson<any[]>(`/v1/projects/${projectId}/documents${page > 1 ? `?page=${page}&pageSize=25` : ""}`);
  const list = Array.isArray(rows) ? rows : (rows as { items?: unknown[] })?.items ?? [];
  return list.filter(Boolean).map(toDoc);
};

export const getDocumentStatus = async (projectId:string,documentId:string,signal?:AbortSignal):Promise<Doc> =>
  toDoc(await apiJson<any>(`/v1/projects/${projectId}/documents/${documentId}`,{signal,cache:'no-store'}));
export const retryDocumentProcessing = (projectId:string,documentId:string) =>
  apiJson(`/v1/projects/${projectId}/documents/${documentId}/reprocess`,{method:'POST',body:JSON.stringify({})});

export type UploadDocumentOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: import("./api/client").UploadProgress) => void;
  /** Reuse after a timeout; never retry with a new id until reconciliation says it did not complete. */
  operationId?: string;
};

export type DocumentUploadOperation = {
  documentId: string;
  documentVersionId: string;
  status: "pending" | "processing" | "ready" | "failed";
  parseRevision: number;
  operationId: string;
};

export function createDocumentUploadOperationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((value, index) => `${[4, 6, 8, 10].includes(index) ? "-" : ""}${value.toString(16).padStart(2, "0")}`).join("");
}

export const uploadDoc = async (projectId: string, file: File, options: UploadDocumentOptions = {}): Promise<Doc> => {
  const body = new FormData();
  body.append("file", file);
  body.append("kind", "reference");
  body.append("title", file.name.replace(/\.(pdf|docx)$/i, ""));
  body.append("visibility", "internal");
  const result = await apiUploadJson<any>(`/v1/projects/${projectId}/documents/upload`, body, {
    signal: options.signal,
    onProgress: options.onProgress,
    operationId: options.operationId ?? createDocumentUploadOperationId()
  });
  if (result.document && typeof result.document === "object") return toDoc(result.document);
  if (typeof result.documentId === "string") {
    const document = await apiJson<any>(`/v1/projects/${projectId}/documents/${result.documentId}`, { signal: options.signal });
    return toDoc(document);
  }
  return toDoc(result.document ?? result);
};

export const reconcileDocumentUpload = (projectId: string, operationId: string, signal?: AbortSignal) =>
  apiJson<DocumentUploadOperation>(`/v1/projects/${projectId}/documents/uploads/${operationId}`, { signal, cache: "no-store" });

export const archiveDocument = async (projectId: string, documentId: string) =>
  apiJson<{ documentId: string; archivedAt: string }>(
    `/v1/projects/${projectId}/documents/${documentId}`,
    { method: "DELETE" }
  );

export const askSocrates = async (projectId: string, content: string) => {
  return apiJson<{
    answer_md: string;
    citations: Array<{ label: string; refId: string }>;
    open_targets: Array<{ targetType: string; targetRef: Record<string, unknown> }>;
  }>(`/v1/projects/${projectId}/socrates/beta/ask`, {
    method: "POST",
    body: JSON.stringify({ content })
  });
};

// ─── Socrates chat (v1 ask — real evidence, source-scoped, cited) ──────────────

export type SocratesScope = "All" | "Slack" | "GitHub" | "Docs";

export interface SocratesCitation {
  id?: string;
  evidenceNumber?: number;
  label: string;
  excerpt: string;
  refId: string;
  sourceType: string;
  confidence?: number;
  openTargetId?: string | null;
}

export interface SocratesOpenTarget {
  id?: string;
  sourceType?: string;
  targetType: string;
  targetRef: Record<string, unknown>;
}

export interface SocratesArtifact {
  id: string;
  type: "diagram" | "summary" | "api_map" | "ownership" | "timeline_view";
  title: string;
  payload: Record<string, unknown>;
  contentMd: string;
  sourceRefs: Array<{ sourceType: string; refId: string; label: string }>;
  generatedAt: string;
}

export interface SocratesSourceState {
  state: "ready" | "empty" | "not_connected" | "unavailable";
  count: number;
  message?: string;
}

export interface SocratesAnswer {
  answer_md: string;
  citations: SocratesCitation[];
  open_targets: SocratesOpenTarget[];
  suggested_prompts: string[];
  confidence: "high" | "medium" | "low";
  limitations: string[];
  artifact: SocratesArtifact | null;
  sourceStates: Record<string, SocratesSourceState>;
  modelMetadata: { provider?: string; model?: string | null; degraded?: boolean };
  sessionId: string;
  message: {
    sessionId?: string;
    userMessageId: string;
    assistantMessageId: string;
    createdAt: string;
  };
}

export interface SocratesStreamHandlers {
  onMessageCreated?: (message: SocratesAnswer["message"]) => void;
  onDelta?: (delta: string, accumulated: string) => void;
  onReconnect?: (attempt: number, maxAttempts: number) => void;
}

export interface SocratesSessionSummary {
  id: string;
  projectId: string;
  pageContext: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SocratesSessionRecord {
  id: string;
  projectId: string;
  userId: string;
  pageContext: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocratesHistoryMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  responseStatus: string | null;
  answerPayloadJson?: {
    suggested_prompts?: string[];
    citations?: Array<Partial<SocratesCitation>>;
    open_targets?: SocratesOpenTarget[];
    confidence?: "high" | "medium" | "low";
    limitations?: string[];
    artifact?: SocratesArtifact | null;
    sourceStates?: Record<string, SocratesSourceState>;
    modelMetadata?: { provider?: string; model?: string | null; degraded?: boolean };
  } | null;
  createdAt: string;
  citations?: Array<{
    label: string;
    excerpt?: string | null;
    refId?: string | null;
    sourceType?: string | null;
    confidence?: number | string | null;
  }>;
  openTargets?: Array<{
    id?: string;
    targetType: string;
    targetPayloadJson: Record<string, unknown>;
  }>;
  feedback?: Array<{
    id: string;
    reason: "helpful" | "incorrect" | "outdated" | "missing_evidence" | "wrong_source" | "wrong_current_truth";
    correctionText: string | null;
    needsHumanReview: boolean;
    updatedAt: string;
  }>;
}

export const listSocratesSessions = (projectId: string, signal?: AbortSignal) =>
  apiJson<SocratesSessionSummary[]>(`/v1/projects/${projectId}/socrates/sessions?limit=30`, { signal });

export const createSocratesSession = (projectId: string, signal?: AbortSignal) =>
  apiJson<SocratesSessionRecord>(`/v1/projects/${projectId}/socrates/sessions`, {
    method: "POST",
    body: JSON.stringify({ pageContext: "dashboard_project" }),
    signal
  });

export const getSocratesHistory = (projectId: string, sessionId: string, signal?: AbortSignal) =>
  apiJson<SocratesHistoryMessage[]>(
    `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages`,
    { signal }
  );

export const deleteSocratesSession = (projectId: string, sessionId: string) =>
  apiJson<{ deleted: boolean; sessionId: string }>(
    `/v1/projects/${projectId}/socrates/sessions/${sessionId}`,
    { method: "DELETE" }
  );

export const prewarmSocratesV1 = (projectId: string, signal?: AbortSignal) =>
  apiJson<{ warmed: true; durationMs: number; expiresInMs: number }>(
    `/v1/projects/${projectId}/socrates/v1/prewarm`,
    { signal, cache: "no-store" }
  );

// UI scope toggle → backend evidence source keys (socratesV1SourceSchema).
const SOCRATES_SCOPE_SOURCES: Record<Exclude<SocratesScope, "All">, string[]> = {
  Slack: ["slack"],
  GitHub: ["github"],
  Docs: ["documents", "live_doc"]
};

const SOCRATES_ALL_SOURCES = ["all"];

export const askSocratesV1 = async (
  projectId: string,
  question: string,
  opts?: { scope?: SocratesScope; sessionId?: string; signal?: AbortSignal }
): Promise<SocratesAnswer> => {
  const scope = opts?.scope ?? "All";
  const selectedSources = scope === "All" ? SOCRATES_ALL_SOURCES : SOCRATES_SCOPE_SOURCES[scope];
  const result = await apiJson<{
    answer_md: string;
    citations?: Array<Partial<SocratesCitation>>;
    open_targets?: SocratesOpenTarget[];
    suggested_prompts?: string[];
    confidence?: "high" | "medium" | "low";
    limitations?: string[];
    artifact?: SocratesArtifact | null;
    sourceStates?: Record<string, SocratesSourceState>;
    modelMetadata?: { provider?: string; model?: string | null; degraded?: boolean };
    sessionId: string;
    message: SocratesAnswer["message"];
  }>(`/v1/projects/${projectId}/socrates/v1/ask`, {
    method: "POST",
    body: JSON.stringify({
      question,
      sessionId: opts?.sessionId,
      selectedSources,
      includeArtifacts: true,
      mode: "ask"
    }),
    signal: opts?.signal
  });
  return normalizeSocratesAnswer(result, result.message);
};

type SocratesSseEvent = { event: string; data: unknown; id?: string };

export async function consumeSocratesSse(
  response: Response,
  onEvent: (event: SocratesSseEvent) => void,
  signal?: AbortSignal
) {
  if (!response.body) throw new Error("Socrates stream did not include a response body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (frame: string) => {
    if (!frame.trim() || frame.trimStart().startsWith(":")) return;
    let event = "message";
    let id: string | undefined;
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    const raw = data.join("\n");
    let parsed: unknown = raw;
    try { parsed = JSON.parse(raw); } catch { /* Preserve provider-safe text errors. */ }
    onEvent({ event, data: parsed, id });
  };

  while (true) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    frames.forEach(dispatch);
    if (done) break;
  }
  if (buffer.trim()) dispatch(buffer);
}

function normalizeSocratesAnswer(result: any, fallbackMessage: SocratesAnswer["message"]): SocratesAnswer {
  const normalizedArtifact = result?.artifact && typeof result.artifact === "object"
    ? {
        ...result.artifact,
        contentMd: result.artifact.contentMd ?? result.artifact.content_md ?? "",
        sourceRefs: result.artifact.sourceRefs ?? result.artifact.source_refs ?? [],
        generatedAt: result.artifact.generatedAt ?? result.artifact.generated_at ?? ""
      }
    : null;
  return {
    answer_md: result?.answer_md ?? "",
    citations: (result?.citations ?? []).map((citation: any) => ({
      label: citation.label ?? "Source",
      excerpt: citation.excerpt ?? "",
      refId: citation.refId ?? citation.ref_id ?? "",
      sourceType: citation.sourceType ?? citation.source_type ?? "documents",
      id: citation.id,
      evidenceNumber: Number.isInteger(citation.evidenceNumber) && citation.evidenceNumber >= 1 && citation.evidenceNumber <= 10
        ? citation.evidenceNumber : undefined,
      confidence: typeof citation.confidence === "number" ? citation.confidence : undefined,
      openTargetId: citation.openTargetId ?? citation.open_target_id ?? null
    })),
    open_targets: (result?.open_targets ?? result?.openTargets ?? [])
      .map((target: any) => ({
        ...target,
        sourceType: target.sourceType ?? target.source_type,
        targetType: target.targetType ?? target.target_type,
        targetRef: target.targetRef ?? target.target_ref
      }))
      .filter((target: any) => target && typeof target.targetType === "string" && target.targetRef && typeof target.targetRef === "object"),
    suggested_prompts: result?.suggested_prompts ?? [],
    confidence: result?.confidence ?? "medium",
    limitations: Array.isArray(result?.limitations) ? result.limitations.filter((item: unknown): item is string => typeof item === "string") : [],
    artifact: normalizedArtifact,
    sourceStates: (result?.sourceStates ?? result?.source_states) && typeof (result?.sourceStates ?? result?.source_states) === "object" ? (result?.sourceStates ?? result?.source_states) : {},
    modelMetadata: (result?.modelMetadata ?? result?.model_metadata) && typeof (result?.modelMetadata ?? result?.model_metadata) === "object" ? (result?.modelMetadata ?? result?.model_metadata) : {},
    sessionId: result?.sessionId ?? "",
    message: result?.message ?? fallbackMessage
  };
}

export const streamSocratesV1 = async (
  projectId: string,
  question: string,
  sessionId: string | null,
  opts?: { scope?: SocratesScope; signal?: AbortSignal; handlers?: SocratesStreamHandlers }
): Promise<SocratesAnswer> => {
  const selectedSources = !opts?.scope || opts.scope === "All" ? SOCRATES_ALL_SOURCES : SOCRATES_SCOPE_SOURCES[opts.scope];
  let created: SocratesAnswer["message"] | null = null;
  let acceptedAssistantMessageId: string | null = null;
  let acceptedSessionId: string | null = sessionId;
  let accumulated = "";
  let completed: SocratesAnswer | null = null;
  let terminalError: Error | null = null;

  const handleEvent = ({ event, data }: SocratesSseEvent) => {
    const payload = data as any;
    if (event === "message_created") {
      created = {
        sessionId: payload.sessionId,
        userMessageId: payload.userMessageId,
        assistantMessageId: payload.assistantMessageId,
        createdAt: typeof payload.createdAt === "string" ? payload.createdAt : new Date().toISOString()
      };
      acceptedAssistantMessageId = payload.assistantMessageId;
      acceptedSessionId = typeof payload.sessionId === "string" ? payload.sessionId : acceptedSessionId;
      opts?.handlers?.onMessageCreated?.(created);
    } else if (event === "delta") {
      const delta = typeof payload?.text === "string" ? payload.text : "";
      if (delta) {
        accumulated += delta;
        opts?.handlers?.onDelta?.(delta, accumulated);
      }
    } else if (event === "done") {
      completed = normalizeSocratesAnswer(payload, created ?? {
        userMessageId: "",
        assistantMessageId: "",
        createdAt: new Date().toISOString()
      });
    } else if (event === "error") {
      const error = new Error(payload?.message ?? "Socrates streaming failed.");
      error.name = payload?.code === "generation_cancelled" ? "AbortError" : "SocratesStreamError";
      terminalError = error;
    }
  };

  const openInitialStream = async (retryAuth = true): Promise<Response> => {
    const csrf = await ensureCsrfToken();
    const streamPath = sessionId
      ? `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/stream/v1`
      : `/v1/projects/${projectId}/socrates/messages/stream/v1`;
    const response = await fetch(`${API_BASE_URL}${streamPath}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ question, sessionId, selectedSources, includeArtifacts: true, mode: "ask" }),
      signal: opts?.signal
    });
    if (response.status === 401 && retryAuth && await refreshAccessToken()) return openInitialStream(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error?.message ?? `Socrates stream failed: ${response.status}`);
    }
    return response;
  };

  try {
    await consumeSocratesSse(await openInitialStream(), handleEvent, opts?.signal);
  } catch (error) {
    if (opts?.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    if (!created) throw error;
  }
  if (terminalError) throw terminalError;
  if (completed) return completed;
  if (!acceptedAssistantMessageId || !acceptedSessionId) throw new Error("Socrates stream ended before the server accepted the message.");

  const maxReconnects = 2;
  for (let attempt = 1; attempt <= maxReconnects; attempt += 1) {
    opts?.handlers?.onReconnect?.(attempt, maxReconnects);
    try {
      const openResume = async (retryAuth = true): Promise<Response> => {
        const response = await fetch(
          `${API_BASE_URL}/v1/projects/${projectId}/socrates/sessions/${acceptedSessionId}/messages/${acceptedAssistantMessageId}/stream?offset=${encodeURIComponent(String(accumulated.length))}`,
          { credentials: "include", signal: opts?.signal }
        );
        if (response.status === 401 && retryAuth && await refreshAccessToken()) return openResume(false);
        return response;
      };
      const response = await openResume();
      if (!response.ok) throw new Error(`Could not reconnect to Socrates: ${response.status}`);
      await consumeSocratesSse(response, handleEvent, opts?.signal);
      if (terminalError) throw terminalError;
      if (completed) return completed;
    } catch (error) {
      if (opts?.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      if (attempt === maxReconnects) throw error;
    }
  }
  throw new Error("Socrates stream disconnected before the answer completed. Reload this conversation to restore the authoritative result.");
};

export const cancelSocratesV1 = (
  projectId: string,
  sessionId: string,
  assistantMessageId: string
) => apiJson<{ cancelled: boolean; assistantMessageId: string }>(
  `/v1/projects/${projectId}/socrates/sessions/${sessionId}/messages/${assistantMessageId}/cancel`,
  { method: "POST", body: JSON.stringify({}) }
);

export const getDocViewer = async (projectId: string, docId: string): Promise<DocViewerPayload> => {
  return apiJson<DocViewerPayload>(`/v1/projects/${projectId}/documents/${docId}/view`);
};

export const getDocFileBlob = async (projectId: string, docId: string, signal?: AbortSignal): Promise<Blob> => {
  const { blob } = await apiBlob(`/v1/projects/${projectId}/documents/${docId}/file`, { signal });
  return blob;
};

export const getAnchorProvenance = async (
  projectId: string,
  docId: string,
  anchorId: string
): Promise<AnchorProvenance> =>
  apiJson<AnchorProvenance>(`/v1/projects/${projectId}/documents/${docId}/anchors/${anchorId}/provenance`);

export const getIntegrationStatuses = async (projectId: string): Promise<IntegrationStatus[]> => {
  const result = await apiJson<{ connectors?: Array<{ status: string; lastUsedAt: string | null }> }>(
    `/v1/projects/${projectId}/editor-connectors/vscode/status`
  );
  const connectors = result?.connectors ?? [];
  return [{
    id: "vscode",
    name: "VS Code",
    category: "editor",
    connected: connectors.some((connector) => connector.status === "connected"),
    accountConnected: connectors.some((connector) => connector.status === "connected"),
    lastSyncedAt: connectors.find((connector) => connector.lastUsedAt)?.lastUsedAt ?? undefined
  }];
};

export const createVsCodePairing = async (projectId: string) => {
  return apiJson<{ pairingCode: string; expiresAt: string; status: string }>(
    `/v1/projects/${projectId}/editor-connectors/vscode/pairings`,
    {
      method: "POST",
      body: JSON.stringify({ label: "VS Code" })
    }
  );
};

export const revokeVsCodeConnector = async (projectId: string) => {
  return apiJson<{ revoked: number }>(`/v1/projects/${projectId}/editor-connectors/vscode/revoke`, {
    method: "POST",
    body: JSON.stringify({})
  });
};

export const getCommunicationReadiness = async (projectId: string): Promise<CommunicationConnectorReadiness[]> => {
  return apiJson<CommunicationConnectorReadiness[]>(`/v1/projects/${projectId}/connectors/readiness`);
};

export const listCommunicationConnectors = async (projectId: string): Promise<CommunicationConnector[]> => {
  return apiJson<CommunicationConnector[]>(`/v1/projects/${projectId}/connectors`);
};

export const connectSlack = async (projectId: string) => {
  return apiJson<{ connectorId: string; provider: string; status: string; redirectUrl: string | null }>(
    `/v1/projects/${projectId}/connectors/slack/connect`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
};

export const listSlackChannels = async (projectId: string, connectorId: string) => {
  const result = await apiJson<SlackChannel[] | { channels?: SlackChannel[] }>(`/v1/projects/${projectId}/connectors/${connectorId}/channels`);
  return Array.isArray(result) ? result : result?.channels ?? [];
};

export const updateCommunicationConnector = async (
  projectId: string,
  connectorId: string,
  input: { accountLabel?: string; config?: Record<string, unknown> }
) => {
  return apiJson<CommunicationConnector>(`/v1/projects/${projectId}/connectors/${connectorId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
};

export const syncCommunicationConnector = async (projectId: string, connectorId: string) => {
  return apiJson<{ syncRunId: string; connectorId: string; status: string }>(
    `/v1/projects/${projectId}/connectors/${connectorId}/sync`,
    {
      method: "POST",
      body: JSON.stringify({ syncType: "backfill" })
    }
  );
};

export const revokeCommunicationConnector = async (projectId: string, connectorId: string) => {
  return apiJson<CommunicationConnector>(`/v1/projects/${projectId}/connectors/${connectorId}/revoke`, {
    method: "POST",
    body: JSON.stringify({})
  });
};

function normalizeProjectionText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function communicationProjectionKey(thread: CommunicationThreadSummary) {
  const providerUrl = thread.providerOpenTarget?.url?.trim();
  if (providerUrl) return `${thread.provider}:url:${providerUrl}`;
  return [
    thread.provider,
    normalizeProjectionText(thread.subject),
    normalizeProjectionText(thread.latestMessage?.senderLabel),
    normalizeProjectionText(thread.latestMessage?.excerpt)
  ].join(":semantic:");
}

export const getCommunicationThreads = async (projectId: string, search?: string): Promise<CommunicationThreadSummary[]> => {
  const params = new URLSearchParams({ limit: "25" });
  if (search?.trim()) params.set("search", search.trim());
  // The endpoint returns `data` as a bare array; tolerate an `{ items }` envelope too.
  const result = await apiJson<CommunicationThreadSummary[] | { items?: CommunicationThreadSummary[] }>(
    `/v1/projects/${projectId}/threads?${params.toString()}`
  );
  const rows = Array.isArray(result) ? result : result?.items ?? [];
  const seen = new Set<string>();
  return rows.filter((thread) => {
    const sourceKey = communicationProjectionKey(thread);
    if (seen.has(sourceKey)) return false;
    seen.add(sourceKey);
    return true;
  });
};

function toDoc(row: any): Doc {
  row = row ?? {};
  const version = row.currentVersion ?? row.versions?.[0] ?? row.version ?? row ?? {};
  const title = row.title ?? row.name ?? version.title ?? "Uploaded document";
  const fileSize = Number(version.fileSize ?? row.fileSize ?? 0);
  const fileName = version.fileName ?? row.fileName ?? title;
  const externalSource = typeof row.sourceProvider === "string" && !["upload", "manual_upload"].includes(row.sourceProvider);
  const sourceLabel = externalSource ? (row.sourceLabel || row.sourceProvider) : "Uploaded";
  return {
    id: row.id ?? row.documentId,
    name: title,
    type: version.mimeType?.includes("wordprocessingml") ? "srs" : "spec",
    fileName,
    size: fileSize > 0 ? `${(fileSize / 1024 / 1024).toFixed(1)} MB` : sourceLabel,
    pages: version.pageCount ?? 1,
    status: version.status === "failed" ? "failed" : version.status === "ready" ? "ready" : version.status === "partial" ? "partial" : "processing",
    uploadedBy: "Project member",
    uploadedAt: row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "Recently",
    excerpt: row.summary ?? version.parseWarningJson?.summary ?? (externalSource ? `Project memory document from ${sourceLabel}.` : "Uploaded project memory document.")
  };
}

// ─── Deep Research ──────────────────────────────────────────────────────────

export type DeepResearchSourceKey = "github" | "slack" | "calendar" | "docs" | "web";

export interface DeepResearchInput {
  researchFocus: string;
  sources: DeepResearchSourceKey[];
  outputFormat: "Executive Summary" | "Full Report" | "Action Items Only";
  privacyMode: "internal_only" | "internal_plus_web";
  webSearchEnabled: boolean;
}

export interface DeepResearchResults {
  executiveSummary: string;
  findings: { category: string; severity: "HIGH" | "MEDIUM"; title: string; description: string; sources: string }[];
  marketContext: { title: string; body: string }[];
  expansionOpportunities: string[];
  recommendedActions: { priority: "IMMEDIATE" | "THIS WEEK" | "THIS SPRINT"; action: string; source: string }[];
  stats: { totalSources: number; slackMessages: number; commits: number; docs: number; webSources: number; duration: string };
  sources: { provider: string; label: string; kind: "internal" | "web"; href: string; ref?: string; refs?: string[] }[];
}

export interface DeepResearchRun {
  id: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed";
  researchFocus: string;
  sources: DeepResearchSourceKey[];
  outputFormat: string;
  privacyMode: "internal_only" | "internal_plus_web";
  webSearchRequested: boolean;
  webSearchUsed: boolean;
  progress: { percent: number; stage: string };
  results: DeepResearchResults | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DeepResearchUsage {
  used: number;
  limit: number;
  resetLabel: string;
}

export interface ProjectContextEntry {
  id: string;
  projectId: string;
  type: string;
  title: string;
  body: string;
  source: string;
  status: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export const getProjectContextEntry = async (projectId: string, contextId: string) =>
  apiJson<ProjectContextEntry>(`/v1/projects/${projectId}/context/${contextId}`);

export const startDeepResearch = async (projectId: string, input: DeepResearchInput): Promise<DeepResearchRun> => {
  return apiJson<DeepResearchRun>(`/v1/projects/${projectId}/deep-research`, {
    method: "POST",
    body: JSON.stringify(input)
  });
};

export const getDeepResearchRun = async (projectId: string, runId: string): Promise<DeepResearchRun> => {
  return apiJson<DeepResearchRun>(`/v1/projects/${projectId}/deep-research/${runId}`);
};

export const getDeepResearchUsage = async (projectId: string): Promise<DeepResearchUsage> => {
  return apiJson<DeepResearchUsage>(`/v1/projects/${projectId}/deep-research/usage`);
};

export const addDeepResearchToMemory = async (
  projectId: string,
  runId: string
): Promise<{ success: boolean; memoryEntryId: string; createdAt: string; destination: { type: "project_context"; route: string; apiPath: string } }> => {
  return apiJson(`/v1/projects/${projectId}/deep-research/${runId}/add-to-memory`, {
    method: "POST",
    body: JSON.stringify({})
  });
};

export const downloadDeepResearchReport = async (
  projectId: string,
  runId: string,
  format: "pdf" | "markdown" = "pdf",
  signal?: AbortSignal
): Promise<void> => {
  const { blob, filename } = await apiBlob(`/v1/projects/${projectId}/deep-research/${runId}/export?format=${format}`, { signal });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename ?? `deep-research-report.${format === "pdf" ? "pdf" : "md"}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

// ─── Shared mapping helpers ─────────────────────────────────────────────────
const AVATAR_PALETTE = ["#C84A1F", "#2A9D8F", "#7C6FD9", "#E5A663", "#5A8A3A", "#C84A4A"];
function colorForSeed(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}
function initialsFor(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const ini = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return ini.toUpperCase() || "?";
}
// ─── Timeline ───────────────────────────────────────────────────────────────
const TIMELINE_SOURCES = new Set(["manual", "calendar", "slack", "clickup", "granola", "fireflies_ai", "manual_import", "microsoft_teams", "zoho_mail", "zoho_cliq", "zoho_crm", "github", "google_drive", "notion", "socrates", "vscode", "document", "approval", "system"]);
const TIMELINE_TYPES = new Set(["decision", "change", "commit", "message", "note", "milestone", "upload", "approval", "rejection", "connector", "query"]);

function mapTimelineEvent(item: any): TimelineEvent {
  const author = item.author
    ? { name: item.author.name ?? "Unknown", initials: item.author.initials ?? initialsFor(item.author.name ?? ""), color: colorForSeed(item.author.name ?? item.id) }
    : { name: "System", initials: "SY", color: "#8A8378" };
  return {
    id: item.id,
    title: item.title,
    description: item.description ?? "",
    source: (TIMELINE_SOURCES.has(item.source) ? item.source : "system") as TimelineEvent["source"],
    sourceRef: item.sourceRef ?? "",
    author,
    timestamp: item.timestamp,
    tier: item.tier === "milestone" ? "milestone" : "atomic",
    type: (TIMELINE_TYPES.has(item.type) ? item.type : "note") as TimelineEvent["type"],
    status: item.status === "accepted" ? "approved" : item.status === "pending" || item.status === "needs_review" ? "pending" : "approved",
    approvedBy: item.acceptedBy?.name ?? undefined,
    approvedAt: item.acceptedAt ?? undefined,
    diff: Array.isArray(item.diff) ? item.diff.map((d: any) => ({ field: d.field, old: d.old ?? "", new: d.new ?? "" })) : undefined,
    proposalId: item.proposalId ?? null,
    metadataSummary: item.metadataSummary ?? null,
    openTarget: item.openTarget ?? null,
  };
}

export const getProjectTimeline = async (
  projectId: string,
  opts?: { source?: string; status?: string }
): Promise<TimelineEvent[]> => {
  const params = new URLSearchParams({ view: "detailed", limit: "60" });
  if (opts?.source && opts.source !== "all") params.set("source", opts.source);
  if (opts?.status && opts.status !== "all") params.set("status", opts.status);
  const result = await apiJson<{ items: any[] }>(`/v1/projects/${projectId}/timeline?${params.toString()}`);
  return (result.items ?? []).map(mapTimelineEvent);
};

export const createProjectTimelineEvent = async (
  projectId: string,
  input: { title: string; description?: string; source: "manual"; tier?: string; sourceRef?: string }
): Promise<TimelineEvent> => {
  const item = await apiJson<any>(`/v1/projects/${projectId}/timeline/events`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  return mapTimelineEvent(item);
};

export const acceptTimelineProposal = async (projectId: string, proposalId: string): Promise<void> => {
  await apiJson(`/v1/projects/${projectId}/change-proposals/${proposalId}/accept`, { method: "POST", body: JSON.stringify({}) });
};

export const rejectTimelineProposal = async (projectId: string, proposalId: string): Promise<void> => {
  await apiJson(`/v1/projects/${projectId}/change-proposals/${proposalId}/reject`, { method: "POST", body: JSON.stringify({}) });
};

// ─── Settings: integrations ─────────────────────────────────────────────────
// Map every backend provider key to a display kind. Never returns null, so no
// configured integration is silently dropped from the Settings list.
function providerToKind(provider: string): Integration["kind"] {
  const p = (provider ?? "").toLowerCase();
  if (p === "vscode" || p === "editor") return "vscode";
  if (p === "slack") return "slack";
  if (p === "github") return "github";
  if (p === "google_calendar" || p === "calendar") return "calendar";
  if (p === "google_drive" || p === "drive") return "drive";
  if (p === "gmail") return "gmail";
  if (p === "clickup") return "clickup";
  if (p === "granola") return "granola";
  if (p === "fireflies_ai" || p === "fireflies") return "fireflies";
  if (p.startsWith("zoho")) return "zoho";
  if (p === "notion") return "notion";
  if (p === "microsoft_teams" || p === "teams") return "teams";
  return "generic";
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  slack: "Slack", clickup: "ClickUp", granola: "Granola", fireflies_ai: "Fireflies.ai",
  vscode: "VS Code", google_calendar: "Google Calendar", google_drive: "Google Drive",
  gmail: "Gmail invitations",
  github: "GitHub", zoho_mail: "Zoho Mail", zoho_cliq: "Zoho Cliq", zoho_crm: "Zoho CRM",
  microsoft_teams: "Microsoft Teams", notion: "Notion"
};

// Some connectors expose their OAuth start under a hyphenated slug.
const CONNECT_SLUGS: Record<string, string> = {
  google_calendar: "google-calendar",
  google_drive: "google-drive"
};

function safeIntegrationSetupMessage(name: string, input: {
  connected: boolean;
  state?: string;
  reasons?: string[];
  missingConfig?: string[];
  canConnect: boolean;
}) {
  if (input.connected || input.canConnect) return undefined;
  if (input.state === "error" || input.reasons?.includes("connector_error")) {
    return `${name} needs attention. Reconnect it or contact an administrator.`;
  }
  if ((input.missingConfig?.length ?? 0) > 0 || input.state === "readiness_gated" || input.state === "not_configured") {
    return `${name} is not configured by an administrator.`;
  }
  if (input.state === "disabled" || input.reasons?.some((reason) => /disabled/.test(reason))) {
    return `${name} is not enabled for this beta.`;
  }
  return `${name} is currently unavailable.`;
}

function toIntegrationStatus(connected: boolean, canConnect: boolean, state?: string): Integration["status"] {
  if (connected) return "connected";
  if (state === "error") return "needs_attention";
  return canConnect ? "available" : "unavailable";
}

export const getIntegrationsList = async (projectId: string): Promise<Integration[]> => {
    const [statusRes, readiness] = await Promise.all([
      apiJson<{ providers?: any[] }>(`/v1/projects/${projectId}/integrations/status`),
      getCommunicationReadiness(projectId)
    ]);
    const out: Integration[] = [];
    const seen = new Set<string>();
    const statusProviders = Array.isArray(statusRes?.providers) ? statusRes.providers : [];
    const readinessByProvider = new Map(readiness.map((item) => [item.provider, item]));
    for (const p of statusProviders) {
      if (!p?.provider || p.provider === "manual_import" || seen.has(p.provider)) continue;
      seen.add(p.provider);
      const providerReadiness = readinessByProvider.get(p.provider);
      const actions = new Set<string>(Array.isArray(p.availableActions) ? p.availableActions : []);
      const connected = Boolean(p.connected);
      const canConnect = !connected && Boolean(p.capabilities?.canConnect ?? actions.has("connect")) &&
        (providerReadiness?.readiness.canConnect ?? true) &&
        (providerReadiness == null || ["enabled", "revoked"].includes(providerReadiness.readiness.state));
      const canSync = connected && Boolean(p.capabilities?.canSync ?? actions.has("sync")) &&
        (providerReadiness?.readiness.canSync ?? true);
      const canDisconnect = Boolean(
        (providerReadiness?.connectorId && providerReadiness.readiness.canDisconnect) ||
        (connected && (p.capabilities?.canDisconnect ?? (actions.has("disconnect") || actions.has("revoke"))))
      );
      const readinessState = providerReadiness?.readiness.state ?? String(p.status ?? "unknown");
      const reasons = providerReadiness?.readiness.reasons ?? (Array.isArray(p.limitations) ? p.limitations : []);
      const name = p.label ?? PROVIDER_DISPLAY_NAMES[p.provider] ?? p.provider;
      out.push({
        id: p.provider,
        name,
        kind: providerToKind(p.provider),
        description: p.description ?? providerReadiness?.metadata?.description ?? "Project integration — evidence only.",
        status: toIntegrationStatus(connected, canConnect, readinessState),
        connectorId: providerReadiness?.connectorId ?? undefined,
        capabilities: { canConnect, canSync, canDisconnect },
        readiness: {
          state: readinessState,
          reasons,
          deferredFeatures: providerReadiness?.readiness.deferredFeatures ?? [],
        },
        meta: p.connectedAccountLabel ?? undefined,
        disclaimer: safeIntegrationSetupMessage(name, {
          connected,
          state: readinessState,
          reasons,
          missingConfig: providerReadiness?.readiness.missingConfig,
          canConnect,
        })
      });
    }
    // Merge communication connectors that the unified status endpoint doesn't list
    // (Zoho Mail/Cliq/CRM, Microsoft Teams, Notion, etc.).
    for (const r of readiness) {
      if (!r?.provider || r.provider === "manual_import" || seen.has(r.provider)) continue;
      seen.add(r.provider);
      const connected = ["connected", "syncing"].includes(r.connectorStatus ?? "");
      const canConnect = !connected && ["enabled", "revoked"].includes(r.readiness.state) && r.readiness.canConnect;
      const canSync = connected && r.readiness.canSync && Boolean(r.connectorId);
      const canDisconnect = Boolean(r.connectorId) && r.connectorStatus !== "revoked" &&
        (r.readiness.canDisconnect ?? true);
      const name = r.metadata?.label ?? PROVIDER_DISPLAY_NAMES[r.provider] ?? r.provider;
      out.push({
        id: r.provider,
        name,
        kind: providerToKind(r.provider),
        description: r.metadata?.description ?? "Communication evidence connector.",
        status: toIntegrationStatus(connected, canConnect, r.readiness.state),
        connectorId: r.connectorId ?? undefined,
        capabilities: { canConnect, canSync, canDisconnect },
        readiness: {
          state: r.readiness.state,
          reasons: r.readiness.reasons,
          deferredFeatures: r.readiness.deferredFeatures,
        },
        meta: undefined,
        disclaimer: safeIntegrationSetupMessage(name, {
          connected,
          state: r.readiness.state,
          reasons: r.readiness.reasons,
          missingConfig: r.readiness.missingConfig,
          canConnect,
        })
      });
    }
    return out;
};

// Generic OAuth/connect start for a connector by its provider key.
export const connectIntegration = async (projectId: string, provider: string) => {
  if (provider === "manual_import") throw new Error("Manual imports are uploaded from Memory, not connected as a service.");
  if (provider === "github") {
    const result = await apiJson<{ installUrl?: string | null }>("/v1/github/install-url");
    return { authorizationUrl: result.installUrl ?? null };
  }
  const slug = CONNECT_SLUGS[provider] ?? provider;
  return apiJson<{ redirectUrl?: string | null; authorizationUrl?: string | null; status?: string }>(
    `/v1/projects/${projectId}/connectors/${slug}/connect`,
    {
      method: "POST",
      body: JSON.stringify(provider === "gmail"
        ? { returnTo: "/settings#integrations", purpose: "invitation_sender" }
        : { returnTo: "/settings" })
    }
  );
};

function collectGithubRepoLinkIds(status: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const obj = node as Record<string, unknown>;
    for (const key of ["repoLinkId", "repositoryLinkId"]) {
      if (typeof obj[key] === "string") ids.add(obj[key] as string);
    }
    for (const value of Object.values(obj)) visit(value);
  };
  visit(status);
  return [...ids];
}

// Generic disconnect for a connector by its provider key. Routes to the right
// endpoint per connector type (communication revoke, Google slug disconnect,
// GitHub repo-link archive).
export const syncIntegration = async (projectId: string, provider: string, connectorId?: string): Promise<void> => {
  if (provider === "google_calendar") {
    await apiJson(`/v1/projects/${projectId}/connectors/google-calendar/sync`, { method: "POST", body: "{}" });
    return;
  }
  if (provider === "google_drive") {
    await apiJson(`/v1/projects/${projectId}/connectors/google-drive/sync`, { method: "POST", body: JSON.stringify({ syncType: "manual" }) });
    return;
  }
  if (provider === "github") {
    await apiJson(`/v1/projects/${projectId}/github/backfill`, {
      method: "POST",
      body: JSON.stringify({ dryRun: false, mode: "incremental" }),
    });
    return;
  }
  if (!connectorId) throw new Error("This integration does not have an active connection to sync.");
  await syncCommunicationConnector(projectId, connectorId);
};

export const disconnectIntegration = async (projectId: string, provider: string, connectorId?: string): Promise<void> => {
  const p = (provider ?? "").toLowerCase();
  if (p === "google_calendar") {
    await apiJson(`/v1/projects/${projectId}/connectors/google-calendar/disconnect`, { method: "POST", body: "{}" });
    return;
  }
  if (p === "google_drive") {
    await apiJson(`/v1/projects/${projectId}/connectors/google-drive/disconnect`, { method: "POST", body: "{}" });
    return;
  }
  if (p === "github") {
    const status = await apiJson<unknown>(`/v1/projects/${projectId}/github/status`);
    const linkIds = collectGithubRepoLinkIds(status);
    if (linkIds.length === 0) throw new Error("No linked GitHub repository to disconnect.");
    for (const id of linkIds) {
      await apiJson(`/v1/projects/${projectId}/github/repositories/${id}/archive`, { method: "POST", body: "{}" });
    }
    return;
  }
  // Communication connectors (slack, clickup, granola, fireflies_ai, zoho_*, microsoft_teams, notion).
  if (connectorId) {
    await revokeCommunicationConnector(projectId, connectorId);
    return;
  }
  const connectors = await listCommunicationConnectors(projectId);
  const match = connectors.find((c) => c.provider === provider && c.status !== "revoked");
  if (!match) throw new Error("No active connection found to disconnect.");
  await revokeCommunicationConnector(projectId, match.id);
};

// ─── Settings: workspace + members ──────────────────────────────────────────
export const getWorkspace = async (projectId: string): Promise<Workspace> => {
  const s = await apiJson<any>(`/v1/projects/${projectId}/settings`);
  return { id: s.projectId, name: s.name, slug: s.slug, createdAt: s.createdAt, plan: "beta" };
};

export const updateWorkspace = async (projectId: string, input: { name: string }): Promise<Workspace> => {
  const s = await apiJson<any>(`/v1/projects/${projectId}/settings`, {
    method: "PATCH",
    body: JSON.stringify({ name: input.name })
  });
  const workspace = { id: s.projectId, name: s.name, slug: s.slug, createdAt: s.createdAt, plan: "beta" as const };
  useWorkspaceStore.getState().setWorkspaceName(workspace.name);
  return workspace;
};

function mapMember(m: any, currentEmail: string | null): Member {
  const name = m.user?.displayName ?? m.user?.email ?? "Member";
  return {
    id: m.id,
    name,
    email: m.user?.email ?? "",
    initials: initialsFor(name),
    avatarColor: colorForSeed(m.userId ?? m.id),
    role: m.projectRole as MemberRole,
    canApproveTruthChanges: m.projectRole === "manager" || Boolean(m.canApproveTruthChanges),
    status: m.isActive ? "active" : "pending",
    isCurrentUser: Boolean(currentEmail && m.user?.email && m.user.email === currentEmail)
  };
}

export const getMembersList = async (projectId: string): Promise<Member[]> => {
  const currentEmail = useWorkspaceStore.getState().profileEmail ?? null;
  const result = await apiJson<{ members: any[] }>(`/v1/projects/${projectId}/members`);
  return (result.members ?? []).filter((m) => m.isActive !== false).map((m) => mapMember(m, currentEmail));
};

function mapWorkspaceInvite(value: any): WorkspaceInvite {
  const expiresAt = String(value.expiresAt);
  const state: WorkspaceInvite["state"] = value.revokedAt
    ? "revoked"
    : Number(value.useCount ?? 0) >= Number(value.maxUses ?? 1)
      ? "redeemed"
      : new Date(expiresAt).getTime() <= Date.now()
        ? "expired"
        : "pending";
  return {
    id: String(value.id),
    code: typeof value.code === "string" ? value.code : null,
    codePrefix: String(value.codePrefix ?? ""),
    invitedEmail: String(value.invitedEmail ?? ""),
    projectRole: value.projectRole as MemberRole,
    canApproveTruthChanges: Boolean(value.canApproveTruthChanges),
    maxUses: Number(value.maxUses ?? 1),
    useCount: Number(value.useCount ?? 0),
    expiresAt,
    revokedAt: value.revokedAt ?? null,
    createdAt: String(value.createdAt),
    emailDeliveryStatus: String(value.emailDeliveryStatus ?? "pending") as WorkspaceInvite["emailDeliveryStatus"],
    emailDeliveryProvider: value.emailDeliveryProvider ?? null,
    emailSentAt: value.emailSentAt ?? null,
    emailDeliveryError: value.emailDeliveryError ?? null,
    state,
  };
}

export const listWorkspaceInvites = async (projectId: string): Promise<WorkspaceInvite[]> => {
  const result = await apiJson<any[]>(`/v1/projects/${projectId}/join-codes`);
  return result.map(mapWorkspaceInvite);
};

export const inviteMember = async (
  projectId: string,
  email: string,
  role: Member["role"],
  canApproveTruthChanges = false
): Promise<WorkspaceInvite> => {
  const invite = await apiJson<any>(`/v1/projects/${projectId}/join-codes`, {
    method: "POST",
    body: JSON.stringify({ invitedEmail: email, projectRole: role, canApproveTruthChanges })
  });
  return mapWorkspaceInvite(invite);
};

export const updateMemberRole = async (projectId: string, memberId: string, role: Member["role"]): Promise<Member> => {
  const m = await apiJson<any>(`/v1/projects/${projectId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify({ projectRole: role })
  });
  return mapMember(m, useWorkspaceStore.getState().profileEmail ?? null);
};

export const removeMember = async (projectId: string, memberId: string): Promise<void> => {
  await apiJson(`/v1/projects/${projectId}/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify({ isActive: false })
  });
};

export const setTruthApprover = async (projectId: string, memberId: string, enabled: boolean): Promise<Member> => {
  const m = enabled
    ? await apiJson<any>(`/v1/projects/${projectId}/truth-approvers`, {
        method: "POST",
        body: JSON.stringify({ memberId })
      })
    : await apiJson<any>(`/v1/projects/${projectId}/truth-approvers/${memberId}`, { method: "DELETE" });
  return mapMember(m, useWorkspaceStore.getState().profileEmail ?? null);
};

export const revokeWorkspaceInvite = async (projectId: string, inviteId: string): Promise<void> => {
  await apiJson(`/v1/projects/${projectId}/join-codes/${inviteId}/revoke`, { method: "POST", body: "{}" });
};

// ─── Settings: account (profile / sessions / linked) ────────────────────────
export const getProfile = async (): Promise<User> => {
  const p = await apiJson<any>(`/v1/me/profile`);
  const name = p.displayName ?? p.email ?? "You";
  return {
    id: p.userId,
    name,
    email: p.email,
    emailVerified: Boolean(p.emailVerified),
    emailVerifiedAt: p.emailVerifiedAt ?? null,
    avatarUrl: p.avatarUrl ?? undefined,
    initials: initialsFor(name),
    avatarColor: colorForSeed(p.userId ?? name),
    role: p.globalRole === "owner" || p.globalRole === "admin" ? "admin" : "member",
    title: undefined,
    timezone: p.timezone ?? "—",
    bio: undefined,
    updatedAt: p.createdAt ?? new Date().toISOString(),
    joinedAt: p.createdAt ?? new Date().toISOString()
  };
};

export const updateProfile = async (input: { displayName?: string; timezone?: string | null }): Promise<User> => {
  await apiJson(`/v1/me/profile`, { method: "PATCH", body: JSON.stringify(input) });
  return getProfile();
};

export const getSessions = async (): Promise<Session[]> => {
  const rows = await apiJson<any[]>(`/v1/me/sessions`);
  const list = Array.isArray(rows) ? rows : (rows as { items?: unknown[] })?.items ?? [];
  return list.filter(Boolean).map((s: any): Session => {
    const lastUsed = s.lastUsedAt ? new Date(s.lastUsedAt) : null;
    return {
      id: s.id,
      device: s.deviceLabel ?? "Browser session",
      deviceType: s.deviceType ?? "browser",
      location: s.ipLabel ?? "Network unavailable",
      lastActiveAt: s.current ? "Active now" : lastUsed && !Number.isNaN(lastUsed.getTime()) ? lastUsed.toLocaleString() : "Unknown",
      isCurrent: Boolean(s.current),
      organizationName: s.organization?.name ?? null,
      expiresAt: s.expiresAt ?? null,
      status: s.status ?? "active"
    };
  });
};

export const revokeUserSession = async (sessionId: string): Promise<void> => {
  await apiJson(`/v1/me/sessions/${sessionId}`, { method: "DELETE" });
};

export const revokeAllOtherSessions = async (): Promise<void> => {
  await apiJson(`/v1/me/sessions/revoke-all`, { method: "POST", body: JSON.stringify({ includeCurrent: false }) });
};

export const getAppearancePreference = async (): Promise<{ theme: "light" | "dark" | "auto"; updatedAt: string }> =>
  apiJson(`/v1/me/appearance-preference`);

export const updateAppearancePreference = async (theme: "light" | "dark" | "auto"): Promise<{ theme: "light" | "dark" | "auto"; updatedAt: string }> =>
  apiJson(`/v1/me/appearance-preference`, { method: "PATCH", body: JSON.stringify({ theme }) });

export const getLinkedAccounts = async (): Promise<LinkedAccount[]> => {
  const rows = await apiJson<any[]>(`/v1/me/linked-accounts`);
  return rows.flatMap((row): LinkedAccount[] => {
    if (row.service !== "google" && row.service !== "github" && row.service !== "microsoft") return [];
    return [{
      id: String(row.id),
      service: row.service,
      connected: Boolean(row.connected),
      accountIdentifier: typeof row.accountIdentifier === "string" && row.accountIdentifier ? row.accountIdentifier : undefined,
      status: String(row.status ?? (row.connected ? "connected" : "unknown")),
      linkedAt: String(row.linkedAt),
      sources: Array.isArray(row.sources) ? row.sources.filter((source: unknown): source is string => typeof source === "string") : []
    }];
  });
};
