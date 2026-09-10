import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "../../config/env.js";
import { AppError } from "../../app/errors.js";
import type { EmbeddingProvider } from "../../lib/ai/provider.js";
import { buildMessageContextualContent, buildMessageLexicalContent } from "../../lib/communications/message-contextualize.js";
import { stableBodyHash } from "../../lib/communications/idempotency.js";
import { jobKeys } from "../../lib/jobs/keys.js";
import { JobNames, type JobDispatcher } from "../../lib/jobs/types.js";
import { chunkText } from "../../lib/retrieval/chunking.js";
import { AuditService } from "../audit/service.js";

export class MessageIndexingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly env?: Pick<AppEnv, "BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED" | "BETA_COMMUNICATION_AUTO_CLASSIFY_ENABLED">
  ) {}

  async runIndexJob(input: { messageId: string; idempotencyKey?: string }) {
    if (input.idempotencyKey) {
      await this.prisma.jobRun.upsert({
        where: { idempotencyKey: input.idempotencyKey },
        update: {
          jobType: "index_communication_message",
          status: "running",
          startedAt: new Date(),
          finishedAt: null,
          lastError: null,
          attemptCount: { increment: 1 }
        },
        create: {
          jobType: "index_communication_message",
          status: "running",
          idempotencyKey: input.idempotencyKey,
          startedAt: new Date(),
          attemptCount: 1
        }
      });
    }

    try {
      const result = await this.indexCommunicationMessage(input.messageId);
      if (input.idempotencyKey) {
        await this.prisma.jobRun.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: {
            status: "completed",
            finishedAt: new Date(),
            lastError: null
          }
        });
      }
      return result;
    } catch (error) {
      if (input.idempotencyKey) {
        await this.prisma.jobRun.update({
          where: { idempotencyKey: input.idempotencyKey },
          data: {
            status: "failed",
            finishedAt: new Date(),
            lastError: error instanceof Error ? error.message : "Unknown communication indexing error"
          }
        });
      }
      throw error;
    }
  }

  async indexCommunicationMessage(messageId: string) {
    const message = await this.prisma.communicationMessage.findUnique({
      where: { id: messageId },
      include: {
        thread: true,
        connector: true,
        attachments: true,
        project: true
      }
    });

    if (!message) {
      throw new AppError(404, "Communication message not found", "communication_message_not_found");
    }

    if (message.isDeletedByProvider) {
      await this.prisma.communicationMessageChunk.deleteMany({
        where: { messageId }
      });
      return { indexed: false, chunkCount: 0, skippedReason: "provider_deleted" };
    }

    const expectedBodyHash = stableBodyHash(message.bodyText, message.bodyHtml);
    if (message.bodyHash !== expectedBodyHash) {
      await this.prisma.communicationMessage.update({
        where: { id: message.id },
        data: { bodyHash: expectedBodyHash }
      });
    }

    const existingChunks = await this.prisma.communicationMessageChunk.findMany({
      where: { messageId },
      orderBy: { chunkIndex: "asc" }
    });

    const firefliesSegments = message.provider === "fireflies_ai" ? extractFirefliesSegments(message.rawMetadataJson) : [];
    const contentSignature = stableBodyHash(
      message.bodyText,
      JSON.stringify(firefliesSegments.length > 0 ? firefliesSegments : existingChunks.map((chunk) => chunk.metadataJson))
    );
    const attachmentNames = message.attachments
      .map((attachment) => attachment.filename)
      .filter((value): value is string => Boolean(value && value.trim().length > 0));
    const contextualBody = buildMessageContextualContent({
      provider: message.provider,
      senderLabel: message.senderLabel,
      senderEmail: message.senderEmail,
      sentAt: message.sentAt,
      bodyText: message.bodyText,
      thread: message.thread,
      attachmentNames
    });
    const lexicalContent = buildMessageLexicalContent({
      bodyText: message.bodyText,
      senderLabel: message.senderLabel,
      senderEmail: message.senderEmail,
      subject: message.thread.subject,
      attachmentNames
    });

    const existingSignature = existingChunks[0]?.metadataJson;
    if (
      existingChunks.length > 0 &&
      typeof existingSignature === "object" &&
      existingSignature !== null &&
      "contentSignature" in existingSignature &&
      (existingSignature as { contentSignature?: unknown }).contentSignature === contentSignature
    ) {
      return { indexed: false, chunkCount: existingChunks.length };
    }

    await this.prisma.communicationMessageChunk.deleteMany({
      where: { messageId }
    });

    const chunks =
      firefliesSegments.length > 0
        ? firefliesSegments.map((segment, index) => ({
            chunkIndex: index,
            content: segment.text,
            tokenCount: Math.max(1, Math.ceil(segment.text.length / 4)),
            metadata: {
              ...buildProviderChunkMetadata(message),
              ...extractSafeProviderEvidenceMetadata(message.rawMetadataJson),
              ...segment,
              timestampLabel: formatFirefliesTimestampRange(segment.startMs, segment.endMs),
              contentSignature
            }
          }))
        : chunkText({
            content: message.bodyText,
            documentTitle: message.thread.subject ?? `Thread ${message.threadId}`,
            kind: "communication_message",
            headingPath: [message.senderLabel],
            pageNumber: null,
            chunkSize: 220,
            overlapSize: 40
          }).map((chunk) => ({
            ...chunk,
            metadata: {
              ...buildProviderChunkMetadata(message),
              ...extractSafeProviderEvidenceMetadata(message.rawMetadataJson),
              senderLabel: message.senderLabel,
              senderEmail: message.senderEmail,
              subject: message.thread.subject,
              contentSignature
            }
          }));

    let indexedCount = 0;
    for (const chunk of chunks) {
      const firefliesMetadata = "metadata" in chunk ? (chunk.metadata as Record<string, unknown>) : null;
      const chunkContext =
        message.provider === "fireflies_ai" && firefliesMetadata
          ? buildFirefliesChunkContext({
              meetingTitle: String(firefliesMetadata.meetingTitle ?? message.thread.subject ?? "Fireflies meeting"),
              speakerName: typeof firefliesMetadata.speakerName === "string" ? firefliesMetadata.speakerName : null,
              timestampLabel: String(firefliesMetadata.timestampLabel ?? ""),
              text: chunk.content
            })
          : buildMessageContextualContent({
              provider: message.provider,
              senderLabel: message.senderLabel,
              senderEmail: message.senderEmail,
              sentAt: message.sentAt,
              bodyText: chunk.content,
              thread: message.thread,
              attachmentNames
            });
      const embedding = await this.embeddingProvider.embedText(chunkContext);
      const created = await this.prisma.communicationMessageChunk.create({
        data: {
          messageId: message.id,
          threadId: message.threadId,
          projectId: message.projectId,
          connectorId: message.connectorId,
          provider: message.provider,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          contextualContent: chunkContext,
          lexicalContent,
          tokenCount: chunk.tokenCount,
          metadataJson: chunk.metadata
        }
      });

      await this.prisma.$executeRawUnsafe(
        "UPDATE communication_message_chunks SET embedding = CAST($1 AS extensions.vector) WHERE id = CAST($2 AS uuid)",
        `[${embedding.join(",")}]`,
        created.id
      );
      indexedCount += 1;
    }

    await this.auditService.record({
      orgId: message.project.orgId,
      projectId: message.projectId,
      eventType: "communication_message_indexed",
      entityType: "communication_message",
      entityId: message.id,
      payload: {
        connectorId: message.connectorId,
        provider: message.provider,
        chunkCount: indexedCount
      }
    });

    if (this.shouldAutoClassifyMessages()) {
      const classifyKey = jobKeys.classifyMessageInsight(message.id, expectedBodyHash);
      await this.prisma.jobRun.upsert({
        where: { idempotencyKey: classifyKey },
        update: {
          jobType: JobNames.classifyMessageInsight,
          status: "pending",
          payloadJson: { projectId: message.projectId, messageId: message.id, idempotencyKey: classifyKey }
        },
        create: {
          jobType: JobNames.classifyMessageInsight,
          status: "pending",
          idempotencyKey: classifyKey,
          payloadJson: { projectId: message.projectId, messageId: message.id, idempotencyKey: classifyKey }
        }
      });
      await this.jobs.enqueue(
        JobNames.classifyMessageInsight,
        { projectId: message.projectId, messageId: message.id, idempotencyKey: classifyKey },
        classifyKey
      );
    }

    return { indexed: true, chunkCount: indexedCount };
  }

  private shouldAutoClassifyMessages() {
    return this.env?.BETA_COMMUNICATION_CHANGE_DETECTION_ENABLED !== false &&
      this.env?.BETA_COMMUNICATION_AUTO_CLASSIFY_ENABLED !== false;
  }
}

