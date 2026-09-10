import crypto from "node:crypto";
import {
  Prisma,
  type CalendarConnectionStatus,
  type CalendarSyncStatus,
  type CalendarSyncType,
  type ProjectCalendarProvider,
  type ProjectEventSource,
  type ProjectEventType,
  type PrismaClient
} from "@prisma/client";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import { CredentialVault } from "../../lib/communications/credential-vault.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { JobNames } from "../../lib/jobs/types.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";
import { assertProjectOpsReadable } from "./authz.js";

// OAuth state TTL (15 minutes)
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
// Backfill window (days) for initial calendar sync
const CALENDAR_BACKFILL_DAYS = 30;
// Forward sync window (days)
const CALENDAR_FORWARD_DAYS = 90;
const DEFAULT_GOOGLE_CALENDAR_IDS = ["primary"];
const DEFAULT_GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/userinfo.email"
];

export type CalendarConnectionItem = {
  id: string;
  projectId: string;
  provider: string;
  accountLabel: string;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  selectedCalendarIds?: string[];
  syncMode?: "webhook" | "polling" | "manual";
  webhookState?: GoogleCalendarWebhookState | null;
  createdAt: string;
};

export type GoogleCalendarListItem = {
  id: string;
  summary: string;
  description: string | null;
  timeZone: string | null;
  primary: boolean;
  accessRole: string | null;
  selected: boolean;
};

export type GoogleCalendarWebhookState = {
  mode: "webhook" | "polling_fallback" | "manual_sync";
  status: "active" | "fallback" | "disabled" | "error";
  reason: string | null;
  updatedAt: string;
  channelCount?: number;
};

export type GoogleCalendarStatus = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  connection: CalendarConnectionItem | null;
  calendars: GoogleCalendarListItem[];
  selectedCalendarIds: string[];
  syncMode: "webhook" | "polling" | "manual";
  webhookState: GoogleCalendarWebhookState;
  lastSyncedAt: string | null;
  error: string | null;
};

