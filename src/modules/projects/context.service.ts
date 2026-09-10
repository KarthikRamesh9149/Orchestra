import { createHash, randomUUID } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  ProjectContextAttachmentKind,
  ProjectContextImportance,
  ProjectContextStatus,
  ProjectContextType
} from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import type { EmbeddingProvider } from "../../lib/ai/provider.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import { jobKeys } from "../../lib/jobs/keys.js";
import { JobNames, type JobDispatcher } from "../../lib/jobs/types.js";
import { shouldEnableImageContext, shouldEnableImageVisionSummary } from "../../lib/mvp/policy.js";
import { parseDocumentBuffer } from "../../lib/parsers/index.js";
import { assertDocumentBufferSafe, looksLikePdf, looksLikeZip } from "../../lib/parsers/file-safety.js";
import { chunkText, estimateTokenCount } from "../../lib/retrieval/chunking.js";
import type { TelemetryService } from "../../lib/observability/telemetry.js";
import type { StorageDriver } from "../../lib/storage/types.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "./service.js";
import type {
  CreateProjectContextEntryInput,
  CreateProjectContextUploadInput,
  ListProjectContextEntriesQuery,
  UpdateProjectContextEntryInput
} from "./context.schemas.js";

type ContextRow = Prisma.ProjectContextEntryGetPayload<{
  include: {
    linkedMember: {
      include: {
        user: {
          select: {
            id: true;
            email: true;
            displayName: true;
          };
        };
      };
    };
    chunks: {
      select: {
        id: true;
        createdAt: true;
      };
    };
    attachments: true;
  };
}>;

type TxClient = Prisma.TransactionClient;

const chunkingTypes = new Set<ProjectContextType>(["chat_export", "manual_transcript", "meeting_note"]);
const imageContextLimitation =
  "This image was not parsed as text. Socrates only has the user-provided caption/description unless vision summary is enabled.";
const audioExtensionPattern = /\.(mp3|wav|m4a|aac|flac|ogg|webm)$/i;
const allowedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const allowedDocumentExtensions = new Set([".pdf", ".docx", ".txt", ".md", ".markdown"]);

