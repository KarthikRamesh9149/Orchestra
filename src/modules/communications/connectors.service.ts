import { randomUUID } from "node:crypto";
import { Prisma, type CommunicationProvider, type PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import { CredentialVault } from "../../lib/communications/credential-vault.js";
import { buildOAuthState, hashOAuthNonce, parseAndVerifyOAuthState } from "../../lib/communications/oauth-state.js";
import type { CommunicationProviderAdapter } from "./providers/provider.interface.js";
import { ensureCommunicationManager } from "./authz.js";
import type { ProjectService } from "../projects/service.js";
import { AuditService } from "../audit/service.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import type { SyncService } from "./sync.service.js";
import type { TelemetryService } from "../../lib/observability/telemetry.js";
import { getProviderReadiness } from "./provider-readiness.js";
import { sanitizeCommunicationErrorMessage } from "./redaction.js";
import { isProviderEnabledForMvp } from "../../lib/mvp/policy.js";
import { BETA_DISABLED_CODE, isMvpBetaMode } from "../../lib/beta/policy.js";
import { communicationProviders, getCommunicationProviderMetadata } from "../../lib/communications/provider-types.js";

const ALL_PROVIDERS = [...communicationProviders] as CommunicationProvider[];

export class ConnectorsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly credentialVault: CredentialVault,
    private readonly adapters: Map<string, CommunicationProviderAdapter>,
    private readonly telemetry: TelemetryService,
    private syncService?: SyncService
  ) {}

  setSyncService(syncService: SyncService) {
    this.syncService = syncService;
  }

  async list(projectId: string, actorUserId: string, filters: { provider?: string; status?: string }) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    if (filters.provider) {
      this.assertProviderAllowedForBeta(filters.provider as CommunicationProvider);
    }
    const connectors = await this.prisma.communicationConnector.findMany({
      where: {
        projectId,
        ...(isMvpBetaMode(this.env) && !filters.provider ? { provider: { in: betaCommunicationProviders(this.env) } } : {}),
        ...(filters.provider ? { provider: filters.provider as never } : {}),
        ...(filters.status ? { status: filters.status as never } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      include: {
        _count: {
          select: {
            threads: true,
            messages: true,
            syncRuns: true
          }
        }
      }
    });

    return connectors.filter((connector) => this.isProviderVisibleInBeta(connector.provider)).map((connector) => ({
      id: connector.id,
      projectId: connector.projectId,
      provider: connector.provider,
      accountLabel: connector.accountLabel,
      status: connector.status,
      lastSyncedAt: connector.lastSyncedAt?.toISOString() ?? null,
      lastError: sanitizeCommunicationErrorMessage(connector.lastError),
      createdAt: connector.createdAt.toISOString(),
      updatedAt: connector.updatedAt.toISOString(),
      readiness: getProviderReadiness(this.env, connector.provider, connector),
      configSummary: {
        threadCount: connector._count.threads,
        messageCount: connector._count.messages,
        syncRunCount: connector._count.syncRuns
      }
    }));
  }

  async get(projectId: string, connectorId: string, actorUserId: string) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: connectorId, projectId },
      include: {
        syncRuns: {
          orderBy: { createdAt: "desc" },
          take: 10
        },
        _count: {
          select: {
            threads: true,
            messages: true
          }
        }
      }
    });
    this.assertProviderAllowedForBeta(connector.provider);

    return {
      id: connector.id,
      projectId: connector.projectId,
      provider: connector.provider,
      accountLabel: connector.accountLabel,
      status: connector.status,
      config: sanitizeConnectorConfig(connector.configJson),
      readiness: getProviderReadiness(this.env, connector.provider, connector),
      lastSyncedAt: connector.lastSyncedAt?.toISOString() ?? null,
      lastError: sanitizeCommunicationErrorMessage(connector.lastError),
      createdAt: connector.createdAt.toISOString(),
      updatedAt: connector.updatedAt.toISOString(),
      counts: {
        threads: connector._count.threads,
        messages: connector._count.messages
      },
      recentSyncRuns: connector.syncRuns.map((run) => ({
        id: run.id,
        provider: run.provider,
        syncType: run.syncType,
        status: run.status,
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        errorMessage: sanitizeCommunicationErrorMessage(run.errorMessage),
        summary: sanitizeSyncRunJson(run.summaryJson)
      }))
    };
  }

  async listReadiness(projectId: string, actorUserId: string) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const connectors = await this.prisma.communicationConnector.findMany({
      where: {
        projectId,
        ...(isMvpBetaMode(this.env) ? { provider: { in: betaCommunicationProviders(this.env) } } : {})
      },
      orderBy: [{ updatedAt: "desc" }]
    });

    return this.visibleProvidersForBeta(ALL_PROVIDERS).map((provider) => {
      const connector = connectors.find((item) => item.provider === provider);
      const readiness = getProviderReadiness(this.env, provider, connector);
      return {
        provider,
        metadata: getCommunicationProviderMetadata(provider),
        connectorId: connector?.id ?? null,
        connectorStatus: connector?.status ?? null,
        readiness: {
          ...readiness,
          canDisconnect: Boolean(connector && connector.status !== "revoked")
        }
      };
    });
  }

  async connect(projectId: string, provider: string, actorUserId: string, body?: unknown) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    this.assertProviderAllowedForBeta(provider as CommunicationProvider);
    this.assertProviderEnabledForMvp(provider as CommunicationProvider);
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new AppError(404, "Communication provider is not supported", "communication_provider_not_supported");
    }
    const readiness = getProviderReadiness(this.env, provider as CommunicationProvider);
    if (!readiness.canConnect) {
      throw new AppError(503, `Communication provider ${provider} is not ready`, "communication_provider_not_ready", {
        provider,
        readiness
      });
    }

    const existing = await this.prisma.communicationConnector.findFirst({
      where: { projectId, provider: provider as never }
    });

    if (body === undefined && existing?.status === "connected") {
      return {
        connectorId: existing.id,
        provider: existing.provider,
        status: existing.status,
        redirectUrl: null
      };
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    const stateToken =
      provider === "slack" ||
      provider === "gmail" ||
      provider === "outlook" ||
      provider === "microsoft_teams" ||
      provider === "clickup" ||
      provider === "zoho_mail" ||
      provider === "zoho_cliq" ||
      provider === "zoho_crm" ||
      provider === "notion"
        ? await this.createOAuthState(
            project.orgId,
            projectId,
            provider as CommunicationProvider,
            actorUserId,
            readSafeFrontendPath(body)
          )
        : undefined;

    const adapterResult = await adapter.connect({ projectId, actorUserId, oauthState: stateToken, body });
    assertConnectorConfigIsCredentialSafe(adapterResult.config ?? {});

    const connector = existing
      ? await this.prisma.communicationConnector.update({
          where: { id: existing.id },
          data: {
            accountLabel: adapterResult.accountLabel ?? existing.accountLabel,
            status: adapterResult.status,
            configJson: (adapterResult.config ?? existing.configJson ?? {}) as object
          }
        })
      : await this.prisma.communicationConnector.create({
          data: {
            projectId,
            provider: provider as never,
            accountLabel: adapterResult.accountLabel ?? provider.replace(/_/g, " "),
            status: adapterResult.status,
            configJson: (adapterResult.config ?? {}) as object,
            createdBy: actorUserId
          }
        });

    if (provider === "manual_import" || adapterResult.credential !== undefined) {
      const credential = await this.credentialVault.putCredential({
        provider,
        connectorId: connector.id,
        credential: adapterResult.credential ?? null
      });
      await this.prisma.communicationConnector.update({
        where: { id: connector.id },
        data: { credentialsRef: credential.ref }
      });
    }

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "communication_connector_created",
      entityType: "communication_connector",
      entityId: connector.id,
      payload: { provider, status: connector.status }
    });
    this.telemetry.increment("communication_connectors_total", { provider, status: connector.status });
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "communication_connector_created", {
      skip: isMvpBetaMode(this.env)
    });

    return {
      connectorId: connector.id,
      provider: connector.provider,
      status: connector.status,
      redirectUrl: adapterResult.redirectUrl ?? null
    };
  }

  async handleOAuthCallback(provider: CommunicationProvider, query: { code?: string; state?: string; error?: string }) {
    this.assertProviderAllowedForBeta(provider);
    this.assertProviderEnabledForMvp(provider);
    if (query.error) {
      throw new AppError(400, `OAuth authorization failed: ${query.error}`, "oauth_callback_failed");
    }
    if (!query.code || !query.state) {
      throw new AppError(400, "OAuth callback is missing code or state", "oauth_callback_invalid");
    }

    const statePayload = parseAndVerifyOAuthState(this.env, query.state);
    if (statePayload.provider !== provider) {
      throw new AppError(400, "OAuth callback provider mismatch", "oauth_callback_invalid");
    }
    this.assertProviderCanConnect(provider);

    const oauthState = await this.prisma.oAuthState.findFirst({
      where: {
        projectId: statePayload.projectId,
        provider,
        nonceHash: hashOAuthNonce(statePayload.nonce)
      }
    });

    if (!oauthState || oauthState.usedAt || oauthState.expiresAt < new Date()) {
      throw new AppError(400, "OAuth state is expired or already used", "oauth_state_expired");
    }

    await ensureCommunicationManager(this.projectService, oauthState.projectId, oauthState.actorUserId);
    const stateUse = await this.prisma.oAuthState.updateMany({
      where: {
        id: oauthState.id,
        usedAt: null,
        expiresAt: { gt: new Date() }
      },
      data: { usedAt: new Date() }
    });
    if (stateUse.count !== 1) {
      throw new AppError(400, "OAuth state is expired or already used", "oauth_state_expired");
    }

    const adapter = this.adapters.get(provider);
    if (!adapter?.handleOAuthCallback) {
      throw new AppError(501, "OAuth callback is not supported for this provider", "oauth_callback_not_supported");
    }

    const callbackResult = await adapter.handleOAuthCallback({
      code: query.code,
      redirectUri: this.resolveRedirectUri(provider)
    });
    assertConnectorConfigIsCredentialSafe(callbackResult.configPatch ?? {});

    const connector = await this.upsertConnectedConnector({
      projectId: oauthState.projectId,
      provider,
      createdBy: oauthState.actorUserId,
      accountLabel: callbackResult.accountLabel,
      configPatch: callbackResult.configPatch ?? {},
      providerCursor: callbackResult.providerCursor ?? null,
      credentialsRef: null
    });

    const credentialResult = await this.credentialVault.putCredential({
      provider,
      connectorId: connector.id,
      credential: callbackResult.credential
    });
    await this.prisma.communicationConnector.update({
      where: { id: connector.id },
      data: { credentialsRef: credentialResult.ref }
    });

    let queuedSync: { syncRunId: string | null } = { syncRunId: null };
    const connectorConfig = (connector.configJson as Record<string, unknown> | null) ?? {};
    if (provider === "notion" || (provider === "gmail" && connectorConfig.purpose === "invitation_sender")) {
      queuedSync = { syncRunId: null };
    } else if (!this.syncService) {
      throw new AppError(500, "Communication sync service is unavailable", "communication_sync_service_missing");
    } else {
      queuedSync = await this.syncService.enqueueSync({
        projectId: oauthState.projectId,
        connectorId: connector.id,
        syncType: "backfill"
      });
    }

    await this.auditService.record({
      orgId: oauthState.orgId,
      projectId: oauthState.projectId,
      actorUserId: oauthState.actorUserId,
      eventType: "communication_connector_created",
      entityType: "communication_connector",
      entityId: connector.id,
      payload: { provider, status: connector.status, oauthCompleted: true }
    });

    return {
      connectorId: connector.id,
      provider: connector.provider,
      status: connector.status,
      syncRunId: queuedSync.syncRunId,
      redirectAfter: oauthState.redirectAfter ?? null
    };
  }

  async handleOAuthCallbackFromState(
    query: { code?: string; state?: string; error?: string },
    allowedProviders: CommunicationProvider[]
  ) {
    if (!query.state) {
      throw new AppError(400, "OAuth callback is missing state", "oauth_callback_invalid");
    }

    const statePayload = parseAndVerifyOAuthState(this.env, query.state);
    const provider = statePayload.provider as CommunicationProvider;
    if (!allowedProviders.includes(provider)) {
      throw new AppError(400, "OAuth callback provider is not allowed on this endpoint", "oauth_callback_invalid");
    }

    return this.handleOAuthCallback(provider, query);
  }

  async update(projectId: string, connectorId: string, actorUserId: string, body: { accountLabel?: string; config?: Record<string, unknown> }) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: connectorId, projectId }
    });
    this.assertProviderAllowedForBeta(connector.provider);
    this.assertProviderEnabledForMvp(connector.provider);
    this.assertProviderCanAccessResources(connector);
    if (body.config) assertProviderOwnedConfigNotPatched(connector.provider, body.config);

    const updated = await this.prisma.communicationConnector.update({
      where: { id: connector.id },
      data: {
        accountLabel: body.accountLabel ?? connector.accountLabel,
        configJson:
          body.config != null
            ? (mergeCredentialSafeConnectorConfig(connector.configJson, body.config) as Prisma.JsonObject)
            : connector.configJson == null
              ? Prisma.JsonNull
              : (connector.configJson as Prisma.InputJsonValue)
      }
    });

    return this.toConnectorDetail(updated);
  }

  async listProviderChannels(projectId: string, connectorId: string, actorUserId: string) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: connectorId, projectId }
    });
    this.assertProviderAllowedForBeta(connector.provider);
    this.assertProviderEnabledForMvp(connector.provider);
    this.assertProviderCanAccessResources(connector);
    const adapter = this.adapters.get(connector.provider);
    if (!adapter?.listChannels) {
      throw new AppError(501, "Provider channel listing is not supported", "provider_channel_listing_not_supported", {
        provider: connector.provider
      });
    }

    const credential = await this.credentialVault.getCredential(
      connector.provider,
      connector.id,
      connector.credentialsRef
    );
    const config = (connector.configJson ?? {}) as Record<string, unknown>;
    const channels = await adapter.listChannels({
      credential,
      includePrivateChannels: config.includePrivateChannels === true
    });

    return {
      provider: connector.provider,
      connectorId: connector.id,
      channels
    };
  }

  async listProviderResources(
    projectId: string,
    connectorId: string,
    actorUserId: string,
    query: { search?: string; limit?: number; cursor?: string }
  ) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: connectorId, projectId }
    });
    this.assertProviderAllowedForBeta(connector.provider);
    this.assertProviderEnabledForMvp(connector.provider);
    this.assertProviderCanAccessResources(connector);
    const adapter = this.adapters.get(connector.provider);
    if (!adapter?.listResources) {
      throw new AppError(501, "Provider resource listing is not supported", "provider_resource_listing_not_supported", {
        provider: connector.provider
      });
    }

    const credential = await this.credentialVault.getCredential(
      connector.provider,
      connector.id,
      connector.credentialsRef
    );
    const result = await adapter.listResources({
      connector,
      credential,
      query: {
        search: query.search,
        limit: query.limit,
        cursor: query.cursor
      }
    });

    return {
      provider: connector.provider,
      connectorId: connector.id,
      selectionMode:
        connector.provider === "notion"
          ? "selected_shared_only"
          : connector.provider === "microsoft_teams"
            ? "selected_teams_channels_chats_only"
            : "provider_default",
      resources: result.resources,
      nextCursor: result.nextCursor ?? null
    };
  }

  async revoke(projectId: string, connectorId: string, actorUserId: string) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: connectorId, projectId }
    });
    this.assertProviderAllowedForBeta(connector.provider);
    this.assertProviderEnabledForMvp(connector.provider);
    const adapter = this.adapters.get(connector.provider);
    const credential = await this.credentialVault
      .getCredential(connector.provider, connector.id, connector.credentialsRef)
      .catch(() => null);
    let providerRevocation: { providerRevoked: boolean; reason?: string } = {
      providerRevoked: false,
      reason: "Provider-side revocation is not supported; the local credential was removed."
    };
    if (credential) {
      try {
        providerRevocation = adapter?.revoke
          ? (await adapter.revoke({ connector, credential })) ?? providerRevocation
          : providerRevocation;
      } catch {
        await this.prisma.communicationConnector.update({
          where: { id: connector.id },
          data: { status: "error", lastError: "Provider-side revocation failed. The connector remains active until retry succeeds." }
        });
        throw new AppError(502, "Provider-side connector revocation failed", "communication_connector_provider_revoke_failed");
      }
    }
    try {
      await this.credentialVault.revokeCredential(connector.provider, connector.id, connector.credentialsRef);
    } catch {
      await this.prisma.communicationConnector.update({
        where: { id: connector.id },
        data: { status: "error", lastError: "Local credential cleanup failed. Disconnect must be retried." }
      });
      throw new AppError(500, "Connector credential cleanup failed", "communication_connector_credential_revoke_failed");
    }

    const revoked = await this.prisma.communicationConnector.update({
      where: { id: connector.id },
      data: {
        status: "revoked",
        lastError: providerRevocation.providerRevoked ? null : providerRevocation.reason
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "communication_connector_revoked",
      entityType: "communication_connector",
      entityId: revoked.id,
      payload: { provider: revoked.provider, providerRevoked: providerRevocation.providerRevoked, cleanupReason: providerRevocation.reason ?? null }
    });
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, "communication_connector_revoked", {
      skip: isMvpBetaMode(this.env)
    });
    return this.toConnectorDetail(revoked);
  }

  async registerWebhook(projectId: string, connectorId: string, actorUserId: string) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: connectorId, projectId }
    });
    this.assertProviderAllowedForBeta(connector.provider);
    this.assertProviderEnabledForMvp(connector.provider);
    this.assertProviderCanWebhook(connector.provider);
    const adapter = this.adapters.get(connector.provider);
    if (!adapter?.registerWebhook) {
      throw new AppError(501, "Provider webhook registration is not supported", "provider_webhook_registration_not_supported", {
        provider: connector.provider
      });
    }
    const credential = await this.credentialVault.getCredential(connector.provider, connector.id, connector.credentialsRef);
    const webhookBaseUrl = connector.provider === "clickup" ? this.env.CLICKUP_WEBHOOK_BASE_URL ?? this.env.APP_BASE_URL : this.env.APP_BASE_URL;
    const endpointUrl = `${webhookBaseUrl.replace(/\/$/, "")}/v1/webhooks/${connector.provider === "clickup" ? "clickup" : connector.provider}`;
    const result = await adapter.registerWebhook({ connector, credential, endpointUrl });
    assertConnectorConfigIsCredentialSafe(result.configPatch ?? {});
    let credentialsRef = connector.credentialsRef;
    if (result.updatedCredential !== undefined) {
      const credentialResult = await this.credentialVault.putCredential({
        provider: connector.provider,
        connectorId: connector.id,
        credential: result.updatedCredential
      });
      credentialsRef = credentialResult.ref;
    }
    const updated = await this.prisma.communicationConnector.update({
      where: { id: connector.id },
      data: {
        credentialsRef,
        configJson: mergeCredentialSafeConnectorConfig(connector.configJson, result.configPatch ?? {}) as Prisma.InputJsonValue
      }
    });

    await this.auditService.record({
      orgId: project.orgId,
      projectId,
      actorUserId,
      eventType: "communication_connector_webhook_registered",
      entityType: "communication_connector",
      entityId: connector.id,
      payload: { provider: connector.provider, webhookId: result.webhookId }
    });

    return {
      connectorId: updated.id,
      provider: updated.provider,
      webhookId: result.webhookId,
      config: sanitizeConnectorConfig(updated.configJson)
    };
  }

  async listSyncRuns(projectId: string, connectorId: string, actorUserId: string, query: { limit: number }) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: connectorId, projectId },
      select: { provider: true }
    });
    this.assertProviderAllowedForBeta(connector.provider);
    const rows = await this.prisma.communicationSyncRun.findMany({
      where: { projectId, connectorId },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });
    return rows.map((run) => this.toSyncRunDto(run));
  }

  async listProjectJobRuns(
    projectId: string,
    actorUserId: string,
    query: { limit: number; status?: string; jobType?: string }
  ) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    const rows = await this.prisma.jobRun.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.jobType ? { jobType: query.jobType } : {}),
        payloadJson: {
          path: ["projectId"],
          equals: projectId
        }
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    return rows.map((run) => ({
      id: run.id,
      jobType: run.jobType,
      status: run.status,
      attemptCount: run.attemptCount,
      scheduledAt: run.scheduledAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      lastError: sanitizeCommunicationErrorMessage(run.lastError),
      createdAt: run.createdAt.toISOString(),
      updatedAt: (run.finishedAt ?? run.startedAt ?? run.createdAt).toISOString()
    }));
  }

  async handleWebhook(
    provider: CommunicationProvider,
    input: {
      headers: Record<string, string | string[] | undefined>;
      rawBody: string;
      body: unknown;
      query?: Record<string, string | string[] | undefined>;
    }
  ) {
    this.assertProviderAllowedForBeta(provider);
    this.assertProviderEnabledForMvp(provider);
    this.assertProviderCanWebhook(provider);
    const adapter = this.adapters.get(provider);
    if (!adapter?.verifyWebhook) {
      throw new AppError(501, "Webhook handling is not implemented for this provider", "communication_webhook_not_implemented");
    }

    const connectors = await this.prisma.communicationConnector.findMany({
      where: {
        provider,
        status: {
          in: ["connected", "syncing", "error", "pending_auth"]
        }
      }
    });
    const credentialConnectorIds = webhookCredentialConnectorIds(provider, input, connectors);
    const credentialsByConnectorId: Record<string, Record<string, unknown> | null> = {};
    for (const connector of connectors.filter((item) => credentialConnectorIds.has(item.id))) {
      credentialsByConnectorId[connector.id] = await this.credentialVault
        .getCredential(connector.provider, connector.id, connector.credentialsRef)
        .catch(() => null);
    }

    const verification = await adapter.verifyWebhook({
      headers: input.headers,
      rawBody: input.rawBody,
      body: input.body,
      query: input.query,
      connectors,
      credentialsByConnectorId
    });

    if (verification.handledImmediately) {
      return verification.handledImmediately;
    }
    if (!verification.providerEventId) {
      throw new AppError(422, "Webhook event id was not resolved", "communication_webhook_event_invalid");
    }

    const existing = await this.prisma.providerWebhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider,
          providerEventId: verification.providerEventId
        }
      }
    });
    if (existing && ["processed", "ignored_duplicate"].includes(existing.status)) {
      this.telemetry.increment("communication_webhook_duplicates_total", { provider });
      return { statusCode: 200, body: { ok: true, duplicate: true } };
    }

    const webhookEvent = existing
      ? await this.prisma.providerWebhookEvent.update({
          where: { id: existing.id },
          data: {
            connectorId: verification.connectorIds?.[0] ?? existing.connectorId ?? null,
            eventType: verification.eventType ?? existing.eventType ?? "webhook_event",
            rawPayloadHash: hashOAuthNonce(input.rawBody),
            status: "queued",
            processedAt: null
          }
        })
      : await this.prisma.providerWebhookEvent.create({
          data: {
            provider,
            providerEventId: verification.providerEventId,
            connectorId: verification.connectorIds?.[0] ?? null,
            projectId: null,
            eventType: verification.eventType ?? "webhook_event",
            rawPayloadHash: hashOAuthNonce(input.rawBody),
            status: "queued",
            receivedAt: new Date(),
            processedAt: null
          }
        });

    if (!this.syncService) {
      throw new AppError(500, "Communication sync service is unavailable", "communication_sync_service_missing");
    }

    try {
      for (const connectorId of verification.connectorIds ?? []) {
        const connector = connectors.find((item) => item.id === connectorId);
        if (!connector) {
          continue;
        }

        await this.syncService.enqueueSync({
          projectId: connector.projectId,
          connectorId,
          syncType: "webhook",
          webhookPayload: {
            providerEventId: verification.providerEventId,
            eventType: verification.eventType ?? "webhook_event",
            ...(verification.jobPayload ?? {})
          }
        });
      }

      const keepFirefliesQueuedForSyncProof = provider === "fireflies_ai" && (verification.connectorIds?.length ?? 0) > 0;
      await this.prisma.providerWebhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: keepFirefliesQueuedForSyncProof ? "queued" : "processed",
          processedAt: keepFirefliesQueuedForSyncProof ? null : new Date()
        }
      });
    } catch (error) {
      await this.prisma.providerWebhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: "failed",
          processedAt: null
        }
      });
      throw error;
    }
    this.telemetry.increment("communication_webhook_events_total", {
      provider,
      event_type: verification.eventType ?? "webhook_event"
    });

    return { statusCode: 200, body: { ok: true, ...(existing ? { retried: true } : {}) } };
  }

  private async createOAuthState(
    orgId: string,
    projectId: string,
    provider: CommunicationProvider,
    actorUserId: string,
    redirectAfter: string | null = null
  ) {
    const nonce = randomUUID();
    await this.prisma.oAuthState.create({
      data: {
        orgId,
        projectId,
        provider,
        actorUserId,
        nonceHash: hashOAuthNonce(nonce),
        redirectAfter,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    return buildOAuthState(this.env, {
      nonce,
      provider,
      projectId,
      issuedAt: Date.now()
    });
  }

  private resolveRedirectUri(provider: CommunicationProvider) {
    if (provider === "slack") {
      return this.env.SLACK_REDIRECT_URI ?? `${this.env.APP_BASE_URL}/v1/oauth/slack/callback`;
    }
    if (provider === "gmail") {
      return this.env.GOOGLE_REDIRECT_URI ?? `${this.env.APP_BASE_URL}/v1/oauth/google/callback`;
    }
    if (provider === "outlook" || provider === "microsoft_teams") {
      return this.env.MICROSOFT_REDIRECT_URI ?? `${this.env.APP_BASE_URL}/v1/oauth/microsoft/callback`;
    }
    if (provider === "clickup") {
      return this.env.CLICKUP_REDIRECT_URI ?? `${this.env.APP_BASE_URL}/v1/oauth/clickup/callback`;
    }
    if (provider === "zoho_mail" || provider === "zoho_cliq" || provider === "zoho_crm") {
      return this.env.ZOHO_REDIRECT_URI ?? `${this.env.APP_BASE_URL}/v1/oauth/zoho/callback`;
    }
    if (provider === "notion") {
      return this.env.NOTION_REDIRECT_URI ?? `${this.env.APP_BASE_URL}/v1/oauth/notion/callback`;
    }
    throw new AppError(400, "Unsupported OAuth provider", "oauth_provider_not_supported");
  }

  private assertProviderEnabledForMvp(provider: CommunicationProvider) {
    if (isMvpBetaMode(this.env) && betaCommunicationProviders(this.env).includes(provider)) {
      return;
    }
    if (!isProviderEnabledForMvp(this.env, provider)) {
      throw new AppError(403, "Communication provider is disabled in MVP mode", "communication_provider_disabled_in_mvp", {
        provider
      });
    }
  }

  private assertProviderCanConnect(provider: CommunicationProvider) {
    const readiness = getProviderReadiness(this.env, provider);
    if (!readiness.canConnect) {
      throw new AppError(409, "Communication provider connect is not available", "communication_provider_connect_unavailable", {
        provider,
        reasons: readiness.reasons,
        deferredFeatures: readiness.deferredFeatures,
        missingConfig: readiness.missingConfig
      });
    }
  }

  private assertProviderCanWebhook(provider: CommunicationProvider) {
    const readiness = getProviderReadiness(this.env, provider);
    if (!readiness.canWebhook) {
      throw new AppError(409, "Communication provider webhooks are not available", "communication_provider_webhook_unavailable", {
        provider,
        reasons: readiness.reasons,
        deferredFeatures: readiness.deferredFeatures,
        missingConfig: readiness.missingConfig
      });
    }
  }

  private assertProviderCanAccessResources(connector: {
    provider: CommunicationProvider;
    status?: string | null;
    credentialsRef?: string | null;
    configJson?: unknown;
  }) {
    const readiness = getProviderReadiness(this.env, connector.provider, connector);
    if (!readiness.canSync) {
      throw new AppError(409, "Communication provider resources are not available", "communication_provider_resources_unavailable", {
        provider: connector.provider,
        reasons: readiness.reasons,
        deferredFeatures: readiness.deferredFeatures,
        missingConfig: readiness.missingConfig
      });
    }
  }

  private assertProviderAllowedForBeta(provider: CommunicationProvider) {
    if (isMvpBetaMode(this.env) && !betaCommunicationProviders(this.env).includes(provider)) {
      throw new AppError(404, "Feature disabled in beta", BETA_DISABLED_CODE, { provider });
    }
  }

  private visibleProvidersForBeta(providers: CommunicationProvider[]) {
    const visibleProviders = betaCommunicationProviders(this.env);
    return isMvpBetaMode(this.env) ? visibleProviders.filter((provider) => providers.includes(provider)) : providers;
  }

  private isProviderVisibleInBeta(provider: CommunicationProvider) {
    return !isMvpBetaMode(this.env) || betaCommunicationProviders(this.env).includes(provider);
  }

  private async upsertConnectedConnector(input: {
    projectId: string;
    provider: CommunicationProvider;
    createdBy: string;
    accountLabel: string;
    configPatch: Record<string, unknown>;
    providerCursor: Record<string, unknown> | null;
    credentialsRef: string | null;
  }) {
    const existing = await this.prisma.communicationConnector.findFirst({
      where: { projectId: input.projectId, provider: input.provider }
    });
    assertConnectorConfigIsCredentialSafe(input.configPatch);

    return existing
      ? this.prisma.communicationConnector.update({
          where: { id: existing.id },
          data: {
            accountLabel: input.accountLabel,
            status: "connected",
            lastError: null,
            credentialsRef: input.credentialsRef,
            configJson: ({
              ...((existing.configJson as Record<string, unknown> | null) ?? {}),
              ...input.configPatch
            } as Prisma.InputJsonValue),
            providerCursorJson:
              input.providerCursor == null ? Prisma.JsonNull : (input.providerCursor as Prisma.InputJsonValue)
          }
        })
      : this.prisma.communicationConnector.create({
          data: {
            projectId: input.projectId,
            provider: input.provider,
            accountLabel: input.accountLabel,
            status: "connected",
            createdBy: input.createdBy,
            credentialsRef: input.credentialsRef,
            configJson: input.configPatch as Prisma.InputJsonValue,
            providerCursorJson:
              input.providerCursor == null ? Prisma.JsonNull : (input.providerCursor as Prisma.InputJsonValue)
          }
        });
  }

  private toConnectorDetail(connector: {
    id: string;
    projectId: string;
    provider: CommunicationProvider;
    accountLabel: string;
    status: string;
    configJson?: unknown;
    lastSyncedAt?: Date | null;
    lastError?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      id: connector.id,
      projectId: connector.projectId,
      provider: connector.provider,
      accountLabel: connector.accountLabel,
      status: connector.status,
      config: sanitizeConnectorConfig(connector.configJson),
      readiness: getProviderReadiness(this.env, connector.provider, connector),
      lastSyncedAt: connector.lastSyncedAt?.toISOString() ?? null,
      lastError: sanitizeCommunicationErrorMessage(connector.lastError ?? null),
      createdAt: connector.createdAt?.toISOString() ?? null,
      updatedAt: connector.updatedAt?.toISOString() ?? null
    };
  }

  private toSyncRunDto(run: {
    id: string;
    connectorId: string;
    projectId: string;
    provider: CommunicationProvider;
    syncType: string;
    status: string;
    summaryJson?: unknown;
    errorMessage?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    createdAt?: Date | null;
  }) {
    return {
      id: run.id,
      connectorId: run.connectorId,
      projectId: run.projectId,
      provider: run.provider,
      syncType: run.syncType,
      status: run.status,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt?.toISOString() ?? null,
      errorMessage: sanitizeCommunicationErrorMessage(run.errorMessage),
      summary: sanitizeSyncRunJson(run.summaryJson)
    };
  }
}

function betaCommunicationProviders(env: AppEnv): CommunicationProvider[] {
  return [
    "manual_import" as CommunicationProvider,
    ...(env.BETA_SLACK_CONNECTOR_ENABLED === false ? [] : (["slack"] as CommunicationProvider[])),
    ...(env.BETA_GMAIL_INVITE_SENDER_ENABLED === true ? (["gmail"] as CommunicationProvider[]) : []),
    ...(env.BETA_FIREFLIES_CONNECTOR_ENABLED === false ? [] : (["fireflies_ai"] as CommunicationProvider[])),
    ...(env.BETA_CLICKUP_CONNECTOR_ENABLED === false ? [] : (["clickup"] as CommunicationProvider[])),
    ...(env.BETA_GRANOLA_CONNECTOR_ENABLED === false ? [] : (["granola"] as CommunicationProvider[])),
    ...(env.BETA_MICROSOFT_TEAMS_CONNECTOR_ENABLED === false ? [] : (["microsoft_teams"] as CommunicationProvider[])),
    ...(env.BETA_ZOHO_MAIL_CONNECTOR_ENABLED === false ? [] : (["zoho_mail"] as CommunicationProvider[])),
    ...(env.BETA_ZOHO_CLIQ_CONNECTOR_ENABLED === false ? [] : (["zoho_cliq"] as CommunicationProvider[])),
    ...(env.BETA_ZOHO_CRM_CONNECTOR_ENABLED === false ? [] : (["zoho_crm"] as CommunicationProvider[])),
    ...(env.BETA_NOTION_CONNECTOR_ENABLED === false ? [] : (["notion"] as CommunicationProvider[]))
  ];
}

function readSafeFrontendPath(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>).returnTo;
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  return value.slice(0, 500);
}

const SECRET_CONFIG_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /credential/i,
  /password/i,
  /^credentialsref$/i,
  /apikey/i,
  /api[_-]?key/i,
  /authorization/i,
  /auth[_-]?header/i,
  /private[_-]?key/i,
  /signing[_-]?key/i
];
const SECRET_CONFIG_VALUE_PATTERNS = [
  /xox[baprs]-[A-Za-z0-9-]+/i,
  /\bgrn_[A-Za-z0-9._-]{16,}\b/i,
  /\b(access_token|refresh_token|client_secret|webhook_secret)=/i,
  /^Bearer\s+\S+/i
];

