import type { AppContext } from "../../types/index.js";
import { AppError } from "../../app/errors.js";
import type { NormalizedCommunicationBatch } from "../communications/provider-normalized-types.js";
import type { JobHandler } from "./queue.js";
import { JobNames, type JobName } from "./types.js";
import { z, type ZodTypeAny } from "zod";

type HandlerContext = Pick<AppContext, "services">;

const uuidSchema = z.string().uuid();
const providerRefSchema = z.string().min(1);
const optionalIdempotencySchema = z.object({
  idempotencyKey: z.string().min(1).optional()
});

const documentVersionPayloadSchema = z.object({
  documentVersionId: uuidSchema,
  parseRevision: z.number().int().nonnegative()
});

const projectPayloadSchema = z.object({
  projectId: uuidSchema
});

const liveDocPayloadSchema = projectPayloadSchema.extend({
  actorUserId: uuidSchema.optional().nullable(),
  proposalId: uuidSchema.optional().nullable(),
  reason: z.string().min(1).optional().nullable()
});

const acceptedChangePayloadSchema = z.object({
  projectId: uuidSchema,
  proposalId: uuidSchema
});

const deepResearchPayloadSchema = z.object({
  projectId: uuidSchema,
  runId: uuidSchema,
  actorUserId: uuidSchema.optional().nullable()
});

const socratesSuggestionPayloadSchema = z.object({
  projectId: uuidSchema,
  sessionId: uuidSchema
});

const dashboardPayloadSchema = optionalIdempotencySchema
  .extend({
    scope: z.enum(["general", "project"]),
    orgId: uuidSchema,
    projectId: uuidSchema.optional().nullable(),
    reason: z.string().min(1).optional()
  })
  .superRefine((value, context) => {
    if (value.scope === "project" && !value.projectId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "Project dashboard refresh requires projectId"
      });
    }
    if (value.scope === "general" && value.projectId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "General dashboard refresh must not include projectId"
      });
    }
  });

const connectorSyncPayloadSchema = optionalIdempotencySchema.extend({
  connectorId: uuidSchema,
  projectId: uuidSchema,
  syncType: z.enum(["manual", "webhook", "backfill", "incremental"]),
  syncRunId: uuidSchema,
  webhookPayload: z.record(z.string(), z.unknown()).optional()
});

const normalizedParticipantPayloadSchema = z.object({
  label: z.string().min(1),
  externalRef: z.string().optional().nullable(),
  email: z.string().optional().nullable()
});

const normalizedAttachmentPayloadSchema = z.object({
  providerAttachmentId: z.string().optional().nullable(),
  filename: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  fileSize: z.number().nonnegative().optional().nullable(),
  providerUrl: z.string().optional().nullable(),
  rawMetadata: z.record(z.string(), z.unknown()).optional().nullable()
});

const normalizedThreadPayloadSchema = z.object({
  providerThreadId: providerRefSchema,
  subject: z.string().optional().nullable(),
  participants: z.array(normalizedParticipantPayloadSchema),
  startedAt: z.union([z.string(), z.date()]).optional().nullable(),
  lastMessageAt: z.union([z.string(), z.date()]).optional().nullable(),
  threadUrl: z.string().optional().nullable(),
  rawMetadata: z.record(z.string(), z.unknown()).optional().nullable()
});

const normalizedMessagePayloadSchema = z.object({
  providerThreadId: providerRefSchema.optional().nullable(),
  providerMessageId: providerRefSchema,
  senderLabel: z.string().min(1),
  senderExternalRef: z.string().optional().nullable(),
  senderEmail: z.string().optional().nullable(),
  sentAt: z.union([z.string(), z.date()]),
  bodyText: z.string(),
  bodyHtml: z.string().optional().nullable(),
  messageType: z.enum(["user", "system", "bot", "file_share", "note", "other"]),
  providerPermalink: z.string().optional().nullable(),
  replyToProviderMessageId: z.string().optional().nullable(),
  rawMetadata: z.record(z.string(), z.unknown()).optional().nullable(),
  attachments: z.array(normalizedAttachmentPayloadSchema).optional()
});