export class ProjectContextService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: AppEnv,
    private readonly storage: StorageDriver,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly jobs: JobDispatcher,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly telemetry?: TelemetryService
  ) {}

  async listContext(projectId: string, actorUserId: string, query: ListProjectContextEntriesQuery) {
    if (query.includeDeleted) {
      await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    } else {
      await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    }
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where = this.buildListWhere(projectId, query);
    const [totalCount, rows] = await Promise.all([
      this.prisma.projectContextEntry.count({ where }),
      this.prisma.projectContextEntry.findMany({
        where,
        include: this.contextInclude(),
        orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return {
      items: rows.map((row) => this.toDto(row)),
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
      }
    };
  }

  async getContext(projectId: string, contextId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const row = await this.prisma.projectContextEntry.findFirst({
      where: { id: contextId, projectId, status: "active" },
      include: this.contextInclude()
    });
    if (!row) {
      throw new AppError(404, "Context entry not found", "project_context_not_found");
    }
    return this.toDto(row);
  }

  async getContextAttachmentSignedUrl(
    projectId: string,
    contextId: string,
    attachmentId: string,
    actorUserId: string
  ) {
    const attachment = await this.loadStoredAttachment(projectId, contextId, attachmentId, actorUserId);
    const url =
      this.env.STORAGE_DRIVER === "local"
        ? `/v1/projects/${projectId}/context/${contextId}/attachments/${attachmentId}/content`
        : await this.storage.getSignedUrl(attachment.storageKey);
    return {
      attachmentId: attachment.id,
      contextId: attachment.contextEntryId,
      url,
      expiresInSeconds: this.env.STORAGE_DRIVER === "local" ? 0 : this.env.SIGNED_URL_TTL_SECONDS,
      mimeType: attachment.mimeType,
      originalFilename: attachment.originalFilename ?? attachment.filename
    };
  }

  async getContextAttachmentFile(projectId: string, contextId: string, attachmentId: string, actorUserId: string) {
    const attachment = await this.loadStoredAttachment(projectId, contextId, attachmentId, actorUserId);
    const stored = await this.storage.getObjectStream(attachment.storageKey);
    return {
      attachmentId: attachment.id,
      contextId: attachment.contextEntryId,
      stream: stored.stream,
      size: stored.size,
      mimeType: attachment.mimeType,
      originalFilename: attachment.originalFilename ?? attachment.filename
    };
  }

  async createContext(projectId: string, actorUserId: string, input: CreateProjectContextEntryInput) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const project = await this.loadProject(projectId);
    const linkedMember = input.linkedMemberId ? await this.ensureActiveProjectMember(projectId, input.linkedMemberId) : null;
    const normalized = this.normalizeInput(input);
    const bodyHash = computeProjectContextBodyHash(normalized);

    const created = await this.withTransaction(async (tx) => {
      const row = await tx.projectContextEntry.create({
        data: {
          orgId: project.orgId,
          projectId,
          type: normalized.type,
          title: normalized.title,
          body: normalized.body,
          sourceDate: normalized.sourceDate ? new Date(normalized.sourceDate) : null,
          participantsJson: normalized.participants,
          tagsJson: normalized.tags,
          linkedMemberId: linkedMember?.id ?? null,
          importance: normalized.importance,
          source: "manual",
          status: "active",
          bodyHash,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          attachments: normalized.attachments.length
            ? {
                createMany: {
                  data: normalized.attachments.map((attachment) => ({
                    orgId: project.orgId,
                    projectId,
                    attachmentKind: classifyAttachmentKind(attachment.mimeType ?? null),
                    filename: attachment.filename ?? null,
                    originalFilename: attachment.filename ?? null,
                    safeFilename: attachment.filename ? sanitizeFileName(attachment.filename) : null,
                    mimeType: attachment.mimeType ?? null,
                    fileSize: attachment.fileSize ?? null,
                    providerUrl: attachment.providerUrl ?? null,
                    storageStatus: "metadata_only",
                    createdByUserId: actorUserId,
                    metadataJson: (attachment.metadata ?? {}) as Prisma.InputJsonValue
                  }))
                }
              }
            : undefined
        },
        include: this.contextInclude()
      }) as ContextRow;

      await this.recordAudit(tx, {
        orgId: project.orgId,
        projectId,
        actorUserId,
        eventType: "project_context_created",
        entityType: "project_context",
        entityId: row.id,
        payload: this.auditSnapshot(row)
      });
      return row;
    });

    await this.enqueueIndexJob(created.id, created.bodyHash);
    await this.enqueueDashboardRefresh(projectId, "project_context_created");
    this.telemetry?.increment("project_context_created_total", { type: created.type });

    return this.toDto(created);
  }

  async createContextFromUpload(projectId: string, actorUserId: string, input: CreateProjectContextUploadInput) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    if (input.file.size <= 0) {
      throw new AppError(422, "Context upload file is empty", "empty_context_file");
    }

    const normalizedMime = normalizeMimeType(input.file.mimeType);
    const originalFilename = input.file.filename.trim() || "context-upload";
    if (isAudioFile(normalizedMime, originalFilename)) {
      throw new AppError(422, "audio_file_context_not_supported_in_mvp", "audio_file_context_not_supported_in_mvp");
    }

    const fileValidation = this.validateContextUploadFile(normalizedMime, originalFilename, input.file.buffer);
    const isImage = fileValidation.kind === "image";
    if (fileValidation.kind === "unsupported") {
      throw new AppError(415, "unsupported_context_file_type", "unsupported_context_file_type");
    }
    if (isImage && !shouldEnableImageContext(this.env)) {
      throw new AppError(403, "Image context is disabled", "image_context_disabled_in_mvp");
    }
    const maxSize = isImage ? this.env.MVP_IMAGE_CONTEXT_MAX_FILE_SIZE_BYTES : this.env.MVP_CONTEXT_ATTACHMENT_MAX_FILE_SIZE_BYTES;
    if (input.file.size > maxSize) {
      throw new AppError(413, "Context file exceeds configured size limit", "context_file_too_large", { maxSize });
    }

    const type = normalizeUploadContextType(input.type, isImage);
    if (isImage && !input.caption?.trim()) {
      throw new AppError(422, "caption is required for image, chart, screenshot, and WhatsApp screenshot context", "image_context_caption_required");
    }

    const project = await this.loadProject(projectId);
    const linkedMember = input.linkedMemberId ? await this.ensureActiveProjectMember(projectId, input.linkedMemberId) : null;
    const checksumSha256 = createHash("sha256").update(input.file.buffer).digest("hex");
    const contextId = randomUUID();
    const attachmentId = randomUUID();
    const safeFilename = sanitizeFileName(originalFilename);
    const extension = safeExtensionForMime(normalizedMime, originalFilename);
    const storageKey = `projects/${projectId}/context/${contextId}/${attachmentId}/${checksumSha256}${extension}`;
    const attachmentKind = isImage ? "image" : classifyAttachmentKind(normalizedMime);
    const body = isImage
      ? buildImageContextBody({
          title: input.title,
          type,
          caption: input.caption ?? "",
          description: input.description ?? null,
          originalFilename,
          mimeType: normalizedMime,
          visionSummaryEnabled: shouldEnableImageVisionSummary(this.env)
        })
      : await buildDocumentContextBody({
          title: input.title,
          type,
          caption: input.caption ?? null,
          description: input.description ?? null,
          mimeType: normalizedMime,
          filename: originalFilename,
          buffer: input.file.buffer,
          parserMimeType: fileValidation.parserMimeType ?? normalizedMime
        });

    if (!body.trim()) {
      throw new AppError(422, "Context upload did not produce indexable text", "empty_context_upload_body");
    }

    await this.storage.putObject({ key: storageKey, body: input.file.buffer, contentType: normalizedMime });

    const normalized = {
      type,
      title: input.title,
      body,
      sourceDate: input.sourceDate ?? null,
      participants: input.participants ?? [],
      tags: normalizeTags(input.tags ?? []),
      linkedMemberId: linkedMember?.id ?? null,
      importance: input.importance ?? "normal"
    };
    const bodyHash = computeProjectContextBodyHash(normalized);
    const metadata = {
      uploadType: input.type,
      subtype: input.type === "whatsapp_screenshot" ? "whatsapp_screenshot" : input.type === "chat_screenshot" ? "whatsapp_or_chat_screenshot" : null,
      visionSummaryStatus: shouldEnableImageVisionSummary(this.env) ? "not_configured" : "disabled",
      evidenceLimitations: isImage ? [imageContextLimitation] : []
    };

    const created = await this.withTransaction(async (tx) => {
      const row = await tx.projectContextEntry.create({
        data: {
          id: contextId,
          orgId: project.orgId,
          projectId,
          type: normalized.type,
          title: normalized.title,
          body: normalized.body,
          sourceDate: normalized.sourceDate ? new Date(normalized.sourceDate) : null,
          participantsJson: normalized.participants,
          tagsJson: normalized.tags,
          linkedMemberId: normalized.linkedMemberId,
          importance: normalized.importance,
          source: "manual",
          status: "active",
          bodyHash,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
          attachments: {
            create: {
              id: attachmentId,
              orgId: project.orgId,
              projectId,
              attachmentKind,
              filename: originalFilename,
              originalFilename,
              safeFilename,
              mimeType: normalizedMime,
              fileSize: BigInt(input.file.size),
              checksumSha256,
              storageKey,
              storageStatus: "stored",
              caption: input.caption ?? null,
              description: input.description ?? null,
              metadataJson: metadata as Prisma.InputJsonValue,
              createdByUserId: actorUserId
            }
          }
        },
        include: this.contextInclude()
      }) as ContextRow;

      await this.recordAudit(tx, {
        orgId: project.orgId,
        projectId,
        actorUserId,
        eventType: "project_context_created",
        entityType: "project_context",
        entityId: row.id,
        payload: this.auditSnapshot(row)
      });
      await this.recordAudit(tx, {
        orgId: project.orgId,
        projectId,
        actorUserId,
        eventType: "project_context_attachment_uploaded",
        entityType: "project_context_attachment",
        entityId: attachmentId,
        payload: {
          contextId: row.id,
          attachmentId,
          type: row.type,
          title: row.title,
          attachmentKind,
          mimeType: normalizedMime,
          fileSize: input.file.size,
          checksumSha256,
          captionLength: input.caption?.length ?? 0,
          descriptionLength: input.description?.length ?? 0,
          actorUserId,
          projectId,
          sourceDate: normalized.sourceDate,
          tags: normalized.tags
        }
      });
      return row;
    }).catch(async (error) => {
      await this.storage.deleteObject(storageKey).catch(() => undefined);
      throw error;
    });

    await this.enqueueIndexJob(created.id, created.bodyHash);
    await this.enqueueDashboardRefresh(projectId, "project_context_created");
    this.telemetry?.increment("project_context_upload_created_total", { type: created.type, attachmentKind });

    return this.toDto(created);
  }

  async updateContext(
    projectId: string,
    contextId: string,
    actorUserId: string,
    input: UpdateProjectContextEntryInput
  ) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const existing = await this.loadActiveContext(projectId, contextId);
    const linkedMember = Object.prototype.hasOwnProperty.call(input, "linkedMemberId") && input.linkedMemberId
      ? await this.ensureActiveProjectMember(projectId, input.linkedMemberId)
      : null;
    const next = this.mergeForUpdate(existing, input, linkedMember?.id ?? null);
    const bodyHash = computeProjectContextBodyHash(next);
    const needsReindex = bodyHash !== existing.bodyHash;
    const storedAttachmentsToReplace = input.attachments
      ? existing.attachments.filter((attachment) => attachment.storageKey).map((attachment) => ({
          id: attachment.id,
          storageKey: attachment.storageKey!
        }))
      : [];

    const updated = await this.withTransaction(async (tx) => {
      if (input.attachments) {
        await tx.projectContextAttachment.deleteMany({
          where: { contextEntryId: existing.id, storageKey: null }
        });
        if (storedAttachmentsToReplace.length > 0) {
          await tx.projectContextAttachment.updateMany({
            where: { id: { in: storedAttachmentsToReplace.map((attachment) => attachment.id) } },
            data: { storageStatus: "failed" }
          });
        }
      }
      const row = await tx.projectContextEntry.update({
        where: { id: existing.id },
        data: {
          type: next.type,
          title: next.title,
          body: next.body,
          sourceDate: next.sourceDate ? new Date(next.sourceDate) : null,
          participantsJson: next.participants,
          tagsJson: next.tags,
          linkedMemberId: next.linkedMemberId,
          importance: next.importance,
          bodyHash,
          updatedByUserId: actorUserId,
          attachments: input.attachments?.length
            ? {
                createMany: {
                  data: input.attachments.map((attachment) => ({
                    orgId: existing.orgId,
                    projectId,
                    attachmentKind: classifyAttachmentKind(attachment.mimeType ?? null),
                    filename: attachment.filename ?? null,
                    originalFilename: attachment.filename ?? null,
                    safeFilename: attachment.filename ? sanitizeFileName(attachment.filename) : null,
                    mimeType: attachment.mimeType ?? null,
                    fileSize: attachment.fileSize ?? null,
                    providerUrl: attachment.providerUrl ?? null,
                    storageStatus: "metadata_only",
                    createdByUserId: actorUserId,
                    metadataJson: (attachment.metadata ?? {}) as Prisma.InputJsonValue
                  }))
                }
              }
            : undefined
        },
        include: this.contextInclude()
      }) as ContextRow;

      await this.recordAudit(tx, {
        orgId: existing.orgId,
        projectId,
        actorUserId,
        eventType: "project_context_updated",
        entityType: "project_context",
        entityId: row.id,
        payload: {
          contextId: row.id,
          before: this.auditSnapshot(existing),
          after: this.auditSnapshot(row)
        }
      });
      return row;
    });

    if (needsReindex) {
      await this.enqueueIndexJob(updated.id, updated.bodyHash);
    }
    await this.cleanupPendingStorageObjects(projectId);
    await this.enqueueDashboardRefresh(projectId, "project_context_updated");

    return this.toDto(updated);
  }

  async deleteContext(projectId: string, contextId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const existing = await this.loadActiveContext(projectId, contextId);

    await this.withTransaction(async (tx) => {
      await tx.projectContextEntry.update({
        where: { id: existing.id },
        data: {
          status: "deleted",
          deletedAt: new Date(),
          deletedByUserId: actorUserId,
          updatedByUserId: actorUserId
        }
      });
      await tx.projectContextChunk.deleteMany({ where: { contextEntryId: existing.id } });
      await this.recordAudit(tx, {
        orgId: existing.orgId,
        projectId,
        actorUserId,
        eventType: "project_context_deleted",
        entityType: "project_context",
        entityId: existing.id,
        payload: {
          contextId: existing.id,
          deleted: this.auditSnapshot(existing)
        }
      });
    });
    await this.enqueueDashboardRefresh(projectId, "project_context_deleted");

    return { ok: true, deletedId: existing.id };
  }

  async reindexContext(projectId: string, contextId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanManageTeamContext(projectId, actorUserId);
    const existing = await this.loadActiveContext(projectId, contextId);
    await this.enqueueIndexJob(existing.id, existing.bodyHash);
    await this.withTransaction(async (tx) => {
      await this.recordAudit(tx, {
        orgId: existing.orgId,
        projectId,
        actorUserId,
        eventType: "project_context_reindexed",
        entityType: "project_context",
        entityId: existing.id,
        payload: this.auditSnapshot(existing)
      });
    });
    await this.enqueueDashboardRefresh(projectId, "project_context_reindexed");

    return { ok: true, contextId: existing.id, status: "queued" as const };
  }

  async indexContextEntry(contextId: string) {
    const entry = await this.prisma.projectContextEntry.findUnique({
      where: { id: contextId },
      include: this.contextInclude()
    });
    if (!entry) {
      throw new AppError(404, "Context entry not found", "project_context_not_found");
    }
    if (entry.status !== "active") {
      await this.prisma.projectContextChunk.deleteMany({ where: { contextEntryId: contextId } });
      return { ok: true, contextId, chunkCount: 0, skipped: "deleted" as const };
    }

    const chunks = buildContextChunks(entry);
    const chunksWithEmbeddings = await Promise.all(
      chunks.map(async (chunk) => ({
        ...chunk,
        embedding: await this.embeddingProvider.embedText(chunk.contextualText)
      }))
    );

    await this.withTransaction(async (tx) => {
      await tx.projectContextChunk.deleteMany({ where: { contextEntryId: contextId } });
      for (const chunk of chunksWithEmbeddings) {
        const created = await tx.projectContextChunk.create({
          data: {
            orgId: entry.orgId,
            projectId: entry.projectId,
            contextEntryId: entry.id,
            chunkIndex: chunk.chunkIndex,
            rawText: chunk.rawText,
            contextualText: chunk.contextualText,
            lexicalText: chunk.lexicalText,
            tokenEstimate: chunk.tokenEstimate,
            metadataJson: chunk.metadataJson
          }
        });
        await tx.$executeRawUnsafe(
          "UPDATE project_context_chunks SET embedding = CAST($1 AS extensions.vector) WHERE id = CAST($2 AS uuid)",
          `[${chunk.embedding.join(",")}]`,
          created.id
        );
      }
    });

    return { ok: true, contextId, chunkCount: chunks.length };
  }

  async getContextEvidenceForRetrieval(projectId: string, query: string, limit = 8) {
    const tokens = tokenize(query);
    const rows = await this.prisma.projectContextChunk.findMany({
      where: {
        projectId,
        contextEntry: { status: "active" }
      },
      include: {
        contextEntry: {
          include: {
            linkedMember: {
              include: { user: { select: { id: true, email: true, displayName: true } } }
            },
            chunks: { select: { id: true, createdAt: true } },
            attachments: true
          }
        }
      },
      take: 100,
      orderBy: { updatedAt: "desc" }
    });

    return rows
      .map((row) => ({ row, score: scoreContextChunk(row.contextualText, tokens) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  async buildContextSummary(projectId: string) {
    const rows = await this.prisma.projectContextEntry.findMany({
      where: { projectId, status: "active" },
      include: this.contextInclude(),
      orderBy: { updatedAt: "desc" },
      take: 200
    });
    return buildManualContextSummary(projectId, rows);
  }

  private validateContextUploadFile(mimeType: string, fileName: string, buffer: Buffer) {
    const ext = fileExtension(fileName);
    const hasImageExtension = allowedImageExtensions.has(ext) || ext === ".svg";
    const hasDocumentExtension = allowedDocumentExtensions.has(ext);
    const isAllowedImageMime = this.env.MVP_IMAGE_CONTEXT_ALLOWED_MIME_TYPES.includes(mimeType);

    if (isAllowedImageMime && allowedImageExtensions.has(ext) && this.looksLikeAllowedImage(mimeType, buffer)) {
      return { kind: "image" as const };
    }
    if (isAllowedImageMime || hasImageExtension || mimeType.startsWith("image/")) {
      return { kind: "unsupported" as const };
    }

    if (!hasDocumentExtension) {
      return { kind: "unsupported" as const };
    }
    if (mimeTypeMatchesDocumentExtension(mimeType, ext, this.env.MVP_CONTEXT_ALLOWED_FILE_MIME_TYPES)) {
      assertDocumentBufferSafe(mimeType, buffer, fileName);
      return { kind: "document" as const };
    }
    if (mimeType === "application/octet-stream" && isTextLikeExtension(ext) && isLikelyTextBuffer(buffer)) {
      return { kind: "document" as const, parserMimeType: "text/plain" };
    }
    return { kind: "unsupported" as const };
  }

  private looksLikeAllowedImage(mimeType: string, buffer: Buffer) {
    if (mimeType === "image/png") {
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mimeType === "image/jpeg") {
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (mimeType === "image/webp") {
      return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    }
    if (mimeType === "application/pdf") return looksLikePdf(buffer);
    if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return looksLikeZip(buffer);
    return false;
  }

  private async loadStoredAttachment(projectId: string, contextId: string, attachmentId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUseSocrates(projectId, actorUserId);
    const attachment = await this.prisma.projectContextAttachment.findFirst({
      where: {
        id: attachmentId,
        projectId,
        contextEntryId: contextId,
        contextEntry: { status: "active" }
      },
      select: {
        id: true,
        contextEntryId: true,
        storageKey: true,
        storageStatus: true,
        mimeType: true,
        originalFilename: true,
        filename: true
      }
    });
    if (!attachment) {
      throw new AppError(404, "Context attachment not found", "project_context_attachment_not_found");
    }
    if (attachment.storageStatus !== "stored" || !attachment.storageKey) {
      throw new AppError(422, "Context attachment is not stored", "context_attachment_not_stored");
    }
    return {
      ...attachment,
      storageKey: attachment.storageKey
    };
  }

  private buildListWhere(projectId: string, query: ListProjectContextEntriesQuery): Prisma.ProjectContextEntryWhereInput {
    const tag = query.tag?.trim().toLowerCase();
    return {
      projectId,
      ...(query.includeDeleted ? {} : { status: "active" as ProjectContextStatus }),
      ...(query.type ? { type: query.type } : {}),
      ...(query.importance ? { importance: query.importance } : {}),
      ...(query.linkedMemberId ? { linkedMemberId: query.linkedMemberId } : {}),
      ...(tag ? { tagsJson: { array_contains: [tag] } } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { body: { contains: query.q, mode: "insensitive" } },
              { linkedMember: { user: { displayName: { contains: query.q, mode: "insensitive" } } } }
            ]
          }
        : {})
    };
  }

  private async loadProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, orgId: true } });
    if (!project) {
      throw new AppError(404, "Project not found", "project_not_found");
    }
    return project;
  }

  private async ensureActiveProjectMember(projectId: string, memberId: string) {
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId, isActive: true },
      include: { user: { select: { id: true, email: true, displayName: true } } }
    });
    if (!member) {
      throw new AppError(422, "linkedMemberId must be an active member of this project", "invalid_context_linked_member");
    }
    return member;
  }

  private async loadActiveContext(projectId: string, contextId: string) {
    const row = await this.prisma.projectContextEntry.findFirst({
      where: { id: contextId, projectId, status: "active" },
      include: this.contextInclude()
    });
    if (!row) {
      throw new AppError(404, "Context entry not found", "project_context_not_found");
    }
    return row;
  }

  private normalizeInput(input: CreateProjectContextEntryInput) {
    return {
      type: input.type,
      title: input.title,
      body: input.body,
      sourceDate: input.sourceDate ?? null,
      participants: input.participants ?? [],
      tags: normalizeTags(input.tags ?? []),
      linkedMemberId: input.linkedMemberId ?? null,
      importance: input.importance ?? "normal",
      attachments: input.attachments ?? []
    };
  }

  private mergeForUpdate(existing: ContextRow, input: UpdateProjectContextEntryInput, validatedLinkedMemberId: string | null) {
    return {
      type: input.type ?? existing.type,
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
      sourceDate: Object.prototype.hasOwnProperty.call(input, "sourceDate")
        ? input.sourceDate ?? null
        : existing.sourceDate?.toISOString() ?? null,
      participants: input.participants ?? jsonStringArray(existing.participantsJson),
      tags: input.tags ? normalizeTags(input.tags) : jsonStringArray(existing.tagsJson),
      linkedMemberId: Object.prototype.hasOwnProperty.call(input, "linkedMemberId")
        ? input.linkedMemberId ? validatedLinkedMemberId : null
        : existing.linkedMemberId,
      importance: input.importance ?? existing.importance,
      attachments: input.attachments ?? []
    };
  }

  private async enqueueIndexJob(contextId: string, bodyHash: string) {
    const key = jobKeys.indexProjectContextEntry(contextId, bodyHash);
    await this.recordQueuedJob(JobNames.indexProjectContextEntry, key, { contextId });
    await this.jobs.enqueue(JobNames.indexProjectContextEntry, { contextId }, key);
  }

  private async recordQueuedJob(jobType: string, idempotencyKey: string, payload: unknown) {
    if (!("jobRun" in this.prisma) || typeof this.prisma.jobRun?.upsert !== "function") {
      return;
    }
    await this.prisma.jobRun.upsert({
      where: { idempotencyKey },
      update: {
        jobType,
        status: "pending",
        payloadJson: payload as Prisma.InputJsonValue,
        finishedAt: null,
        lastError: null
      },
      create: {
        jobType,
        status: "pending",
        idempotencyKey,
        payloadJson: payload as Prisma.InputJsonValue
      }
    });
  }

  private async enqueueDashboardRefresh(projectId: string, reason: string) {
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, reason);
  }

  private async withTransaction<T>(callback: (tx: TxClient) => Promise<T>) {
    if (typeof this.prisma.$transaction === "function") {
      return this.prisma.$transaction(callback);
    }
    return callback(this.prisma as unknown as TxClient);
  }

  private async recordAudit(
    tx: TxClient,
    input: {
      orgId: string;
      eventType: string;
      entityType: string;
      entityId?: string | null;
      projectId?: string | null;
      actorUserId?: string | null;
      payload: unknown;
    }
  ) {
    if (typeof this.auditService.recordWithClient === "function") {
      await this.auditService.recordWithClient(tx as unknown as Pick<PrismaClient, "auditEvent">, input);
      return;
    }
    await this.auditService.record(input);
  }

  private contextInclude() {
    return {
      linkedMember: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true
            }
          }
        }
      },
      chunks: {
        select: {
          id: true,
          createdAt: true
        }
      },
      attachments: true
    } satisfies Prisma.ProjectContextEntryInclude;
  }

  private async cleanupPendingStorageObjects(projectId: string) {
    const attachmentStore = this.prisma.projectContextAttachment as unknown as {
      findMany?: (args: unknown) => Promise<Array<{ id: string; storageKey: string | null }>>;
    };
    if (typeof attachmentStore.findMany !== "function") return;
    const pending = await attachmentStore.findMany({
      where: { projectId, storageStatus: "failed", storageKey: { not: null } },
      select: { id: true, storageKey: true },
      take: 20
    });
    for (const attachment of pending) {
      if (!attachment.storageKey) continue;
      try {
        await this.storage.deleteObject(attachment.storageKey);
        await this.prisma.projectContextAttachment.deleteMany({
          where: { id: attachment.id, storageStatus: "failed" }
        });
      } catch {
        this.telemetry?.increment("project_context_storage_cleanup_failed_total");
      }
    }
  }

  private auditSnapshot(row: ContextRow) {
    return {
      contextId: row.id,
      type: row.type,
      title: row.title,
      linkedMemberId: row.linkedMemberId,
      importance: row.importance,
      participants: jsonStringArray(row.participantsJson),
      tags: jsonStringArray(row.tagsJson),
      status: row.status,
      bodyHash: row.bodyHash,
      bodyLength: row.body.length,
      sourceDate: row.sourceDate?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private toDto(row: ContextRow) {
    const latestChunk = row.chunks
      .slice()
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    return {
      id: row.id,
      projectId: row.projectId,
      type: row.type,
      title: row.title,
      body: row.body,
      sourceDate: row.sourceDate?.toISOString() ?? null,
      participants: jsonStringArray(row.participantsJson),
      tags: jsonStringArray(row.tagsJson),
      linkedMemberId: row.linkedMemberId,
      linkedMember: row.linkedMember
        ? {
            memberId: row.linkedMember.id,
            userId: row.linkedMember.userId,
            displayName: row.linkedMember.user.displayName,
            email: row.linkedMember.user.email,
            roleInProject: row.linkedMember.roleInProject
          }
        : null,
      importance: row.importance,
      source: row.source,
      status: row.status,
      createdByUserId: row.createdByUserId,
      updatedByUserId: row.updatedByUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      attachments: (Array.isArray(row.attachments) ? row.attachments : [])
        .filter((attachment) => attachment.storageStatus !== "failed")
        .map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        originalFilename: attachment.originalFilename ?? attachment.filename,
        safeFilename: attachment.safeFilename,
        attachmentKind: attachment.attachmentKind,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize?.toString() ?? null,
        checksumSha256: attachment.checksumSha256,
        caption: attachment.caption,
        description: attachment.description,
        storageStatus: attachment.storageStatus,
        metadata: attachment.metadataJson,
        openTarget: {
          targetType: "project_context",
          targetRef: {
            projectId: row.projectId,
            contextId: row.id,
            attachmentId: attachment.id
          }
        }
      })),
      chunksSummary: {
        count: row.chunks.length,
        lastIndexedAt: latestChunk?.createdAt.toISOString() ?? null
      }
    };
  }
}

