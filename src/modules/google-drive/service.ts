import crypto from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type ProjectDriveAccessMode,
  type ProjectDriveConnection,
  type ProjectDriveFile,
  type ProjectDriveFileIndexStatus,
  type ProjectDriveRootType,
  type ProjectDriveSyncRun,
  type ProjectDriveSyncStatus,
  type ProjectDriveSyncType
} from "@prisma/client";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import { CredentialVault } from "../../lib/communications/credential-vault.js";
import {
  isProviderReleaseValidated,
  PROVIDER_RELEASE_VALIDATION_REASON
} from "../../lib/integrations/provider-release.js";
import { JobNames, type JobDispatcher } from "../../lib/jobs/types.js";
import type { AuditService } from "../audit/service.js";
import type { DocumentService } from "../documents/service.js";
import type { ProjectService } from "../projects/service.js";
import { assertProjectOpsReadable } from "../project-ops/authz.js";

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";
const FRESH_SYNC_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_ALLOWED_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.ms-excel"
];
const GOOGLE_WORKSPACE_MIME_TYPES = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.presentation",
  "application/vnd.google-apps.spreadsheet"
]);
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type Actor = { userId: string; orgId: string };

type StoredDriveCredential = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string | null;
  email?: string | null;
  sub?: string | null;
  scopes?: string[];
};

type OAuthStatePayload = {
  connectionId: string;
  nonce: string;
  sig: string;
};

type GoogleDriveFileMetadata = {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  iconLink?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
  createdTime?: string;
  modifiedTime?: string;
  version?: string;
  md5Checksum?: string;
  size?: string;
  trashed?: boolean;
  driveId?: string;
  parents?: string[];
};