export type CalendarSyncRunItem = {
  id: string;
  connectionId: string;
  provider: string;
  syncType: string;
  status: string;
  summaryJson: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export class CalendarConnectionsService {
  private readonly credentialVault: CredentialVault;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    credentialVault?: CredentialVault
  ) {
    this.credentialVault = credentialVault ?? new CredentialVault(env);
  }

  async listConnections(projectId: string, actorUserId: string): Promise<CalendarConnectionItem[]> {
    await this.ensureReadableProject(projectId, actorUserId);
    const rows = await this.prisma.projectCalendarConnection.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }]
    });
    return rows.map((r) => this.toConnectionItem(r));
  }

  async getConnection(projectId: string, connectionId: string, actorUserId: string): Promise<CalendarConnectionItem> {
    await this.ensureReadableProject(projectId, actorUserId);
    const row = await this.findConnectionOrThrow(projectId, connectionId);
    return this.toConnectionItem(row);
  }

  async getGoogleCalendarStatus(projectId: string, actorUserId: string): Promise<GoogleCalendarStatus> {
    await this.ensureReadableProject(projectId, actorUserId);
    const enabled = this.env.BETA_GOOGLE_CALENDAR_ENABLED !== false && this.env.GOOGLE_CALENDAR_CONNECTOR_ENABLED !== false;
    const configured = Boolean(enabled && this.googleClientId() && this.googleClientSecret());
    const connection = await this.findLatestProviderConnection(projectId, "google_calendar");
    const selectedCalendarIds = connection ? this.selectedCalendarIds(connection.configJson) : DEFAULT_GOOGLE_CALENDAR_IDS;
    const webhookState = connection ? this.readWebhookState(connection.configJson) : this.defaultWebhookState(configured);
    const connected = connection != null && ["connected", "syncing"].includes(connection.status);
    const calendars =
      connected && connection?.status !== "revoked"
        ? await this.safeListGoogleCalendarsFromConnection(connection, selectedCalendarIds)
        : [];

    return {
      enabled,
      configured,
      connected,
      connection: connection ? this.toConnectionItem(connection) : null,
      calendars,
      selectedCalendarIds,
      syncMode: this.syncModeFromWebhookState(webhookState),
      webhookState,
      lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
      error: sanitizeProviderError(connection?.lastError ?? null)
    };
  }

  async listGoogleCalendars(projectId: string, actorUserId: string): Promise<GoogleCalendarListItem[]> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const connection = await this.findActiveGoogleConnectionOrThrow(projectId);
    const credential = await this.googleCredentialForConnection(connection);
    const accessToken = await this.googleAccessTokenForConnection(connection, credential);
    if (!accessToken) {
      throw new AppError(409, "Google Calendar credentials are not available", "calendar_credentials_missing");
    }
    return this.fetchGoogleCalendarList(accessToken, this.selectedCalendarIds(connection.configJson));
  }

  async updateSelectedGoogleCalendars(
    projectId: string,
    actorUserId: string,
    input: { calendarIds: string[] }
  ): Promise<GoogleCalendarStatus> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const connection = await this.findActiveGoogleConnectionOrThrow(projectId);
    const credential = await this.googleCredentialForConnection(connection);
    const accessToken = await this.googleAccessTokenForConnection(connection, credential);
    if (!accessToken) {
      throw new AppError(409, "Google Calendar credentials are not available", "calendar_credentials_missing");
    }
    const available = await this.fetchGoogleCalendarList(accessToken, this.selectedCalendarIds(connection.configJson));
    const availableIds = new Set(available.map((calendar) => calendar.id));
    const nextIds = Array.from(new Set(input.calendarIds.map((id) => id.trim()).filter(Boolean)));
    if (nextIds.length === 0) {
      throw new AppError(400, "Select at least one Google Calendar", "calendar_selection_required");
    }
    const invalid = nextIds.filter((calendarId) => !availableIds.has(calendarId));
    if (invalid.length > 0) {
      throw new AppError(400, "Selected calendar is not available on this Google account", "calendar_selection_invalid");
    }

    const configJson = this.connectionConfig(connection.configJson);
    const watchRegistration = await this.maybeStartGoogleWatches(connection, accessToken, nextIds);
    await this.prisma.projectCalendarConnection.update({
      where: { id: connection.id },
      data: {
        configJson: {
          ...configJson,
          selectedCalendarIds: nextIds,
          webhookState: watchRegistration.webhookState,
          ...(watchRegistration.watchChannels ? { googleWatchChannels: watchRegistration.watchChannels } : {})
        } as InputJsonValue,
        lastError: null
      }
    });

    await this.auditService.record({
      orgId: connection.orgId,
      projectId,
      actorUserId,
      eventType: "calendar_selection_updated",
      entityType: "project_calendar_connection",
      entityId: connection.id,
      payload: { provider: "google_calendar", selectedCount: nextIds.length, syncMode: watchRegistration.webhookState.mode }
    });

    await this.triggerSync(projectId, connection.id, actorUserId, "manual");
    return this.getGoogleCalendarStatus(projectId, actorUserId);
  }

  async triggerGoogleCalendarSync(projectId: string, actorUserId: string): Promise<CalendarSyncRunItem> {
    const connection = await this.findActiveGoogleConnectionOrThrow(projectId);
    return this.triggerSync(projectId, connection.id, actorUserId, "manual");
  }

  async disconnectGoogleCalendar(projectId: string, actorUserId: string): Promise<{ ok: boolean }> {
    const connection = await this.findActiveGoogleConnectionOrThrow(projectId);
    return this.revokeConnection(projectId, connection.id, actorUserId);
  }

  async handleGoogleCalendarWebhook(headers: Record<string, string | string[] | undefined>): Promise<{
    ok: boolean;
    ignored: boolean;
    syncQueued: boolean;
    reason: string | null;
  }> {
    if (!this.env.BETA_GOOGLE_CALENDAR_WEBHOOKS_ENABLED) {
      return { ok: true, ignored: true, syncQueued: false, reason: "webhooks_disabled" };
    }

    const channelId = firstHeader(headers["x-goog-channel-id"]);
    const channelToken = firstHeader(headers["x-goog-channel-token"]);
    const resourceState = firstHeader(headers["x-goog-resource-state"]);
    if (!channelId || !channelToken) {
      return { ok: true, ignored: true, syncQueued: false, reason: "missing_channel_headers" };
    }

    const connections = await this.prisma.projectCalendarConnection.findMany({
      where: { provider: "google_calendar", status: { in: ["connected", "syncing", "error"] } },
      take: 200
    });

    for (const connection of connections) {
      const watch = this.readWatchChannel(connection.configJson, channelId);
      if (!watch) continue;
      const tokenHash = crypto.createHash("sha256").update(channelToken).digest("hex");
      if (!constantTimeEqual(watch.tokenHash, tokenHash)) {
        return { ok: true, ignored: true, syncQueued: false, reason: "invalid_channel_token" };
      }

      if (resourceState === "sync") {
        return { ok: true, ignored: false, syncQueued: false, reason: "initial_sync_notification" };
      }

      await this.jobs.enqueue(
        JobNames.syncCalendarConnection,
        {
          connectionId: connection.id,
          projectId: connection.projectId,
          syncType: "incremental" as CalendarSyncType
        },
        `calendar-sync:${connection.id}:webhook:${Date.now()}`
      );
      await this.auditService.record({
        orgId: connection.orgId,
        projectId: connection.projectId,
        actorUserId: connection.createdBy,
        eventType: "calendar_webhook_received",
        entityType: "project_calendar_connection",
        entityId: connection.id,
        payload: { provider: "google_calendar", calendarId: watch.calendarId, resourceState: resourceState ?? null }
      });
      return { ok: true, ignored: false, syncQueued: true, reason: null };
    }

    return { ok: true, ignored: true, syncQueued: false, reason: "unknown_channel" };
  }

  async updateConnection(
    projectId: string,
    connectionId: string,
    actorUserId: string,
    input: { accountLabel?: string }
  ): Promise<CalendarConnectionItem> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const existing = await this.findConnectionOrThrow(projectId, connectionId);
    const updated = await this.prisma.projectCalendarConnection.update({
      where: { id: connectionId },
      data: {
        ...(input.accountLabel !== undefined ? { accountLabel: input.accountLabel } : {})
      }
    });
    await this.auditService.record({
      orgId: existing.orgId,
      projectId,
      actorUserId,
      eventType: "calendar_connection_updated",
      entityType: "project_calendar_connection",
      entityId: connectionId,
      payload: { provider: updated.provider }
    });
    return this.toConnectionItem(updated);
  }

  // Returns the OAuth redirect URL for the manager to visit.
  async initiateConnect(
    projectId: string,
    actorUserId: string,
    provider: ProjectCalendarProvider
  ): Promise<{ connectionId: string; redirectUrl: string }> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    this.assertProviderConfigured(provider);

    // Create a pending connection
    const nonce = crypto.randomBytes(32).toString("hex");
    const nonceHash = crypto.createHash("sha256").update(nonce).digest("hex");

    const connection = await this.prisma.projectCalendarConnection.create({
      data: {
        orgId: project.orgId,
        projectId,
        provider,
        accountLabel: `${provider} (pending)`,
        status: "pending_auth",
        configJson: {
          pendingNonceHash: nonceHash,
          nonceExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
          actorUserId
        },
        createdBy: actorUserId
      }
    });

    // Build the signed state param: connectionId:nonce
    const stateSecret = this.env.CONNECTOR_OAUTH_STATE_SECRET;
    const raw = `${connection.id}:${nonce}`;
    const sig = crypto.createHmac("sha256", stateSecret).update(raw).digest("hex");
    const stateParam = Buffer.from(JSON.stringify({ connectionId: connection.id, nonce, sig })).toString("base64url");

    const redirectUrl = this.buildOAuthUrl(provider, stateParam);

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "calendar_connection_initiated",
      entityType: "project_calendar_connection",
      entityId: connection.id,
      payload: { provider }
    });

    return { connectionId: connection.id, redirectUrl };
  }

  // Called by the OAuth callback handler with the provider code + state.
  async handleOAuthCallback(
    provider: ProjectCalendarProvider,
    code: string,
    rawState: string
  ): Promise<{ projectId: string; connectionId: string }> {
    const parsed = this.parseAndVerifyState(rawState, provider);
    const { connectionId } = parsed;

    const connection = await this.prisma.projectCalendarConnection.findFirst({
      where: { id: connectionId, provider, status: "pending_auth" }
    });

    if (!connection) {
      throw new AppError(400, "Invalid or expired OAuth state", "calendar_oauth_invalid_state");
    }

    const configJson = (connection.configJson ?? {}) as Record<string, unknown>;
    const actorUserId = typeof configJson["actorUserId"] === "string" ? configJson["actorUserId"] : null;
    if (!actorUserId) {
      throw new AppError(400, "OAuth state actor is missing", "calendar_oauth_actor_missing");
    }
    await this.projectService.ensureProjectManager(connection.projectId, actorUserId);
    const expiresAt = configJson["nonceExpiresAt"] as string | undefined;
    if (!expiresAt || new Date(expiresAt) < new Date()) {
      await this.prisma.projectCalendarConnection.update({
        where: { id: connectionId },
        data: { status: "error", lastError: "OAuth state expired" }
      });
      throw new AppError(400, "OAuth state has expired. Please reconnect.", "calendar_oauth_state_expired");
    }

    const storedNonceHash = configJson["pendingNonceHash"] as string;
    const incomingNonceHash = crypto.createHash("sha256").update(parsed.nonce).digest("hex");
    if (!constantTimeEqual(storedNonceHash, incomingNonceHash)) {
      throw new AppError(400, "OAuth nonce mismatch", "calendar_oauth_nonce_mismatch");
    }

    const claimed = await this.prisma.projectCalendarConnection.updateMany({
      where: { id: connectionId, provider, status: "pending_auth" },
      data: { status: "syncing", lastError: null }
    });
    if (claimed.count !== 1) {
      throw new AppError(400, "OAuth state is already used", "calendar_oauth_state_used");
    }

    // Exchange code for tokens
    let tokens: { accessToken: string; refreshToken?: string; email?: string; expiresIn?: number };
    try {
      tokens = await this.exchangeCode(provider, code);
    } catch (error) {
      const sanitizedError = sanitizeProviderError(error instanceof Error ? error.message : String(error));
      await this.prisma.projectCalendarConnection.update({
        where: { id: connectionId },
        data: {
          status: "error",
          lastError: `Token exchange failed: ${sanitizedError ?? "provider_error"}`
        }
      });
      throw new AppError(502, "Failed to exchange OAuth code", "calendar_oauth_exchange_failed");
    }

    const credentialResult = await this.credentialVault.putCredential({
      provider,
      connectorId: connectionId,
      credential: tokens
    });
    const selectedCalendarIds =
      provider === "google_calendar" ? this.selectedCalendarIds(configJson) : DEFAULT_GOOGLE_CALENDAR_IDS;
    const connectedConfigJson = {
      ...configJson,
      pendingNonceHash: null,
      nonceExpiresAt: null,
      tokenExpiresAt: tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
        : null,
      email: tokens.email ?? null,
      ...(provider === "google_calendar"
        ? {
            selectedCalendarIds,
            webhookState: this.defaultWebhookState(true)
          }
        : {})
    };

    await this.prisma.projectCalendarConnection.update({
      where: { id: connectionId },
      data: {
        status: "connected",
        accountLabel: tokens.email ?? `${provider} account`,
        credentialsRef: credentialResult.ref,
        configJson: connectedConfigJson as InputJsonValue,
        lastError: null
      }
    });

    if (provider === "google_calendar") {
      const watchRegistration = await this.maybeStartGoogleWatches(
        { id: connectionId, configJson: connectedConfigJson },
        tokens.accessToken,
        selectedCalendarIds
      );
      await this.prisma.projectCalendarConnection.update({
        where: { id: connectionId },
        data: {
          configJson: {
            ...connectedConfigJson,
            webhookState: watchRegistration.webhookState,
            ...(watchRegistration.watchChannels ? { googleWatchChannels: watchRegistration.watchChannels } : {})
          } as InputJsonValue
        }
      });
    }

    if (provider !== "google_calendar" || this.env.GOOGLE_CALENDAR_BACKFILL_ENABLED !== false) {
      await this.jobs.enqueue(
        JobNames.syncCalendarConnection,
        {
          connectionId,
          projectId: connection.projectId,
          syncType: "backfill" as CalendarSyncType
        },
        `calendar-sync:${connectionId}:backfill:${Date.now()}`
      );
    }

    await this.auditService.record({
      orgId: connection.orgId,
      projectId: connection.projectId,
      actorUserId: actorUserId ?? "system",
      eventType: "calendar_connection_connected",
      entityType: "project_calendar_connection",
      entityId: connectionId,
      payload: { provider, email: tokens.email ?? null }
    });

    return { projectId: connection.projectId, connectionId };
  }

  async triggerSync(
    projectId: string,
    connectionId: string,
    actorUserId: string,
    syncType: CalendarSyncType = "manual"
  ): Promise<CalendarSyncRunItem> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const connection = await this.findConnectionOrThrow(projectId, connectionId);

    if (connection.status === "pending_auth" || connection.status === "revoked") {
      throw new AppError(409, "Connection is not active", "calendar_connection_not_active");
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    const syncRun = await this.prisma.projectCalendarSyncRun.create({
      data: {
        connectionId,
        orgId: project.orgId,
        projectId,
        provider: connection.provider,
        syncType,
        status: "queued"
      }
    });

    await this.jobs.enqueue(
      JobNames.syncCalendarConnection,
      { connectionId, projectId, syncType, syncRunId: syncRun.id },
      `calendar-sync:${connectionId}:${syncType}:${syncRun.id}`
    );

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "calendar_sync_started",
      entityType: "project_calendar_sync_run",
      entityId: syncRun.id,
      payload: { provider: connection.provider, syncType }
    });

    return this.toSyncRunItem(syncRun);
  }

  async revokeConnection(
    projectId: string,
    connectionId: string,
    actorUserId: string
  ): Promise<{ ok: boolean }> {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const connection = await this.findConnectionOrThrow(projectId, connectionId);
    let stoppedWatchCount = 0;
    let googleTokenRevoked = false;

    if (connection.provider === "google_calendar") {
      try {
        const credential = await this.credentialVault.getCredential(
          connection.provider,
          connection.id,
          connection.credentialsRef
        );
        const accessToken = credential?.["accessToken"] as string | undefined;
        if (accessToken) {
          stoppedWatchCount = await this.stopGoogleWatches(connection, accessToken);
        }
        googleTokenRevoked = await this.revokeGoogleToken(credential);
      } catch {
        // Disconnect must still clear local credentials even if Google best-effort cleanup fails.
      }
    }

    await this.prisma.projectCalendarConnection.update({
      where: { id: connectionId },
      data: {
        status: "revoked",
        credentialsRef: null,
        configJson: { revokedAt: new Date().toISOString() }
      }
    });
    await this.credentialVault.revokeCredential(connection.provider, connection.id, connection.credentialsRef);

    await this.auditService.record({
      orgId: connection.orgId,
      projectId,
      actorUserId,
      eventType: "calendar_connection_revoked",
      entityType: "project_calendar_connection",
      entityId: connectionId,
      payload: { provider: connection.provider, stoppedWatchCount, googleTokenRevoked }
    });

    return { ok: true };
  }

  async listSyncRuns(
    projectId: string,
    connectionId: string,
    actorUserId: string,
    limit = 20
  ): Promise<CalendarSyncRunItem[]> {
    await this.ensureReadableProject(projectId, actorUserId);
    await this.findConnectionOrThrow(projectId, connectionId);
    const runs = await this.prisma.projectCalendarSyncRun.findMany({
      where: { connectionId },
      orderBy: [{ createdAt: "desc" }],
      take: Math.min(limit, 50)
    });
    return runs.map((r) => this.toSyncRunItem(r));
  }

  // Job handler: runs the actual sync
  async runSyncJob(payload: {
    connectionId: string;
    projectId: string;
    syncType: CalendarSyncType;
    syncRunId?: string;
  }) {
    const connection = await this.prisma.projectCalendarConnection.findUnique({
      where: { id: payload.connectionId }
    });
    if (!connection || connection.status === "revoked") {
      throw new AppError(404, "Calendar connection not found or revoked", "calendar_connection_not_found");
    }

    let syncRun = payload.syncRunId
      ? await this.prisma.projectCalendarSyncRun.findUniqueOrThrow({ where: { id: payload.syncRunId } })
      : await this.prisma.projectCalendarSyncRun.create({
          data: {
            connectionId: payload.connectionId,
            orgId: connection.orgId,
            projectId: payload.projectId,
            provider: connection.provider,
            syncType: payload.syncType,
            status: "queued"
          }
        });

    // Mark running
    await this.prisma.projectCalendarSyncRun.update({
      where: { id: syncRun.id },
      data: { status: "running", startedAt: new Date() }
    });
    await this.prisma.projectCalendarConnection.update({
      where: { id: payload.connectionId },
      data: { status: "syncing" }
    });

    try {
      const { eventsImported, eventsUpdated, nextCursorJson } = await this.importCalendarEvents(
        connection,
        payload.syncType
      );

      await this.prisma.projectCalendarSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "completed",
          finishedAt: new Date(),
          cursorAfterJson: (nextCursorJson ? nextCursorJson : Prisma.JsonNull) as InputJsonValue,
          summaryJson: { eventsImported, eventsUpdated } as InputJsonValue
        }
      });

      await this.prisma.projectCalendarConnection.update({
        where: { id: payload.connectionId },
        data: {
          status: "connected",
          lastSyncedAt: new Date(),
          lastError: null,
          providerCursorJson: (nextCursorJson ? nextCursorJson : connection.providerCursorJson ?? Prisma.JsonNull) as InputJsonValue
        }
      });

      await enqueueProjectDashboardRefreshByProjectId(
        this.prisma,
        this.jobs,
        payload.projectId,
        "calendar_sync_completed"
      );

      await this.auditService.record({
        orgId: connection.orgId,
        projectId: payload.projectId,
        actorUserId: connection.createdBy,
        eventType: "calendar_sync_completed",
        entityType: "project_calendar_sync_run",
        entityId: syncRun.id,
        payload: { provider: connection.provider, syncType: payload.syncType, eventsImported, eventsUpdated }
      });
    } catch (error) {
      const errorMsg = sanitizeProviderError(error instanceof Error ? error.message : String(error)) ?? "provider_error";
      await this.prisma.projectCalendarSyncRun.update({
        where: { id: syncRun.id },
        data: { status: "failed", finishedAt: new Date(), errorMessage: errorMsg }
      });
      await this.prisma.projectCalendarConnection.update({
        where: { id: payload.connectionId },
        data: { status: "error", lastError: errorMsg }
      });
      await this.auditService.record({
        orgId: connection.orgId,
        projectId: payload.projectId,
        actorUserId: connection.createdBy,
        eventType: "calendar_sync_failed",
        entityType: "project_calendar_sync_run",
        entityId: syncRun.id,
        payload: { provider: connection.provider, syncType: payload.syncType, error: errorMsg }
      });
      throw error;
    }
  }

  // ─── Provider-specific helpers ───────────────────────────────────────────

  private async importCalendarEvents(
    connection: {
      id: string;
      projectId: string;
      orgId: string;
      provider: ProjectCalendarProvider;
      credentialsRef: string | null;
      configJson: unknown;
      providerCursorJson: unknown;
    },
    syncType: CalendarSyncType
  ): Promise<{ eventsImported: number; eventsUpdated: number; nextCursorJson: Record<string, unknown> | null }> {
    const credential = await this.credentialVault.getCredential(
      connection.provider,
      connection.id,
      connection.credentialsRef
    );
    const accessToken =
      connection.provider === "google_calendar"
        ? await this.googleAccessTokenForConnection(connection, credential)
        : (credential?.["accessToken"] as string | undefined);

    if (!accessToken) {
      throw new Error("No access token available for calendar sync");
    }

    const now = new Date();
    const backfillDays = Math.min(this.env.GOOGLE_CALENDAR_SYNC_MAX_BACKFILL_DAYS ?? CALENDAR_BACKFILL_DAYS, 90);
    const backfillFrom = new Date(now.getTime() - backfillDays * 24 * 60 * 60 * 1000);
    const forwardTo = new Date(now.getTime() + CALENDAR_FORWARD_DAYS * 24 * 60 * 60 * 1000);

    const cursorJson = this.connectionConfig(connection.providerCursorJson);

    let rawEvents: ProviderCalendarEvent[] = [];
    let nextCursorJson: Record<string, unknown> | null = null;

    if (connection.provider === "google_calendar") {
      const selectedCalendarIds = this.selectedCalendarIds(connection.configJson);
      const cursors = readRecord(cursorJson["cursors"]);
      const nextCursors: Record<string, string> = {};
      for (const calendarId of selectedCalendarIds) {
        const syncToken =
          syncType === "incremental" && this.env.GOOGLE_CALENDAR_INCREMENTAL_SYNC_ENABLED
            ? readString(cursors?.[calendarId])
            : undefined;
        let result: { events: ProviderCalendarEvent[]; nextCursor: string | null };
        try {
          result = await this.fetchGoogleCalendarEvents(accessToken, calendarId, backfillFrom, forwardTo, syncToken);
        } catch (error) {
          if (!isGoogleAuthError(error) || !credential?.["refreshToken"]) {
            throw error;
          }
          const refreshedAccessToken = await this.refreshAndStoreGoogleAccessToken(connection, credential);
          result = await this.fetchGoogleCalendarEvents(
            refreshedAccessToken,
            calendarId,
            backfillFrom,
            forwardTo,
            syncToken
          );
        }
        rawEvents = rawEvents.concat(result.events);
        if (result.nextCursor) {
          nextCursors[calendarId] = result.nextCursor;
        }
      }
      nextCursorJson = { cursors: nextCursors, selectedCalendarIds };
    } else if (connection.provider === "outlook_calendar") {
      const syncToken = syncType === "incremental" ? readString(cursorJson["cursor"]) : undefined;
      const outlookResult = await this.fetchOutlookCalendarEvents(
        accessToken,
        backfillFrom,
        forwardTo,
        syncToken
      );
      rawEvents = outlookResult.events;
      nextCursorJson = outlookResult.nextCursor ? { cursor: outlookResult.nextCursor } : null;
    }

    let imported = 0;
    let updated = 0;

    for (const event of rawEvents) {
      const result = await this.upsertImportedEvent(event, connection.projectId, connection.orgId, connection.id);
      if (result === "created") imported++;
      else if (result === "updated") updated++;
    }

    return { eventsImported: imported, eventsUpdated: updated, nextCursorJson };
  }

  private async upsertImportedEvent(
    event: ProviderCalendarEvent,
    projectId: string,
    orgId: string,
    connectionId: string
  ): Promise<"created" | "updated" | "skipped"> {
    if (!event.externalRef || !event.startsAt) return "skipped";

    // Find creator — fall back to null (use the connection creator)
    const connection = await this.prisma.projectCalendarConnection.findUniqueOrThrow({
      where: { id: connectionId },
      select: { createdBy: true }
    });

    const existing = await this.prisma.projectEvent.findFirst({
      where: { projectId, externalCalendarRef: event.externalRef }
    });

    if (existing) {
      await this.prisma.projectEvent.update({
        where: { id: existing.id },
        data: {
          title: event.title,
          description: event.description ?? null,
          startsAt: new Date(event.startsAt),
          endsAt: event.endsAt ? new Date(event.endsAt) : null,
          isAllDay: event.isAllDay ?? false,
        timezone: event.timezone ?? null
      }
    });
      return "updated";
    }

    await this.prisma.projectEvent.create({
      data: {
        orgId,
        projectId,
        title: event.title,
        description: event.description ?? null,
        eventType: this.mapEventType(event.eventType),
        source: "imported" as ProjectEventSource,
        startsAt: new Date(event.startsAt),
        endsAt: event.endsAt ? new Date(event.endsAt) : null,
        timezone: event.timezone ?? null,
        isAllDay: event.isAllDay ?? false,
        externalCalendarRef: event.externalRef,
        providerCalendarId: event.calendarId ?? connectionId,
        createdBy: connection.createdBy
      }
    });
    return "created";
  }

  // Google Calendar API fetch (real implementation stub)
  private async fetchGoogleCalendarEvents(
    accessToken: string,
    calendarId: string,
    from: Date,
    to: Date,
    syncToken?: string
  ): Promise<{ events: ProviderCalendarEvent[]; nextCursor: string | null }> {
    const maxResults = String(this.env.GOOGLE_CALENDAR_SYNC_PAGE_SIZE ?? 250);
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults
    });

    if (syncToken) {
      params.set("syncToken", syncToken);
    } else {
      params.set("timeMin", from.toISOString());
      params.set("timeMax", to.toISOString());
    }

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

    let pageToken: string | null = null;
    const events: ProviderCalendarEvent[] = [];
    let nextCursor: string | null = null;

    do {
      if (pageToken) params.set("pageToken", pageToken);
      else params.delete("pageToken");
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (res.status === 401) throw new Error("Google Calendar token expired or revoked");
      if (res.status === 410 && syncToken) {
        return this.fetchGoogleCalendarEvents(accessToken, calendarId, from, to);
      }
      if (!res.ok) throw new Error(`Google Calendar API error: ${res.status}`);

      const body = (await res.json()) as {
        items?: GoogleCalendarEvent[];
        nextSyncToken?: string;
        nextPageToken?: string;
      };

      events.push(...(body.items ?? []).map((item) => this.normalizeGoogleEvent(item, calendarId)));
      pageToken = body.nextPageToken ?? null;
      nextCursor = body.nextSyncToken ?? nextCursor;
    } while (pageToken);

    return { events, nextCursor };
  }

  private normalizeGoogleEvent(item: GoogleCalendarEvent, calendarId: string): ProviderCalendarEvent {
    const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
    const isPrivate = item.visibility === "private" || item.visibility === "confidential";
    const title = item.status === "cancelled"
      ? `[Cancelled] ${item.summary ?? "Google Calendar event"}`
      : isPrivate
        ? "Private Google Calendar event"
        : item.summary ?? "(No title)";
    return {
      externalRef: `${calendarId}:${item.id}`,
      calendarId,
      title,
      description: isPrivate ? null : sanitizeEventDescription(item.description ?? null),
      startsAt: item.start?.dateTime ?? (item.start?.date ? `${item.start.date}T00:00:00Z` : null),
      endsAt: item.end?.dateTime ?? (item.end?.date ? `${item.end.date}T00:00:00Z` : null),
      timezone: item.start?.timeZone ?? item.end?.timeZone ?? null,
      isAllDay,
      eventType: item.status === "cancelled" ? "other" : "meeting",
      status: item.status ?? null,
      privacy: isPrivate ? "private" : item.visibility ?? null,
      htmlLink: isPrivate ? null : item.htmlLink ?? null,
      updatedAt: item.updated ?? null,
      iCalUID: item.iCalUID ?? null
    };
  }

  // Outlook/Microsoft Graph Calendar fetch (real implementation stub)
  private async fetchOutlookCalendarEvents(
    accessToken: string,
    from: Date,
    to: Date,
    _syncToken?: string
  ): Promise<{ events: ProviderCalendarEvent[]; nextCursor: string | null }> {
    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $top: "250",
      $select: "id,subject,bodyPreview,start,end,isAllDay,location"
    });

    const url = `https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (res.status === 401) throw new Error("Outlook Calendar token expired or revoked");
    if (!res.ok) throw new Error(`Microsoft Graph API error: ${res.status}`);

    const body = (await res.json()) as {
      value?: OutlookCalendarEvent[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };

    const events = (body.value ?? []).map((item) => this.normalizeOutlookEvent(item));
    // Use deltaLink as incremental cursor
    const deltaLink = body["@odata.deltaLink"];
    const nextCursor = deltaLink ? extractDeltaToken(deltaLink) : null;

    return { events, nextCursor };
  }

  private normalizeOutlookEvent(item: OutlookCalendarEvent): ProviderCalendarEvent {
    return {
      externalRef: item.id,
      title: item.subject ?? "(No title)",
      description: item.bodyPreview ?? null,
      startsAt: item.start?.dateTime ? `${item.start.dateTime}Z` : null,
      endsAt: item.end?.dateTime ? `${item.end.dateTime}Z` : null,
      timezone: item.start?.timeZone ?? null,
      isAllDay: item.isAllDay ?? false,
      eventType: "meeting"
    };
  }

  private async fetchGoogleCalendarList(
    accessToken: string,
    selectedCalendarIds: string[]
  ): Promise<GoogleCalendarListItem[]> {
    const calendars: GoogleCalendarListItem[] = [];
    let pageToken: string | null = null;
    do {
      const params = new URLSearchParams({ minAccessRole: "reader" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (res.status === 401) throw new Error("Google Calendar token expired or revoked");
      if (!res.ok) throw new Error(`Google Calendar list error: ${res.status}`);
      const body = (await res.json()) as { items?: GoogleCalendarListEntry[]; nextPageToken?: string };
      calendars.push(
        ...(body.items ?? [])
          .filter((item) => item.id)
          .map((item) => ({
            id: item.id,
            summary: item.summary ?? item.id,
            description: item.description ?? null,
            timeZone: item.timeZone ?? null,
            primary: item.primary === true,
            accessRole: item.accessRole ?? null,
            selected: selectedCalendarIds.includes(item.id)
          }))
      );
      pageToken = body.nextPageToken ?? null;
    } while (pageToken);

    return calendars.sort((left, right) => Number(right.primary) - Number(left.primary) || left.summary.localeCompare(right.summary));
  }

  private async safeListGoogleCalendarsFromConnection(
    connection: GoogleConnectionRow,
    selectedCalendarIds: string[]
  ): Promise<GoogleCalendarListItem[]> {
    try {
      const credential = await this.googleCredentialForConnection(connection);
      const accessToken = await this.googleAccessTokenForConnection(connection, credential);
      if (!accessToken) {
        return [];
      }
      return this.fetchGoogleCalendarList(accessToken, selectedCalendarIds);
    } catch {
      return [];
    }
  }

  private async googleCredentialForConnection(connection: {
    id: string;
    provider: ProjectCalendarProvider;
    credentialsRef: string | null;
  }) {
    const credential = await this.credentialVault.getCredential(
      connection.provider,
      connection.id,
      connection.credentialsRef
    );
    if (!credential?.["accessToken"]) {
      throw new AppError(409, "Google Calendar credentials are not available", "calendar_credentials_missing");
    }
    return credential;
  }

  private async googleAccessTokenForConnection(
    connection: {
      id: string;
      provider: ProjectCalendarProvider;
      credentialsRef: string | null;
      configJson: unknown;
    },
    credential: Record<string, unknown> | null | undefined
  ) {
    const accessToken = credential?.["accessToken"] as string | undefined;
    if (!accessToken) return undefined;

    const tokenExpiresAt = readString(this.connectionConfig(connection.configJson)["tokenExpiresAt"]);
    if (tokenExpiresAt && new Date(tokenExpiresAt).getTime() > Date.now() + 60_000) {
      return accessToken;
    }

    const refreshToken = credential?.["refreshToken"] as string | undefined;
    if (!refreshToken) return accessToken;

    return this.refreshAndStoreGoogleAccessToken(connection, credential as Record<string, unknown>);
  }

  private async refreshAndStoreGoogleAccessToken(
    connection: {
      id: string;
      provider: ProjectCalendarProvider;
      credentialsRef: string | null;
      configJson: unknown;
    },
    credential: Record<string, unknown>
  ) {
    const refreshToken = credential["refreshToken"] as string | undefined;
    if (!refreshToken) {
      throw new Error("Google Calendar refresh token is not available");
    }
    const refreshed = await this.refreshGoogleAccessToken(refreshToken);
    const nextCredential = {
      ...credential,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? refreshToken,
      expiresIn: refreshed.expiresIn
    };
    await this.credentialVault.putCredential({
      provider: "google_calendar",
      connectorId: connection.id,
      credential: nextCredential
    });
    await this.prisma.projectCalendarConnection.update({
      where: { id: connection.id },
      data: {
        configJson: {
          ...this.connectionConfig(connection.configJson),
          tokenExpiresAt: refreshed.expiresIn
            ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
            : null
        } as InputJsonValue
      }
    });
    return refreshed.accessToken;
  }

  private async refreshGoogleAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
  }> {
    const body = new URLSearchParams({
      client_id: this.googleClientId()!,
      client_secret: this.googleClientSecret()!,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google token refresh failed: ${sanitizeProviderError(text) ?? "provider_error"}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    };
  }

  private async revokeGoogleToken(credential: Record<string, unknown> | null | undefined) {
    const token = (credential?.["refreshToken"] as string | undefined) ?? (credential?.["accessToken"] as string | undefined);
    if (!token) {
      return false;
    }
    try {
      const body = new URLSearchParams({ token });
      const res = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async stopGoogleWatches(connection: { configJson: unknown }, accessToken: string) {
    const configJson = this.connectionConfig(connection.configJson);
    const watchChannels = readRecord(configJson["googleWatchChannels"]);
    let stopped = 0;
    for (const [channelId, rawWatch] of Object.entries(watchChannels ?? {})) {
      const watch = readRecord(rawWatch);
      const resourceId = readString(watch?.["resourceId"]);
      if (!resourceId) continue;
      try {
        const res = await fetch("https://www.googleapis.com/calendar/v3/channels/stop", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ id: channelId, resourceId })
        });
        if (res.ok) stopped++;
      } catch {
        // Best-effort stop; local disconnect still clears stored credentials.
      }
    }
    return stopped;
  }

  private async maybeStartGoogleWatches(
    connection: { id: string; configJson: unknown },
    accessToken: string,
    calendarIds: string[]
  ): Promise<{ webhookState: GoogleCalendarWebhookState; watchChannels: Record<string, GoogleWatchChannelConfig> | null }> {
    if (!this.env.BETA_GOOGLE_CALENDAR_WEBHOOKS_ENABLED) {
      return {
        webhookState: {
          mode: "polling_fallback",
          status: "disabled",
          reason: "Google Calendar webhooks disabled; manual sync remains available.",
          updatedAt: new Date().toISOString()
        },
        watchChannels: null
      };
    }

    const webhookUrl = this.env.GOOGLE_CALENDAR_WEBHOOK_URL ?? `${this.env.APP_BASE_URL}/v1/webhooks/google/calendar`;
    if (!webhookUrl.startsWith("https://")) {
      return {
        webhookState: {
          mode: "polling_fallback",
          status: "fallback",
          reason: "Google Calendar webhook URL is not HTTPS; using manual sync/polling fallback.",
          updatedAt: new Date().toISOString()
        },
        watchChannels: null
      };
    }

    const watchChannels: Record<string, GoogleWatchChannelConfig> = {};
    try {
      for (const calendarId of calendarIds) {
        const channelId = crypto.randomUUID();
        const channelToken = this.googleWatchChannelToken(channelId, calendarId);
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              id: channelId,
              type: "web_hook",
              address: webhookUrl,
              token: channelToken,
              params: {
                ttl: String(this.env.GOOGLE_CALENDAR_WATCH_TTL_SECONDS ?? 604800)
              }
            })
          }
        );
        if (!res.ok) {
          throw new Error(`Google Calendar watch error: ${res.status}`);
        }
        const body = (await res.json()) as { resourceId?: string; expiration?: string };
        watchChannels[channelId] = {
          calendarId,
          resourceId: body.resourceId ?? null,
          tokenHash: crypto.createHash("sha256").update(channelToken).digest("hex"),
          expiration: body.expiration ?? null
        };
      }

      return {
        webhookState: {
          mode: "webhook",
          status: "active",
          reason: null,
          updatedAt: new Date().toISOString(),
          channelCount: Object.keys(watchChannels).length
        },
        watchChannels
      };
    } catch (error) {
      return {
        webhookState: {
          mode: "polling_fallback",
          status: "fallback",
          reason:
            sanitizeProviderError(error instanceof Error ? error.message : String(error)) ??
            "Google Calendar watch registration failed; manual sync remains available.",
          updatedAt: new Date().toISOString()
        },
        watchChannels: null
      };
    }
  }

  private async exchangeCode(
    provider: ProjectCalendarProvider,
    code: string
  ): Promise<{ accessToken: string; refreshToken?: string; email?: string; expiresIn?: number }> {
    if (provider === "google_calendar") {
      return this.exchangeGoogleCode(code);
    }
    return this.exchangeMicrosoftCode(code);
  }

  private async exchangeGoogleCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    email?: string;
    expiresIn?: number;
  }> {
    const redirectUri = this.googleRedirectUri();
    const body = new URLSearchParams({
      code,
      client_id: this.googleClientId()!,
      client_secret: this.googleClientSecret()!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google token exchange failed: ${sanitizeProviderError(text) ?? "provider_error"}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Fetch email from userinfo
    let email: string | undefined;
    try {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      if (userRes.ok) {
        const user = (await userRes.json()) as { email?: string };
        email = user.email;
      }
    } catch {
      // Non-fatal
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      email,
      expiresIn: data.expires_in
    };
  }

  private async exchangeMicrosoftCode(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    email?: string;
    expiresIn?: number;
  }> {
    const redirectUri = `${this.env.APP_BASE_URL}/v1/oauth/outlook-calendar/callback`;
    const tenantId = this.env.MICROSOFT_TENANT_ID ?? "common";
    const body = new URLSearchParams({
      code,
      client_id: this.env.MICROSOFT_CLIENT_ID!,
      client_secret: this.env.MICROSOFT_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: "https://graph.microsoft.com/Calendars.Read offline_access User.Read"
    });

    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Microsoft token exchange failed: ${sanitizeProviderError(text) ?? "provider_error"}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    let email: string | undefined;
    try {
      const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      if (userRes.ok) {
        const user = (await userRes.json()) as { mail?: string; userPrincipalName?: string };
        email = user.mail ?? user.userPrincipalName;
      }
    } catch {
      // Non-fatal
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      email,
      expiresIn: data.expires_in
    };
  }

  private buildOAuthUrl(provider: ProjectCalendarProvider, stateParam: string): string {
    if (provider === "google_calendar") {
      const redirectUri = this.googleRedirectUri();
      const params = new URLSearchParams({
        client_id: this.googleClientId()!,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: this.googleCalendarScopes().join(" "),
        access_type: "offline",
        prompt: "consent",
        state: stateParam
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    // Outlook
    const redirectUri = `${this.env.APP_BASE_URL}/v1/oauth/outlook-calendar/callback`;
    const tenantId = this.env.MICROSOFT_TENANT_ID ?? "common";
    const params = new URLSearchParams({
      client_id: this.env.MICROSOFT_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://graph.microsoft.com/Calendars.Read offline_access User.Read",
      response_mode: "query",
      state: stateParam
    });
    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  private googleRedirectUri() {
    return this.env.GOOGLE_CALENDAR_REDIRECT_URI ?? this.env.GOOGLE_REDIRECT_URI ?? `${this.env.APP_BASE_URL}/v1/oauth/google/calendar/callback`;
  }

  private googleClientId() {
    return this.env.GOOGLE_CALENDAR_CLIENT_ID ?? this.env.GOOGLE_CLIENT_ID;
  }

  private googleClientSecret() {
    return this.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? this.env.GOOGLE_CLIENT_SECRET;
  }

  private googleCalendarScopes() {
    const configuredScopes = this.env.GOOGLE_CALENDAR_SCOPES ?? [];
    const scopes = configuredScopes.length > 0 ? configuredScopes : DEFAULT_GOOGLE_CALENDAR_SCOPES;
    return Array.from(new Set(scopes));
  }

  private googleWatchChannelToken(channelId: string, calendarId: string) {
    const random = crypto.randomBytes(32).toString("hex");
    const secret = this.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN_SECRET;
    if (!secret) {
      return random;
    }
    return crypto.createHmac("sha256", secret).update(`${channelId}:${calendarId}:${random}`).digest("base64url");
  }

  private parseAndVerifyState(
    rawState: string,
    _provider: ProjectCalendarProvider
  ): { connectionId: string; nonce: string } {
    let parsed: { connectionId: string; nonce: string; sig: string };
    try {
      parsed = JSON.parse(Buffer.from(rawState, "base64url").toString("utf-8")) as typeof parsed;
    } catch {
      throw new AppError(400, "Invalid OAuth state parameter", "calendar_oauth_invalid_state");
    }
    if (
      !parsed ||
      typeof parsed.connectionId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.sig !== "string"
    ) {
      throw new AppError(400, "Invalid OAuth state parameter", "calendar_oauth_invalid_state");
    }

    const stateSecret = this.env.CONNECTOR_OAUTH_STATE_SECRET;
    const raw = `${parsed.connectionId}:${parsed.nonce}`;
    const expectedSig = crypto.createHmac("sha256", stateSecret).update(raw).digest("hex");

    if (!constantTimeEqual(expectedSig, parsed.sig)) {
      throw new AppError(400, "OAuth state signature invalid", "calendar_oauth_invalid_signature");
    }

    return { connectionId: parsed.connectionId, nonce: parsed.nonce };
  }

  private assertProviderConfigured(provider: ProjectCalendarProvider) {
    if (provider === "google_calendar") {
      if (this.env.BETA_GOOGLE_CALENDAR_ENABLED === false || this.env.GOOGLE_CALENDAR_CONNECTOR_ENABLED === false) {
        throw new AppError(403, "Google Calendar integration is disabled", "feature_disabled");
      }
      if (!this.googleClientId() || !this.googleClientSecret()) {
        throw new AppError(501, "Google Calendar OAuth is not configured", "calendar_provider_not_configured");
      }
    } else if (provider === "outlook_calendar") {
      if (!this.env.MICROSOFT_CLIENT_ID || !this.env.MICROSOFT_CLIENT_SECRET) {
        throw new AppError(501, "Outlook Calendar OAuth is not configured", "calendar_provider_not_configured");
      }
    }
  }

  private mapEventType(raw: string | null | undefined): ProjectEventType {
    const map: Record<string, ProjectEventType> = {
      meeting: "meeting",
      standup: "standup",
      review: "review",
      demo: "demo",
      client: "client",
      milestone: "milestone"
    };
    return map[raw?.toLowerCase() ?? ""] ?? "other";
  }

  private async findConnectionOrThrow(projectId: string, connectionId: string) {
    const row = await this.prisma.projectCalendarConnection.findFirst({
      where: { id: connectionId, projectId }
    });
    if (!row) throw new AppError(404, "Calendar connection not found", "calendar_connection_not_found");
    return row;
  }

  private async findLatestProviderConnection(projectId: string, provider: ProjectCalendarProvider) {
    return this.prisma.projectCalendarConnection.findFirst({
      where: { projectId, provider, status: { not: "revoked" } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
  }

  private async findActiveGoogleConnectionOrThrow(projectId: string) {
    const connection = await this.findLatestProviderConnection(projectId, "google_calendar");
    if (!connection || connection.status === "pending_auth" || connection.status === "revoked" || connection.status === "error") {
      throw new AppError(404, "Google Calendar connection not found", "calendar_connection_not_found");
    }
    return connection;
  }

  private async ensureReadableProject(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    assertProjectOpsReadable(member.projectRole);
    return member;
  }

  private connectionConfig(value: unknown): Record<string, unknown> {
    return readRecord(value) ?? {};
  }

  private selectedCalendarIds(value: unknown) {
    const configJson = this.connectionConfig(value);
    const selected = readStringArray(configJson["selectedCalendarIds"]);
    return selected.length > 0 ? selected : DEFAULT_GOOGLE_CALENDAR_IDS;
  }

  private readWebhookState(value: unknown): GoogleCalendarWebhookState {
    const raw = readRecord(this.connectionConfig(value)["webhookState"]);
    if (!raw) return this.defaultWebhookState(true);
    const mode = readString(raw["mode"]);
    const status = readString(raw["status"]);
    if (
      (mode === "webhook" || mode === "polling_fallback" || mode === "manual_sync") &&
      (status === "active" || status === "fallback" || status === "disabled" || status === "error")
    ) {
      return {
        mode,
        status,
        reason: readString(raw["reason"]) ?? null,
        updatedAt: readString(raw["updatedAt"]) ?? new Date().toISOString(),
        channelCount: typeof raw["channelCount"] === "number" ? raw["channelCount"] : undefined
      };
    }
    return this.defaultWebhookState(true);
  }

  private readWatchChannel(value: unknown, channelId: string): GoogleWatchChannelConfig | null {
    const channels = readRecord(this.connectionConfig(value)["googleWatchChannels"]);
    const raw = channels ? readRecord(channels[channelId]) : null;
    if (!raw) return null;
    const tokenHash = readString(raw["tokenHash"]);
    const calendarId = readString(raw["calendarId"]);
    if (!tokenHash || !calendarId) return null;
    return {
      calendarId,
      resourceId: readString(raw["resourceId"]) ?? null,
      tokenHash,
      expiration: readString(raw["expiration"]) ?? null
    };
  }

  private defaultWebhookState(configured: boolean): GoogleCalendarWebhookState {
    return {
      mode: "manual_sync",
      status: configured ? "disabled" : "error",
      reason: configured
        ? "Webhook registration has not run yet; manual sync remains available."
        : "Google Calendar OAuth is not configured.",
      updatedAt: new Date().toISOString()
    };
  }

  private syncModeFromWebhookState(state: GoogleCalendarWebhookState): "webhook" | "polling" | "manual" {
    if (state.mode === "webhook" && state.status === "active") return "webhook";
    if (state.mode === "polling_fallback") return "polling";
    return "manual";
  }

  private toConnectionItem(row: {
    id: string;
    projectId: string;
    provider: ProjectCalendarProvider;
    accountLabel: string;
    status: CalendarConnectionStatus;
    lastSyncedAt: Date | null;
    lastError: string | null;
    configJson?: unknown;
    createdAt: Date;
  }): CalendarConnectionItem {
    const webhookState = row.provider === "google_calendar" ? this.readWebhookState(row.configJson) : null;
    return {
      id: row.id,
      projectId: row.projectId,
      provider: row.provider,
      accountLabel: row.accountLabel,
      status: row.status,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      lastError: sanitizeProviderError(row.lastError),
      selectedCalendarIds: row.provider === "google_calendar" ? this.selectedCalendarIds(row.configJson) : undefined,
      syncMode: webhookState ? this.syncModeFromWebhookState(webhookState) : undefined,
      webhookState,
      createdAt: row.createdAt.toISOString()
    };
  }

  private toSyncRunItem(row: {
    id: string;
    connectionId: string;
    provider: ProjectCalendarProvider;
    syncType: CalendarSyncType;
    status: CalendarSyncStatus;
    summaryJson: unknown;
    errorMessage: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    createdAt: Date;
  }): CalendarSyncRunItem {
    return {
      id: row.id,
      connectionId: row.connectionId,
      provider: row.provider,
      syncType: row.syncType,
      status: row.status,
      summaryJson: (row.summaryJson as Record<string, unknown> | null) ?? null,
      errorMessage: sanitizeProviderError(row.errorMessage),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    };
  }
}

function sanitizeProviderError(message: string | null) {
  if (!message) {
    return null;
  }
  return message
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/(access_token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(refresh_token=)[^&\s]+/gi, "$1[redacted]");
}

function sanitizeEventDescription(description: string | null) {
  if (!description) return null;
  const withoutHtml = description.replace(/<[^>]*>/g, " ");
  const normalized = withoutHtml.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized;
}

function isGoogleAuthError(error: unknown) {
  return error instanceof Error && /google calendar token expired|401|unauthorized|revoked/i.test(error.message);
}

function constantTimeEqual(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

// ─── Provider event shape ──────────────────────────────────────────────────

type ProviderCalendarEvent = {
  externalRef: string | null;
  calendarId?: string | null;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  isAllDay: boolean;
  eventType: string;
  status?: string | null;
  privacy?: string | null;
  htmlLink?: string | null;
  updatedAt?: string | null;
  iCalUID?: string | null;
};

type GoogleCalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  visibility?: string;
  htmlLink?: string;
  updated?: string;
  iCalUID?: string;
};

type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: string;
};

type GoogleWatchChannelConfig = {
  calendarId: string;
  resourceId: string | null;
  tokenHash: string;
  expiration: string | null;
};

type GoogleConnectionRow = {
  id: string;
  provider: ProjectCalendarProvider;
  status: CalendarConnectionStatus;
  credentialsRef: string | null;
  configJson: unknown;
  lastSyncedAt?: Date | null;
  lastError?: string | null;
};

type OutlookCalendarEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
};

function extractDeltaToken(deltaLink: string): string | null {
  try {
    const url = new URL(deltaLink);
    return url.searchParams.get("$deltatoken") ?? deltaLink;
  } catch {
    return deltaLink;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === "string" && header.trim().length > 0 ? header : undefined;
}
