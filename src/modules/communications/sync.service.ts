import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CommunicationSyncStatus } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";
import { jobKeys } from "../../lib/jobs/keys.js";
import { getJobExecutionPolicy } from "../../lib/jobs/policy.js";
import { JobNames, type JobDispatcher } from "../../lib/jobs/types.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import { stableHash } from "../../lib/communications/idempotency.js";
import { CredentialVault } from "../../lib/communications/credential-vault.js";
import { ensureCommunicationManager } from "./authz.js";
import type { ProjectService } from "../projects/service.js";
import { AuditService } from "../audit/service.js";
import type {
  CommunicationProviderAdapter,
  NormalizedDocumentWorkspaceResource,
  SkippedDocumentWorkspaceResource
} from "./providers/provider.interface.js";
import { MessageIngestionService } from "./message-ingestion.service.js";
import type { TelemetryService } from "../../lib/observability/telemetry.js";
import { errorMessageForPersistence } from "./redaction.js";
import { isMvpBetaMode } from "../../lib/beta/policy.js";
import { isProviderEnabledForMvp } from "../../lib/mvp/policy.js";
import { getProviderReadiness } from "./provider-readiness.js";
import type { DocumentService } from "../documents/service.js";
import { ConnectorLeaseLostError, ConnectorLeaseService, type ConnectorLease } from "./connector-lease.service.js";

const ACTIVE_SYNC_RUN_WINDOW_MS = 2 * 60 * 1000;