const ingestBatchPayloadSchema = z.object({
  projectId: uuidSchema,
  connectorId: uuidSchema,
  provider: z.enum([
    "manual_import",
    "slack",
    "gmail",
    "outlook",
    "microsoft_teams",
    "whatsapp_business",
    "fireflies_ai",
    "clickup",
    "granola",
    "notion"
  ]),
  syncRunId: uuidSchema.optional().nullable(),
  threads: z.array(normalizedThreadPayloadSchema).min(1),
  messages: z.array(normalizedMessagePayloadSchema)
});

const messagePayloadSchema = optionalIdempotencySchema.extend({
  messageId: uuidSchema
});

const projectContextPayloadSchema = optionalIdempotencySchema.extend({
  contextId: uuidSchema
});

const messageClassificationPayloadSchema = messagePayloadSchema.extend({
  projectId: uuidSchema
});

const threadClassificationPayloadSchema = optionalIdempotencySchema.extend({
  projectId: uuidSchema,
  threadId: uuidSchema
});

const proposalFromInsightPayloadSchema = z
  .object({
    projectId: uuidSchema,
    insightId: uuidSchema.optional(),
    threadInsightId: uuidSchema.optional()
  })
  .refine((value) => value.insightId != null || value.threadInsightId != null, {
    message: "Either insightId or threadInsightId is required"
  });

const calendarSyncPayloadSchema = optionalIdempotencySchema.extend({
  connectionId: uuidSchema,
  projectId: uuidSchema,
  syncType: z.enum(["backfill", "incremental", "manual"]),
  syncRunId: uuidSchema
});

const googleDriveSyncPayloadSchema = optionalIdempotencySchema.extend({
  connectionId: uuidSchema,
  projectId: uuidSchema,
  syncType: z.enum(["full", "incremental", "webhook", "manual"]),
  syncRunId: uuidSchema,
  maxFiles: z.number().int().min(1).max(500).optional(),
  forceReindex: z.boolean().optional()
});

function parseJobPayload<TSchema extends ZodTypeAny>(jobName: JobName, schema: TSchema, payload: unknown): z.infer<TSchema> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new AppError(400, `Invalid payload for job ${jobName}`, "job_payload_invalid", result.error.flatten());
  }

  return result.data;
}