function buildProviderChunkMetadata(message: {
  id: string;
  connectorId: string;
  threadId: string;
  provider: string;
  providerMessageId?: string | null;
  providerPermalink?: string | null;
  sentAt: Date;
  rawMetadataJson?: unknown;
  isDeletedByProvider?: boolean;
}) {
  return {
    provider: message.provider,
    connectorId: message.connectorId,
    threadId: message.threadId,
    messageId: message.id,
    providerMessageId: message.providerMessageId ?? null,
    providerPermalink: message.providerPermalink ?? null,
    sourceSubType: extractSourceSubType(message.rawMetadataJson),
    sentAt: message.sentAt.toISOString(),
    unavailable: message.isDeletedByProvider ?? false
  };
}

function extractSourceSubType(rawMetadata: unknown) {
  if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
    return null;
  }
  const value = (rawMetadata as Record<string, unknown>).sourceSubType;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractSafeProviderEvidenceMetadata(rawMetadata: unknown) {
  if (!rawMetadata || typeof rawMetadata !== "object" || Array.isArray(rawMetadata)) {
    return {};
  }
  const raw = rawMetadata as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};
  for (const key of ["noteId", "segmentIndex", "startTime", "endTime", "transcriptSource", "sourceKind", "platformShape", "notTruth"]) {
    const value = raw[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      metadata[key] = value;
    }
  }
  const speaker = raw.speaker;
  if (speaker && typeof speaker === "object" && !Array.isArray(speaker)) {
    const source = (speaker as Record<string, unknown>).source;
    const diarizationLabel = (speaker as Record<string, unknown>).diarizationLabel;
    metadata.speaker = {
      source: typeof source === "string" ? source : "unknown",
      diarizationLabel: typeof diarizationLabel === "string" ? diarizationLabel : null
    };
  }
  const folders = raw.folderMembership;
  if (Array.isArray(folders)) {
    metadata.folderIds = folders
      .map((folder) => (folder && typeof folder === "object" ? (folder as Record<string, unknown>).id : null))
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  }
  return metadata;
}

