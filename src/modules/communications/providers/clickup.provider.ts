import { createHmac, timingSafeEqual } from "node:crypto";
import type { CommunicationConnector, CommunicationSyncType } from "@prisma/client";
import type { AppEnv } from "../../../config/env.js";
import { AppError } from "../../../app/errors.js";
import type {
  NormalizedCommunicationBatch,
  NormalizedMessage,
  NormalizedParticipant,
  NormalizedThread
} from "../../../lib/communications/provider-normalized-types.js";
import {
  evaluateSelectedResourceAccess,
  selectedScopesFromIds,
  type SelectedResourceScope
} from "../../../lib/communications/selected-resource-gate.js";
import type {
  CommunicationProviderAdapter,
  ProviderCallbackResult,
  ProviderChannel,
  ProviderConnectResult,
  ProviderSyncResult,
  ProviderWebhookRegistrationResult,
  ProviderWebhookVerificationResult
} from "./provider.interface.js";

type FetchLike = typeof fetch;

type ClickUpCredential = {
  accessToken?: string;
  teams?: Array<{ id: string; name?: string | null }>;
  webhookSecrets?: Record<string, string>;
};

type ClickUpTask = Record<string, any>;
type ClickUpComment = Record<string, any>;
type ClickUpHistoryItem = Record<string, any>;
type ClickUpWebhookScope = { type: "task" | "list" | "folder" | "space"; id: string };

const SUPPORTED_WEBHOOK_EVENTS = new Set([
  "taskCreated",
  "taskUpdated",
  "taskDeleted",
  "taskPriorityUpdated",
  "taskStatusUpdated",
  "taskAssigneeUpdated",
  "taskDueDateUpdated",
  "taskMoved",
  "taskCommentPosted",
  "taskCommentUpdated"
]);

export class ClickUpProvider implements CommunicationProviderAdapter {
  readonly provider = "clickup" as const;

