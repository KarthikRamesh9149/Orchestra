import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GoogleDriveService } from "../src/modules/google-drive/service.js";
import { googleDriveSyncRootsSchema, googleDriveSyncSchema } from "../src/modules/google-drive/schemas.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const CONNECTION_ID = "44444444-4444-4444-8444-444444444444";

function baseEnv(overrides: Record<string, unknown> = {}) {
  return {
    BETA_GOOGLE_DRIVE_ENABLED: true,
    BETA_GOOGLE_DRIVE_OAUTH_ENABLED: true,
    BETA_GOOGLE_DRIVE_FULL_ACCESS_ENABLED: true,
    BETA_GOOGLE_DRIVE_PICKER_ENABLED: true,
    BETA_GOOGLE_DRIVE_WEBHOOKS_ENABLED: true,
    BETA_GOOGLE_DRIVE_WRITE_ACTIONS_ENABLED: false,
    GOOGLE_DRIVE_CONNECTOR_ENABLED: true,
    GOOGLE_DRIVE_CLIENT_ID: "client-id",
    GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
    GOOGLE_DRIVE_REDIRECT_URI: "https://api.example.test/v1/oauth/google/drive/callback",
    GOOGLE_DRIVE_WEBHOOK_URL: "https://api.example.test/v1/webhooks/google/drive",
    GOOGLE_DRIVE_WEBHOOK_TOKEN_SECRET: "webhook-secret",
    GOOGLE_DRIVE_SCOPES: [],
    GOOGLE_DRIVE_SYNC_PAGE_SIZE: 100,
    GOOGLE_DRIVE_INCLUDE_SHARED_DRIVES: true,
    GOOGLE_DRIVE_INCREMENTAL_SYNC_ENABLED: true,
    GOOGLE_DRIVE_WEBHOOKS_ENABLED: true,
    GOOGLE_DRIVE_MAX_FILE_SIZE_MB: 25,
    GOOGLE_DRIVE_ALLOWED_MIME_TYPES: [],
    GOOGLE_DRIVE_FULL_SYNC_MAX_FILES: 500,
    GOOGLE_DRIVE_INCREMENTAL_SYNC_MAX_FILES: 200,
    GOOGLE_DRIVE_EXPORT_GOOGLE_DOCS_AS: "text/plain",
    GOOGLE_DRIVE_EXPORT_GOOGLE_SLIDES_AS: "text/plain",
    GOOGLE_DRIVE_EXPORT_GOOGLE_SHEETS_AS: "text/csv",
    CONNECTOR_OAUTH_STATE_SECRET: "state-secret-32-characters-minimum",
    CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: "credential-secret-32-characters-minimum",
    CONNECTOR_CREDENTIAL_VAULT_MODE: "memory",
    DEPLOYMENT_ENV: "test",
    FRONTEND_BASE_URL: "https://beta.orchestraos.dev",
    APP_BASE_URL: "https://beta.orchestraos.dev",
    ...overrides
  } as any;
}