export type ProjectContextDto = ReturnType<ProjectContextService["toDto"]>;

export function computeProjectContextBodyHash(input: {
  type: ProjectContextType;
  title: string;
  body: string;
  sourceDate: string | null;
  participants: string[];
  tags: string[];
  linkedMemberId: string | null;
  importance: ProjectContextImportance;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        type: input.type,
        title: input.title,
        body: input.body,
        sourceDate: input.sourceDate,
        participants: input.participants,
        tags: input.tags,
        linkedMemberId: input.linkedMemberId,
        importance: input.importance
      })
    )
    .digest("hex");
}

export function buildManualContextSummary(projectId: string, rows: ContextRow[]) {
  const active = rows.filter((row) => row.status === "active");
  const latestContextAt =
    active
      .map((row) => row.updatedAt)
      .sort((left, right) => right.getTime() - left.getTime())[0]
      ?.toISOString() ?? null;
  return {
    totalCount: active.length,
    highImportanceCount: active.filter((row) => row.importance === "high").length,
    decisionNoteCount: active.filter((row) => row.type === "decision_note").length,
    manualTranscriptCount: active.filter((row) => row.type === "manual_transcript").length,
    imageContextCount: active.filter((row) => row.attachments.some((attachment) => attachment.attachmentKind === "image")).length,
    chartContextCount: active.filter((row) => row.type === "chart_caption").length,
    screenshotContextCount: active.filter((row) => row.type === "screenshot_caption").length,
    latestContextAt,
    teamNoteCount: active.filter((row) => row.type === "team_note").length,
    taskNoteCount: active.filter((row) => row.type === "task_note").length,
    quickLinks: {
      contextPath: `/projects/${projectId}/context`
    }
  };
}