  constructor(
    private readonly env: AppEnv,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async connect(input: { projectId: string; actorUserId: string; oauthState?: string }): Promise<ProviderConnectResult> {
    if (!this.env.CLICKUP_CLIENT_ID || !this.env.CLICKUP_CLIENT_SECRET || !this.env.CLICKUP_REDIRECT_URI) {
      throw new AppError(503, "ClickUp OAuth is not configured", "clickup_oauth_not_configured");
    }
    if (!input.oauthState) {
      throw new AppError(400, "ClickUp OAuth state is required", "clickup_oauth_state_required");
    }

    const url = new URL("https://app.clickup.com/api");
    url.searchParams.set("client_id", this.env.CLICKUP_CLIENT_ID);
    url.searchParams.set("redirect_uri", this.env.CLICKUP_REDIRECT_URI);
    url.searchParams.set("state", input.oauthState);

    return {
      mode: "oauth_pending",
      status: "pending_auth",
      redirectUrl: url.toString(),
      accountLabel: "ClickUp",
      config: this.defaultConfig()
    };
  }

  async handleOAuthCallback(input: { code: string; redirectUri: string }): Promise<ProviderCallbackResult> {
    const body = new URLSearchParams({
      client_id: this.env.CLICKUP_CLIENT_ID ?? "",
      client_secret: this.env.CLICKUP_CLIENT_SECRET ?? "",
      code: input.code
    });

    const tokenPayload = await this.requestJson("https://api.clickup.com/api/v2/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const accessToken = this.asString(tokenPayload.access_token);
    if (!accessToken) {
      throw new AppError(502, "ClickUp OAuth callback failed", "clickup_oauth_failed");
    }

    const teamsPayload = await this.clickupRequest(accessToken, "/team");
    const teams = Array.isArray(teamsPayload.teams)
      ? teamsPayload.teams.map((team: any) => ({ id: String(team.id), name: this.asString(team.name) }))
      : [];
    const primaryTeam = teams[0] ?? null;

    return {
      accountLabel: primaryTeam?.name ? `ClickUp: ${primaryTeam.name}` : "ClickUp",
      credential: {
        accessToken,
        teams,
        webhookSecrets: {}
      },
      providerCursor: {
        teams,
        tasks: {},
        lists: {}
      },
      configPatch: {
        ...this.defaultConfig(),
        teamId: primaryTeam?.id ?? null,
        workspaceId: primaryTeam?.id ?? null,
        teams
      }
    };
  }

  async listChannels(input: { credential: Record<string, unknown> | null }): Promise<ProviderChannel[]> {
    const credential = this.requireCredential(input.credential);
    const teamsPayload = await this.clickupRequest(credential.accessToken, "/team");
    const teams = Array.isArray(teamsPayload.teams) ? teamsPayload.teams : [];
    const channels: ProviderChannel[] = [];

    for (const team of teams) {
      channels.push({
        id: `team:${team.id}`,
        name: this.asString(team.name) ?? `Workspace ${team.id}`,
        isPrivate: false,
        isArchived: false
      });
      const spacesPayload = await this.clickupRequest(credential.accessToken, `/team/${encodeURIComponent(String(team.id))}/space?archived=false`);
      for (const space of Array.isArray(spacesPayload.spaces) ? spacesPayload.spaces : []) {
        channels.push({ id: `space:${space.id}`, name: this.asString(space.name) ?? `Space ${space.id}`, isPrivate: Boolean(space.private), isArchived: Boolean(space.archived) });
        const listsPayload = await this.clickupRequest(credential.accessToken, `/space/${encodeURIComponent(String(space.id))}/list?archived=false`);
        for (const list of Array.isArray(listsPayload.lists) ? listsPayload.lists : []) {
          channels.push({ id: `list:${list.id}`, name: this.asString(list.name) ?? `List ${list.id}`, isPrivate: false, isArchived: Boolean(list.archived) });
        }
        const foldersPayload = await this.clickupRequest(credential.accessToken, `/space/${encodeURIComponent(String(space.id))}/folder?archived=false`);
        for (const folder of Array.isArray(foldersPayload.folders) ? foldersPayload.folders : []) {
          channels.push({ id: `folder:${folder.id}`, name: this.asString(folder.name) ?? `Folder ${folder.id}`, isPrivate: false, isArchived: Boolean(folder.archived) });
          const folderListsPayload = await this.clickupRequest(credential.accessToken, `/folder/${encodeURIComponent(String(folder.id))}/list?archived=false`);
          const folderLists = Array.isArray(folderListsPayload.lists) ? folderListsPayload.lists : Array.isArray(folder.lists) ? folder.lists : [];
          for (const list of folderLists) {
            channels.push({ id: `list:${list.id}`, name: this.asString(list.name) ?? `List ${list.id}`, isPrivate: false, isArchived: Boolean(list.archived) });
          }
        }
      }
    }

    return channels;
  }

  async sync(input: {
    projectId: string;
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    syncType: CommunicationSyncType;
    webhookPayload?: Record<string, unknown>;
    batchSize: number;
    maxBackfillDays: number;
  }): Promise<ProviderSyncResult> {
    const credential = this.requireCredential(input.credential);
    const config = this.connectorConfig(input.connector.configJson);
    const taskIds = await this.resolveTaskIds(credential.accessToken, config, input.batchSize);
    const threads: NormalizedThread[] = [];
    const messages: NormalizedMessage[] = [];
    const deletedProviderMessageIds: string[] = [];

    for (const taskId of taskIds.slice(0, config.maxTasksPerSync ?? input.batchSize)) {
      const task = await this.fetchTask(credential.accessToken, taskId);
      const normalized = this.normalizeTask(task, config);
      threads.push(normalized.thread);
      messages.push(...normalized.messages);

      if (config.syncTaskComments !== false) {
        messages.push(...(await this.fetchAndNormalizeComments(credential.accessToken, task, config)));
      }
    }

    const webhookEvents = this.normalizeWebhookPayload(input.webhookPayload, config);
    for (const event of webhookEvents.threads) {
      if (!threads.some((thread) => thread.providerThreadId === event.providerThreadId)) {
        threads.push(event);
      }
    }
    messages.push(...webhookEvents.messages);
    deletedProviderMessageIds.push(...webhookEvents.deletedProviderMessageIds);

    if (threads.length === 0 && input.webhookPayload) {
      const taskId = this.asString(input.webhookPayload.task_id ?? input.webhookPayload.taskId ?? input.webhookPayload.resource_id);
      if (taskId) {
        threads.push(this.minimalThread(taskId, input.webhookPayload));
      }
    }

    return {
      queued: false,
      batches:
        threads.length > 0
          ? [
              {
                projectId: input.projectId,
                connectorId: input.connector.id,
                provider: this.provider,
                threads,
                messages
              }
            ]
          : [],
      cursorAfter: {
        ...((input.connector.providerCursorJson as Record<string, unknown> | null) ?? {}),
        lastSyncedAt: new Date().toISOString(),
        tasks: Object.fromEntries(taskIds.map((taskId) => [taskId, new Date().toISOString()]))
      },
      deletedProviderMessageIds,
      summary: {
        taskCount: threads.length,
        messageCount: messages.length,
        providerMode: "read_only",
        writesEnabled: false
      },
      status: "completed"
    };
  }

  async registerWebhook(input: {
    connector: CommunicationConnector;
    credential: Record<string, unknown> | null;
    endpointUrl: string;
  }): Promise<ProviderWebhookRegistrationResult> {
    if (!this.env.CLICKUP_WEBHOOKS_ENABLED) {
      throw new AppError(503, "ClickUp webhooks are disabled", "clickup_webhooks_disabled");
    }
    const credential = this.requireCredential(input.credential);
    const config = this.connectorConfig(input.connector.configJson);
    const teamId = config.teamId ?? credential.teams?.[0]?.id;
    if (!teamId) {
      throw new AppError(422, "ClickUp webhook registration requires a selected workspace/team", "clickup_team_required");
    }
    const requestedScope = this.webhookScopeForConfig(config);
    if (!requestedScope) {
      throw new AppError(
        422,
        "ClickUp webhook registration requires at least one selected task, list, folder, or space",
        "clickup_webhook_selected_scope_required"
      );
    }
    const existingWebhookId = config.webhookIds?.find((id) => {
      if (!(credential.webhookSecrets?.[id] || this.env.CLICKUP_WEBHOOK_SECRET)) return false;
      return this.webhookScopeMatchesConfig(config.webhookScopes?.[id], config);
    });
    if (existingWebhookId) {
      return {
        webhookId: existingWebhookId,
        configPatch: {
          webhookIds: config.webhookIds ?? [existingWebhookId],
          webhookEvents: Array.from(SUPPORTED_WEBHOOK_EVENTS),
          webhookScopes: {
            ...(config.webhookScopes ?? {}),
            ...(requestedScope ? { [existingWebhookId]: requestedScope } : {})
          }
        }
      };
    }
    const payload: Record<string, unknown> = {
      endpoint: input.endpointUrl,
      events: Array.from(SUPPORTED_WEBHOOK_EVENTS)
    };
    if (config.spaceIds?.[0]) payload.space_id = config.spaceIds[0];
    if (config.folderIds?.[0]) payload.folder_id = config.folderIds[0];
    if (config.listIds?.[0]) payload.list_id = config.listIds[0];
    if (config.taskIds?.[0]) payload.task_id = config.taskIds[0];

    const response = await this.clickupRequest(credential.accessToken, `/team/${encodeURIComponent(teamId)}/webhook`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const webhookId = this.asString(response.id ?? response.webhook?.id);
    const webhookSecret = this.asString(response.secret ?? response.webhook?.secret);
    if (!webhookId) {
      throw new AppError(502, "ClickUp webhook registration did not return an id", "clickup_webhook_registration_failed");
    }

    return {
      webhookId,
      webhookSecret,
      configPatch: {
        webhookIds: Array.from(new Set([...(config.webhookIds ?? []), webhookId])),
        webhookEvents: Array.from(SUPPORTED_WEBHOOK_EVENTS),
        webhookScopes: {
          ...(config.webhookScopes ?? {}),
          ...(requestedScope ? { [webhookId]: requestedScope } : {})
        }
      },
      updatedCredential: {
        ...credential,
        webhookSecrets: {
          ...(credential.webhookSecrets ?? {}),
          ...(webhookSecret ? { [webhookId]: webhookSecret } : {})
        }
      }
    };
  }

  async verifyWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
    body: unknown;
    connectors: CommunicationConnector[];
    credentialsByConnectorId?: Record<string, Record<string, unknown> | null>;
  }): Promise<ProviderWebhookVerificationResult> {
    if (!input.rawBody) {
      throw new AppError(401, "ClickUp webhook raw body is required for signature verification", "clickup_webhook_raw_body_missing");
    }
    const body = this.objectBody(input.body);
    const webhookId = this.asString(body.webhook_id);
    if (!webhookId) {
      throw new AppError(422, "ClickUp webhook id is required", "clickup_webhook_id_required");
    }
    const connector = input.connectors.find((item) => {
      const config = this.connectorConfig(item.configJson);
      return config.webhookIds?.includes(webhookId);
    });
    if (!connector) {
      throw new AppError(404, "ClickUp webhook id is not recognized", "clickup_webhook_unknown");
    }
    const config = this.connectorConfig(connector.configJson);
    const credential = input.credentialsByConnectorId?.[connector.id] as ClickUpCredential | null | undefined;
    const secret =
      credential?.webhookSecrets?.[webhookId] ??
      (this.env.CLICKUP_WEBHOOK_SECRET_STORAGE_MODE === "env_fallback" ? this.env.CLICKUP_WEBHOOK_SECRET : undefined);
    if (!secret) {
      throw new AppError(503, "ClickUp webhook secret is not configured", "clickup_webhook_secret_missing");
    }
    const signature = this.header(input.headers, "x-signature") ?? this.header(input.headers, "x-clickup-signature");
    if (!signature || !this.verifySignature(input.rawBody, secret, signature)) {
      throw new AppError(401, "ClickUp webhook signature is invalid", "clickup_webhook_signature_invalid");
    }

    const eventType = this.asString(body.event) ?? "clickup_webhook";
    if (!SUPPORTED_WEBHOOK_EVENTS.has(eventType)) {
      return {
        providerEventId: `${webhookId}:${eventType}:${this.asString(body.task_id ?? body.resource_id) ?? "unknown"}`,
        eventType,
        connectorIds: [],
        jobPayload: { ignored: true, reason: "unsupported_clickup_event" }
      };
    }
    const historyId = Array.isArray(body.history_items) ? this.asString(body.history_items[0]?.id) : null;
    const resourceId = this.asString(body.task_id ?? body.resource_id ?? body.id) ?? "unknown";
    const providerEventId = historyId ? `${webhookId}:${historyId}` : `${webhookId}:${eventType}:${resourceId}`;
    if (!this.isWebhookResourceSelected(body, config, webhookId)) {
      return {
        providerEventId,
        eventType,
        connectorIds: [],
        jobPayload: { ignored: true, reason: "clickup_resource_not_selected" },
        projectIdHints: [connector.projectId]
      };
    }
    return {
      providerEventId,
      eventType,
      connectorIds: [connector.id],
      jobPayload: {
        clickupWebhookPayload: this.safeWebhookJobPayload(body),
        providerEventId
      },
      projectIdHints: [connector.projectId]
    };
  }

  private safeWebhookJobPayload(body: Record<string, unknown>) {
    const historyItems = Array.isArray(body.history_items) ? body.history_items : [];
    return {
      webhook_id: this.asString(body.webhook_id),
      event: this.asString(body.event),
      task_id: this.asString(body.task_id),
      task_name: this.asString(body.task_name)?.slice(0, 300),
      resource_id: this.asString(body.resource_id),
      id: this.asString(body.id),
      history_items: historyItems.slice(0, 10).map((item) => {
        const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          id: this.asString(record.id),
          date: this.asString(record.date),
          field: this.asString(record.field),
          before: this.safeValue(record.before),
          after: this.safeValue(record.after)
        };
      })
    };
  }