function mergeCredentialSafeConnectorConfig(existing: unknown, patch: Record<string, unknown>) {
  assertConnectorConfigIsCredentialSafe(patch);
  return {
    ...((existing as Record<string, unknown> | null) ?? {}),
    ...patch
  };
}

const PROVIDER_OWNED_CONFIG_KEYS: Partial<Record<CommunicationProvider, Set<string>>> = {
  slack: new Set(["teamId", "teamName"]),
  clickup: new Set(["workspaceId", "workspaceName", "webhookIds", "webhookScopes"]),
  whatsapp_business: new Set(["businessAccountId", "phoneNumberIds"]),
  microsoft_teams: new Set(["tenantId"]),
  outlook: new Set(["tenantId"]),
  fireflies_ai: new Set(["accountId", "webhookConnectorTokenHash"]),
  notion: new Set(["workspaceId", "workspaceName", "botId", "owner"])
};

function assertProviderOwnedConfigNotPatched(provider: CommunicationProvider, patch: Record<string, unknown>) {
  const protectedKeys = PROVIDER_OWNED_CONFIG_KEYS[provider];
  const attempted = Object.keys(patch).find((key) => protectedKeys?.has(key));
  if (attempted) {
    throw new AppError(422, "Provider-owned connector identity cannot be changed", "connector_provider_identity_immutable", {
      provider,
      path: attempted
    });
  }
}