export function createJobHandlers(context: HandlerContext): Record<JobName, JobHandler> {
  return {
    [JobNames.parseDocument]: async (payload) => {
      const { documentVersionId, parseRevision } = parseJobPayload(
        JobNames.parseDocument,
        documentVersionPayloadSchema,
        payload
      );
      await context.services.documentService.processDocumentVersion(documentVersionId, parseRevision);
    },
    [JobNames.chunkDocument]: async (payload) => {
      const { documentVersionId, parseRevision } = parseJobPayload(
        JobNames.chunkDocument,
        documentVersionPayloadSchema,
        payload
      );
      await context.services.documentService.chunkDocumentVersion(documentVersionId, parseRevision);
    },
    [JobNames.embedDocumentChunks]: async (payload) => {
      const { documentVersionId, parseRevision } = parseJobPayload(
        JobNames.embedDocumentChunks,
        documentVersionPayloadSchema,
        payload
      );
      await context.services.documentService.embedDocumentChunks(documentVersionId, parseRevision);
    },
    [JobNames.generateSourcePackage]: async (payload) => {
      const { projectId } = parseJobPayload(JobNames.generateSourcePackage, projectPayloadSchema, payload);
      await context.services.brainService.generateSourcePackage(projectId);
    },
    [JobNames.generateClarifiedBrief]: async (payload) => {
      const { projectId } = parseJobPayload(JobNames.generateClarifiedBrief, projectPayloadSchema, payload);
      await context.services.brainService.generateClarifiedBrief(projectId);
    },
    [JobNames.generateBrainGraph]: async (payload) => {
      const { projectId } = parseJobPayload(JobNames.generateBrainGraph, projectPayloadSchema, payload);
      await context.services.brainService.generateBrainGraph(projectId);
    },
    [JobNames.generateProductBrain]: async (payload) => {
      const { projectId } = parseJobPayload(JobNames.generateProductBrain, projectPayloadSchema, payload);
      await context.services.brainService.generateProductBrain(projectId);
    },
    [JobNames.generateLiveDoc]: async (payload) => {
      const typed = parseJobPayload(JobNames.generateLiveDoc, liveDocPayloadSchema, payload);
      await context.services.liveDocService.refreshCurrentArtifact(typed.projectId, typed.actorUserId ?? null, {
        proposalId: typed.proposalId ?? null,
        reason: typed.reason ?? null
      });
    },
    [JobNames.applyAcceptedChange]: async (payload) => {
      const { projectId, proposalId } = parseJobPayload(
        JobNames.applyAcceptedChange,
        acceptedChangePayloadSchema,
        payload
      );
      await context.services.changeProposalService.applyAcceptedProposal(projectId, proposalId);
    },
    [JobNames.precomputeSocratesSuggestions]: async (payload) => {
      const { projectId, sessionId } = parseJobPayload(
        JobNames.precomputeSocratesSuggestions,
        socratesSuggestionPayloadSchema,
        payload
      );
      await context.services.socratesService.precomputeSuggestions(projectId, sessionId);
    },
    [JobNames.refreshDashboardSnapshot]: async (payload) => {
      await context.services.dashboardService.refreshSnapshotJob(
        parseJobPayload(JobNames.refreshDashboardSnapshot, dashboardPayloadSchema, payload)
      );
    },
    [JobNames.syncCommunicationConnector]: async (payload) => {
      await context.services.communicationsService.sync.runSyncJob(
        parseJobPayload(JobNames.syncCommunicationConnector, connectorSyncPayloadSchema, payload)
      );
    },
    [JobNames.ingestCommunicationBatch]: async (payload) => {
      await context.services.communicationsService.ingestion.runIngestBatchJob(
        parseJobPayload(JobNames.ingestCommunicationBatch, ingestBatchPayloadSchema, payload) as NormalizedCommunicationBatch
      );
    },
    [JobNames.indexCommunicationMessage]: async (payload) => {
      await context.services.communicationsService.indexing.runIndexJob(
        parseJobPayload(JobNames.indexCommunicationMessage, messagePayloadSchema, payload)
      );
    },
    [JobNames.indexProjectContextEntry]: async (payload) => {
      const { contextId } = parseJobPayload(JobNames.indexProjectContextEntry, projectContextPayloadSchema, payload);
      await context.services.projectContextService.indexContextEntry(contextId);
    },
    [JobNames.classifyMessageInsight]: async (payload) => {
      await context.services.communicationsService.messageInsights.runClassificationJob(
        parseJobPayload(JobNames.classifyMessageInsight, messageClassificationPayloadSchema, payload)
      );
    },
    [JobNames.classifyThreadInsight]: async (payload) => {
      await context.services.communicationsService.threadInsights.runClassificationJob(
        parseJobPayload(JobNames.classifyThreadInsight, threadClassificationPayloadSchema, payload)
      );
    },
    [JobNames.generateChangeProposalFromInsight]: async (payload) => {
      const typed = parseJobPayload(
        JobNames.generateChangeProposalFromInsight,
        proposalFromInsightPayloadSchema,
        payload
      );
      if (typed.insightId) {
        await context.services.communicationsService.messageInsights.autoCreateProposal(typed.projectId, typed.insightId);
      } else if (typed.threadInsightId) {
        await context.services.communicationsService.threadInsights.autoCreateProposal(
          typed.projectId,
          typed.threadInsightId
        );
      }
    },
    [JobNames.syncCalendarConnection]: async (payload) => {
      await context.services.calendarConnectionsService.runSyncJob(
        parseJobPayload(JobNames.syncCalendarConnection, calendarSyncPayloadSchema, payload)
      );
    },
    [JobNames.syncGoogleDriveConnection]: async (payload) => {
      await context.services.googleDriveService.runSyncJob(
        parseJobPayload(JobNames.syncGoogleDriveConnection, googleDriveSyncPayloadSchema, payload)
      );
    },
    [JobNames.deepResearchRun]: async (payload) => {
      const { projectId, runId, actorUserId } = parseJobPayload(
        JobNames.deepResearchRun,
        deepResearchPayloadSchema,
        payload
      );
      await context.services.deepResearchService.runResearchJob(projectId, runId, actorUserId ?? null);
    }
  };
}
