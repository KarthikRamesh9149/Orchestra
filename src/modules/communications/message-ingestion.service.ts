import type { PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import { stableBodyHash, stableHash } from "../../lib/communications/idempotency.js";
import type { NormalizedCommunicationBatch, NormalizedMessage } from "../../lib/communications/provider-normalized-types.js";
import { jobKeys } from "../../lib/jobs/keys.js";
import { JobNames, type JobDispatcher } from "../../lib/jobs/types.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";

const BACKGROUND_ENQUEUE_ERROR_LIMIT = 500;

export class MessageIngestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly jobs: JobDispatcher,
    private readonly skipDashboardRefresh = false
  ) {}

  async ingestNormalizedBatch(batch: NormalizedCommunicationBatch) {
    const connector = await this.prisma.communicationConnector.findFirst({
      where: {
        id: batch.connectorId,
        projectId: batch.projectId,
        provider: batch.provider
      }
    });

    if (!connector) {
      throw new AppError(404, "Communication connector not found for project", "communication_connector_not_found");
    }

    if (batch.threads.length === 0) {
      throw new AppError(422, "Communication import requires at least one thread", "communication_thread_required");
    }
    const providerThreadIds = new Set(batch.threads.map((thread) => thread.providerThreadId));
    if (batch.threads.length > 1) {
      for (const message of batch.messages) {
        if (!message.providerThreadId) {
          throw new AppError(422, "Multi-thread communication batches require providerThreadId on each message", "communication_message_thread_required");
        }
        if (!providerThreadIds.has(message.providerThreadId)) {
          throw new AppError(422, "Communication message references an unknown provider thread", "communication_message_thread_invalid");
        }
      }
    }

    const threadByProviderId = new Map<string, { id: string; lastMessageAt: Date | null }>();
    for (const threadInput of batch.threads) {
      const thread = await this.prisma.communicationThread.upsert({
        where: {
          connectorId_providerThreadId: {
            connectorId: batch.connectorId,
            providerThreadId: threadInput.providerThreadId
          }
        },
        create: {
          projectId: batch.projectId,
          connectorId: batch.connectorId,
          provider: batch.provider,
          providerThreadId: threadInput.providerThreadId,
          subject: threadInput.subject ?? null,
          normalizedSubject: threadInput.subject?.trim().toLowerCase() ?? null,
          participantsJson: threadInput.participants as object,
          startedAt: threadInput.startedAt ? new Date(threadInput.startedAt) : null,
          lastMessageAt: threadInput.lastMessageAt ? new Date(threadInput.lastMessageAt) : null,
          threadUrl: threadInput.threadUrl ?? null,
          rawMetadataJson: (threadInput.rawMetadata ?? {}) as object
        },
        update: {
          subject: threadInput.subject ?? null,
          normalizedSubject: threadInput.subject?.trim().toLowerCase() ?? null,
          participantsJson: threadInput.participants as object,
          startedAt: threadInput.startedAt ? new Date(threadInput.startedAt) : null,
          lastMessageAt: threadInput.lastMessageAt ? new Date(threadInput.lastMessageAt) : null,
          threadUrl: threadInput.threadUrl ?? null,
          rawMetadataJson: (threadInput.rawMetadata ?? {}) as object
        }
      });
      threadByProviderId.set(threadInput.providerThreadId, {
        id: thread.id,
        lastMessageAt: thread.lastMessageAt
      });
    }

    let createdMessageCount = 0;
    let updatedRevisionCount = 0;
    const indexedMessages: Array<{ messageId: string; bodyHash: string }> = [];
    const messageIds: string[] = [];

    const messagesByProviderId = new Map<string, string>();
    const sortedMessages = [...batch.messages].sort((left, right) => {
      return new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime();
    });
    const existingProviderMessageIds = Array.from(
      new Set(
        sortedMessages.flatMap((message) => [
          message.providerMessageId,
          ...(message.replyToProviderMessageId ? [message.replyToProviderMessageId] : [])
        ])
      )
    );
    const existingMessages =
      existingProviderMessageIds.length > 0
        ? await this.prisma.communicationMessage.findMany({
            where: {
              connectorId: batch.connectorId,
              providerMessageId: { in: existingProviderMessageIds }
            }
          })
        : [];
    const existingByProviderMessageId = new Map(existingMessages.map((message) => [message.providerMessageId, message]));

    for (const messageInput of sortedMessages) {
      const providerThreadId = messageInput.providerThreadId ?? (batch.threads.length === 1 ? batch.threads[0].providerThreadId : null);
      if (!providerThreadId) {
        throw new AppError(422, "Multi-thread communication batches require providerThreadId on each message", "communication_message_thread_required");
      }
      const targetThread = threadByProviderId.get(providerThreadId);
      if (!targetThread) {
        throw new AppError(422, "Communication message references an unknown provider thread", "communication_message_thread_invalid");
      }
      const result = await this.upsertMessage(batch, targetThread.id, messageInput, messagesByProviderId, existingByProviderMessageId);
      messageIds.push(result.messageId);
      messagesByProviderId.set(messageInput.providerMessageId, result.messageId);

      if (result.created) {
        createdMessageCount += 1;
      }
      if (result.revisionCreated) {
        updatedRevisionCount += 1;
      }
      if (result.needsIndexing) {
        indexedMessages.push({ messageId: result.messageId, bodyHash: result.bodyHash });
      }
    }

    for (const [providerThreadId, thread] of threadByProviderId) {
      if (thread.lastMessageAt != null) continue;
      const latestMessage = sortedMessages
        .filter((message) => (message.providerThreadId ?? (batch.threads.length === 1 ? batch.threads[0].providerThreadId : null)) === providerThreadId)
        .at(-1);
      if (latestMessage) {
        await this.prisma.communicationThread.update({
          where: { id: thread.id },
          data: { lastMessageAt: new Date(latestMessage.sentAt) }
        });
      }
    }

    await Promise.all(indexedMessages.map(async (indexedMessage) => {
      const key = jobKeys.indexCommunicationMessage(indexedMessage.messageId, indexedMessage.bodyHash);
      await this.prisma.jobRun.upsert({
        where: { idempotencyKey: key },
        update: {
          jobType: JobNames.indexCommunicationMessage,
          status: "pending",
          payloadJson: { messageId: indexedMessage.messageId, idempotencyKey: key }
        },
        create: {
          jobType: JobNames.indexCommunicationMessage,
          status: "pending",
          idempotencyKey: key,
          payloadJson: { messageId: indexedMessage.messageId, idempotencyKey: key }
        }
      });
      this.enqueueIndexingJobInBackground(indexedMessage.messageId, key);
    }));

    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, batch.projectId, "communication_ingested", {
      skip: this.skipDashboardRefresh
    });

    return {
      threadId: threadByProviderId.get(batch.threads[0].providerThreadId)!.id,
      threadIds: Array.from(threadByProviderId.values()).map((thread) => thread.id),
      messageIds,
      createdMessageCount,
      updatedRevisionCount,
      indexedMessageCount: indexedMessages.length
    };
  }

  async runIngestBatchJob(batch: NormalizedCommunicationBatch) {
    return this.ingestNormalizedBatch(batch);
  }

  private enqueueIndexingJobInBackground(messageId: string, idempotencyKey: string) {
    try {
      void Promise.resolve(
        this.jobs.enqueue(
          JobNames.indexCommunicationMessage,
          { messageId, idempotencyKey },
          idempotencyKey
        )
      ).catch((error) => this.markIndexDispatchFailed(idempotencyKey, error));
    } catch (error) {
      void this.markIndexDispatchFailed(idempotencyKey, error);
    }
  }

  private async markIndexDispatchFailed(idempotencyKey: string, error: unknown) {
    try {
      await this.prisma.jobRun.updateMany({
        where: {
          idempotencyKey,
          status: "pending"
        },
        data: {
          status: "failed",
          finishedAt: new Date(),
          lastError: sanitizeBackgroundDispatchError(error)
        }
      });
    } catch {
      // Best-effort dispatch telemetry must never crash the request path.
    }
  }

  private async upsertMessage(
    batch: NormalizedCommunicationBatch,
    threadId: string,
    messageInput: NormalizedMessage,
    messagesByProviderId: Map<string, string>,
    existingByProviderMessageId: Map<string, Awaited<ReturnType<PrismaClient["communicationMessage"]["findMany"]>>[number]>
  ) {
    const replyToExisting =
      messageInput.replyToProviderMessageId != null
        ? messagesByProviderId.get(messageInput.replyToProviderMessageId) ??
          existingByProviderMessageId.get(messageInput.replyToProviderMessageId)?.id
        : null;

    const current = existingByProviderMessageId.get(messageInput.providerMessageId) ?? null;

    const bodyHash = stableBodyHash(messageInput.bodyText, messageInput.bodyHtml);
    let revisionCreated = false;
    let created = false;
    let messageId = current?.id ?? "";

    if (!current) {
      const createdMessage = await this.prisma.communicationMessage.create({
        data: {
          projectId: batch.projectId,
          connectorId: batch.connectorId,
          threadId,
          provider: batch.provider,
          providerMessageId: messageInput.providerMessageId,
          providerPermalink: messageInput.providerPermalink ?? null,
          senderLabel: messageInput.senderLabel,
          senderExternalRef: messageInput.senderExternalRef ?? null,
          senderEmail: messageInput.senderEmail ?? null,
          sentAt: new Date(messageInput.sentAt),
          bodyText: messageInput.bodyText,
          bodyHtml: messageInput.bodyHtml ?? null,
          bodyHash,
          messageType: messageInput.messageType,
          replyToMessageId: replyToExisting ?? null,
          rawMetadataJson: (messageInput.rawMetadata ?? {}) as object
        }
      });
      created = true;
      messageId = createdMessage.id;
    } else {
      if (current.projectId !== batch.projectId || current.threadId !== threadId) {
        throw new AppError(409, "Communication message belongs to a different project or thread", "communication_message_conflict");
      }

      if (current.bodyHash !== bodyHash) {
        const lastRevision = await this.prisma.communicationMessageRevision.findFirst({
          where: { messageId: current.id },
          orderBy: { revisionIndex: "desc" },
          select: { revisionIndex: true }
        });

        await this.prisma.communicationMessageRevision.create({
          data: {
            messageId: current.id,
            projectId: batch.projectId,
            connectorId: batch.connectorId,
            provider: batch.provider,
            revisionIndex: (lastRevision?.revisionIndex ?? 0) + 1,
            bodyText: current.bodyText,
            bodyHtml: current.bodyHtml,
            bodyHash: current.bodyHash,
            rawMetadataJson: current.rawMetadataJson as object | undefined,
            editedAt: new Date()
          }
        });

        revisionCreated = true;
      }

      await this.prisma.communicationMessage.update({
        where: { id: current.id },
        data: {
          providerPermalink: messageInput.providerPermalink ?? current.providerPermalink,
          senderLabel: messageInput.senderLabel,
          senderExternalRef: messageInput.senderExternalRef ?? null,
          senderEmail: messageInput.senderEmail ?? null,
          sentAt: new Date(messageInput.sentAt),
          bodyText: messageInput.bodyText,
          bodyHtml: messageInput.bodyHtml ?? null,
          bodyHash,
          isEdited: revisionCreated || current.isEdited,
          replyToMessageId: replyToExisting ?? current.replyToMessageId,
          rawMetadataJson: (messageInput.rawMetadata ?? {}) as object
        }
      });
      messageId = current.id;
    }

    await this.upsertAttachments(batch, messageId, messageInput);

    return {
      messageId,
      bodyHash,
      created,
      revisionCreated,
      needsIndexing: created || revisionCreated
    };
  }

  private async upsertAttachments(
    batch: NormalizedCommunicationBatch,
    messageId: string,
    messageInput: NormalizedMessage
  ) {
    for (const [index, attachment] of (messageInput.attachments ?? []).entries()) {
      const providerAttachmentId =
        attachment.providerAttachmentId ??
        `generated:${stableHash({
          providerMessageId: messageInput.providerMessageId,
          index,
          filename: attachment.filename ?? null,
          mimeType: attachment.mimeType ?? null,
          fileSize: attachment.fileSize ?? null,
          providerUrl: attachment.providerUrl ?? null
        })}`;
      await this.prisma.communicationAttachment.upsert({
        where: {
          messageId_providerAttachmentId: {
            messageId,
            providerAttachmentId
          }
        },
        create: {
          messageId,
          projectId: batch.projectId,
          connectorId: batch.connectorId,
          provider: batch.provider,
          providerAttachmentId,
          filename: attachment.filename ?? null,
          mimeType: attachment.mimeType ?? null,
          fileSize: attachment.fileSize != null ? BigInt(attachment.fileSize) : null,
          providerUrl: attachment.providerUrl ?? null,
          storageStatus: "metadata_only",
          rawMetadataJson: (attachment.rawMetadata ?? {}) as object
        },
        update: {
          filename: attachment.filename ?? null,
          mimeType: attachment.mimeType ?? null,
          fileSize: attachment.fileSize != null ? BigInt(attachment.fileSize) : null,
          providerUrl: attachment.providerUrl ?? null,
          rawMetadataJson: (attachment.rawMetadata ?? {}) as object
        }
      });
    }
  }
}

function sanitizeBackgroundDispatchError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown communication indexing dispatch error";
  return message.replace(/\s+/g, " ").slice(0, BACKGROUND_ENQUEUE_ERROR_LIMIT);
}