function webhookCredentialConnectorIds(
  provider: CommunicationProvider,
  input: { body: unknown; query?: Record<string, string | string[] | undefined> },
  connectors: Array<{ id: string; configJson: unknown }>
) {
  if (provider === "clickup") {
    const body = input.body && typeof input.body === "object" && !Array.isArray(input.body)
      ? input.body as Record<string, unknown>
      : {};
    const webhookId = typeof body.webhook_id === "string" ? body.webhook_id : null;
    return new Set(connectors.filter((connector) => {
      const config = connector.configJson && typeof connector.configJson === "object" && !Array.isArray(connector.configJson)
        ? connector.configJson as Record<string, unknown>
        : {};
      return webhookId && Array.isArray(config.webhookIds) && config.webhookIds.includes(webhookId);
    }).map((connector) => connector.id));
  }
  if (provider === "fireflies_ai") {
    const raw = input.query?.connectorId ?? input.query?.connector_id;
    const connectorId = Array.isArray(raw) ? raw[0] : raw;
    return new Set(connectors.filter((connector) => connector.id === connectorId).map((connector) => connector.id));
  }
  return new Set<string>();
}

function assertConnectorConfigIsCredentialSafe(value: unknown, path: string[] = []) {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertConnectorConfigIsCredentialSafe(child, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && SECRET_CONFIG_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new AppError(422, "Connector config must not contain credential material", "connector_config_contains_secret", {
        path: path.join(".")
      });
    }
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_CONFIG_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new AppError(422, "Connector config must not contain credential material", "connector_config_contains_secret", {
        path: [...path, key].join(".")
      });
    }
    assertConnectorConfigIsCredentialSafe(child, [...path, key]);
  }
}

function sanitizeConnectorConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConnectorConfig(item));
  }
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_CONFIG_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      continue;
    }
    sanitized[key] = sanitizeConnectorConfig(child);
  }
  return sanitized;
}

function sanitizeSyncRunJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSyncRunJson(item));
  }
  if (typeof value === "string") {
    return sanitizeCommunicationErrorMessage(value);
  }
  if (!value || typeof value !== "object") {
    return value ?? null;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_CONFIG_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      continue;
    }
    sanitized[key] = sanitizeSyncRunJson(child);
  }
  return sanitized;
}