type GoogleFilesPage = {
  files?: GoogleDriveFileMetadata[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
};

type GoogleChangesPage = {
  changes?: Array<{
    fileId?: string;
    removed?: boolean;
    file?: GoogleDriveFileMetadata;
  }>;
  nextPageToken?: string;
  newStartPageToken?: string;
};

type SyncCounters = {
  filesScanned: number;
  filesDownloaded: number;
  filesIndexed: number;
  filesSkipped: number;
  filesFailed: number;
};

export class GoogleDriveService {
  private readonly credentialVault: CredentialVault;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly documentService: DocumentService,
    credentialVault?: CredentialVault
  ) {
    this.credentialVault = credentialVault ?? new CredentialVault(env);
  }

  async getStatus(projectId: string, actorUserId: string) {
    await this.ensureReadableProject(projectId, actorUserId);
    const enabled = this.isEnabled();
    const configured = enabled && this.isOAuthConfigured();
    const releaseValidated = isProviderReleaseValidated(this.env, "google_drive");
    const connection = await this.findLatestConnection(projectId);
    const [credentialMissing, latestSyncRun, selectedRootCount, fileCounts] = connection
      ? await Promise.all([
          this.credentialMissingForConnection(connection),
          this.latestSyncRun(connection.id),
          this.countSelectedExplicitRoots(connection.id),
          this.prisma.projectDriveFile.groupBy({
            by: ["indexStatus"],
            where: { projectId, connectionId: connection.id },
            _count: true
          })
        ])
      : [false, null, 0, [] as Array<{ indexStatus: ProjectDriveFileIndexStatus; _count: number }>];
    const effectiveStatus = this.effectiveConnectionStatus(connection, latestSyncRun, credentialMissing);

    return {
      state: !enabled || !configured
        ? "not_configured"
        : !connection || connection.status === "disconnected"
          ? "not_connected"
          : effectiveStatus,
      enabled,
      configured,
      releaseValidated,
      canConnect: configured && releaseValidated,
      canSync: configured && releaseValidated && Boolean(connection && connection.status !== "disconnected"),
      connected: Boolean(connection && ["connected", "syncing", "error", "needs_reauth", "stale_sync", "sync_failed"].includes(effectiveStatus ?? connection.status)),
      connection: connection ? this.toConnectionDto(connection, effectiveStatus, credentialMissing ? "Google Drive must be reconnected before syncing." : undefined) : null,
      latestSyncRun: latestSyncRun ? this.toSyncRunDto(latestSyncRun) : null,
      indexedFileCount: countStatus(fileCounts, "indexed"),
      skippedFileCount: countStatus(fileCounts, "skipped") + countStatus(fileCounts, "unsupported"),
      failedFileCount: countStatus(fileCounts, "failed"),
      webhooksEnabled: this.webhooksAvailable(),
      incrementalSyncEnabled: this.env.GOOGLE_DRIVE_INCREMENTAL_SYNC_ENABLED !== false,
      writeActionsEnabled: false,
      syncRootSelectionRequired: this.requireExplicitSyncRoots(),
      selectedRootCount,
      limitations: [
        ...this.statusLimitations(configured, connection),
        ...(releaseValidated ? [] : [PROVIDER_RELEASE_VALIDATION_REASON])
      ]
    };
  }

  async initiateConnect(input: {
    projectId: string;
    actorUserId: string;
    accessMode: ProjectDriveAccessMode;
    returnTo?: string;
  }) {
    this.assertReleaseValidated();
    await this.projectService.ensureProjectManager(input.projectId, input.actorUserId);
    this.assertConfigured();
    this.assertAccessModeAllowed(input.accessMode);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { orgId: true }
    });
    const nonce = crypto.randomBytes(32).toString("hex");
    const nonceHash = this.hash(nonce);
    const connection = await this.prisma.projectDriveConnection.create({
      data: {
        orgId: project.orgId,
        projectId: input.projectId,
        connectedByUserId: input.actorUserId,
        accessMode: input.accessMode,
        status: "pending_auth",
        metadataJson: {
          pendingNonceHash: nonceHash,
          nonceExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
          returnTo: safeReturnTo(input.returnTo)
        } as InputJsonValue
      }
    });

    const raw = `${connection.id}:${nonce}`;
    const sig = crypto.createHmac("sha256", this.env.CONNECTOR_OAUTH_STATE_SECRET).update(raw).digest("hex");
    const state = Buffer.from(JSON.stringify({ connectionId: connection.id, nonce, sig }), "utf8").toString("base64url");
    const redirectUrl = this.buildOAuthUrl(input.accessMode, state);

    await this.auditService.record({
      orgId: project.orgId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      eventType: "google_drive.connect_started",
      entityType: "project_drive_connection",
      entityId: connection.id,
      payload: { accessMode: input.accessMode }
    });

    return { connectionId: connection.id, redirectUrl };
  }

  async handleOAuthCallback(input: { code?: string; state?: string }) {
    this.assertReleaseValidated();
    if (!input.code || !input.state) {
      throw new AppError(400, "Missing Google Drive OAuth code or state", "google_drive_oauth_missing");
    }
    const state = this.parseState(input.state);
    const connection = await this.prisma.projectDriveConnection.findFirst({
      where: { id: state.connectionId, status: "pending_auth" }
    });
    if (!connection) {
      throw new AppError(400, "Invalid or expired Google Drive OAuth state", "google_drive_oauth_invalid_state");
    }
    this.verifyStateAgainstConnection(connection, state);
    await this.projectService.ensureProjectManager(connection.projectId, connection.connectedByUserId);

    const claimed = await this.prisma.projectDriveConnection.updateMany({
      where: { id: connection.id, status: "pending_auth" },
      data: { status: "syncing", lastErrorCode: null, lastErrorMessage: null }
    });
    if (claimed.count !== 1) {
      throw new AppError(400, "Google Drive OAuth state is already used", "google_drive_oauth_state_used");
    }

    try {
      const token = await this.exchangeCode(input.code);
      const about = await this.fetchAbout(token.accessToken);
      const requestedScopes = this.scopesForAccessMode(connection.accessMode);
      const scopes = (token.scopes?.length ?? 0) > 0 ? token.scopes! : requestedScopes;
      this.assertGrantedScopesMatchAccessMode(connection.accessMode, scopes);
      const credential = await this.credentialVault.putCredential({
        provider: "google_drive",
        connectorId: connection.id,
        credential: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000).toISOString() : null,
          email: about.email ?? null,
          sub: about.sub ?? null,
          scopes
        }
      });
      const returnTo = readString(readRecord(connection.metadataJson)["returnTo"]) ?? "/connectors";
      await this.prisma.$transaction(async (tx) => {
        await tx.projectDriveConnection.update({
          where: { id: connection.id },
          data: {
            status: "connected",
            googleAccountEmail: about.email ?? null,
            googleAccountSub: about.sub ?? null,
            credentialRef: credential.ref,
            grantedScopesJson: scopes as InputJsonValue,
            connectedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null,
            metadataJson: {
              oauthConnectedAt: new Date().toISOString(),
              returnTo
            } as InputJsonValue
          }
        });
        await tx.projectDriveSyncRoot.create({
          data: {
            orgId: connection.orgId,
            projectId: connection.projectId,
            connectionId: connection.id,
            rootType: connection.accessMode === "full_drive" ? "all_drive" : "selected_file",
            name: connection.accessMode === "full_drive" ? "Manager has not selected Drive sources yet" : "Selected files",
            selected: !this.requireExplicitSyncRoots(),
            includeChildren: true,
            mimeTypeAllowlist: this.allowedMimeTypes(),
            metadataJson: this.requireExplicitSyncRoots()
              ? ({ reason: "explicit_sync_roots_required" } as InputJsonValue)
              : Prisma.DbNull
          }
        });
      });
      await this.auditService.record({
        orgId: connection.orgId,
        projectId: connection.projectId,
        actorUserId: connection.connectedByUserId,
        eventType: "google_drive.connected",
        entityType: "project_drive_connection",
        entityId: connection.id,
        payload: { accessMode: connection.accessMode, accountEmail: about.email ?? null }
      });
      return { projectId: connection.projectId, connectionId: connection.id, returnTo };
    } catch (error) {
      const sanitized = sanitizeProviderError(error);
      await this.prisma.projectDriveConnection.update({
        where: { id: connection.id },
        data: { status: "error", lastErrorCode: "oauth_callback_failed", lastErrorMessage: sanitized }
      });
      await this.auditService.record({
        orgId: connection.orgId,
        projectId: connection.projectId,
        actorUserId: connection.connectedByUserId,
        eventType: "google_drive.connect_failed",
        entityType: "project_drive_connection",
        entityId: connection.id,
        payload: { error: sanitized }
      });
      throw new AppError(502, "Google Drive OAuth failed", "google_drive_oauth_failed");
    }
  }

  async listFiles(
    projectId: string,
    actorUserId: string,
    query: {
      status?: ProjectDriveFileIndexStatus;
      mimeType?: string;
      search?: string;
      limit: number;
      cursor?: string;
      includeUnsupported: boolean;
      includeTrashed: boolean;
    }
  ) {
    await this.ensureReadableProject(projectId, actorUserId);
    const cursorDate = query.cursor ? new Date(query.cursor) : null;
    const where: Prisma.ProjectDriveFileWhereInput = {
      projectId,
      ...(query.status ? { indexStatus: query.status } : {}),
      ...(query.mimeType ? { mimeType: query.mimeType } : {}),
      ...(query.includeUnsupported ? {} : { indexStatus: { not: "unsupported" } }),
      ...(query.includeTrashed ? {} : { trashed: false }),
      ...(cursorDate && !Number.isNaN(cursorDate.getTime()) ? { updatedAt: { lt: cursorDate } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { ownersSummary: { contains: query.search, mode: "insensitive" } }
            ]
          }
        : {})
    };
    const rows = await this.prisma.projectDriveFile.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      take: this.requireExplicitSyncRoots() ? 100 : query.limit + 1
    });
    const selectedRoots = await this.selectedSyncRootsForProject(projectId);
    const visibleRows = this.requireExplicitSyncRoots()
      ? rows.filter((row) => this.persistedDriveFileAllowedByRoots(row, selectedRoots))
      : rows;
    const page = visibleRows.slice(0, query.limit);
    return {
      items: page.map((file) => this.toFileDto(file)),
      meta: {
        hasMore: visibleRows.length > query.limit || rows.length === 100,
        nextCursor: (visibleRows.length > query.limit || rows.length === 100) ? page.at(-1)?.updatedAt.toISOString() ?? null : null
      }
    };
  }

  async listSyncRootCandidates(
    projectId: string,
    actorUserId: string,
    query: {
      search?: string;
      limit: number;
      cursor?: string;
      foldersOnly: boolean;
    }
  ) {
    this.assertReleaseValidated();
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const connection = await this.findActiveConnectionOrThrow(projectId);
    await this.assertCredentialAvailable(connection);
    const token = await this.accessTokenForConnection(connection);
    const page = await this.listRootCandidatePage(token, query);
    const candidates = (page.files ?? []).map((file) => {
      const normalized = normalizeDriveFile(file);
      return {
        googleFileId: normalized.id,
        googleDriveId: normalized.driveId ?? null,
        name: normalized.name,
        mimeType: normalized.mimeType,
        rootType: normalized.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE ? "folder" : "selected_file",
        includeChildren: normalized.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        webViewLink: safeUrl(normalized.webViewLink),
        iconLink: safeUrl(normalized.iconLink),
        modifiedTime: normalized.modifiedTime ?? null
      };
    });
    return {
      items: candidates,
      meta: {
        hasMore: Boolean(page.nextPageToken),
        nextCursor: page.nextPageToken ?? null
      }
    };
  }

  async updateSyncRoots(
    projectId: string,
    actorUserId: string,
    input: {
      accessMode?: ProjectDriveAccessMode;
      roots?: Array<{
        rootType: ProjectDriveRootType;
        googleDriveId?: string | null;
        googleFileId?: string | null;
        name: string;
        selected: boolean;
        includeChildren: boolean;
      }>;
    }
  ) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const connection = await this.findActiveConnectionOrThrow(projectId);
    if (input.accessMode) {
      this.assertAccessModeAllowed(input.accessMode);
    }
    if (input.roots) {
      await this.prisma.$transaction(async (tx) => {
        await tx.projectDriveSyncRoot.updateMany({
          where: { projectId, connectionId: connection.id },
          data: { selected: false }
        });
        for (const root of input.roots ?? []) {
          await tx.projectDriveSyncRoot.create({
            data: {
              orgId: connection.orgId,
              projectId,
              connectionId: connection.id,
              rootType: root.rootType,
              googleDriveId: root.googleDriveId ?? null,
              googleFileId: root.googleFileId ?? null,
              name: root.name,
              selected: root.selected,
              includeChildren: root.includeChildren,
              mimeTypeAllowlist: this.allowedMimeTypes()
            }
          });
        }
      });
    }
    if (input.accessMode && input.accessMode !== connection.accessMode) {
      throw new AppError(
        409,
        "Changing Google Drive access mode requires reconnecting and granting the matching OAuth scopes",
        "google_drive_access_mode_reconnect_required"
      );
    }
    await this.auditService.record({
      orgId: connection.orgId,
      projectId,
      actorUserId,
      eventType: "google_drive.sync_roots_updated",
      entityType: "project_drive_connection",
      entityId: connection.id,
      payload: { rootCount: input.roots?.length ?? null, accessMode: input.accessMode ?? connection.accessMode }
    });
    return this.getStatus(projectId, actorUserId);
  }

  async triggerSync(
    projectId: string,
    actorUserId: string,
    input: {
      syncType: "full" | "incremental" | "manual";
      maxFiles?: number;
      dryRun?: boolean;
      forceReindex?: boolean;
    }
  ) {
    this.assertReleaseValidated();
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const connection = await this.findActiveConnectionOrThrow(projectId);
    if (input.dryRun) {
      return {
        dryRun: true,
        connectionId: connection.id,
        syncType: input.syncType,
        maxFiles: this.resolveMaxFiles(input.maxFiles, input.syncType),
        selectedRootCount: await this.countSelectedExplicitRoots(connection.id)
      };
    }
    if (this.requireExplicitSyncRoots() && await this.countSelectedExplicitRoots(connection.id) === 0) {
      throw new AppError(
        409,
        "Choose allowed Google Drive files or folders before syncing.",
        "google_drive_sync_roots_required"
      );
    }
    await this.assertCredentialAvailable(connection);
    const syncType: ProjectDriveSyncType = input.syncType === "manual" ? "manual" : input.syncType;
    const run = await this.prisma.projectDriveSyncRun.create({
      data: {
        orgId: connection.orgId,
        projectId,
        connectionId: connection.id,
        startedByUserId: actorUserId,
        syncType,
        status: "queued",
        metadataJson: {
          maxFiles: this.resolveMaxFiles(input.maxFiles, syncType),
          forceReindex: input.forceReindex === true
        } as InputJsonValue
      }
    });
    await this.jobs.enqueue(
      JobNames.syncGoogleDriveConnection,
      {
        connectionId: connection.id,
        projectId,
        syncType,
        syncRunId: run.id,
        maxFiles: this.resolveMaxFiles(input.maxFiles, syncType),
        forceReindex: input.forceReindex === true
      },
      `google-drive-sync:${connection.id}:${run.id}`
    );
    return this.toSyncRunDto(run);
  }

  async runSyncJob(input: {
    connectionId: string;
    projectId: string;
    syncType: ProjectDriveSyncType;
    syncRunId: string;
    maxFiles?: number;
    forceReindex?: boolean;
  }) {
    this.assertReleaseValidated();
    const run = await this.prisma.projectDriveSyncRun.findUniqueOrThrow({ where: { id: input.syncRunId } });
    const connection = await this.prisma.projectDriveConnection.findFirstOrThrow({
      where: { id: input.connectionId, projectId: input.projectId }
    });
    await this.prisma.projectDriveSyncRun.update({
      where: { id: run.id },
      data: { status: "running", startedAt: new Date() }
    });
    await this.prisma.projectDriveConnection.update({
      where: { id: connection.id },
      data: { status: "syncing", lastErrorCode: null, lastErrorMessage: null }
    });

    const counters: SyncCounters = { filesScanned: 0, filesDownloaded: 0, filesIndexed: 0, filesSkipped: 0, filesFailed: 0 };
    try {
      const maxFiles = this.resolveMaxFiles(input.maxFiles, input.syncType);
      await this.runSyncPassWithAuthRetry(connection, input.syncType, counters, maxFiles, input.forceReindex === true);
      const status: ProjectDriveSyncStatus = counters.filesFailed > 0 ? "partial" : "completed";
      await this.prisma.projectDriveSyncRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          ...counters
        }
      });
      await this.prisma.projectDriveConnection.update({
        where: { id: connection.id },
        data: {
          status: status === "completed" || status === "partial" ? "connected" : "error",
          lastSyncedAt: new Date(),
          lastErrorCode: status === "partial" ? "partial_sync" : null,
          lastErrorMessage: status === "partial" ? `${counters.filesFailed} Drive file(s) failed to index.` : null
        }
      });
      await this.auditService.record({
        orgId: connection.orgId,
        projectId: connection.projectId,
        actorUserId: run.startedByUserId ?? connection.connectedByUserId,
        eventType: status === "completed" ? "google_drive.sync_completed" : "google_drive.sync_partial",
        entityType: "project_drive_sync_run",
        entityId: run.id,
        payload: counters
      });
      return { ...counters, status };
    } catch (error) {
      const sanitized = sanitizeProviderError(error);
      const authFailure = isGoogleAuthFailure(error);
      await this.prisma.projectDriveSyncRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          ...counters,
          errorCode: authFailure ? "needs_reauth" : "sync_failed",
          errorMessage: sanitized
        }
      });
      await this.prisma.projectDriveConnection.update({
        where: { id: connection.id },
        data: {
          status: authFailure ? "needs_reauth" : "error",
          lastErrorCode: authFailure ? "needs_reauth" : "sync_failed",
          lastErrorMessage: sanitized
        }
      });
      await this.auditService.record({
        orgId: connection.orgId,
        projectId: connection.projectId,
        actorUserId: run.startedByUserId ?? connection.connectedByUserId,
        eventType: "google_drive.sync_failed",
        entityType: "project_drive_sync_run",
        entityId: run.id,
        payload: { error: sanitized }
      });
      throw error;
    }
  }

  private async runSyncPassWithAuthRetry(
    connection: ProjectDriveConnection,
    syncType: ProjectDriveSyncType,
    counters: SyncCounters,
    maxFiles: number,
    forceReindex: boolean
  ) {
    try {
      const token = await this.accessTokenForConnection(connection);
      await this.runSyncPass(connection, token, syncType, counters, maxFiles, forceReindex);
    } catch (error) {
      if (!isGoogleAuthFailure(error)) throw error;
      resetSyncCounters(counters);
      const token = await this.refreshAccessTokenForConnection(connection);
      await this.runSyncPass(connection, token, syncType, counters, maxFiles, forceReindex);
    }
  }

  private async runSyncPass(
    connection: ProjectDriveConnection,
    token: string,
    syncType: ProjectDriveSyncType,
    counters: SyncCounters,
    maxFiles: number,
    forceReindex: boolean
  ) {
    if (syncType === "incremental" || syncType === "webhook") {
      await this.runIncrementalSync(connection, token, counters, maxFiles, forceReindex);
      return;
    }
    await this.runFullSync(connection, token, counters, maxFiles, forceReindex);
  }

  async disconnect(projectId: string, actorUserId: string) {
    await this.projectService.ensureProjectManager(projectId, actorUserId);
    const connection = await this.findActiveConnectionOrThrow(projectId);
    const token = await this.tryAccessTokenForConnection(connection).catch(() => null);
    const credential = await this.credentialVault.getCredential("google_drive", connection.id, connection.credentialRef);
    const channels = await this.prisma.projectDriveWatchChannel.findMany({
      where: { connectionId: connection.id, status: "active" }
    });
    let watchStopFailures = 0;
    for (const channel of channels) {
      if (token) {
        try {
          await this.stopWatchChannel(token, channel.channelId, channel.resourceId);
        } catch {
          watchStopFailures += 1;
        }
      }
      await this.prisma.projectDriveWatchChannel.update({
        where: { id: channel.id },
        data: { status: "stopped", stoppedAt: new Date() }
      });
    }
    const providerRevoked = await this.revokeGoogleCredential(credential);
    await this.credentialVault.revokeCredential("google_drive", connection.id, connection.credentialRef);
    await this.prisma.projectDriveConnection.update({
      where: { id: connection.id },
      data: {
        status: "disconnected",
        disconnectedAt: new Date(),
        credentialRef: null,
        lastErrorCode: null,
        lastErrorMessage: providerRevoked
          ? null
          : "Google grant was already unavailable; the local credential was removed."
      }
    });
    await this.auditService.record({
      orgId: connection.orgId,
      projectId,
      actorUserId,
      eventType: "google_drive.disconnected",
      entityType: "project_drive_connection",
      entityId: connection.id,
      payload: { preservedIndexedDocuments: true, providerRevoked, watchStopFailures }
    });
    return { ok: true, providerRevoked, watchStopFailures };
  }

  private async revokeGoogleCredential(credential: Record<string, unknown> | null) {
    const refreshToken = typeof credential?.refreshToken === "string" ? credential.refreshToken : null;
    const accessToken = typeof credential?.accessToken === "string" ? credential.accessToken : null;
    const token = refreshToken ?? accessToken;
    if (!token) return false;
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token })
    });
    if (!response.ok && response.status !== 400) {
      throw new AppError(502, "Google Drive grant revocation failed", "google_drive_provider_revoke_failed");
    }
    return true;
  }

  async handleWebhook(headers: Record<string, string | string[] | undefined>) {
    this.assertReleaseValidated();
    if (!this.webhooksAvailable()) {
      return { ok: true, ignored: true, syncQueued: false, reason: "webhooks_disabled_or_unconfigured" };
    }
    const channelId = firstHeader(headers["x-goog-channel-id"]);
    const channelToken = firstHeader(headers["x-goog-channel-token"]);
    const resourceId = firstHeader(headers["x-goog-resource-id"]);
    if (!channelId || !channelToken) {
      return { ok: true, ignored: true, syncQueued: false, reason: "missing_channel_headers" };
    }
    const channel = await this.prisma.projectDriveWatchChannel.findUnique({ where: { channelId } });
    if (!channel || channel.status !== "active") {
      return { ok: true, ignored: true, syncQueued: false, reason: "unknown_channel" };
    }
    if (resourceId && channel.resourceId && resourceId !== channel.resourceId) {
      return { ok: true, ignored: true, syncQueued: false, reason: "resource_mismatch" };
    }
    const tokenHash = this.hash(channelToken);
    if (!constantTimeEqual(tokenHash, channel.tokenHash)) {
      return { ok: true, ignored: true, syncQueued: false, reason: "invalid_channel_token" };
    }
    await this.prisma.projectDriveWatchChannel.update({
      where: { id: channel.id },
      data: { lastNotificationAt: new Date() }
    });
    const run = await this.prisma.projectDriveSyncRun.create({
      data: {
        orgId: channel.orgId,
        projectId: channel.projectId,
        connectionId: channel.connectionId,
        syncType: "webhook",
        status: "queued",
        metadataJson: { channelId } as InputJsonValue
      }
    });
    await this.jobs.enqueue(
      JobNames.syncGoogleDriveConnection,
      {
        connectionId: channel.connectionId,
        projectId: channel.projectId,
        syncType: "webhook" as ProjectDriveSyncType,
        syncRunId: run.id,
        maxFiles: this.env.GOOGLE_DRIVE_INCREMENTAL_SYNC_MAX_FILES
      },
      `google-drive-sync:${channel.connectionId}:webhook:${run.id}`
    );
    await this.auditService.record({
      orgId: channel.orgId,
      projectId: channel.projectId,
      actorUserId: "system",
      eventType: "google_drive.webhook_received",
      entityType: "project_drive_watch_channel",
      entityId: channel.id,
      payload: { resourceId: resourceId ?? null }
    });
    return { ok: true, ignored: false, syncQueued: true, reason: null };
  }

  private async runFullSync(
    connection: ProjectDriveConnection,
    token: string,
    counters: SyncCounters,
    maxFiles: number,
    forceReindex: boolean
  ) {
    const selectedRoots = await this.selectedSyncRoots(connection.id);
    if (this.requireExplicitSyncRoots() && selectedRoots.length === 0) {
      return;
    }
    if (selectedRoots.length > 0 && selectedRoots.every((root) => root.rootType !== "all_drive" && root.rootType !== "my_drive" && root.rootType !== "shared_drive")) {
      await this.runScopedFullSync(connection, token, counters, maxFiles, forceReindex, selectedRoots);
      return;
    }
    let pageToken: string | undefined;
    let incompleteSearch = false;
    while (counters.filesScanned < maxFiles) {
      const page = await this.listFilesPage(token, pageToken);
      incompleteSearch = incompleteSearch || page.incompleteSearch === true;
      for (const file of page.files ?? []) {
        if (counters.filesScanned >= maxFiles) break;
        counters.filesScanned += 1;
        await this.processDriveFile(connection, token, file, counters, forceReindex);
      }
      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
    const startToken = await this.getStartPageToken(token).catch(() => null);
    if (startToken) {
      await this.prisma.projectDriveSyncRoot.updateMany({
        where: { connectionId: connection.id, selected: true },
        data: {
          lastStartPageToken: startToken,
          lastChangePageToken: startToken,
          lastSyncedAt: new Date(),
          metadataJson: incompleteSearch ? { incompleteSearch: true } : Prisma.DbNull
        }
      });
    }
  }

  private async runIncrementalSync(
    connection: ProjectDriveConnection,
    token: string,
    counters: SyncCounters,
    maxFiles: number,
    forceReindex: boolean
  ) {
    const roots = await this.prisma.projectDriveSyncRoot.findMany({
      where: this.selectedRootWhere(connection.id),
      take: 10
    });
    if (this.requireExplicitSyncRoots() && roots.length === 0) return;
    const root = roots[0];
    const pageToken = root?.lastChangePageToken ?? root?.lastStartPageToken;
    if (!pageToken) {
      await this.runFullSync(connection, token, counters, maxFiles, forceReindex);
      return;
    }
    let nextPageToken: string | undefined = pageToken;
    let newStartPageToken: string | null = null;
    try {
      while (nextPageToken && counters.filesScanned < maxFiles) {
        const page = await this.listChangesPage(token, nextPageToken);
        for (const change of page.changes ?? []) {
          if (counters.filesScanned >= maxFiles) break;
          counters.filesScanned += 1;
          if (change.removed || change.file?.trashed) {
            if (change.fileId) {
              await this.prisma.projectDriveFile.updateMany({
                where: { projectId: connection.projectId, connectionId: connection.id, driveFileId: change.fileId },
                data: { trashed: true, indexStatus: "skipped" }
              });
            }
            counters.filesSkipped += 1;
            continue;
          }
          if (change.file) {
            const allowed = await this.googleFileAllowedByRoots(connection, change.file, roots);
            if (!allowed.allowed) {
              counters.filesSkipped += 1;
              continue;
            }
            await this.processDriveFile(connection, token, change.file, counters, forceReindex, allowed.allowedRootIds);
          }
        }
        nextPageToken = page.nextPageToken;
        newStartPageToken = page.newStartPageToken ?? newStartPageToken;
      }
      if (newStartPageToken) {
        await this.prisma.projectDriveSyncRoot.updateMany({
          where: { connectionId: connection.id, selected: true },
          data: {
            lastChangePageToken: newStartPageToken,
            lastStartPageToken: newStartPageToken,
            lastSyncedAt: new Date()
          }
        });
      }
    } catch (error) {
      if (/410|invalid/i.test(sanitizeProviderError(error))) {
        await this.prisma.projectDriveSyncRoot.updateMany({
          where: { connectionId: connection.id, selected: true },
          data: { lastChangePageToken: null }
        });
        await this.runFullSync(connection, token, counters, maxFiles, forceReindex);
        return;
      }
      throw error;
    }
  }

  private async processDriveFile(
    connection: ProjectDriveConnection,
    token: string,
    file: GoogleDriveFileMetadata,
    counters: SyncCounters,
    forceReindex: boolean,
    allowedRootIds: string[] = []
  ) {
    const metadata = normalizeDriveFile(file);
    if (!metadata.id || !metadata.mimeType) {
      counters.filesSkipped += 1;
      return;
    }
    const allowed = this.allowedMimeTypes();
    const supported = allowed.includes(metadata.mimeType);
    const sizeBytes = metadata.size ? Number(metadata.size) : null;
    const maxBytes = this.env.GOOGLE_DRIVE_MAX_FILE_SIZE_MB * 1024 * 1024;
    const baseData = this.driveFileData(connection, metadata);
    let row = await this.prisma.projectDriveFile.upsert({
      where: { projectId_driveFileId: { projectId: connection.projectId, driveFileId: metadata.id } },
      update: baseData,
      create: baseData
    });
    if (!supported) {
      await this.markDriveFile(row.id, "unsupported", "unsupported_mime_type");
      counters.filesSkipped += 1;
      return;
    }
    if (sizeBytes != null && sizeBytes > maxBytes) {
      await this.markDriveFile(row.id, "skipped", "file_too_large");
      counters.filesSkipped += 1;
      return;
    }
    if (metadata.trashed) {
      await this.markDriveFile(row.id, "skipped", "file_trashed");
      counters.filesSkipped += 1;
      return;
    }
    try {
      const downloaded = await this.downloadOrExportFile(token, metadata);
      if (downloaded.buffer.length > maxBytes) {
        await this.markDriveFile(row.id, "skipped", "download_too_large");
        counters.filesSkipped += 1;
        return;
      }
      const contentHash = crypto.createHash("sha256").update(downloaded.buffer).digest("hex");
      if (!forceReindex && row.contentHash === contentHash && row.indexStatus === "indexed") {
        counters.filesSkipped += 1;
        return;
      }
      counters.filesDownloaded += 1;
      const upload = await this.documentService.uploadFile({
        projectId: connection.projectId,
        actorUserId: connection.connectedByUserId,
        kind: "reference",
        title: metadata.name,
        visibility: "internal",
        sourceLabel: "google_drive",
        makePrimaryLiveDoc: false,
        fileName: downloaded.fileName,
        contentType: downloaded.contentType,
        buffer: downloaded.buffer
      });
      row = await this.prisma.projectDriveFile.update({
        where: { id: row.id },
        data: {
          documentId: upload.documentId,
          documentVersionId: upload.documentVersionId,
          indexStatus: "indexed",
          lastIndexedAt: new Date(),
          lastError: null,
          contentHash,
          metadataJson: {
            sourceProvider: "google_drive",
            webViewLink: metadata.webViewLink ?? null,
            exportedContentType: downloaded.contentType,
            allowedRootIds
          } as InputJsonValue
        }
      });
      counters.filesIndexed += 1;
      await this.auditService.record({
        orgId: connection.orgId,
        projectId: connection.projectId,
        actorUserId: connection.connectedByUserId,
        eventType: "google_drive.file_indexed",
        entityType: "project_drive_file",
        entityId: row.id,
        payload: { driveFileId: metadata.id, mimeType: metadata.mimeType, documentId: upload.documentId }
      });
    } catch (error) {
      if (isGoogleAuthFailure(error)) throw error;
      await this.markDriveFile(row.id, "failed", sanitizeProviderError(error));
      counters.filesFailed += 1;
    }
  }

  private async exchangeCode(code: string) {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        redirect_uri: this.redirectUri(),
        grant_type: "authorization_code"
      }).toString()
    });
    if (!response.ok) {
      throw new Error(`Google Drive token exchange failed: ${response.status} ${sanitizeProviderError(await response.text())}`);
    }
    const body = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresIn: body.expires_in,
      scopes: body.scope?.split(/\s+/).filter(Boolean) ?? []
    };
  }

  private async fetchAbout(accessToken: string) {
    const response = await this.googleFetch(accessToken, `${GOOGLE_DRIVE_BASE_URL}/about?fields=user(emailAddress,permissionId,displayName)`);
    const body = await response.json() as { user?: { emailAddress?: string; permissionId?: string } };
    return { email: body.user?.emailAddress ?? null, sub: body.user?.permissionId ?? null };
  }

  private async listFilesPage(accessToken: string, pageToken?: string): Promise<GoogleFilesPage> {
    const params = new URLSearchParams({
      spaces: "drive",
      pageSize: String(this.env.GOOGLE_DRIVE_SYNC_PAGE_SIZE),
      q: "trashed = false",
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,iconLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),createdTime,modifiedTime,version,md5Checksum,size,trashed,driveId,parents)",
      supportsAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES),
      includeItemsFromAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES),
      corpora: this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES ? "allDrives" : "user"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await this.googleFetch(accessToken, `${GOOGLE_DRIVE_BASE_URL}/files?${params.toString()}`);
    return response.json() as Promise<GoogleFilesPage>;
  }

  private async listRootCandidatePage(
    accessToken: string,
    query: { search?: string; limit: number; cursor?: string; foldersOnly: boolean }
  ): Promise<GoogleFilesPage> {
    const clauses = ["trashed = false"];
    if (query.foldersOnly) {
      clauses.push(`mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}'`);
    } else {
      clauses.push(`(mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}' or mimeType != '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}')`);
    }
    if (query.search) {
      clauses.push(`name contains '${escapeDriveQueryValue(query.search)}'`);
    }
    const params = new URLSearchParams({
      spaces: "drive",
      pageSize: String(query.limit),
      q: clauses.join(" and "),
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,iconLink,modifiedTime,driveId,parents)",
      supportsAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES),
      includeItemsFromAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES),
      corpora: this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES ? "allDrives" : "user",
      orderBy: "folder,name"
    });
    if (query.cursor) params.set("pageToken", query.cursor);
    const response = await this.googleFetch(accessToken, `${GOOGLE_DRIVE_BASE_URL}/files?${params.toString()}`);
    return response.json() as Promise<GoogleFilesPage>;
  }

  private async listFilesPageForParent(accessToken: string, parentId: string, pageToken?: string): Promise<GoogleFilesPage> {
    const params = new URLSearchParams({
      spaces: "drive",
      pageSize: String(this.env.GOOGLE_DRIVE_SYNC_PAGE_SIZE),
      q: `'${escapeDriveQueryValue(parentId)}' in parents and trashed = false`,
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,iconLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),createdTime,modifiedTime,version,md5Checksum,size,trashed,driveId,parents)",
      supportsAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES),
      includeItemsFromAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES)
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await this.googleFetch(accessToken, `${GOOGLE_DRIVE_BASE_URL}/files?${params.toString()}`);
    return response.json() as Promise<GoogleFilesPage>;
  }

  private async getDriveFileMetadata(accessToken: string, fileId: string): Promise<GoogleDriveFileMetadata> {
    const params = new URLSearchParams({
      fields: "id,name,mimeType,webViewLink,iconLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),createdTime,modifiedTime,version,md5Checksum,size,trashed,driveId,parents",
      supportsAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES)
    });
    const response = await this.googleFetch(accessToken, `${GOOGLE_DRIVE_BASE_URL}/files/${encodeURIComponent(fileId)}?${params.toString()}`);
    return response.json() as Promise<GoogleDriveFileMetadata>;
  }

  private async runScopedFullSync(
    connection: ProjectDriveConnection,
    token: string,
    counters: SyncCounters,
    maxFiles: number,
    forceReindex: boolean,
    roots: Awaited<ReturnType<GoogleDriveService["selectedSyncRoots"]>>
  ) {
    const seen = new Set<string>();
    for (const root of roots) {
      if (counters.filesScanned >= maxFiles) break;
      if (root.rootType === "selected_file" && root.googleFileId) {
        const file = await this.getDriveFileMetadata(token, root.googleFileId);
        if (seen.has(file.id)) continue;
        seen.add(file.id);
        counters.filesScanned += 1;
        await this.processDriveFile(connection, token, file, counters, forceReindex, [root.id]);
        continue;
      }
      if (root.rootType === "folder" && root.googleFileId) {
        await this.runFolderSync(connection, token, counters, maxFiles, forceReindex, root.googleFileId, root.id, root.includeChildren, seen);
      }
    }
    const startToken = await this.getStartPageToken(token).catch(() => null);
    if (startToken) {
      await this.prisma.projectDriveSyncRoot.updateMany({
        where: { id: { in: roots.map((root) => root.id) } },
        data: {
          lastStartPageToken: startToken,
          lastChangePageToken: startToken,
          lastSyncedAt: new Date()
        }
      });
    }
  }

  private async runFolderSync(
    connection: ProjectDriveConnection,
    token: string,
    counters: SyncCounters,
    maxFiles: number,
    forceReindex: boolean,
    folderId: string,
    rootRowId: string,
    includeChildren: boolean,
    seen: Set<string>
  ) {
    const queue = [folderId];
    const visitedFolders = new Set<string>();
    while (queue.length > 0 && counters.filesScanned < maxFiles) {
      const parentId = queue.shift()!;
      if (visitedFolders.has(parentId)) continue;
      visitedFolders.add(parentId);
      let pageToken: string | undefined;
      do {
        const page = await this.listFilesPageForParent(token, parentId, pageToken);
        for (const file of page.files ?? []) {
          if (counters.filesScanned >= maxFiles) break;
          const normalized = normalizeDriveFile(file);
          if (seen.has(normalized.id)) continue;
          seen.add(normalized.id);
          if (normalized.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE) {
            if (includeChildren) queue.push(normalized.id);
            continue;
          }
          counters.filesScanned += 1;
          await this.processDriveFile(connection, token, normalized, counters, forceReindex, [rootRowId]);
        }
        pageToken = page.nextPageToken;
      } while (pageToken && counters.filesScanned < maxFiles);
    }
  }

  private async listChangesPage(accessToken: string, pageToken: string): Promise<GoogleChangesPage> {
    const params = new URLSearchParams({
      pageToken,
      pageSize: String(this.env.GOOGLE_DRIVE_SYNC_PAGE_SIZE),
      fields: "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,webViewLink,iconLink,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),createdTime,modifiedTime,version,md5Checksum,size,trashed,driveId,parents))",
      supportsAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES),
      includeItemsFromAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES)
    });
    const response = await this.googleFetch(accessToken, `${GOOGLE_DRIVE_BASE_URL}/changes?${params.toString()}`);
    return response.json() as Promise<GoogleChangesPage>;
  }

  private async getStartPageToken(accessToken: string) {
    const params = new URLSearchParams({
      supportsAllDrives: String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES)
    });
    const response = await this.googleFetch(accessToken, `${GOOGLE_DRIVE_BASE_URL}/changes/startPageToken?${params.toString()}`);
    const body = await response.json() as { startPageToken?: string };
    return body.startPageToken ?? null;
  }

  private async downloadOrExportFile(accessToken: string, file: GoogleDriveFileMetadata) {
    const mimeType = file.mimeType ?? "application/octet-stream";
    if (GOOGLE_WORKSPACE_MIME_TYPES.has(mimeType)) {
      const exportMime = this.exportMimeType(mimeType);
      const response = await this.googleFetch(
        accessToken,
        `${GOOGLE_DRIVE_BASE_URL}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportMime)}`
      );
      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: exportMime,
        fileName: `${safeBaseName(file.name ?? file.id)}${extensionForContentType(exportMime)}`
      };
    }
    const response = await this.googleFetch(
      accessToken,
      `${GOOGLE_DRIVE_BASE_URL}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=${String(this.env.GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES)}`
    );
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: normalizeBlobContentType(mimeType),
      fileName: `${safeBaseName(file.name ?? file.id)}${extensionForContentType(normalizeBlobContentType(mimeType), file.name)}`
    };
  }

  private async googleFetch(accessToken: string, url: string, init?: RequestInit) {
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Drive API error ${response.status}: ${sanitizeProviderError(text)}`);
    }
    return response;
  }

  private async accessTokenForConnection(connection: ProjectDriveConnection) {
    const token = await this.tryAccessTokenForConnection(connection);
    if (!token) {
      throw new AppError(409, "Google Drive credentials are missing", "google_drive_credentials_missing");
    }
    return token;
  }

  private async tryAccessTokenForConnection(connection: ProjectDriveConnection) {
    const credential = await this.credentialVault.getCredential("google_drive", connection.id, connection.credentialRef) as StoredDriveCredential | null;
    if (!credential?.accessToken) return null;
    const expiresAt = credential.expiresAt ? Date.parse(credential.expiresAt) : 0;
    if (!credential.refreshToken || expiresAt > Date.now() + 60_000) {
      return credential.accessToken;
    }
    const refreshed = await this.refreshAccessToken(credential.refreshToken);
    await this.credentialVault.putCredential({
      provider: "google_drive",
      connectorId: connection.id,
      credential: {
        ...credential,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() : null
      }
    });
    return refreshed.accessToken;
  }

  private async refreshAccessToken(refreshToken: string) {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        grant_type: "refresh_token"
      }).toString()
    });
    if (!response.ok) {
      throw new Error(`Google Drive token refresh failed: ${response.status} ${sanitizeProviderError(await response.text())}`);
    }
    const body = await response.json() as { access_token: string; expires_in?: number };
    return { accessToken: body.access_token, expiresIn: body.expires_in };
  }

  private async refreshAccessTokenForConnection(connection: ProjectDriveConnection) {
    const credential = await this.credentialVault.getCredential("google_drive", connection.id, connection.credentialRef) as StoredDriveCredential | null;
    if (!credential?.refreshToken) {
      throw new AppError(401, "Google Drive refresh token is missing", "google_drive_needs_reauth");
    }
    const refreshed = await this.refreshAccessToken(credential.refreshToken);
    await this.credentialVault.putCredential({
      provider: "google_drive",
      connectorId: connection.id,
      credential: {
        ...credential,
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() : null
      }
    });
    return refreshed.accessToken;
  }

  private async stopWatchChannel(accessToken: string, channelId: string, resourceId: string | null) {
    if (!resourceId) return;
    await this.googleFetch(accessToken, `${GOOGLE_DRIVE_BASE_URL}/channels/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: channelId, resourceId })
    });
  }

  private buildOAuthUrl(accessMode: ProjectDriveAccessMode, state: string) {
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.redirectUri(),
      response_type: "code",
      scope: this.scopesForAccessMode(accessMode).join(" "),
      access_type: "offline",
      prompt: "consent",
      state
    });
    return `${GOOGLE_OAUTH_URL}?${params.toString()}`;
  }

  private scopesForAccessMode(accessMode: ProjectDriveAccessMode) {
    if (accessMode === "selected_files") {
      return ["https://www.googleapis.com/auth/drive.file"];
    }
    return this.env.GOOGLE_DRIVE_SCOPES.length > 0
      ? this.env.GOOGLE_DRIVE_SCOPES
      : [
          "https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/drive.metadata.readonly"
        ];
  }

  private assertGrantedScopesMatchAccessMode(accessMode: ProjectDriveAccessMode, scopes: string[]) {
    if (accessMode !== "selected_files") return;
    const allowed = new Set([
      "https://www.googleapis.com/auth/drive.file",
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile"
    ]);
    const excessiveScopes = scopes.filter((scope) => !allowed.has(scope));
    if (excessiveScopes.length > 0 || !scopes.includes("https://www.googleapis.com/auth/drive.file")) {
      throw new AppError(
        409,
        "Google granted scopes broader than selected-file access; reconnect with selected-file permissions",
        "google_drive_scope_mismatch"
      );
    }
  }

  private allowedMimeTypes() {
    return this.env.GOOGLE_DRIVE_ALLOWED_MIME_TYPES.length > 0
      ? this.env.GOOGLE_DRIVE_ALLOWED_MIME_TYPES
      : DEFAULT_ALLOWED_MIME_TYPES;
  }

  private exportMimeType(mimeType: string) {
    if (mimeType === "application/vnd.google-apps.spreadsheet") return this.env.GOOGLE_DRIVE_EXPORT_GOOGLE_SHEETS_AS;
    if (mimeType === "application/vnd.google-apps.presentation") return this.env.GOOGLE_DRIVE_EXPORT_GOOGLE_SLIDES_AS;
    return this.env.GOOGLE_DRIVE_EXPORT_GOOGLE_DOCS_AS;
  }

  private driveFileData(connection: ProjectDriveConnection, file: Required<Pick<GoogleDriveFileMetadata, "id" | "name" | "mimeType">> & GoogleDriveFileMetadata) {
    return {
      orgId: connection.orgId,
      projectId: connection.projectId,
      connectionId: connection.id,
      driveFileId: file.id,
      driveId: file.driveId ?? null,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: safeUrl(file.webViewLink),
      iconLink: safeUrl(file.iconLink),
      ownersSummary: summarizePeople(file.owners),
      lastModifyingUserSummary: summarizePerson(file.lastModifyingUser),
      createdTime: file.createdTime ? new Date(file.createdTime) : null,
      modifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : null,
      version: file.version ?? null,
      md5Checksum: file.md5Checksum ?? null,
      size: file.size ? BigInt(file.size) : null,
      trashed: file.trashed === true,
      sharedDrive: Boolean(file.driveId),
      parentsJson: (file.parents ?? []) as InputJsonValue
    };
  }

  private async markDriveFile(id: string, status: ProjectDriveFileIndexStatus, error: string | null) {
    await this.prisma.projectDriveFile.update({
      where: { id },
      data: {
        indexStatus: status,
        lastError: sanitizeProviderError(error)
      }
    });
  }

  private requireExplicitSyncRoots() {
    return this.env.GOOGLE_DRIVE_REQUIRE_SYNC_ROOTS !== false;
  }

  private selectedRootWhere(connectionId: string): Prisma.ProjectDriveSyncRootWhereInput {
    return {
      connectionId,
      selected: true,
      ...(this.requireExplicitSyncRoots()
        ? { rootType: { in: ["folder", "selected_file"] } }
        : {})
    };
  }

  private async selectedSyncRoots(connectionId: string) {
    return this.prisma.projectDriveSyncRoot.findMany({
      where: this.selectedRootWhere(connectionId),
      orderBy: [{ createdAt: "asc" }],
      take: 25
    });
  }

  private async selectedSyncRootsForProject(projectId: string) {
    return this.prisma.projectDriveSyncRoot.findMany({
      where: {
        projectId,
        selected: true,
        ...(this.requireExplicitSyncRoots()
          ? { rootType: { in: ["folder", "selected_file"] } }
          : {})
      },
      orderBy: [{ createdAt: "asc" }],
      take: 25
    });
  }

  private async countSelectedExplicitRoots(connectionId: string) {
    return this.prisma.projectDriveSyncRoot.count({
      where: this.selectedRootWhere(connectionId)
    });
  }

  private async credentialMissingForConnection(connection: ProjectDriveConnection) {
    if (["pending_auth", "disconnected"].includes(connection.status)) return false;
    if (!connection.credentialRef) return true;
    try {
      const credential = await this.credentialVault.getCredential("google_drive", connection.id, connection.credentialRef) as StoredDriveCredential | null;
      return !credential?.accessToken && !credential?.refreshToken;
    } catch {
      return true;
    }
  }

  private async assertCredentialAvailable(connection: ProjectDriveConnection) {
    if (await this.credentialMissingForConnection(connection)) {
      await this.prisma.projectDriveConnection.update({
        where: { id: connection.id },
        data: {
          status: "needs_reauth",
          lastErrorCode: "google_drive_credentials_missing",
          lastErrorMessage: "Google Drive must be reconnected before syncing."
        }
      }).catch(() => undefined);
      throw new AppError(409, "Reconnect Google Drive before syncing.", "google_drive_needs_reauth");
    }
  }

  private persistedDriveFileAllowedByRoots(file: ProjectDriveFile, roots: Awaited<ReturnType<GoogleDriveService["selectedSyncRootsForProject"]>>) {
    if (!this.requireExplicitSyncRoots() && roots.some((root) => ["all_drive", "my_drive", "shared_drive"].includes(root.rootType))) {
      return true;
    }
    const metadata = readRecord(file.metadataJson);
    const allowedRootIds = readStringArray(metadata["allowedRootIds"]);
    const parents = readStringArray(file.parentsJson);
    return roots.some((root) =>
      root.connectionId === file.connectionId &&
      (
        (root.rootType === "selected_file" && root.googleFileId === file.driveFileId) ||
        (root.rootType === "folder" && Boolean(root.googleFileId) && (parents.includes(root.googleFileId!) || allowedRootIds.includes(root.id)))
      )
    );
  }

  private async googleFileAllowedByRoots(
    connection: ProjectDriveConnection,
    file: GoogleDriveFileMetadata,
    roots: Awaited<ReturnType<GoogleDriveService["selectedSyncRoots"]>>
  ) {
    const normalized = normalizeDriveFile(file);
    if (!this.requireExplicitSyncRoots() && roots.some((root) => root.rootType === "all_drive" || root.rootType === "my_drive" || root.rootType === "shared_drive")) {
      return { allowed: true, allowedRootIds: roots.map((root) => root.id) };
    }
    const parents = normalized.parents ?? [];
    const existing = normalized.id
      ? await this.prisma.projectDriveFile.findUnique({
          where: { projectId_driveFileId: { projectId: connection.projectId, driveFileId: normalized.id } },
          select: { metadataJson: true }
        }).catch(() => null)
      : null;
    const existingAllowedRootIds = readStringArray(readRecord(existing?.metadataJson)["allowedRootIds"]);
    const allowedRootIds = roots
      .filter((root) =>
        (root.rootType === "selected_file" && root.googleFileId === normalized.id) ||
        (root.rootType === "folder" && Boolean(root.googleFileId) && (parents.includes(root.googleFileId!) || existingAllowedRootIds.includes(root.id)))
      )
      .map((root) => root.id);
    return { allowed: allowedRootIds.length > 0, allowedRootIds };
  }

  private async latestSyncRun(connectionId: string) {
    return this.prisma.projectDriveSyncRun.findFirst({
      where: { connectionId },
      orderBy: [{ createdAt: "desc" }]
    });
  }

  private effectiveConnectionStatus(
    connection: ProjectDriveConnection | null,
    latestSyncRun: ProjectDriveSyncRun | null,
    credentialMissing: boolean
  ) {
    if (!connection) return undefined;
    if (credentialMissing) return "needs_reauth";
    if (connection.status !== "syncing") return connection.status;
    if (!latestSyncRun) return "connected";
    if (isFailedDriveSync(latestSyncRun.status)) return "sync_failed";
    if (!isActiveDriveSync(latestSyncRun.status)) return "connected";
    return isFreshDriveSync(latestSyncRun) ? "syncing" : "stale_sync";
  }

  private async findLatestConnection(projectId: string) {
    return this.prisma.projectDriveConnection.findFirst({
      where: { projectId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });
  }

  private async findActiveConnectionOrThrow(projectId: string) {
    const connection = await this.findLatestConnection(projectId);
    if (!connection || ["pending_auth", "disconnected"].includes(connection.status)) {
      throw new AppError(404, "Google Drive connection not found", "google_drive_connection_not_found");
    }
    return connection;
  }

  private async ensureReadableProject(projectId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    assertProjectOpsReadable(member.projectRole);
    return member;
  }

  private assertConfigured() {
    if (!this.isEnabled()) {
      throw new AppError(403, "Google Drive is disabled", "feature_disabled_in_beta");
    }
    if (!this.isOAuthConfigured()) {
      throw new AppError(501, "Google Drive OAuth is not configured", "google_drive_not_configured");
    }
  }

  private assertAccessModeAllowed(accessMode: ProjectDriveAccessMode) {
    if (accessMode === "full_drive" && !this.env.BETA_GOOGLE_DRIVE_FULL_ACCESS_ENABLED) {
      throw new AppError(403, "Full Google Drive access is disabled", "feature_disabled_in_beta");
    }
    if (accessMode === "selected_files" && !this.env.BETA_GOOGLE_DRIVE_PICKER_ENABLED) {
      throw new AppError(403, "Selected Google Drive file access is disabled", "feature_disabled_in_beta");
    }
  }

  private isEnabled() {
    return this.env.BETA_GOOGLE_DRIVE_ENABLED !== false && this.env.GOOGLE_DRIVE_CONNECTOR_ENABLED !== false;
  }

  private isOAuthConfigured() {
    return Boolean(this.clientIdOptional() && this.clientSecretOptional() && this.redirectUriOptional());
  }

  private webhooksAvailable() {
    return Boolean(
      this.env.BETA_GOOGLE_DRIVE_WEBHOOKS_ENABLED &&
      this.env.GOOGLE_DRIVE_WEBHOOKS_ENABLED &&
      this.env.GOOGLE_DRIVE_WEBHOOK_URL &&
      this.env.GOOGLE_DRIVE_WEBHOOK_TOKEN_SECRET
    );
  }

  private clientId() {
    const value = this.clientIdOptional();
    if (!value) throw new AppError(501, "Google Drive client ID is not configured", "google_drive_not_configured");
    return value;
  }

  private clientSecret() {
    const value = this.clientSecretOptional();
    if (!value) throw new AppError(501, "Google Drive client secret is not configured", "google_drive_not_configured");
    return value;
  }

  private redirectUri() {
    const value = this.redirectUriOptional();
    if (!value) throw new AppError(501, "Google Drive redirect URI is not configured", "google_drive_not_configured");
    return value;
  }

  private clientIdOptional() {
    return this.env.GOOGLE_DRIVE_CLIENT_ID ?? this.env.GOOGLE_CLIENT_ID;
  }

  private clientSecretOptional() {
    return this.env.GOOGLE_DRIVE_CLIENT_SECRET ?? this.env.GOOGLE_CLIENT_SECRET;
  }

  private redirectUriOptional() {
    return this.env.GOOGLE_DRIVE_REDIRECT_URI ?? this.env.GOOGLE_REDIRECT_URI;
  }

  private parseState(rawState: string): OAuthStatePayload {
    try {
      const parsed = JSON.parse(Buffer.from(rawState, "base64url").toString("utf8")) as OAuthStatePayload;
      if (
        !parsed ||
        typeof parsed.connectionId !== "string" ||
        typeof parsed.nonce !== "string" ||
        typeof parsed.sig !== "string"
      ) {
        throw new Error("invalid");
      }
      return parsed;
    } catch {
      throw new AppError(400, "Invalid Google Drive OAuth state", "google_drive_oauth_invalid_state");
    }
  }

  private verifyStateAgainstConnection(connection: ProjectDriveConnection, state: OAuthStatePayload) {
    const raw = `${state.connectionId}:${state.nonce}`;
    const expectedSig = crypto.createHmac("sha256", this.env.CONNECTOR_OAUTH_STATE_SECRET).update(raw).digest("hex");
    if (!constantTimeEqual(expectedSig, state.sig)) {
      throw new AppError(400, "Google Drive OAuth state signature is invalid", "google_drive_oauth_invalid_signature");
    }
    const metadata = readRecord(connection.metadataJson);
    const expiresAt = readString(metadata["nonceExpiresAt"]);
    const pendingNonceHash = readString(metadata["pendingNonceHash"]);
    if (!expiresAt || new Date(expiresAt).getTime() < Date.now()) {
      throw new AppError(400, "Google Drive OAuth state expired", "google_drive_oauth_state_expired");
    }
    if (!pendingNonceHash || !constantTimeEqual(pendingNonceHash, this.hash(state.nonce))) {
      throw new AppError(400, "Google Drive OAuth nonce mismatch", "google_drive_oauth_nonce_mismatch");
    }
  }

  private resolveMaxFiles(input: number | undefined, syncType: string) {
    if (input) return Math.min(input, this.env.GOOGLE_DRIVE_FULL_SYNC_MAX_FILES);
    if (syncType === "incremental" || syncType === "webhook") return this.env.GOOGLE_DRIVE_INCREMENTAL_SYNC_MAX_FILES;
    return this.env.GOOGLE_DRIVE_FULL_SYNC_MAX_FILES;
  }

  private hash(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private statusLimitations(configured: boolean, connection: ProjectDriveConnection | null) {
    const limitations: string[] = [];
    if (!configured) limitations.push("Google Drive OAuth env vars are not configured.");
    if (!this.webhooksAvailable()) limitations.push("Drive watch webhooks are unavailable; manual and incremental sync remain available.");
    if (this.requireExplicitSyncRoots()) limitations.push("Managers must choose the Drive files or folders Socrates may access; unselected sources are off-limits for the team.");
    if (connection?.accessMode === "full_drive") limitations.push("Full Drive uses restricted Google scopes and may require Google verification before broad rollout.");
    limitations.push("Google Drive is read-only; create/edit/share/comment actions are disabled.");
    return limitations;
  }

  private toConnectionDto(connection: ProjectDriveConnection, statusOverride?: string, lastErrorOverride?: string) {
    return {
      id: connection.id,
      projectId: connection.projectId,
      provider: connection.provider,
      accountLabel: connection.googleAccountEmail ?? "Google Drive",
      status: statusOverride ?? connection.status,
      accessMode: connection.accessMode,
      connectedAt: connection.connectedAt?.toISOString() ?? null,
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      lastError: sanitizeProviderError(lastErrorOverride ?? connection.lastErrorMessage)
    };
  }

  private toSyncRunDto(run: ProjectDriveSyncRun) {
    return {
      id: run.id,
      connectionId: run.connectionId,
      syncType: run.syncType,
      status: run.status,
      filesScanned: run.filesScanned,
      filesDownloaded: run.filesDownloaded,
      filesIndexed: run.filesIndexed,
      filesSkipped: run.filesSkipped,
      filesFailed: run.filesFailed,
      errorCode: run.errorCode,
      errorMessage: sanitizeProviderError(run.errorMessage),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString()
    };
  }

  private toFileDto(file: ProjectDriveFile) {
    return {
      id: file.id,
      projectId: file.projectId,
      driveProviderFileId: file.driveFileId,
      name: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
      iconLink: file.iconLink,
      ownersSummary: file.ownersSummary,
      lastModifyingUserSummary: file.lastModifyingUserSummary,
      createdTime: file.createdTime?.toISOString() ?? null,
      modifiedTime: file.modifiedTime?.toISOString() ?? null,
      size: file.size?.toString() ?? null,
      sharedDrive: file.sharedDrive,
      indexStatus: file.indexStatus,
      documentId: file.documentId,
      documentVersionId: file.documentVersionId,
      lastIndexedAt: file.lastIndexedAt?.toISOString() ?? null,
      lastError: sanitizeProviderError(file.lastError),
      openTarget: file.documentId
        ? {
            targetType: "document",
            targetRef: {
              projectId: file.projectId,
              documentId: file.documentId,
              documentVersionId: file.documentVersionId,
              driveFileId: file.id
            }
          }
        : {
            targetType: "google_drive_file",
            targetRef: {
              projectId: file.projectId,
              driveFileId: file.id,
              driveProviderFileId: file.driveFileId
            }
          },
      source: "google_drive"
    };
  }

  private assertReleaseValidated() {
    if (!isProviderReleaseValidated(this.env, "google_drive")) {
      throw new AppError(
        409,
        "Google Drive actions are unavailable until live provider validation passes",
        PROVIDER_RELEASE_VALIDATION_REASON,
        { provider: "google_drive" }
      );
    }
  }
}

function normalizeDriveFile(file: GoogleDriveFileMetadata): Required<Pick<GoogleDriveFileMetadata, "id" | "name" | "mimeType">> & GoogleDriveFileMetadata {
  const id = file.id ?? "";
  return {
    ...file,
    id,
    name: file.name ?? id,
    mimeType: file.mimeType ?? "application/octet-stream"
  };
}

function normalizeBlobContentType(mimeType: string) {
  if (mimeType === "application/vnd.ms-excel") return "text/csv";
  return mimeType;
}

function extensionForContentType(contentType: string, existingName?: string) {
  if (existingName && /\.[a-z0-9]{1,12}$/i.test(existingName)) return "";
  if (contentType === "application/pdf") return ".pdf";
  if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  if (contentType === "text/csv" || contentType === "application/csv") return ".csv";
  if (contentType === "text/markdown") return ".md";
  if (contentType === "text/plain") return ".txt";
  return ".txt";
}

function safeBaseName(name: string) {
  const cleaned = name.split(/[\\/]/).pop()?.replace(/[^\w.\- ]+/g, "_").trim() ?? "drive-file";
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "drive-file";
}

function safeReturnTo(value?: string) {
  if (!value) return "/connectors";
  if (!value.startsWith("/") || value.startsWith("//")) return "/connectors";
  return value.slice(0, 300);
}

function safeUrl(value?: string) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function summarizePeople(people?: Array<{ displayName?: string; emailAddress?: string }>) {
  if (!people || people.length === 0) return null;
  return people.slice(0, 3).map((person) => person.displayName ?? person.emailAddress ?? "Drive user").join(", ");
}

function summarizePerson(person?: { displayName?: string; emailAddress?: string }) {
  return person?.displayName ?? person?.emailAddress ?? null;
}

function countStatus(rows: Array<{ indexStatus: ProjectDriveFileIndexStatus; _count: number }>, status: ProjectDriveFileIndexStatus) {
  return rows.find((row) => row.indexStatus === status)?._count ?? 0;
}

function resetSyncCounters(counters: SyncCounters) {
  counters.filesScanned = 0;
  counters.filesDownloaded = 0;
  counters.filesIndexed = 0;
  counters.filesSkipped = 0;
  counters.filesFailed = 0;
}

function isActiveDriveSync(status: string | null | undefined) {
  return ["running", "queued", "pending", "syncing", "in_progress"].includes((status ?? "").toLowerCase());
}

function isFailedDriveSync(status: string | null | undefined) {
  return /fail|error|cancel|timed_out/i.test(status ?? "");
}

function isFreshDriveSync(run: ProjectDriveSyncRun) {
  if (!isActiveDriveSync(run.status) || run.finishedAt) return false;
  const startedAt = new Date(run.startedAt ?? run.createdAt).getTime();
  if (Number.isNaN(startedAt)) return false;
  const ageMs = Date.now() - startedAt;
  return ageMs >= 0 && ageMs < FRESH_SYNC_WINDOW_MS;
}

function isGoogleAuthFailure(error: unknown) {
  return /401|unauthorized|invalid_grant|revoked|credentials are missing|google_drive_needs_reauth|google_drive_credentials_missing/i.test(sanitizeProviderError(error));
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === "string" && header.trim().length > 0 ? header : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function constantTimeEqual(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function sanitizeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(error ?? "");
  return message
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/(access_token[\"'=:\s]+)[^&\"'\s,}]+/gi, "$1[redacted]")
    .replace(/(refresh_token[\"'=:\s]+)[^&\"'\s,}]+/gi, "$1[redacted]")
    .replace(/(client_secret[\"'=:\s]+)[^&\"'\s,}]+/gi, "$1[redacted]")
    .slice(0, 500);
}