  private async resolveTaskIds(accessToken: string, config: ReturnType<ClickUpProvider["connectorConfig"]>, batchSize: number) {
    const directTaskIds = config.taskIds ?? [];
    const taskIds = new Set(directTaskIds);
    for (const listId of config.listIds ?? []) {
      let page = 0;
      while (taskIds.size < (config.maxTasksPerSync ?? batchSize)) {
        const payload = await this.clickupRequest(
          accessToken,
          `/list/${encodeURIComponent(listId)}/task?include_closed=${config.includeClosedTasks === true ? "true" : "false"}&page=${page}`
        );
        const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
        for (const task of tasks) {
          const id = this.asString(task.id);
          if (id) taskIds.add(id);
        }
        if (tasks.length === 0 || payload.last_page === true) break;
        page += 1;
      }
    }
    return Array.from(taskIds).slice(0, config.maxTasksPerSync ?? batchSize);
  }

  private async fetchTask(accessToken: string, taskId: string) {
    return this.clickupRequest(accessToken, `/task/${encodeURIComponent(taskId)}?include_markdown_description=true`);
  }

  private async fetchAndNormalizeComments(accessToken: string, task: ClickUpTask, config: ReturnType<ClickUpProvider["connectorConfig"]>) {
    const taskId = String(task.id);
    const messages: NormalizedMessage[] = [];
    let start: string | null = null;
    let startId: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const suffix = start && startId ? `?start=${encodeURIComponent(start)}&start_id=${encodeURIComponent(startId)}` : "";
      const payload = await this.clickupRequest(accessToken, `/task/${encodeURIComponent(taskId)}/comment${suffix}`);
      const comments = Array.isArray(payload.comments) ? payload.comments : [];
      for (const comment of comments) {
        const normalized = this.normalizeComment(task, comment, config);
        if (normalized) messages.push(normalized);
      }
      const next = comments.at(-1);
      if (!next?.date || !next?.id || comments.length === 0) break;
      start = String(next.date);
      startId = String(next.id);
      if (!payload.has_more) break;
    }
    return messages;
  }

  private normalizeTask(task: ClickUpTask, config: ReturnType<ClickUpProvider["connectorConfig"]>) {
    const taskId = String(task.id);
    const participants = this.participants([task.creator, ...(Array.isArray(task.assignees) ? task.assignees : [])]);
    const createdAt = this.fromClickUpDate(task.date_created ?? task.start_date) ?? new Date();
    const updatedAt = this.fromClickUpDate(task.date_updated) ?? createdAt;
    const thread: NormalizedThread = {
      providerThreadId: `task:${taskId}`,
      subject: this.bound(this.asString(task.name) ?? `ClickUp task ${taskId}`, 240),
      participants,
      startedAt: createdAt,
      lastMessageAt: updatedAt,
      threadUrl: this.asString(task.url),
      rawMetadata: this.taskMetadata(task)
    };
    const messages: NormalizedMessage[] = [];
    const description = this.bound(this.asString(task.markdown_description ?? task.text_content ?? task.description) ?? "", 20_000);
    if (config.syncTaskDescriptions !== false && description.trim()) {
      messages.push({
        providerThreadId: thread.providerThreadId,
        providerMessageId: `task:${taskId}:description`,
        senderLabel: this.userLabel(task.creator) ?? "ClickUp",
        senderExternalRef: this.userExternalRef(task.creator),
        sentAt: createdAt,
        bodyText: description,
        messageType: "note",
        providerPermalink: this.asString(task.url),
        rawMetadata: { sourceSubType: "task_description", ...this.taskMetadata(task) }
      });
    }
    if (Array.isArray(task.history_items)) {
      for (const item of task.history_items) {
        const event = this.normalizeHistoryItem(task, item, config);
        if (event) messages.push(event);
      }
    }
    return { thread, messages };
  }

  private normalizeComment(task: ClickUpTask, comment: ClickUpComment, _config: ReturnType<ClickUpProvider["connectorConfig"]>) {
    const commentId = this.asString(comment.id);
    if (!commentId) return null;
    const taskId = String(task.id);
    const body = this.bound(this.asString(comment.comment_text ?? comment.text_content ?? comment.text) ?? "", 20_000);
    return {
      providerThreadId: `task:${taskId}`,
      providerMessageId: `task:${taskId}:comment:${commentId}`,
      senderLabel: this.userLabel(comment.user) ?? "ClickUp user",
      senderExternalRef: this.userExternalRef(comment.user),
      senderEmail: this.asString(comment.user?.email),
      sentAt: this.fromClickUpDate(comment.date) ?? new Date(),
      bodyText: body,
      messageType: "user" as const,
      providerPermalink: this.asString(task.url),
      rawMetadata: {
        sourceSubType: "task_comment",
        taskId,
        commentId,
        resolved: comment.resolved ?? null
      }
    };
  }

  private normalizeHistoryItem(task: ClickUpTask, item: ClickUpHistoryItem, config: ReturnType<ClickUpProvider["connectorConfig"]>) {
    const historyId = this.asString(item.id);
    if (!historyId) return null;
    const taskId = String(task.id);
    const field = this.asString(item.field ?? item.type) ?? "task";
    if (!this.shouldSyncHistoryField(field, config)) return null;
    return {
      providerThreadId: `task:${taskId}`,
      providerMessageId: `task:${taskId}:history:${historyId}`,
      senderLabel: this.userLabel(item.user) ?? "ClickUp",
      senderExternalRef: this.userExternalRef(item.user),
      sentAt: this.fromClickUpDate(item.date) ?? new Date(),
      bodyText: this.historySummary(field, item.before, item.after),
      messageType: "system" as const,
      providerPermalink: this.asString(task.url),
      rawMetadata: {
        sourceSubType: this.historySubType(field),
        taskId,
        historyItemId: historyId,
        before: this.safeValue(item.before),
        after: this.safeValue(item.after)
      }
    };
  }

  private normalizeWebhookPayload(webhookPayload: Record<string, unknown> | undefined, config: ReturnType<ClickUpProvider["connectorConfig"]>) {
    const messages: NormalizedMessage[] = [];
    const threads: NormalizedThread[] = [];
    const deletedProviderMessageIds: string[] = [];
    const payload = webhookPayload?.clickupWebhookPayload as Record<string, any> | undefined;
    if (!payload) return { messages, threads, deletedProviderMessageIds };
    if (!this.isWebhookResourceSelected(payload, config, this.asString(payload.webhook_id))) {
      return { messages, threads, deletedProviderMessageIds };
    }
    const taskId = this.asString(payload.task_id ?? payload.taskId ?? payload.resource_id);
    if (!taskId) return { messages, threads, deletedProviderMessageIds };
    threads.push(this.minimalThread(taskId, payload));
    for (const item of Array.isArray(payload.history_items) ? payload.history_items : []) {
      const normalized = this.normalizeHistoryItem({ id: taskId, name: `ClickUp task ${taskId}` }, item, config);
      if (normalized) messages.push(normalized);
    }
    if (payload.event === "taskDeleted") {
      const firstHistoryItem = Array.isArray(payload.history_items) ? payload.history_items[0] : null;
      const deletionEventId =
        this.asString(firstHistoryItem?.id) ??
        this.asString(webhookPayload?.providerEventId) ??
        this.asString(payload.webhook_id) ??
        `${payload.event}:${taskId}`;
      const sentAt = this.fromClickUpDate(firstHistoryItem?.date) ?? new Date();
      messages.push({
        providerThreadId: `task:${taskId}`,
        providerMessageId: `task:${taskId}:history:${deletionEventId}`,
        senderLabel: "ClickUp",
        sentAt,
        bodyText: `Task ${taskId} was deleted or became unavailable in ClickUp.`,
        messageType: "system",
        rawMetadata: { sourceSubType: "task_deleted", taskId, unavailable: true, deletionEventId }
      });
    }
    return { messages, threads, deletedProviderMessageIds };
  }

  private minimalThread(taskId: string, payload: Record<string, unknown>): NormalizedThread {
    return {
      providerThreadId: `task:${taskId}`,
      subject: this.asString(payload.task_name) ?? `ClickUp task ${taskId}`,
      participants: [],
      rawMetadata: { taskId, source: "clickup_webhook", event: payload.event ?? null }
    };
  }

  private async clickupRequest(accessToken: string | undefined, path: string, init: RequestInit = {}) {
    if (!accessToken) {
      throw new AppError(401, "ClickUp credential is missing", "clickup_credential_missing");
    }
    const url = path.startsWith("http") ? path : `${this.env.CLICKUP_API_BASE_URL}${path}`;
    return this.requestJson(url, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });
  }

  private async requestJson(input: string, init: RequestInit = {}) {
    const response = await this.fetchImpl(input, init);
    if (response.status === 429) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      const retryAfter = Number(response.headers.get("retry-after"));
      const limit = Number(response.headers.get("x-ratelimit-limit"));
      const remaining = Number(response.headers.get("x-ratelimit-remaining"));
      const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Number.isFinite(reset) && reset > 0
          ? Math.max(1000, reset * 1000 - Date.now())
          : 1000;
      throw new AppError(429, "ClickUp rate limit reached", "communication_provider_rate_limited", {
        retryAfterMs,
        ...(Number.isFinite(limit) ? { limit } : {}),
        ...(Number.isFinite(remaining) ? { remaining } : {}),
        ...(Number.isFinite(reset) ? { reset } : {})
      });
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok) {
      throw new AppError(response.status, "ClickUp API request failed", "clickup_api_error", {
        provider: "clickup",
        statusCode: response.status
      });
    }
    return payload;
  }

  private requireCredential(credential: Record<string, unknown> | null): ClickUpCredential & { accessToken: string } {
    if (!credential || typeof credential.accessToken !== "string" || credential.accessToken.length === 0) {
      throw new AppError(401, "ClickUp credential is missing", "clickup_credential_missing");
    }
    return credential as ClickUpCredential & { accessToken: string };
  }

  private defaultConfig() {
    return {
      teamId: null,
      workspaceId: null,
      spaceIds: [],
      folderIds: [],
      listIds: [],
      taskIds: [],
      syncTaskDescriptions: this.env.CLICKUP_SYNC_TASK_DESCRIPTIONS_DEFAULT,
      syncTaskComments: this.env.CLICKUP_SYNC_TASK_COMMENTS_DEFAULT,
      syncStatusChanges: this.env.CLICKUP_SYNC_STATUS_CHANGES_DEFAULT,
      syncAssigneeChanges: this.env.CLICKUP_SYNC_ASSIGNEE_CHANGES_DEFAULT,
      syncDueDateChanges: this.env.CLICKUP_SYNC_DUE_DATE_CHANGES_DEFAULT,
      syncPriorityChanges: this.env.CLICKUP_SYNC_PRIORITY_CHANGES_DEFAULT,
      syncMovedEvents: this.env.CLICKUP_SYNC_MOVED_EVENTS_DEFAULT,
      includeClosedTasks: this.env.CLICKUP_INCLUDE_CLOSED_TASKS_DEFAULT,
      includeAttachments: this.env.CLICKUP_ATTACHMENT_INGESTION_ENABLED,
      syncAllWorkspace: false,
      writeActionsEnabled: false,
      backfillDays: Math.min(this.env.CLICKUP_MAX_BACKFILL_DAYS, this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS),
      maxTasksPerSync: this.env.CLICKUP_MAX_TASKS_PER_SYNC,
      webhookIds: [],
      webhookScopes: {} as Record<string, ClickUpWebhookScope>
    };
  }

  private connectorConfig(value: unknown) {
    const raw = (value ?? {}) as Record<string, any>;
    const defaults = this.defaultConfig();
    return {
      ...defaults,
      ...raw,
      teamId: this.asString(raw.teamId ?? raw.workspaceId) ?? undefined,
      taskIds: this.stringArray(raw.taskIds),
      listIds: this.stringArray(raw.listIds),
      folderIds: this.stringArray(raw.folderIds),
      spaceIds: this.stringArray(raw.spaceIds),
      webhookIds: this.stringArray(raw.webhookIds),
      webhookScopes: this.webhookScopes(raw.webhookScopes),
      maxTasksPerSync: typeof raw.maxTasksPerSync === "number" ? Math.min(raw.maxTasksPerSync, this.env.CLICKUP_MAX_TASKS_PER_SYNC) : defaults.maxTasksPerSync
    };
  }

  private hasSelectedResourceScope(config: ReturnType<ClickUpProvider["connectorConfig"]>) {
    return this.selectedClickUpScopes(config).length > 0;
  }

  private isWebhookResourceSelected(body: Record<string, unknown>, config: ReturnType<ClickUpProvider["connectorConfig"]>, webhookId?: string | null) {
    return evaluateSelectedResourceAccess({
      selected: this.selectedClickUpScopes(config),
      candidates: this.webhookCandidateScopes(body),
      fallbackScope: webhookId ? config.webhookScopes?.[webhookId] ?? null : null
    }).allowed;
  }

  private webhookScopeForConfig(config: ReturnType<ClickUpProvider["connectorConfig"]>): ClickUpWebhookScope | null {
    if (config.taskIds[0]) return { type: "task", id: config.taskIds[0] };
    if (config.listIds[0]) return { type: "list", id: config.listIds[0] };
    if (config.folderIds[0]) return { type: "folder", id: config.folderIds[0] };
    if (config.spaceIds[0]) return { type: "space", id: config.spaceIds[0] };
    return null;
  }

  private webhookScopeMatchesConfig(scope: ClickUpWebhookScope | undefined, config: ReturnType<ClickUpProvider["connectorConfig"]>) {
    return evaluateSelectedResourceAccess({
      selected: this.selectedClickUpScopes(config),
      candidates: [],
      fallbackScope: scope ?? null
    }).allowed;
  }

  private selectedClickUpScopes(config: ReturnType<ClickUpProvider["connectorConfig"]>): SelectedResourceScope[] {
    return [
      ...selectedScopesFromIds("task", config.taskIds),
      ...selectedScopesFromIds("list", config.listIds),
      ...selectedScopesFromIds("folder", config.folderIds),
      ...selectedScopesFromIds("space", config.spaceIds)
    ];
  }

  private webhookCandidateScopes(body: Record<string, unknown>): SelectedResourceScope[] {
    return [
      this.scopeFromBody("task", body.task_id ?? body.taskId ?? body.resource_id ?? body.id),
      this.scopeFromBody("list", body.list_id ?? body.listId ?? (body.list as Record<string, unknown> | undefined)?.id),
      this.scopeFromBody("folder", body.folder_id ?? body.folderId ?? (body.folder as Record<string, unknown> | undefined)?.id),
      this.scopeFromBody("space", body.space_id ?? body.spaceId ?? (body.space as Record<string, unknown> | undefined)?.id)
    ].filter((scope): scope is SelectedResourceScope => Boolean(scope));
  }

  private scopeFromBody(type: ClickUpWebhookScope["type"], value: unknown): SelectedResourceScope | null {
    const id = this.asString(value);
    return id ? { type, id } : null;
  }

  private webhookScopes(value: unknown): Record<string, ClickUpWebhookScope> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const scopes: Record<string, ClickUpWebhookScope> = {};
    for (const [webhookId, rawScope] of Object.entries(value as Record<string, unknown>)) {
      if (!rawScope || typeof rawScope !== "object" || Array.isArray(rawScope)) continue;
      const record = rawScope as Record<string, unknown>;
      const type = this.asString(record.type);
      const id = this.asString(record.id);
      if (!id || !["task", "list", "folder", "space"].includes(type ?? "")) continue;
      scopes[webhookId] = { type: type as ClickUpWebhookScope["type"], id };
    }
    return scopes;
  }

  private verifySignature(rawBody: string, secret: string, signature: string) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const left = Buffer.from(expected);
    const right = Buffer.from(signature);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private header(headers: Record<string, string | string[] | undefined>, name: string) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  private objectBody(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AppError(422, "ClickUp webhook body is invalid", "clickup_webhook_body_invalid");
    }
    return body as Record<string, any>;
  }

  private fromClickUpDate(value: unknown) {
    if (value == null) return null;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return new Date(asNumber);
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private participants(users: unknown[]): NormalizedParticipant[] {
    const byRef = new Map<string, NormalizedParticipant>();
    for (const user of users) {
      const label = this.userLabel(user);
      const externalRef = this.userExternalRef(user);
      if (!label && !externalRef) continue;
      byRef.set(externalRef ?? label ?? "unknown", {
        label: label ?? externalRef ?? "ClickUp user",
        externalRef,
        email: this.asString((user as any)?.email)
      });
    }
    return Array.from(byRef.values());
  }

  private userLabel(user: unknown) {
    return this.asString((user as any)?.username ?? (user as any)?.email ?? (user as any)?.id);
  }

  private userExternalRef(user: unknown) {
    const id = (user as any)?.id;
    return id == null ? null : `clickup:user:${id}`;
  }

  private taskMetadata(task: ClickUpTask) {
    return {
      taskId: this.asString(task.id),
      customId: this.asString(task.custom_id),
      teamId: this.asString(task.team_id),
      spaceId: this.asString(task.space?.id),
      folderId: this.asString(task.folder?.id),
      listId: this.asString(task.list?.id),
      status: this.asString(task.status?.status ?? task.status),
      priority: this.asString(task.priority?.priority ?? task.priority),
      dueDate: task.due_date ?? null,
      url: this.asString(task.url)
    };
  }

  private shouldSyncHistoryField(field: string, config: ReturnType<ClickUpProvider["connectorConfig"]>) {
    const normalized = field.toLowerCase();
    if (normalized.includes("status")) return config.syncStatusChanges !== false;
    if (normalized.includes("assignee")) return config.syncAssigneeChanges !== false;
    if (normalized.includes("due")) return config.syncDueDateChanges !== false;
    if (normalized.includes("priority")) return config.syncPriorityChanges !== false;
    if (normalized.includes("move") || normalized.includes("list")) return config.syncMovedEvents !== false;
    return true;
  }

  private historySubType(field: string) {
    const normalized = field.toLowerCase();
    if (normalized.includes("status")) return "task_status_updated";
    if (normalized.includes("assignee")) return "task_assignee_updated";
    if (normalized.includes("due")) return "task_due_date_updated";
    if (normalized.includes("priority")) return "task_priority_updated";
    if (normalized.includes("move") || normalized.includes("list")) return "task_moved";
    return "task_updated";
  }

  private historySummary(field: string, before: unknown, after: unknown) {
    const normalized = this.historySubType(field);
    const label = normalized
      .replace(/^task_/, "")
      .replace(/_updated$/, "")
      .replace(/_/g, " ");
    return `${this.capitalize(label)} changed from ${this.displayValue(before)} to ${this.displayValue(after)}`;
  }

  private displayValue(value: unknown) {
    if (value == null || value === "") return "unset";
    if (typeof value === "object") return this.bound(JSON.stringify(this.safeValue(value)), 500);
    return this.bound(String(value), 500);
  }

  private safeValue(value: unknown): unknown {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => this.safeValue(item));
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      if (/token|secret|password|authorization/i.test(key)) continue;
      output[key] = this.safeValue(entry);
    }
    return output;
  }

  private stringArray(value: unknown) {
    return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
  }

  private asString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : value == null ? null : String(value);
  }

  private bound(value: string, maxLength: number) {
    return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
  }

  private capitalize(value: string) {
    return value.length ? value[0].toUpperCase() + value.slice(1) : value;
  }
}
