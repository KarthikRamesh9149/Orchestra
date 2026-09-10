import { describe, expect, it, vi } from "vitest";
import { createJobHandlers } from "../src/lib/jobs/handlers.js";
import { jobKeys } from "../src/lib/jobs/keys.js";
import { assertProductionQueueMode, getJobExecutionPolicy } from "../src/lib/jobs/policy.js";
import { JobNames } from "../src/lib/jobs/types.js";

const ids = {
  connector: "11111111-1111-4111-8111-111111111111",
  org: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  syncRun: "44444444-4444-4444-8444-444444444444"
};

function createContext() {
  const services = {
    documentService: {
      processDocumentVersion: vi.fn(),
      chunkDocumentVersion: vi.fn(),
      embedDocumentChunks: vi.fn()
    },
    brainService: {
      generateSourcePackage: vi.fn(),
      generateClarifiedBrief: vi.fn(),
      generateBrainGraph: vi.fn(),
      generateProductBrain: vi.fn()
    },
    liveDocService: {
      refreshCurrentArtifact: vi.fn()
    },
    changeProposalService: {
      applyAcceptedProposal: vi.fn()
    },
    socratesService: {
      precomputeSuggestions: vi.fn()
    },
    projectContextService: {
      indexContextEntry: vi.fn()
    },
    dashboardService: {
      refreshSnapshotJob: vi.fn()
    },
    communicationsService: {
      sync: {
        runSyncJob: vi.fn()
      },
      ingestion: {
        runIngestBatchJob: vi.fn()
      },
      indexing: {
        runIndexJob: vi.fn()
      },
      messageInsights: {
        runClassificationJob: vi.fn(),
        autoCreateProposal: vi.fn()
      },
      threadInsights: {
        runClassificationJob: vi.fn(),
        autoCreateProposal: vi.fn()
      }
    },
    calendarConnectionsService: {
      runSyncJob: vi.fn()
    }
  };

  return { services } as any;
}