type FirefliesSegmentMetadata = {
  speakerName: string | null;
  speakerEmail: string | null;
  speakerId: string | null;
  startMs: number;
  endMs: number | null;
  text: string;
  segmentIndex: number;
  transcriptId: string;
  meetingTitle: string;
};

function extractFirefliesSegments(rawMetadata: unknown): FirefliesSegmentMetadata[] {
  if (!rawMetadata || typeof rawMetadata !== "object") return [];
  const fireflies = (rawMetadata as { fireflies?: unknown }).fireflies;
  if (!fireflies || typeof fireflies !== "object") return [];
  const segments = (fireflies as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return [];
  return segments
    .map((segment): FirefliesSegmentMetadata | null => {
      if (!segment || typeof segment !== "object") return null;
      const item = segment as Record<string, unknown>;
      if (typeof item.text !== "string" || item.text.trim().length === 0) return null;
      return {
        speakerName: typeof item.speakerName === "string" ? item.speakerName : null,
        speakerEmail: typeof item.speakerEmail === "string" ? item.speakerEmail : null,
        speakerId: typeof item.speakerId === "string" ? item.speakerId : null,
        startMs: typeof item.startMs === "number" ? item.startMs : 0,
        endMs: typeof item.endMs === "number" ? item.endMs : null,
        text: item.text,
        segmentIndex: typeof item.segmentIndex === "number" ? item.segmentIndex : 0,
        transcriptId: typeof item.transcriptId === "string" ? item.transcriptId : "",
        meetingTitle: typeof item.meetingTitle === "string" ? item.meetingTitle : "Fireflies meeting"
      };
    })
    .filter((segment): segment is FirefliesSegmentMetadata => Boolean(segment));
}

function buildFirefliesChunkContext(input: {
  meetingTitle: string;
  speakerName: string | null;
  timestampLabel: string;
  text: string;
}) {
  return [
    "Fireflies.ai meeting transcript segment",
    `Meeting: ${input.meetingTitle}`,
    `Speaker: ${input.speakerName ?? "Unknown speaker"}`,
    `Timestamp: ${input.timestampLabel}`,
    input.text
  ].join("\n");
}

function formatFirefliesTimestampRange(startMs: number, endMs: number | null) {
  return `${formatFirefliesMs(startMs)}-${formatFirefliesMs(endMs ?? startMs)}`;
}

function formatFirefliesMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