function connection(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-02T00:00:00.000Z");
  return {
    id: CONNECTION_ID,
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    connectedByUserId: USER_ID,
    provider: "google_drive",
    googleAccountEmail: "owner@example.test",
    googleAccountSub: "google-sub",
    status: "connected",
    credentialRef: "vault://google-drive/secret-ref",
    grantedScopesJson: [],
    accessMode: "full_drive",
    connectedAt: now,
    disconnectedAt: null,
    lastSyncedAt: now,
    lastErrorCode: null,
    lastErrorMessage: null,
    metadataJson: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as any;
}

function serviceWith(overrides: {
  prisma?: Record<string, any>;
  env?: Record<string, unknown>;
  projectService?: Record<string, any>;
  audit?: Record<string, any>;
  jobs?: Record<string, any>;
  credentialVault?: Record<string, any>;
} = {}) {
  const prisma = {
    project: { findUniqueOrThrow: vi.fn(async () => ({ orgId: ORG_ID })) },
    projectDriveConnection: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => connection({ ...data, id: CONNECTION_ID, createdAt: new Date(), updatedAt: new Date() })),
      update: vi.fn(async () => connection())
    },
    projectDriveFile: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null)
    },
    projectDriveSyncRoot: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }) => ({ id: "66666666-6666-4666-8666-666666666666", ...data })),
      updateMany: vi.fn(async () => ({ count: 0 }))
    },
    projectDriveSyncRun: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({ id: "55555555-5555-4555-8555-555555555555", createdAt: new Date(), ...data }))
    },
    $transaction: vi.fn(async (callback) => callback(prisma)),
    projectDriveWatchChannel: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => null)
    },
    ...overrides.prisma
  } as any;
  const projectService = {
    ensureProjectAccess: vi.fn(async () => ({ projectRole: "manager" })),
    ensureProjectManager: vi.fn(async () => ({ projectRole: "manager" })),
    ...overrides.projectService
  } as any;
  const audit = { record: vi.fn(async () => null), ...overrides.audit } as any;
  const jobs = { enqueue: vi.fn(async () => null), ...overrides.jobs } as any;
  const documentService = {} as any;
  const credentialVault = {
    getCredential: vi.fn(async () => ({ accessToken: "access-token", refreshToken: "refresh-token", expiresAt: new Date(Date.now() + 3600_000).toISOString() })),
    putCredential: vi.fn(async () => ({ ref: "vault://google-drive/mock" })),
    revokeCredential: vi.fn(async () => null),
    ...overrides.credentialVault
  } as any;
  const service = new GoogleDriveService(prisma, baseEnv(overrides.env), projectService, audit, jobs, documentService, credentialVault);
  return { service, prisma, projectService, audit, jobs };
}