export function buildContextChunks(entry: ContextRow) {
  const participants = jsonStringArray(entry.participantsJson);
  const tags = jsonStringArray(entry.tagsJson);
  const linkedMember = entry.linkedMember?.user.displayName ?? null;
  const attachments = (entry.attachments ?? []).map((attachment) => ({
    attachmentId: attachment.id,
    attachmentKind: attachment.attachmentKind,
    mimeType: attachment.mimeType,
    originalFilename: attachment.originalFilename ?? attachment.filename,
    caption: attachment.caption,
    description: attachment.description
  }));
  const limitations = attachments.some((attachment) => attachment.attachmentKind === "image")
    ? [imageContextLimitation]
    : [];
  const prefixParts = [
    `Manual context: ${entry.type} / ${entry.title}`,
    participants.length ? `participants ${participants.join(", ")}` : null,
    tags.length ? `tags ${tags.join(", ")}` : null,
    entry.sourceDate ? entry.sourceDate.toISOString().slice(0, 10) : null,
    linkedMember ? `linked member ${linkedMember}` : null
  ].filter(Boolean);
  const prefix = `${prefixParts.join(" / ")} — `;
  const chunkSize = chunkingTypes.has(entry.type) ? 500 : 900;
  const chunks = chunkText({
    content: entry.body,
    documentTitle: entry.title,
    kind: entry.type,
    headingPath: [entry.type, entry.title],
    pageNumber: null,
    chunkSize,
    overlapSize: 80
  });
  const baseChunks = chunks.length
    ? chunks
    : [{ chunkIndex: 0, content: entry.body, contextualContent: entry.body, tokenCount: estimateTokenCount(entry.body) }];

  return baseChunks.map((chunk) => {
    const contextualText = `${prefix}${chunk.content}`;
    return {
      chunkIndex: chunk.chunkIndex,
      rawText: chunk.content,
      contextualText,
      lexicalText: `${entry.title}\n${entry.type}\n${participants.join(" ")}\n${tags.join(" ")}\n${linkedMember ?? ""}\n${entry.body}`,
      tokenEstimate: chunk.tokenCount,
      metadataJson: {
        contextType: entry.type,
        importance: entry.importance,
        participants,
        tags,
        sourceDate: entry.sourceDate?.toISOString() ?? null,
        linkedMemberId: entry.linkedMemberId,
        attachments,
        limitations
      }
    };
  });
}