describe("createJobHandlers", () => {
  it("registers a handler for every defined job name", () => {
    const handlers = createJobHandlers(createContext());

    for (const jobName of Object.values(JobNames)) {
      expect(handlers[jobName]).toBeTypeOf("function");
    }
  });

  it("routes communication batch ingestion to the communications ingestion service", async () => {
    const context = createContext();
    const handlers = createJobHandlers(context);

    await handlers[JobNames.ingestCommunicationBatch]?.({
      connectorId: ids.connector,
      projectId: ids.project,
      syncRunId: ids.syncRun,
      provider: "manual_import",
      threads: [{ providerThreadId: "thread-1", participants: [] }],
      messages: [
        {
          providerThreadId: "thread-1",
          providerMessageId: "message-1",
          senderLabel: "Client",
          sentAt: "2026-04-19T10:00:00.000Z",
          bodyText: "Need weekly reporting.",
          messageType: "user"
        }
      ]
    });

    expect(context.services.communicationsService.ingestion.runIngestBatchJob).toHaveBeenCalledWith({
      connectorId: ids.connector,
      projectId: ids.project,
      syncRunId: ids.syncRun,
      provider: "manual_import",
      threads: [{ providerThreadId: "thread-1", participants: [] }],
      messages: [
        {
          providerThreadId: "thread-1",
          providerMessageId: "message-1",
          senderLabel: "Client",
          sentAt: "2026-04-19T10:00:00.000Z",
          bodyText: "Need weekly reporting.",
          messageType: "user"
        }
      ]
    });
  });

  it("routes ClickUp communication batch ingestion to the shared ingestion service", async () => {
    const context = createContext();
    const handlers = createJobHandlers(context);

    await handlers[JobNames.ingestCommunicationBatch]?.({
      connectorId: ids.connector,
      projectId: ids.project,
      syncRunId: ids.syncRun,
      provider: "clickup",
      threads: [{ providerThreadId: "task:cu-1", participants: [] }],
      messages: [
        {
          providerThreadId: "task:cu-1",
          providerMessageId: "task:cu-1:comment:c1",
          senderLabel: "PM",
          sentAt: "2026-04-19T10:00:00.000Z",
          bodyText: "ClickUp confirms acceptance criteria.",
          messageType: "user",
          rawMetadata: { sourceSubType: "clickup_task_comment" }
        }
      ]
    });

    expect(context.services.communicationsService.ingestion.runIngestBatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "clickup",
        threads: [{ providerThreadId: "task:cu-1", participants: [] }]
      })
    );
  });

  it("routes Granola communication batch ingestion to the shared ingestion service", async () => {
    const context = createContext();
    const handlers = createJobHandlers(context);

    await handlers[JobNames.ingestCommunicationBatch]?.({
      connectorId: ids.connector,
      projectId: ids.project,
      syncRunId: ids.syncRun,
      provider: "granola",
      threads: [{ providerThreadId: "granola_note:not_abc123DEF45678", participants: [] }],
      messages: [
        {
          providerThreadId: "granola_note:not_abc123DEF45678",
          providerMessageId: "granola_note:not_abc123DEF45678:summary",
          senderLabel: "Granola",
          sentAt: "2026-04-19T10:00:00.000Z",
          bodyText: "Granola summary says the onboarding requirement changed.",
          messageType: "note",
          rawMetadata: { sourceSubType: "granola_summary" }
        }
      ]
    });

    expect(context.services.communicationsService.ingestion.runIngestBatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "granola",
        threads: [{ providerThreadId: "granola_note:not_abc123DEF45678", participants: [] }]
      })
    );
  });

  it("routes project context indexing to the manual context service", async () => {
    const context = createContext();
    const handlers = createJobHandlers(context);
    const contextId = "55555555-5555-4555-8555-555555555555";

    await handlers[JobNames.indexProjectContextEntry]?.({ contextId });

    expect(context.services.projectContextService.indexContextEntry).toHaveBeenCalledWith(contextId);
    expect(jobKeys.indexProjectContextEntry(contextId, "hash-1")).toBe(`context-entry:${contextId}:hash-1`);
  });

  it("rejects malformed internal DB ids while allowing provider refs and idempotency keys", async () => {
    const context = createContext();
    const handlers = createJobHandlers(context);

    await expect(
      handlers[JobNames.syncCommunicationConnector]?.({
        connectorId: "connector-1",
        projectId: ids.project,
        syncType: "manual",
        syncRunId: ids.syncRun,
        idempotencyKey: "sync:provider-ref:cursor-1"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "job_payload_invalid"
    });

    await handlers[JobNames.ingestCommunicationBatch]?.({
      connectorId: ids.connector,
      projectId: ids.project,
      syncRunId: ids.syncRun,
      provider: "manual_import",
      threads: [{ providerThreadId: "provider-thread-1", participants: [] }],
      messages: [
        {
          providerThreadId: "provider-thread-1",
          providerMessageId: "provider-message-1",
          senderLabel: "Client",
          sentAt: "2026-04-19T10:00:00.000Z",
          bodyText: "Need weekly reporting.",
          messageType: "user"
        }
      ]
    });

    expect(context.services.communicationsService.sync.runSyncJob).not.toHaveBeenCalled();
    expect(context.services.communicationsService.ingestion.runIngestBatchJob).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid job payloads before dispatching to services", async () => {
    const context = createContext();
    const handlers = createJobHandlers(context);

    await expect(handlers[JobNames.parseDocument]?.({ parseRevision: 1 })).rejects.toMatchObject({
      statusCode: 400,
      code: "job_payload_invalid"
    });

    expect(context.services.documentService.processDocumentVersion).not.toHaveBeenCalled();
  });

  it("provides a stable idempotency key for Socrates suggestion precompute jobs", () => {
    expect(jobKeys.precomputeSocratesSuggestions("project-1", "session-1")).toBe(
      "socrates-suggestions:project-1:session-1"
    );
  });

  it("preserves dashboard refresh idempotency keys through payload validation", async () => {
    const context = createContext();
    const handlers = createJobHandlers(context);
    const idempotencyKey = `dashboard:project:${ids.project}:accepted_change:2026-05-14T12:04`;

    await handlers[JobNames.refreshDashboardSnapshot]?.({
      scope: "project",
      orgId: ids.org,
      projectId: ids.project,
      reason: "accepted_change",
      idempotencyKey
    });

    expect(context.services.dashboardService.refreshSnapshotJob).toHaveBeenCalledWith({
      scope: "project",
      orgId: ids.org,
      projectId: ids.project,
      reason: "accepted_change",
      idempotencyKey
    });
  });

  it("rejects malformed dashboard refresh scope payloads before dispatch", async () => {
    const context = createContext();
    const handlers = createJobHandlers(context);

    await expect(
      handlers[JobNames.refreshDashboardSnapshot]?.({
        scope: "general",
        orgId: ids.org,
        projectId: ids.project,
        reason: "bad_general_payload"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "job_payload_invalid"
    });
    await expect(
      handlers[JobNames.refreshDashboardSnapshot]?.({
        scope: "project",
        orgId: ids.org,
        reason: "missing_project"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "job_payload_invalid"
    });

    expect(context.services.dashboardService.refreshSnapshotJob).not.toHaveBeenCalled();
  });

  it("maps Day 5 jobs to retry and concurrency policy metadata", () => {
    const env = {
      NODE_ENV: "test",
      QUEUE_MODE: "inline",
      JOB_DEFAULT_ATTEMPTS: 3,
      JOB_DEFAULT_BACKOFF_MS: 1000
    } as any;

    expect(getJobExecutionPolicy(JobNames.parseDocument, env)).toMatchObject({
      attempts: 3,
      backoffMs: 1000,
      heavy: true,
      concurrencyGroup: "document"
    });
    expect(getJobExecutionPolicy(JobNames.syncCommunicationConnector, env)).toMatchObject({
      heavy: true,
      concurrencyGroup: "communication"
    });
    expect(getJobExecutionPolicy(JobNames.refreshDashboardSnapshot, env)).toMatchObject({
      heavy: false,
      concurrencyGroup: "dashboard"
    });
  });

  it("prevents production inline job execution", () => {
    expect(() =>
      assertProductionQueueMode({
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "production",
        QUEUE_MODE: "inline"
      } as any)
    ).toThrow(/QUEUE_MODE=bullmq/);
  });
});