describe("GoogleDriveService security and release gates", () => {
  it("blocks direct production connect and sync calls until Drive passes live validation", async () => {
    const { service } = serviceWith({
      env: {
        NODE_ENV: "production",
        ORCHESTRA_PROFILE: "mvp_beta",
        MVP_BETA_MODE: true,
        PROVIDER_RELEASE_VALIDATED_PROVIDERS: ["vscode"]
      }
    });

    await expect(service.initiateConnect({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      accessMode: "full_drive"
    })).rejects.toMatchObject({ code: "provider_live_validation_required" });
    await expect(service.triggerSync(PROJECT_ID, USER_ID, {
      syncType: "manual",
      dryRun: false,
      forceReindex: false
    })).rejects.toMatchObject({ code: "provider_live_validation_required" });
  });

  it("returns status without leaking credential refs or provider tokens", async () => {
    const activeConnection = connection({
      lastErrorMessage: "Google Drive API error access_token=raw-token refresh_token=raw-refresh client_secret=raw-secret"
    });
    const syncRun = {
      id: "55555555-5555-4555-8555-555555555555",
      connectionId: CONNECTION_ID,
      syncType: "manual",
      status: "failed",
      filesScanned: 1,
      filesDownloaded: 0,
      filesIndexed: 0,
      filesSkipped: 0,
      filesFailed: 1,
      errorCode: "provider_error",
      errorMessage: "Bearer abc.def access_token=raw-token",
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-06-02T00:00:00.000Z")
    };
    const { service } = serviceWith({
      prisma: {
        projectDriveConnection: { findFirst: vi.fn(async () => activeConnection) },
        projectDriveSyncRun: { findFirst: vi.fn(async () => syncRun) },
        projectDriveFile: { groupBy: vi.fn(async () => [{ indexStatus: "indexed", _count: 2 }]) }
      }
    });

    const status = await service.getStatus(PROJECT_ID, USER_ID);
    const serialized = JSON.stringify(status);

    expect(status.connected).toBe(true);
    expect(serialized).not.toContain("credentialRef");
    expect(serialized).not.toContain("vault://");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("raw-refresh");
    expect(serialized).not.toContain("raw-secret");
    expect(status.writeActionsEnabled).toBe(false);
    expect(status.limitations.join(" ")).toContain("read-only");
  });

  it("uses read-only OAuth scopes and a safe return path when starting OAuth", async () => {
    const { service, prisma, projectService, audit } = serviceWith();

    const result = await service.initiateConnect({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      accessMode: "full_drive",
      returnTo: "https://evil.example/steal"
    });
    const redirect = new URL(result.redirectUrl);
    const created = (prisma.projectDriveConnection.create as any).mock.calls[0][0].data;

    expect(projectService.ensureProjectManager).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    expect(redirect.hostname).toBe("accounts.google.com");
    expect(redirect.searchParams.get("access_type")).toBe("offline");
    expect(redirect.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(redirect.searchParams.get("scope")).not.toMatch(/drive\.file\.create|drive\.appdata|drive\.metadata$/);
    expect(created.metadataJson.returnTo).toBe("/connectors");
    expect(JSON.stringify(created)).not.toContain("accessToken");
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("client-secret");
  });

  it("uses least-privilege drive.file scope for selected-file access", async () => {
    const { service } = serviceWith();

    const result = await service.initiateConnect({
      projectId: PROJECT_ID,
      actorUserId: USER_ID,
      accessMode: "selected_files"
    });
    const scope = new URL(result.redirectUrl).searchParams.get("scope") ?? "";

    expect(scope).toContain("https://www.googleapis.com/auth/drive.file");
    expect(scope).not.toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(scope).not.toContain("https://www.googleapis.com/auth/drive.metadata.readonly");
  });

  it("requires OAuth reconnection before changing an existing access mode", async () => {
    const { service } = serviceWith({
      prisma: {
        projectDriveConnection: { findFirst: vi.fn(async () => connection({ accessMode: "full_drive" })) }
      }
    });

    await expect(service.updateSyncRoots(PROJECT_ID, USER_ID, { accessMode: "selected_files" }))
      .rejects.toMatchObject({ code: "google_drive_access_mode_reconnect_required" });
  });

  it("atomically consumes Google Drive OAuth state before provider exchange", async () => {
    const nonce = "drive-oauth-nonce";
    const sig = crypto.createHmac("sha256", baseEnv().CONNECTOR_OAUTH_STATE_SECRET)
      .update(`${CONNECTION_ID}:${nonce}`)
      .digest("hex");
    const state = Buffer.from(JSON.stringify({ connectionId: CONNECTION_ID, nonce, sig }), "utf8").toString("base64url");
    const pending = connection({
      status: "pending_auth",
      metadataJson: {
        pendingNonceHash: crypto.createHash("sha256").update(nonce).digest("hex"),
        nonceExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        returnTo: "/connectors"
      }
    });
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const { service } = serviceWith({
      prisma: {
        projectDriveConnection: {
          findFirst: vi.fn(async () => pending),
          updateMany,
          update: vi.fn(async () => connection())
        }
      }
    });
    (service as any).exchangeCode = vi.fn(async () => ({ accessToken: "access", refreshToken: "refresh", expiresIn: 3600 }));
    (service as any).fetchAbout = vi.fn(async () => ({ email: "manager@example.test", sub: "google-sub" }));

    await expect(service.handleOAuthCallback({ code: "code-1", state })).resolves.toMatchObject({
      connectionId: CONNECTION_ID,
      projectId: PROJECT_ID
    });
    await expect(service.handleOAuthCallback({ code: "code-2", state })).rejects.toMatchObject({
      code: "google_drive_oauth_state_used"
    });
    expect((service as any).exchangeCode).toHaveBeenCalledTimes(1);
  });

  it("queues sync only through manager-gated routes and never performs a Drive write", async () => {
    const { service, projectService, prisma, jobs } = serviceWith({
      env: { GOOGLE_DRIVE_REQUIRE_SYNC_ROOTS: false },
      prisma: {
        projectDriveConnection: { findFirst: vi.fn(async () => connection()) },
        projectDriveSyncRoot: {
          count: vi.fn(async () => 0),
          findMany: vi.fn(async () => []),
          create: vi.fn(async ({ data }) => ({ id: "66666666-6666-4666-8666-666666666666", ...data })),
          updateMany: vi.fn(async () => ({ count: 0 }))
        },
        projectDriveSyncRun: {
          create: vi.fn(async ({ data }) => ({
            id: "55555555-5555-4555-8555-555555555555",
            connectionId: CONNECTION_ID,
            filesScanned: 0,
            filesDownloaded: 0,
            filesIndexed: 0,
            filesSkipped: 0,
            filesFailed: 0,
            errorCode: null,
            errorMessage: null,
            startedAt: null,
            finishedAt: null,
            createdAt: new Date("2026-06-02T00:00:00.000Z"),
            ...data
          }))
        }
      }
    });

    const run = await service.triggerSync(PROJECT_ID, USER_ID, { syncType: "manual", maxFiles: 12, dryRun: false, forceReindex: false });

    expect("status" in run).toBe(true);
    expect(projectService.ensureProjectManager).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    expect((run as { status: string }).status).toBe("queued");
    expect(prisma.projectDriveSyncRun.create).toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "sync_google_drive_connection",
      expect.objectContaining({ connectionId: CONNECTION_ID, projectId: PROJECT_ID, maxFiles: 12 }),
      expect.stringContaining("google-drive-sync:")
    );
  });

  it("requires manager-selected Drive roots before syncing when privacy gate is enabled", async () => {
    const { service, jobs } = serviceWith({
      prisma: {
        projectDriveConnection: { findFirst: vi.fn(async () => connection()) },
        projectDriveSyncRoot: {
          count: vi.fn(async () => 0),
          findMany: vi.fn(async () => []),
          create: vi.fn(async ({ data }) => ({ id: "66666666-6666-4666-8666-666666666666", ...data })),
          updateMany: vi.fn(async () => ({ count: 0 }))
        }
      }
    });

    await expect(
      service.triggerSync(PROJECT_ID, USER_ID, { syncType: "manual", dryRun: false, forceReindex: false })
    ).rejects.toMatchObject({ code: "google_drive_sync_roots_required" });
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("reports needs_reauth when the connection row exists but vault credentials are missing", async () => {
    const { service } = serviceWith({
      credentialVault: { getCredential: vi.fn(async () => null) },
      prisma: {
        projectDriveConnection: { findFirst: vi.fn(async () => connection()) },
        projectDriveSyncRoot: {
          count: vi.fn(async () => 1),
          findMany: vi.fn(async () => []),
          create: vi.fn(async ({ data }) => ({ id: "66666666-6666-4666-8666-666666666666", ...data })),
          updateMany: vi.fn(async () => ({ count: 0 }))
        },
        projectDriveSyncRun: { findFirst: vi.fn(async () => null) },
        projectDriveFile: { groupBy: vi.fn(async () => [{ indexStatus: "indexed", _count: 1 }]), findMany: vi.fn(async () => []) }
      }
    });

    const status = await service.getStatus(PROJECT_ID, USER_ID);

    expect(status.state).toBe("needs_reauth");
    expect(status.connection?.status).toBe("needs_reauth");
    expect(status.connection?.lastError).toContain("reconnected");
  });

  it("classifies old running Drive syncs as retryable instead of active syncing", async () => {
    const staleRun = {
      id: "55555555-5555-4555-8555-555555555555",
      connectionId: CONNECTION_ID,
      syncType: "manual",
      status: "running",
      filesScanned: 0,
      filesDownloaded: 0,
      filesIndexed: 0,
      filesSkipped: 0,
      filesFailed: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(Date.now() - 10 * 60_000),
      finishedAt: null,
      createdAt: new Date(Date.now() - 10 * 60_000)
    };
    const { service } = serviceWith({
      prisma: {
        projectDriveConnection: { findFirst: vi.fn(async () => connection({ status: "syncing" })) },
        projectDriveSyncRun: { findFirst: vi.fn(async () => staleRun) },
        projectDriveSyncRoot: {
          count: vi.fn(async () => 1),
          findMany: vi.fn(async () => []),
          create: vi.fn(async ({ data }) => ({ id: "66666666-6666-4666-8666-666666666666", ...data })),
          updateMany: vi.fn(async () => ({ count: 0 }))
        },
        projectDriveFile: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) }
      }
    });

    const status = await service.getStatus(PROJECT_ID, USER_ID);

    expect(status.state).toBe("stale_sync");
    expect(status.connected).toBe(true);
    expect(status.connection?.status).toBe("stale_sync");
  });

  it("restores connected status when a Drive connection is marked syncing but the latest run completed", async () => {
    const completedRun = {
      id: "55555555-5555-4555-8555-555555555555",
      connectionId: CONNECTION_ID,
      syncType: "manual",
      status: "completed",
      filesScanned: 2,
      filesDownloaded: 1,
      filesIndexed: 1,
      filesSkipped: 1,
      filesFailed: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(Date.now() - 30_000),
      createdAt: new Date(Date.now() - 60_000)
    };
    const { service } = serviceWith({
      prisma: {
        projectDriveConnection: { findFirst: vi.fn(async () => connection({ status: "syncing" })) },
        projectDriveSyncRun: { findFirst: vi.fn(async () => completedRun) },
        projectDriveSyncRoot: {
          count: vi.fn(async () => 1),
          findMany: vi.fn(async () => []),
          create: vi.fn(async ({ data }) => ({ id: "66666666-6666-4666-8666-666666666666", ...data })),
          updateMany: vi.fn(async () => ({ count: 0 }))
        },
        projectDriveFile: { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) }
      }
    });

    const status = await service.getStatus(PROJECT_ID, USER_ID);

    expect(status.state).toBe("connected");
    expect(status.connection?.status).toBe("connected");
  });

  it("saves selected Drive roots as a project-level manager-controlled allowlist", async () => {
    const { service, projectService, prisma } = serviceWith({
      prisma: {
        projectDriveConnection: { findFirst: vi.fn(async () => connection()) },
        projectDriveSyncRoot: {
          count: vi.fn(async () => 1),
          findMany: vi.fn(async () => []),
          create: vi.fn(async ({ data }) => ({ id: "66666666-6666-4666-8666-666666666666", ...data })),
          updateMany: vi.fn(async () => ({ count: 1 }))
        }
      }
    });

    await service.updateSyncRoots(PROJECT_ID, USER_ID, {
      roots: [{
        rootType: "folder",
        googleFileId: "drive-folder-1",
        googleDriveId: null,
        name: "Allowed PRDs",
        selected: true,
        includeChildren: true
      }]
    });

    expect(projectService.ensureProjectManager).toHaveBeenCalledWith(PROJECT_ID, USER_ID);
    expect(prisma.projectDriveSyncRoot.updateMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID, connectionId: CONNECTION_ID },
      data: { selected: false }
    });
    expect(prisma.projectDriveSyncRoot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: PROJECT_ID,
        connectionId: CONNECTION_ID,
        rootType: "folder",
        googleFileId: "drive-folder-1",
        selected: true,
        includeChildren: true
      })
    });
  });

  it("ignores invalid webhook channel tokens and queues only valid notifications", async () => {
    const token = "valid-channel-token";
    const channel = {
      id: "channel-row",
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      channelId: "channel-id",
      resourceId: "resource-id",
      tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      status: "active"
    };
    const { service, jobs, prisma } = serviceWith({
      prisma: {
        projectDriveWatchChannel: {
          findUnique: vi.fn(async () => channel),
          update: vi.fn(async () => null)
        }
      }
    });

    const invalid = await service.handleWebhook({
      "x-goog-channel-id": "channel-id",
      "x-goog-channel-token": "wrong-token",
      "x-goog-resource-id": "resource-id"
    });
    const valid = await service.handleWebhook({
      "x-goog-channel-id": "channel-id",
      "x-goog-channel-token": token,
      "x-goog-resource-id": "resource-id"
    });

    expect(invalid).toMatchObject({ ignored: true, syncQueued: false, reason: "invalid_channel_token" });
    expect(valid).toMatchObject({ ignored: false, syncQueued: true });
    expect(prisma.projectDriveSyncRun.create).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it("bounds sync roots and sync requests before they reach provider code", () => {
    expect(() => googleDriveSyncRootsSchema.parse({ roots: [] })).toThrow();
    expect(() => googleDriveSyncRootsSchema.parse({
      roots: Array.from({ length: 26 }, (_, index) => ({
        rootType: "folder",
        googleFileId: `folder-${index}`,
        name: `Folder ${index}`
      }))
    })).toThrow();
    expect(() => googleDriveSyncSchema.parse({ maxFiles: 501 })).toThrow();
    expect(googleDriveSyncSchema.parse({ syncType: "incremental", maxFiles: 500 }).maxFiles).toBe(500);
  });
});