function jsonStringArray(value: Prisma.JsonValue) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeTags(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)));
}

function tokenize(query: string) {
  return Array.from(new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

function scoreContextChunk(text: string, tokens: string[]) {
  if (tokens.length === 0) return 0.1;
  const haystack = text.toLowerCase();
  return tokens.filter((token) => haystack.includes(token)).length;
}

function normalizeMimeType(value: string | undefined | null) {
  return (value ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function isAudioFile(mimeType: string, filename: string) {
  return mimeType.startsWith("audio/") || audioExtensionPattern.test(filename);
}

function classifyAttachmentKind(mimeType: string | null): ProjectContextAttachmentKind {
  const normalized = normalizeMimeType(mimeType);
  if (normalized.startsWith("image/")) return "image";
  if (normalized === "text/plain" || normalized === "text/markdown" || normalized === "application/markdown") {
    return "text";
  }
  if (
    normalized === "application/pdf" ||
    normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "document";
  }
  return "other";
}

function normalizeUploadContextType(type: CreateProjectContextUploadInput["type"], isImage: boolean): ProjectContextType {
  switch (type) {
    case "chart_image":
    case "chart_caption":
      return "chart_caption";
    case "screenshot":
    case "chat_screenshot":
    case "whatsapp_screenshot":
    case "screenshot_caption":
      return "screenshot_caption";
    case "chat_export":
      return "chat_export";
    case "manual_transcript":
      return "manual_transcript";
    case "meeting_note":
      return "meeting_note";
    case "other":
      return isImage ? "screenshot_caption" : "other";
    default:
      return "other";
  }
}

function sanitizeFileName(fileName: string) {
  const baseName = fileName.split(/[\\/]/).pop() ?? "context-upload";
  const sanitized = baseName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .toLowerCase();
  return sanitized || "context-upload";
}

function safeExtensionForMime(mimeType: string, fileName: string) {
  const byMime: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/markdown": ".md"
  };
  if (byMime[mimeType]) return byMime[mimeType];
  const match = sanitizeFileName(fileName).match(/\.([a-z0-9]{1,12})$/);
  return match ? `.${match[1]}` : "";
}

function buildImageContextBody(input: {
  title: string;
  type: ProjectContextType;
  caption: string;
  description: string | null;
  originalFilename: string;
  mimeType: string;
  visionSummaryEnabled: boolean;
}) {
  return [
    `Title: ${input.title}`,
    `Type: ${input.type}`,
    `Caption: ${input.caption}`,
    input.description ? `Description: ${input.description}` : null,
    `Attachment: ${input.originalFilename} (${input.mimeType})`,
    `Evidence limitation: ${imageContextLimitation}`,
    `Vision summary status: ${input.visionSummaryEnabled ? "enabled_without_provider_in_part5" : "disabled"}`
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildDocumentContextBody(input: {
  title: string;
  type: ProjectContextType;
  caption: string | null;
  description: string | null;
  mimeType: string;
  parserMimeType: string;
  filename: string;
  buffer: Buffer;
}) {
  const parsed = await parseDocumentBuffer(input.parserMimeType, input.buffer, input.filename);
  const parsedText = parsed.sections.map((section) => section.text.trim()).filter(Boolean).join("\n\n");
  const pieces = [
    `Title: ${input.title}`,
    `Type: ${input.type}`,
    input.caption ? `Caption: ${input.caption}` : null,
    input.description ? `Description: ${input.description}` : null,
    parsedText ? `Parsed file text:\n${parsedText}` : null
  ].filter(Boolean);
  return pieces.join("\n\n").slice(0, 60000);
}

function fileExtension(fileName: string) {
  const safeName = sanitizeFileName(fileName);
  const match = safeName.match(/\.([a-z0-9]{1,12})$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function isTextLikeExtension(extension: string) {
  return extension === ".txt" || extension === ".md" || extension === ".markdown";
}

function mimeTypeMatchesDocumentExtension(mimeType: string, extension: string, allowedMimeTypes: readonly string[]) {
  if (!allowedMimeTypes.includes(mimeType)) return false;
  if (extension === ".pdf") return mimeType === "application/pdf";
  if (extension === ".docx") return mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (isTextLikeExtension(extension)) {
    return mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "application/markdown";
  }
  return false;
}

function isLikelyTextBuffer(buffer: Buffer) {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.length === 0) return true;
  const text = sample.toString("utf8");
  const replacementCount = (text.match(/\uFFFD/g) ?? []).length;
  if (replacementCount > Math.max(1, sample.length * 0.01)) return false;
  let controlCount = 0;
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      controlCount += 1;
    }
  }
  return controlCount <= Math.max(1, sample.length * 0.02);
}