export class SyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly credentialVault: CredentialVault,
    private readonly adapters: Map<string, CommunicationProviderAdapter>,
    private readonly ingestion: MessageIngestionService,
    private readonly telemetry: TelemetryService,
    private readonly documentService?: DocumentService
  ) {}

  async queueSync(
    projectId: string,
    connectorId: string,
    actorUserId: string,
    syncType: "manual" | "webhook" | "backfill" | "incremental",
    idempotencyKey?: string
  ) {
    await ensureCommunicationManager(this.projectService, projectId, actorUserId);
    return this.enqueueSync({ projectId, connectorId, syncType, idempotencyKey });
  }

  async enqueueSync(input: {
    projectId: string;
    connectorId: string;
    syncType: "manual" | "webhook" | "backfill" | "incremental";
    webhookPayload?: Record<string, unknown>;
    idempotencyKey?: string;
  }) {
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: input.connectorId, projectId: input.projectId }
    });
    this.assertProviderEnabledForMvp(connector.provider);
    if (connector.status === "revoked") {
      throw new AppError(409, "Revoked connector cannot sync", "communication_connector_revoked");
    }
    this.assertProviderSyncAllowed(connector, input.syncType);

    const activeSyncRun = await this.prisma.communicationSyncRun.findFirst({
      where: {
        connectorId: connector.id,
        status: {
          in: ["queued", "running"]
        }
      },
      orderBy: { createdAt: "desc" }
    });
    if (activeSyncRun && input.syncType !== "webhook") {
      if (this.isStaleActiveSyncRun(activeSyncRun)) {
        const expired = await this.markStaleActiveSyncRunFailed(activeSyncRun.id, activeSyncRun.status);
        if (!expired) {
          return {
            connectorId: connector.id,
            syncRunId: activeSyncRun.id,
            queued: false
          };
        }
      } else {
        return {
          connectorId: connector.id,
          syncRunId: activeSyncRun.id,
          queued: false
        };
      }
    }

    const requestIdentity = input.idempotencyKey
      ?? (input.syncType === "webhook" ? input.webhookPayload?.providerEventId ?? stableHash(input.webhookPayload ?? {}) : randomUUID());
    const cursorHash = stableHash({
      cursor: connector.providerCursorJson,
      request: requestIdentity
    });
    const key = jobKeys.syncCommunicationConnector(connector.id, input.syncType, cursorHash);
    const syncRunDelegate = this.prisma.communicationSyncRun as any;
    if (typeof syncRunDelegate.findUnique === "function") {
      const prior = await syncRunDelegate.findUnique({ where: { idempotencyKey: key } });
      if (prior && prior.status !== "failed") {
        return { connectorId: connector.id, syncRunId: prior.id, queued: false };
      }
      if (prior?.status === "failed") {
        const reclaimed = await syncRunDelegate.updateMany({
          where: { id: prior.id, status: "failed" },
          data: { status: "queued", finishedAt: null, errorMessage: null }
        });
        if (reclaimed.count === 1) {
          await this.enqueueSyncJob(key, connector, input, prior.id);
          return { connectorId: connector.id, syncRunId: prior.id, queued: true };
        }
        return { connectorId: connector.id, syncRunId: prior.id, queued: false };
      }
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { orgId: true }
    });
    let syncRun: { id: string };
    try {
      syncRun = await this.prisma.communicationSyncRun.create({
        data: {
          idempotencyKey: key,
          connectorId: connector.id,
          projectId: input.projectId,
          provider: connector.provider,
          syncType: input.syncType,
          status: "queued",
          cursorBeforeJson: connector.providerCursorJson as object | undefined
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || typeof syncRunDelegate.findUnique !== "function") throw error;
      const concurrent = await syncRunDelegate.findUnique({ where: { idempotencyKey: key } });
      if (!concurrent) throw error;
      return { connectorId: connector.id, syncRunId: concurrent.id, queued: false };
    }

    await this.enqueueSyncJob(key, connector, input, syncRun.id);
    this.telemetry.increment("communication_sync_runs_total", {
      provider: connector.provider,
      sync_type: input.syncType,
      status: "queued"
    });
    await this.auditService.record({
      orgId: project.orgId,
      projectId: input.projectId,
      actorUserId: null,
      eventType: "communication_sync_started",
      entityType: "communication_sync_run",
      entityId: syncRun.id,
      payload: { connectorId: connector.id, provider: connector.provider, syncType: input.syncType }
    });
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, input.projectId, "communication_sync_started", {
      skip: isMvpBetaMode(this.env)
    });

    return {
      connectorId: connector.id,
      syncRunId: syncRun.id,
      queued: true
    };
  }

  private async enqueueSyncJob(
    key: string,
    connector: { id: string; provider: any },
    input: { projectId: string; syncType: "manual" | "webhook" | "backfill" | "incremental"; webhookPayload?: Record<string, unknown> },
    syncRunId: string
  ) {
    const payload = { connectorId: connector.id, projectId: input.projectId, syncType: input.syncType, syncRunId, webhookPayload: input.webhookPayload, idempotencyKey: key };
    await this.prisma.jobRun.upsert({
      where: { idempotencyKey: key },
      update: { jobType: JobNames.syncCommunicationConnector, status: "pending", payloadJson: payload as Prisma.InputJsonValue },
      create: { jobType: JobNames.syncCommunicationConnector, status: "pending", idempotencyKey: key, payloadJson: payload as Prisma.InputJsonValue }
    });
    await this.jobs.enqueue(JobNames.syncCommunicationConnector, payload, key);
  }

  async runSyncJob(input: {
    connectorId: string;
    projectId: string;
    syncType: "manual" | "webhook" | "backfill" | "incremental";
    syncRunId: string;
    webhookPayload?: Record<string, unknown>;
    idempotencyKey?: string;
  }) {
    const startedAt = process.hrtime.bigint();
    let jobRunAttemptCount = 0;
    const connector = await this.prisma.communicationConnector.findFirstOrThrow({
      where: { id: input.connectorId, projectId: input.projectId }
    });
    this.assertProviderEnabledForMvp(connector.provider);
    if (connector.status === "revoked") {
      throw new AppError(409, "Revoked connector cannot sync", "communication_connector_revoked");
    }
    this.assertProviderSyncAllowed(connector, input.syncType);

    const adapter = this.adapters.get(connector.provider);
    if (!adapter) {
      throw new AppError(404, "Communication provider is not supported", "communication_provider_not_supported");
    }

    const claim = await this.prisma.communicationSyncRun.updateMany({
      where: { id: input.syncRunId, status: "queued" },
      data: { status: "running", startedAt: new Date() }
    });
    if (claim.count !== 1) {
      const currentRun = await this.prisma.communicationSyncRun.findUnique({
        where: { id: input.syncRunId },
        select: { id: true, status: true }
      });
      if (input.idempotencyKey && currentRun?.status !== "running") {
        await this.prisma.jobRun.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: { status: "completed", finishedAt: new Date(), lastError: null }
        });
      }
      return {
        skipped: true,
        reason: currentRun?.status === "running" ? "sync_run_already_running" : "sync_run_not_claimable",
        syncRunStatus: currentRun?.status ?? null
      };
    }

    const leaseService = this.connectorLeaseService();
    const lease = leaseService ? await leaseService.acquire(connector.id) : null;
    if (leaseService && !lease) {
      await this.prisma.communicationSyncRun.update({
        where: { id: input.syncRunId },
        data: {
          status: "partial",
          finishedAt: new Date(),
          summaryJson: {
            skipped: true,
            reason: "connector_lease_contended"
          }
        }
      });
      if (input.idempotencyKey) {
        await this.prisma.jobRun.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: { status: "completed", finishedAt: new Date(), lastError: null }
        });
      }
      return {
        skipped: true,
        reason: "connector_lease_contended"
      };
    }
    if (!leaseService) {
      const competingRun = await this.prisma.communicationSyncRun.findFirst({
        where: { connectorId: connector.id, status: "running", id: { not: input.syncRunId } },
        orderBy: { createdAt: "desc" }
      });
      if (competingRun) {
        await this.prisma.communicationSyncRun.update({
          where: { id: input.syncRunId },
          data: { status: "partial", finishedAt: new Date(), summaryJson: { skipped: true, reason: "connector_locked", competingSyncRunId: competingRun.id } }
        });
        if (input.idempotencyKey) {
          await this.prisma.jobRun.update({ where: { idempotencyKey: input.idempotencyKey }, data: { status: "completed", finishedAt: new Date(), lastError: null } });
        }
        return { skipped: true, reason: "connector_locked", competingSyncRunId: competingRun.id };
      }
    }

    const heartbeat = leaseService && lease ? leaseService.startHeartbeat(lease) : null;
    if (lease) {
      await this.prisma.communicationSyncRun.updateMany({
        where: { id: input.syncRunId, status: "running" },
        data: { leaseOwnerToken: lease.ownerToken, leaseFencingToken: lease.fencingToken }
      });
    }

    if (input.idempotencyKey) {
      const jobRun = await this.prisma.jobRun.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {
          jobType: JobNames.syncCommunicationConnector,
          status: "running",
          startedAt: new Date(),
          finishedAt: null,
          lastError: null,
          attemptCount: { increment: 1 }
        },
        create: {
          jobType: JobNames.syncCommunicationConnector,
          status: "running",
          idempotencyKey: input.idempotencyKey,
          startedAt: new Date(),
          attemptCount: 1
        }
      });
      jobRunAttemptCount = Number((jobRun as { attemptCount?: unknown } | null | undefined)?.attemptCount ?? 0);
    }
    if (leaseService && lease) {
      await leaseService.fencedConnectorUpdate(lease, { status: "syncing", lastError: null });
    } else {
      await this.prisma.communicationConnector.update({ where: { id: connector.id }, data: { status: "syncing", lastError: null } });
    }

    try {
      const credential = await this.credentialVault.getCredential(
        connector.provider,
        connector.id,
        connector.credentialsRef
      );
      const result = await this.runProviderSyncWithRetry(adapter, {
        projectId: input.projectId,
        connector,
        credential,
        syncType: input.syncType,
        webhookPayload: input.webhookPayload,
        batchSize:
          connector.provider === "fireflies_ai"
            ? this.env.FIREFLIES_SYNC_BATCH_SIZE
            : connector.provider === "slack"
              ? this.env.SLACK_SYNC_BATCH_SIZE
              : connector.provider === "clickup"
                ? this.env.CLICKUP_SYNC_BATCH_SIZE
              : connector.provider === "granola"
                  ? this.env.GRANOLA_SYNC_BATCH_SIZE
                  : connector.provider === "zoho_mail"
                    ? this.env.ZOHO_MAIL_SYNC_BATCH_SIZE
                    : connector.provider === "zoho_cliq"
                      ? this.env.ZOHO_CLIQ_SYNC_BATCH_SIZE
                      : connector.provider === "zoho_crm"
                        ? this.env.ZOHO_CRM_SYNC_BATCH_SIZE
                : this.env.CONNECTOR_SYNC_BATCH_SIZE,
        maxBackfillDays:
          connector.provider === "fireflies_ai"
            ? this.env.FIREFLIES_SYNC_MAX_BACKFILL_DAYS
            : connector.provider === "slack"
              ? this.env.SLACK_MAX_BACKFILL_DAYS
              : connector.provider === "clickup"
                ? this.env.CLICKUP_MAX_BACKFILL_DAYS
              : connector.provider === "granola"
                  ? this.env.GRANOLA_MAX_BACKFILL_DAYS
                  : connector.provider === "zoho_mail"
                    ? this.env.ZOHO_MAIL_SYNC_MAX_BACKFILL_DAYS
                    : connector.provider === "zoho_cliq"
                      ? this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS
                      : connector.provider === "zoho_crm"
                        ? this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS
                : this.env.CONNECTOR_SYNC_MAX_BACKFILL_DAYS
      });
      await heartbeat?.assertValid();

      let createdMessageCount = 0;
      let updatedRevisionCount = 0;
      let indexedMessageCount = 0;
      for (const batch of result.batches ?? []) {
        await heartbeat?.assertValid();
        const ingestResult = await this.ingestion.ingestNormalizedBatch({
          ...batch,
          projectId: input.projectId,
          connectorId: connector.id,
          provider: connector.provider,
          syncRunId: input.syncRunId
        });
        createdMessageCount += ingestResult.createdMessageCount;
        updatedRevisionCount += ingestResult.updatedRevisionCount;
        indexedMessageCount += ingestResult.indexedMessageCount;
      }

      if ((result.deletedProviderMessageIds?.length ?? 0) > 0) {
        await heartbeat?.assertValid();
        await this.prisma.communicationMessage.updateMany({
          where: {
            connectorId: connector.id,
            providerMessageId: {
              in: result.deletedProviderMessageIds
            }
          },
          data: {
            isDeletedByProvider: true
          }
        });
      }

      const documentWorkspaceResult = await this.persistDocumentWorkspaceResources({
        connector,
        projectId: input.projectId,
        resources: result.documentResources ?? [],
        skippedResources: result.skippedDocumentResources ?? []
      });

      let credentialsRef = connector.credentialsRef;
      if (result.updatedCredential) {
        await heartbeat?.assertValid();
        const stored = await this.credentialVault.putCredential({
          provider: connector.provider,
          connectorId: connector.id,
          credential: result.updatedCredential
        });
        credentialsRef = stored.ref;
      }

      await heartbeat?.assertValid();
      await this.updateSyncRunWithLease(input.syncRunId, lease, {
          status: result.status === "partial" ? "partial" : "completed",
          finishedAt: new Date(),
          cursorAfterJson:
            result.cursorAfter == null ? Prisma.JsonNull : (result.cursorAfter as Prisma.InputJsonValue),
          summaryJson: {
            ...(result.summary ?? {}),
            createdMessageCount,
            updatedRevisionCount,
            indexedMessageCount,
            deletedMessageCount: result.deletedProviderMessageIds?.length ?? 0,
            ...documentWorkspaceResult.summary
          }
        }
      );
      const connectorUpdate = {
          status: "connected",
          lastSyncedAt: new Date(),
          lastError: null,
          credentialsRef,
          providerCursorJson:
            result.cursorAfter == null
              ? connector.providerCursorJson == null
                ? Prisma.JsonNull
                : (connector.providerCursorJson as Prisma.InputJsonValue)
              : (result.cursorAfter as Prisma.InputJsonValue)
        };
      if (leaseService && lease) await leaseService.fencedConnectorUpdate(lease, connectorUpdate);
      else await this.prisma.communicationConnector.update({ where: { id: connector.id }, data: connectorUpdate as any });
      if (input.idempotencyKey) {
        await this.prisma.jobRun.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: { status: "completed", finishedAt: new Date(), lastError: null }
        });
      }
      const providerEventId =
        typeof input.webhookPayload?.providerEventId === "string" ? input.webhookPayload.providerEventId : null;
      if (providerEventId) {
        await heartbeat?.assertValid();
        await this.prisma.providerWebhookEvent.updateMany({
          where: {
            provider: connector.provider,
            providerEventId,
            status: { in: ["queued", "failed"] }
          },
          data: {
            status: "processed",
            processedAt: new Date()
          }
        });
      }
      await this.auditService.record({
        orgId: (
          await this.prisma.project.findUniqueOrThrow({
            where: { id: input.projectId },
            select: { orgId: true }
          })
        ).orgId,
        projectId: input.projectId,
        actorUserId: null,
        eventType: "communication_sync_completed",
        entityType: "communication_sync_run",
        entityId: input.syncRunId,
        payload: {
          connectorId: connector.id,
          provider: connector.provider,
          createdMessageCount,
          updatedRevisionCount,
          indexedMessageCount,
          deletedMessageCount: result.deletedProviderMessageIds?.length ?? 0,
          ...documentWorkspaceResult.auditPayload
        }
      });
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.telemetry.increment("communication_sync_runs_total", {
        provider: connector.provider,
        sync_type: input.syncType,
        status: result.status === "partial" ? "partial" : "completed"
      });
      this.telemetry.observeDuration("communication_sync_duration_ms", durationMs, {
        provider: connector.provider,
        sync_type: input.syncType
      });
      await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, input.projectId, "communication_sync_completed", {
        skip: isMvpBetaMode(this.env)
      });
    } catch (error) {
      const persistedErrorMessage = errorMessageForPersistence(error, "Unknown communication sync error");
      const leaseLost = error instanceof ConnectorLeaseLostError;
      const jobFailureStatus =
        input.idempotencyKey && jobRunAttemptCount >= getJobExecutionPolicy(JobNames.syncCommunicationConnector, this.env).attempts
          ? "dead"
          : "failed";
      await this.updateSyncRunWithLease(input.syncRunId, lease, {
          status: "failed",
          finishedAt: new Date(),
          errorMessage: persistedErrorMessage
        }).catch(() => undefined);
      if (!leaseLost && leaseService && lease) {
        await leaseService.fencedConnectorUpdate(lease, {
          status: "error",
          lastError: persistedErrorMessage
        });
      } else if (!leaseService) {
        await this.prisma.communicationConnector.update({ where: { id: connector.id }, data: { status: "error", lastError: persistedErrorMessage } });
      }
      if (input.idempotencyKey) {
        await this.prisma.jobRun.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: {
            status: jobFailureStatus,
            finishedAt: new Date(),
            lastError: persistedErrorMessage
          }
        });
      }
      await this.auditService.record({
        orgId: (
          await this.prisma.project.findUniqueOrThrow({
            where: { id: input.projectId },
            select: { orgId: true }
          })
        ).orgId,
        projectId: input.projectId,
        actorUserId: null,
        eventType: "communication_sync_failed",
        entityType: "communication_sync_run",
        entityId: input.syncRunId,
        payload: {
          connectorId: connector.id,
          provider: connector.provider,
          errorMessage: persistedErrorMessage,
          ...(input.idempotencyKey
            ? {
                jobStatus: jobFailureStatus,
                jobAttemptCount: jobRunAttemptCount
              }
            : {})
        }
      });
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.telemetry.increment("communication_sync_runs_total", {
        provider: connector.provider,
        sync_type: input.syncType,
        status: "failed"
      });
      this.telemetry.increment("communication_sync_failures_total", {
        provider: connector.provider,
        sync_type: input.syncType,
        job_status: jobFailureStatus
      });
      this.telemetry.observeDuration("communication_sync_duration_ms", durationMs, {
        provider: connector.provider,
        sync_type: input.syncType
      });
      await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, input.projectId, "communication_sync_failed", {
        skip: isMvpBetaMode(this.env)
      });
      throw error;
    } finally {
      heartbeat?.stop();
      if (leaseService && lease) await leaseService.release(lease);
    }
  }

  private connectorLeaseService() {
    const connector = (this.prisma as any).communicationConnector;
    if (typeof connector?.updateMany !== "function" || typeof connector?.findFirstOrThrow !== "function") return null;
    return new ConnectorLeaseService(this.prisma, this.env, this.telemetry);
  }

  private async updateSyncRunWithLease(syncRunId: string, lease: ConnectorLease | null, data: Record<string, unknown>) {
    if (!lease) return this.prisma.communicationSyncRun.update({ where: { id: syncRunId }, data: data as any });
    const updated = await this.prisma.communicationSyncRun.updateMany({
      where: { id: syncRunId, leaseOwnerToken: lease.ownerToken, leaseFencingToken: lease.fencingToken },
      data: data as any
    });
    if (updated.count !== 1) throw new ConnectorLeaseLostError();
    return updated;
  }

  private async persistDocumentWorkspaceResources(input: {
    connector: { id: string; provider: string; projectId: string; createdBy: string };
    projectId: string;
    resources: NormalizedDocumentWorkspaceResource[];
    skippedResources: SkippedDocumentWorkspaceResource[];
  }) {
    if (input.resources.length === 0 && input.skippedResources.length === 0) {
      return { summary: {}, auditPayload: {} };
    }
    if (!this.documentService) {
      throw new AppError(500, "Document workspace sync is unavailable", "document_workspace_sync_unavailable");
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: input.projectId },
      select: { orgId: true }
    });
    const counts = {
      notionDocumentsCreated: 0,
      notionDocumentsUpdated: 0,
      notionDocumentsUnchanged: 0,
      notionSkippedResources: input.skippedResources.length
    };

    for (const resource of input.resources) {
      if (resource.provider !== "notion") continue;
      const existing = await this.prisma.projectNotionResource.findUnique({
        where: {
          projectId_connectorId_notionResourceId: {
            projectId: input.projectId,
            connectorId: input.connector.id,
            notionResourceId: resource.providerResourceId
          }
        }
      });
      if (
        existing?.contentHash === resource.contentHash &&
        existing.documentId &&
        existing.documentVersionId &&
        ["pending", "parsing", "ready", "partial", "indexed"].includes(existing.indexStatus)
      ) {
        await this.prisma.projectNotionResource.update({
          where: { id: existing.id },
          data: {
            lastEditedAt: parseResourceDate(resource.lastEditedAt),
            lastIndexedAt: existing.lastIndexedAt ?? new Date(),
            lastError: null,
            updatedAt: new Date()
          }
        });
        counts.notionDocumentsUnchanged += 1;
        continue;
      }

      const uploaded = await this.documentService.uploadFile({
        projectId: input.projectId,
        actorUserId: input.connector.createdBy,
        kind: "reference",
        title: resource.title,
        visibility: "internal",
        sourceLabel: "notion",
        makePrimaryLiveDoc: false,
        fileName: resource.fileName ?? `${safeResourceFileName(resource.title)}.md`,
        contentType: "text/markdown",
        buffer: Buffer.from(resource.content, "utf8")
      });

      await this.prisma.projectNotionResource.upsert({
        where: {
          projectId_connectorId_notionResourceId: {
            projectId: input.projectId,
            connectorId: input.connector.id,
            notionResourceId: resource.providerResourceId
          }
        },
        update: {
          orgId: project.orgId,
          resourceType: resource.resourceType,
          parentResourceId: resource.parentResourceId ?? null,
          title: resource.title,
          url: resource.url ?? null,
          selectedResourceId: resource.selectedResourceId ?? null,
          selectedResourceLabel: resource.selectedResourceLabel ?? null,
          lastEditedAt: parseResourceDate(resource.lastEditedAt),
          documentId: uploaded.documentId,
          documentVersionId: uploaded.documentVersionId,
          indexStatus: uploaded.status,
          lastIndexedAt: new Date(),
          lastError: null,
          contentHash: resource.contentHash,
          metadataJson: safeNotionResourceMetadata(resource.metadata)
        },
        create: {
          orgId: project.orgId,
          projectId: input.projectId,
          connectorId: input.connector.id,
          notionResourceId: resource.providerResourceId,
          resourceType: resource.resourceType,
          parentResourceId: resource.parentResourceId ?? null,
          title: resource.title,
          url: resource.url ?? null,
          selectedResourceId: resource.selectedResourceId ?? null,
          selectedResourceLabel: resource.selectedResourceLabel ?? null,
          lastEditedAt: parseResourceDate(resource.lastEditedAt),
          documentId: uploaded.documentId,
          documentVersionId: uploaded.documentVersionId,
          indexStatus: uploaded.status,
          lastIndexedAt: new Date(),
          lastError: null,
          contentHash: resource.contentHash,
          metadataJson: safeNotionResourceMetadata(resource.metadata)
        }
      });
      if (existing) {
        counts.notionDocumentsUpdated += 1;
      } else {
        counts.notionDocumentsCreated += 1;
      }
    }

    for (const skipped of input.skippedResources) {
      if (skipped.provider !== "notion") continue;
      await this.prisma.projectNotionResource.upsert({
        where: {
          projectId_connectorId_notionResourceId: {
            projectId: input.projectId,
            connectorId: input.connector.id,
            notionResourceId: skipped.providerResourceId
          }
        },
        update: {
          orgId: project.orgId,
          resourceType: skipped.resourceType,
          title: skipped.title ?? skipped.selectedResourceLabel ?? skipped.providerResourceId,
          selectedResourceId: skipped.selectedResourceId ?? null,
          selectedResourceLabel: skipped.selectedResourceLabel ?? null,
          indexStatus: skipped.skipReason,
          lastError: sanitizeWorkspaceResourceError(skipped.error),
          updatedAt: new Date()
        },
        create: {
          orgId: project.orgId,
          projectId: input.projectId,
          connectorId: input.connector.id,
          notionResourceId: skipped.providerResourceId,
          resourceType: skipped.resourceType,
          title: skipped.title ?? skipped.selectedResourceLabel ?? skipped.providerResourceId,
          selectedResourceId: skipped.selectedResourceId ?? null,
          selectedResourceLabel: skipped.selectedResourceLabel ?? null,
          indexStatus: skipped.skipReason,
          lastError: sanitizeWorkspaceResourceError(skipped.error)
        }
      });
    }

    if (
      counts.notionDocumentsCreated > 0 ||
      counts.notionDocumentsUpdated > 0 ||
      counts.notionDocumentsUnchanged > 0 ||
      counts.notionSkippedResources > 0
    ) {
      await this.auditService.record({
        orgId: project.orgId,
        projectId: input.projectId,
        actorUserId: null,
        eventType: "notion_resources_indexed",
        entityType: "communication_connector",
        entityId: input.connector.id,
        payload: {
          provider: input.connector.provider,
          ...counts
        }
      });
    }

    return {
      summary: counts,
      auditPayload: counts
    };
  }

  private async runProviderSyncWithRetry(
    adapter: CommunicationProviderAdapter,
    input: Parameters<CommunicationProviderAdapter["sync"]>[0]
  ) {
    let attempt = 0;
    let lastError: unknown = null;
    const maxAttempts = 3;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await adapter.sync(input);
      } catch (error) {
        lastError = error;
        const retryAfterMs = this.extractRetryAfterMs(error);
        if (attempt >= maxAttempts || retryAfterMs == null) {
          break;
        }

        this.telemetry.increment("communication_provider_rate_limited_total", {
          provider: input.connector.provider
        });

        await new Promise((resolve) => setTimeout(resolve, Math.max(50, retryAfterMs)));
      }
    }

    throw lastError;
  }

  private extractRetryAfterMs(error: unknown) {
    if (!(error instanceof AppError)) {
      return null;
    }
    if (error.code !== "communication_provider_rate_limited") {
      return null;
    }
    if (!error.details || typeof error.details !== "object") {
      return 1000;
    }
    const retryAfterMs = (error.details as { retryAfterMs?: unknown }).retryAfterMs;
    return typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) ? retryAfterMs : 1000;
  }

  private assertProviderEnabledForMvp(provider: string) {
    if (
      isMvpBetaMode(this.env) &&
      ((provider === "slack" && this.env.BETA_SLACK_CONNECTOR_ENABLED !== false) ||
        (provider === "clickup" && this.env.BETA_CLICKUP_CONNECTOR_ENABLED !== false) ||
        (provider === "granola" && this.env.BETA_GRANOLA_CONNECTOR_ENABLED !== false) ||
        (provider === "fireflies_ai" && this.env.BETA_FIREFLIES_CONNECTOR_ENABLED !== false) ||
        (provider === "microsoft_teams" && this.env.BETA_MICROSOFT_TEAMS_CONNECTOR_ENABLED !== false) ||
        (provider === "zoho_mail" && this.env.BETA_ZOHO_MAIL_CONNECTOR_ENABLED !== false) ||
        (provider === "zoho_cliq" && this.env.BETA_ZOHO_CLIQ_CONNECTOR_ENABLED !== false) ||
        (provider === "zoho_crm" && this.env.BETA_ZOHO_CRM_CONNECTOR_ENABLED !== false) ||
        (provider === "notion" && this.env.BETA_NOTION_CONNECTOR_ENABLED !== false))
    ) {
      return;
    }
    if (!isProviderEnabledForMvp(this.env, provider as never)) {
      throw new AppError(403, "Communication provider is disabled in MVP mode", "communication_provider_disabled_in_mvp", {
        provider
      });
    }
  }

  private assertProviderSyncAllowed(
    connector: { provider: string; status?: string | null; configJson?: unknown },
    syncType: "manual" | "webhook" | "backfill" | "incremental"
  ) {
    const readiness = getProviderReadiness(this.env, connector.provider as never, connector as never);
    const allowed = syncType === "webhook" ? readiness.canWebhook : readiness.canSync;
    if (!allowed) {
      throw new AppError(409, "Communication provider sync is not available", "communication_provider_sync_unavailable", {
        provider: connector.provider,
        syncType,
        reasons: readiness.reasons,
        deferredFeatures: readiness.deferredFeatures,
        missingConfig: readiness.missingConfig
      });
    }
  }

  private isStaleActiveSyncRun(run: { status?: string | null; createdAt?: Date | null; startedAt?: Date | null }) {
    if (!run.status || !["queued", "running"].includes(run.status)) {
      return false;
    }
    const activeSince = run.status === "running" ? run.startedAt ?? run.createdAt : run.createdAt;
    if (!activeSince) return false;
    return Date.now() - activeSince.getTime() >= ACTIVE_SYNC_RUN_WINDOW_MS;
  }

  private async markStaleActiveSyncRunFailed(syncRunId: string, status: CommunicationSyncStatus | null | undefined) {
    if (!status || !["queued", "running"].includes(status)) return false;
    const result = await this.prisma.communicationSyncRun.updateMany({
      where: { id: syncRunId, status },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "Communication sync run became stale; retry is available."
      }
    });
    return result.count === 1;
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseResourceDate(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function safeResourceFileName(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|#{}%~&]+/g, "_").trim();
  return (cleaned || "notion-resource").slice(0, 120);
}

function safeNotionResourceMetadata(value: Record<string, unknown> | null | undefined) {
  return redactSecretLikeJson(value && typeof value === "object" ? value : {}) as Prisma.InputJsonValue;
}

function redactSecretLikeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecretLikeJson);
  }
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/token|secret|credential|authorization|cookie|password/i.test(key)) {
      continue;
    }
    clean[key] = redactSecretLikeJson(child);
  }
  return clean;
}

function sanitizeWorkspaceResourceError(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/(access[_-]?token[\"'=:\s]+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .slice(0, 500);
}
