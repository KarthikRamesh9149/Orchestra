import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { DocumentVisibility, PrismaClient } from "@prisma/client";
import { AppError } from "../../app/errors.js";
import type { AppEnv } from "../../config/env.js";
import type { EmbeddingProvider } from "../../lib/ai/provider.js";
import type { TranscriptionProvider } from "../../lib/ai/provider.js";
import { isMvpBetaMode } from "../../lib/beta/policy.js";
import { getAggregateCache, invalidateProjectAggregateCaches, setAggregateCache } from "../../lib/dashboard/aggregate-cache.js";
import { enqueueProjectDashboardRefreshByProjectId } from "../../lib/dashboard/refresh.js";
import { jobKeys } from "../../lib/jobs/keys.js";
import type { JobDispatcher } from "../../lib/jobs/types.js";
import { JobNames } from "../../lib/jobs/types.js";
import { parseDocumentBuffer } from "../../lib/parsers/index.js";
import { assertDocumentBufferSafe } from "../../lib/parsers/file-safety.js";
import { parseTextDocument } from "../../lib/parsers/text.js";
import type { TelemetryService } from "../../lib/observability/telemetry.js";
import { chunkText } from "../../lib/retrieval/chunking.js";
import type { StorageDriver } from "../../lib/storage/types.js";
import { toAnchorId } from "../../lib/utils/anchors.js";
import { AuditService } from "../audit/service.js";
import { ProjectService } from "../projects/service.js";

type UploadInput = {
  projectId: string;
  actorUserId: string;
  kind: "prd" | "srs" | "meeting_note" | "call_note" | "reference" | "internal_note" | "other";
  title: string;
  visibility: "internal" | "shared_with_client";
  sourceLabel?: string;
  makePrimaryLiveDoc?: boolean;
  fileName: string;
  contentType: string;
  buffer: Buffer;
  operationId?: string;
  /** Internal connector identity only; never accepted by public upload routes. */
  sourceDocumentId?: string;
};

const documentUploadAllowedExtensions = new Set([".pdf", ".docx", ".txt", ".md", ".markdown", ".csv", ".xlsx"]);
const documentUploadMimeByExtension = new Map<string, string[]>([
  [".pdf", ["application/pdf"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  [".txt", ["text/plain"]],
  [".md", ["text/markdown", "text/plain"]],
  [".markdown", ["text/markdown", "text/plain"]],
  [".csv", ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]
]);
const documentUploadAllowedMimes = new Set([...documentUploadMimeByExtension.values()].flat());
const audioUploadMimePattern = /^audio\//i;
const audioUploadExtensionPattern = /\.(mp3|wav|m4a|aac|flac|ogg|webm)$/i;
const binarySniffBytes = 4096;
const DOCUMENT_LIST_CACHE_TTL_MS = 60_000;

type JobPayload = {
  documentVersionId: string;
  parseRevision: number;
};

type PaginationInput = {
  page?: number;
  pageSize?: number;
};

export function buildDocumentStorageKey(projectId: string, documentVersionId: string, checksumSha256: string, fileName: string) {
  return `${projectId}/documents/${documentVersionId}/${checksumSha256}${safeFileExtension(fileName)}`;
}

function safeFileExtension(fileName: string) {
  const baseName = fileName.split(/[\\/]/).pop() ?? "";
  const match = baseName.match(/\.([a-zA-Z0-9]{1,12})$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function normalizeUploadContentType(value: string) {
  return (value || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function normalizedUploadExtension(fileName: string) {
  const match = (fileName.split(/[\\/]/).pop() ?? "").toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match ? `.${match[1]}` : "";
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return ".docx";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return ".xlsx";
  if (mimeType === "text/csv" || mimeType === "application/csv") return ".csv";
  if (mimeType === "text/markdown") return ".md";
  if (mimeType === "text/plain") return ".txt";
  return "";
}

function isLikelyUtf8Text(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, binarySniffBytes));
  if (sample.length === 0) return true;
  if (sample.includes(0)) return false;
  const decoded = sample.toString("utf8");
  if (decoded.includes("\uFFFD")) return false;
  const controlChars = [...decoded].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 32 && ![9, 10, 13].includes(code);
  });
  return controlChars.length / Math.max(decoded.length, 1) < 0.05;
}

function validateDocumentUploadFile(input: Pick<UploadInput, "fileName" | "contentType" | "buffer">) {
  const extension = normalizedUploadExtension(input.fileName);
  const contentType = normalizeUploadContentType(input.contentType);

  if (audioUploadMimePattern.test(contentType) || audioUploadExtensionPattern.test(input.fileName)) {
    throw new AppError(422, "Audio document uploads are disabled in the MVP document upload path", "audio_document_upload_disabled_in_mvp");
  }

  if (!documentUploadAllowedExtensions.has(extension)) {
    if (documentUploadAllowedMimes.has(contentType)) {
      throw new AppError(422, "Document MIME type does not match filename extension", "document_file_type_mismatch");
    }
    throw new AppError(422, "Unsupported document file type", "unsupported_document_file_type");
  }

  if (contentType === "application/octet-stream") {
    if ((extension === ".txt" || extension === ".md" || extension === ".markdown" || extension === ".csv") && isLikelyUtf8Text(input.buffer)) {
      return {
        contentType: extension === ".csv" ? "text/csv" : extension === ".txt" ? "text/plain" : "text/markdown"
      };
    }
    throw new AppError(422, "Unsupported document file type", "unsupported_document_file_type");
  }

  const allowedMimes = documentUploadMimeByExtension.get(extension) ?? [];
  if (!allowedMimes.includes(contentType)) {
    throw new AppError(422, "Document MIME type does not match filename extension", "document_file_type_mismatch");
  }
  const normalizedContentType = extension === ".csv" ? "text/csv" : contentType;
  assertDocumentBufferSafe(normalizedContentType, input.buffer, input.fileName);

  return { contentType: normalizedContentType };
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    || Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

type ViewerAction = "open_document" | "open_anchor" | "search_document" | "open_provenance" | "open_message_evidence";

type ViewerPayloadOptions = PaginationInput & {
  versionId?: string;
  anchorId?: string;
  sectionId?: string;
  chunkId?: string;
  highlightCitationId?: string;
};

type AnchorOptions = {
  versionId?: string;
  highlightCitationId?: string;
};

type DocumentSearchOptions = {
  q: string;
  versionId?: string;
  limit?: number;
};

type MessageRef =
  | {
      type: "message";
      id: string;
      senderLabel: string | null;
      sentAt: string | null;
      threadId: string | null;
    }
  | {
      type: "thread";
      id: string;
      subject: string | null;
      lastMessageAt: string | null;
    };

type ViewerChangeMarker = {
  changeProposalId: string | null;
  proposalType: string;
  status: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  title: string;
  summary: string;
  decisionRecordId: string | null;
  linkedBrainNodeIds: string[];
  linkedThreadIds: string[];
  linkedMessageRefs: MessageRef[];
};

type SectionReadModel = {
  sectionId: string;
  anchorId: string;
  citationLabel: string;
  pageNumber: number | null;
  headingPath: string[];
  orderIndex: number;
  text: string;
  changeMarkers: ViewerChangeMarker[];
  linkedDecisionIds: string[];
  linkedMessageRefs: MessageRef[];
  hasCurrentTruthOverlay: boolean;
  currentTruthSummary: string[] | null;
};

type ViewerOpenTarget = ReturnType<DocumentService["buildDocumentSectionOpenTarget"]>;

type DriveSourceReadModel = {
  provider: "google_drive";
  label: "Google Drive";
  fileId: string;
  fileName: string;
  mimeType: string;
  webViewLink: string | null;
  iconLink: string | null;
  ownersSummary: string | null;
  lastModifyingUserSummary: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  sharedDrive: boolean;
  indexStatus: string;
  openTarget: {
    targetType: string;
    targetRef: Record<string, unknown>;
  };
};

type NotionSourceReadModel = {
  provider: "notion";
  label: "Notion";
  resourceId: string;
  notionResourceId: string;
  resourceType: string;
  title: string;
  url: string | null;
  selectedResourceId: string | null;
  selectedResourceLabel: string | null;
  lastEditedAt: string | null;
  indexStatus: string;
  openTarget: {
    targetType: string;
    targetRef: Record<string, unknown>;
  };
};

type HighlightReadModel = {
  citationId?: string;
  citationType?: string;
  refId: string;
  sectionId: string;
  anchorId: string;
  pageNumber: number | null;
  chunkId: string | null;
  citationLabel: string;
  openTarget: ViewerOpenTarget;
};

type TargetSection = {
  source: "anchor" | "section" | "chunk" | "citation";
  section: {
    id: string;
    anchorId: string;
    pageNumber: number | null;
    headingPath: string[];
    orderIndex: number;
    normalizedText: string;
  };
  chunkId?: string | null;
  citationId?: string;
  citationType?: string;
};

type SectionOverlayBundle = {
  markersBySection: Record<string, ViewerChangeMarker[]>;
  decisionIdsBySection: Record<string, string[]>;
  messageRefsBySection: Record<string, MessageRef[]>;
  truthSummariesBySection: Record<string, string[]>;
};

function ensureNonEmptySections(
  sections: Array<{ title: string; headingPath: string[]; pageNumber: number | null; text: string; metadataJson?: Record<string, unknown> }>
) {
  return sections
    .map((section) => ({
      ...section,
      text: section.text.trim()
    }))
    .filter((section) => section.text.length > 0);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildExcerpt(text: string, query: string) {
  const trimmedText = text.trim();
  const trimmedQuery = query.trim().toLowerCase();
  const lower = trimmedText.toLowerCase();
  const matchIndex = lower.indexOf(trimmedQuery);

  if (matchIndex === -1) {
    return trimmedText.slice(0, 220);
  }

  const start = Math.max(matchIndex - 80, 0);
  const end = Math.min(matchIndex + query.length + 120, trimmedText.length);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < trimmedText.length ? "..." : "";
  return `${prefix}${trimmedText.slice(start, end)}${suffix}`;
}

function computeSearchScore(sectionText: string, query: string, headingPath: string[]) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = sectionText.toLowerCase();
  const firstMatchIndex = normalizedText.indexOf(normalizedQuery);
  const occurrenceBoost = firstMatchIndex === -1 ? 0 : 1 / (firstMatchIndex + 1);
  const headingBoost = headingPath.some((value) => value.toLowerCase().includes(normalizedQuery)) ? 1 : 0;
  return headingBoost + occurrenceBoost;
}

export class DocumentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageDriver,
    private readonly jobs: JobDispatcher,
    private readonly embeddings: EmbeddingProvider,
    private readonly transcriptionProvider: TranscriptionProvider,
    private readonly projectService: ProjectService,
    private readonly auditService: AuditService,
    private readonly telemetry: TelemetryService,
    private readonly env?: AppEnv
  ) {}

  async getUploadOperation(projectId: string, actorUserId: string, operationId: string) {
    await this.projectService.ensureProjectMemberCanUploadContext(projectId, actorUserId);
    let version = await this.prisma.documentVersion.findFirst({
      where: { id: operationId, projectId },
      select: {
        id: true,
        documentId: true,
        status: true,
        parseRevision: true
      }
    });
    if (!version) {
      const audit = await this.prisma.auditEvent.findFirst({
        where: {
          projectId,
          actorUserId,
          eventType: { in: ["document_uploaded", "document_upload_deduplicated"] },
          payloadJson: { path: ["operationId"], equals: operationId }
        },
        orderBy: { createdAt: "desc" },
        select: { entityType: true, entityId: true, payloadJson: true }
      });
      const payload = audit?.payloadJson && typeof audit.payloadJson === "object" && !Array.isArray(audit.payloadJson)
        ? audit.payloadJson as { versionId?: unknown }
        : null;
      const versionId = audit?.entityType === "document_version"
        ? audit.entityId
        : typeof payload?.versionId === "string" ? payload.versionId : null;
      if (versionId) {
        version = await this.prisma.documentVersion.findFirst({
          where: { id: versionId, projectId },
          select: { id: true, documentId: true, status: true, parseRevision: true }
        });
      }
    }
    if (!version) return null;
    return {
      documentId: version.documentId,
      documentVersionId: version.id,
      status: version.status,
      parseRevision: version.parseRevision,
      operationId
    };
  }

  async uploadFile(input: UploadInput) {
    const validatedFile = validateDocumentUploadFile(input);
    await this.projectService.ensureProjectMemberCanUploadContext(input.projectId, input.actorUserId);

    const checksumSha256 = createHash("sha256").update(input.buffer).digest("hex");
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: input.projectId }
    });

    const existingOperation = input.operationId
      ? await this.prisma.documentVersion.findUnique({
          where: { id: input.operationId },
          include: { document: { select: { id: true, projectId: true, kind: true, title: true, visibility: true } } }
        })
      : null;
    if (existingOperation) {
      return this.reconcileUploadOperation(existingOperation, input, project, checksumSha256, validatedFile.contentType);
    }

    const existingDocument = await this.prisma.document.findFirst({
      where: {
        projectId: input.projectId,
        kind: input.kind,
        ...(input.sourceDocumentId ? { id: input.sourceDocumentId } : { title: input.title }),
        visibility: input.visibility,
        archivedAt: null
      },
      include: {
        versions: {
          where: {
            checksumSha256
          },
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        }
      }
    });

    const duplicateVersion = existingDocument?.versions[0];
    if (duplicateVersion && (!input.sourceDocumentId || duplicateVersion.id === existingDocument?.currentVersionId)) {
      await this.auditService.record({
        orgId: project.orgId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        eventType: "document_upload_deduplicated",
        entityType: "document_version",
        entityId: duplicateVersion.id,
        payload: { documentId: existingDocument.id, checksumSha256, title: input.title, operationId: input.operationId }
      });

      await this.maybeSetPrimaryLiveDocSource({
        project,
        actorUserId: input.actorUserId,
        documentId: existingDocument.id,
        documentVersionId: duplicateVersion.id,
        kind: input.kind,
        sourceLabel: input.sourceLabel,
        force: input.makePrimaryLiveDoc ?? false
      });

      return {
        documentId: existingDocument.id,
        documentVersionId: duplicateVersion.id,
        status: duplicateVersion.status,
        parseRevision: duplicateVersion.parseRevision,
        deduplicated: true,
        operationId: input.operationId
      };
    }

    // The browser keeps this UUID after an ambiguous timeout. Persisting it as
    // the version id lets a later reconciliation identify the exact mutation
    // without a second schema or a blind replay.
    const documentVersionId = input.operationId ?? randomUUID();
    // The operation id claims the database version. Each physical write has a
    // separate object key, so a losing request can only clean up its own bytes.
    const storageAttemptId = randomUUID();
    const fileKey = buildDocumentStorageKey(input.projectId, storageAttemptId, checksumSha256, input.fileName);
    await this.storage.putObject({
      key: fileKey,
      body: input.buffer,
      contentType: validatedFile.contentType
    });

    let created: { documentId: string; documentVersionId: string; status: string; parseRevision: number };
    try {
      created = await this.prisma.$transaction(async (tx) => {
      if (existingDocument) {
        const version = await tx.documentVersion.create({
          data: {
            id: documentVersionId,
            documentId: existingDocument.id,
            projectId: input.projectId,
            fileKey,
            checksumSha256,
            mimeType: validatedFile.contentType,
            fileSize: BigInt(input.buffer.length),
            status: "pending",
            sourceLabel: input.sourceLabel,
            uploadedBy: input.actorUserId,
            parseRevision: 1
          }
        });

        await tx.document.update({
          where: { id: existingDocument.id },
          data: {
            currentVersionId: version.id
          }
        });

        return {
          documentId: existingDocument.id,
          documentVersionId: version.id,
          status: version.status,
          parseRevision: version.parseRevision
        };
      }

      const document = await tx.document.create({
        data: {
          ...(input.sourceDocumentId ? { id: input.sourceDocumentId } : {}),
          projectId: input.projectId,
          kind: input.kind,
          title: input.title,
          uploadedBy: input.actorUserId,
          visibility: input.visibility
        }
      });

      const version = await tx.documentVersion.create({
        data: {
          id: documentVersionId,
          documentId: document.id,
          projectId: input.projectId,
          fileKey,
          checksumSha256,
          mimeType: validatedFile.contentType,
          fileSize: BigInt(input.buffer.length),
          status: "pending",
          sourceLabel: input.sourceLabel,
          uploadedBy: input.actorUserId,
          parseRevision: 1
        }
      });

      await tx.document.update({
        where: { id: document.id },
        data: {
          currentVersionId: version.id
        }
      });

      return {
        documentId: document.id,
        documentVersionId: version.id,
        status: version.status,
        parseRevision: version.parseRevision
      };
      });
    } catch (error) {
      if (input.operationId && isUniqueConstraintError(error)) {
        let claimed: any = null;
        try {
          claimed = await this.prisma.documentVersion.findUnique({
            where: { id: input.operationId },
            include: { document: { select: { id: true, projectId: true, kind: true, title: true, visibility: true } } }
          });
        } finally {
          await this.storage.deleteObject(fileKey).catch(() => undefined);
        }
        if (claimed) return this.reconcileUploadOperation(claimed, input, project, checksumSha256, validatedFile.contentType);
        throw new AppError(409, "Upload operation conflicts with a different or incomplete upload", "document_upload_operation_conflict");
      }
      await this.storage.deleteObject(fileKey).catch(() => undefined);
      throw error;
    }

    const parseKey = jobKeys.parseDocument(created.documentVersionId, created.parseRevision);
    const payload = {
      documentVersionId: created.documentVersionId,
      parseRevision: created.parseRevision
    };

    await this.recordQueuedJob(JobNames.parseDocument, parseKey, payload);
    try {
      await this.jobs.enqueue(JobNames.parseDocument, payload, parseKey);
    } catch (error) {
      await this.prisma.documentVersion.updateMany({ where: { id: created.documentVersionId, status: "pending" }, data: { status: "failed" } });
      await this.failJob(JobNames.parseDocument, parseKey, new Error("Document processing could not be queued"));
      throw new AppError(503, "Your file was stored, but processing could not start. Reload Memory, remove the failed file, then upload it again.", "document_dispatch_failed");
    }

    await this.auditService.record({
      orgId: project.orgId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      eventType: "document_uploaded",
      entityType: "document",
      entityId: created.documentId,
      payload: {
        versionId: created.documentVersionId,
        title: input.title,
        parseRevision: created.parseRevision,
        operationId: input.operationId
      }
    });

    await this.enqueueDashboardRefresh(input.projectId, "document_uploaded");
    await this.maybeSetPrimaryLiveDocSource({
      project,
      actorUserId: input.actorUserId,
      documentId: created.documentId,
      documentVersionId: created.documentVersionId,
      kind: input.kind,
      sourceLabel: input.sourceLabel,
      force: input.makePrimaryLiveDoc ?? false
    });

    return { ...created, operationId: input.operationId };
  }

  private async reconcileUploadOperation(
    version: any,
    input: UploadInput,
    project: { id: string; orgId: string },
    checksumSha256: string,
    contentType: string
  ) {
    const matchingInput = version.projectId === input.projectId
      && (!input.sourceDocumentId || version.documentId === input.sourceDocumentId)
      && version.document?.projectId === input.projectId
      && version.document?.kind === input.kind
      && (input.sourceDocumentId ? version.document?.id === input.sourceDocumentId : version.document?.title === input.title)
      && version.document?.visibility === input.visibility
      && version.checksumSha256 === checksumSha256
      && version.mimeType === contentType
      && BigInt(version.fileSize) === BigInt(input.buffer.length)
      && (version.sourceLabel ?? undefined) === input.sourceLabel
      && version.uploadedBy === input.actorUserId;
    if (!matchingInput) {
      throw new AppError(409, "Upload operation conflicts with a different upload", "document_upload_operation_conflict");
    }

    await this.auditService.record({
      orgId: project.orgId,
      projectId: input.projectId,
      actorUserId: input.actorUserId,
      eventType: "document_upload_deduplicated",
      entityType: "document_version",
      entityId: version.id,
      payload: { documentId: version.documentId, checksumSha256, title: input.title, operationId: input.operationId }
    });
    await this.maybeSetPrimaryLiveDocSource({
      project,
      actorUserId: input.actorUserId,
      documentId: version.documentId,
      documentVersionId: version.id,
      kind: input.kind,
      sourceLabel: input.sourceLabel,
      force: input.makePrimaryLiveDoc ?? false
    });
    return {
      documentId: version.documentId,
      documentVersionId: version.id,
      status: version.status,
      parseRevision: version.parseRevision,
      deduplicated: true,
      operationId: input.operationId
    };
  }

  private async maybeSetPrimaryLiveDocSource(input: {
    project: { id: string; orgId: string };
    actorUserId: string;
    documentId: string;
    documentVersionId: string;
    kind: UploadInput["kind"];
    sourceLabel?: string;
    force: boolean;
  }) {
    if (input.kind !== "prd" && input.kind !== "srs") {
      if (input.force) {
        throw new AppError(422, "Only PRD or SRS documents can be the primary Live Doc source", "invalid_live_doc_source_kind");
      }
      return null;
    }

    const existing = await this.prisma.projectLiveDocSource.findUnique({
      where: { projectId: input.project.id }
    });
    if (existing && !input.force) {
      return existing;
    }

    const sourceKind = `${input.sourceLabel === "generated_by_socrates" ? "generated" : "uploaded"}_${input.kind}` as const;
    const source = await this.prisma.projectLiveDocSource.upsert({
      where: { projectId: input.project.id },
      create: {
        orgId: input.project.orgId,
        projectId: input.project.id,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        sourceKind,
        setByUserId: input.actorUserId
      },
      update: {
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        sourceKind,
        setByUserId: input.actorUserId
      }
    });

    await this.auditService.record({
      orgId: input.project.orgId,
      projectId: input.project.id,
      actorUserId: input.actorUserId,
      eventType: "live_doc_primary_source_set",
      entityType: "document",
      entityId: input.documentId,
      payload: {
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        sourceKind,
        force: input.force
      }
    });

    return source;
  }

  async listDocuments(projectId: string, actorUserId: string, opts: PaginationInput = {}) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const pageSize = Math.min(opts.pageSize ?? 25, 200);
    const page = Math.max(opts.page ?? 1, 1);
    const cacheKey = `${projectId}:${member.projectRole}:page=${page}:pageSize=${pageSize}`;
    const cached = getAggregateCache<any>("documents-list", cacheKey, DOCUMENT_LIST_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }

    const skip = (page - 1) * pageSize;
    const where = {
      projectId,
      archivedAt: null,
      ...(this.clientDocumentFilter(member.projectRole) ?? {})
    };

    const [totalCount, documents] = await Promise.all([
      this.prisma.document.count({ where }),
      this.prisma.document.findMany({
        where,
        select: {
          id: true,
          projectId: true,
          title: true,
          kind: true,
          visibility: true,
          currentVersionId: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: {
          createdAt: "desc"
        },
        skip,
        take: pageSize
      })
    ]);

    const currentVersions = await this.loadCurrentVersions(documents);
    const driveSources = await this.loadDriveSourcesForDocuments(projectId, documents, currentVersions);
    const notionSources = await this.loadNotionSourcesForDocuments(projectId, documents, currentVersions);

    const payload = {
      items: documents.map((document) =>
        this.toDocumentListItem(
          document,
          currentVersions.get(document.currentVersionId ?? ""),
          driveSources.get(document.id),
          notionSources.get(document.id)
        )
      ),
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        hasMore: skip + documents.length < totalCount
      }
    };
    setAggregateCache("documents-list", cacheKey, payload);
    return payload;
  }

  async getDocument(projectId: string, documentId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const document = await this.prisma.document.findFirstOrThrow({
      where: {
        id: documentId,
        projectId,
        archivedAt: null,
        ...(this.clientDocumentFilter(member.projectRole) ?? {})
      }
    });

    const versions = await this.prisma.documentVersion.findMany({
      where: {
        documentId: document.id,
        projectId
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    const currentVersion = versions.find((version) => version.id === document.currentVersionId) ?? null;
    const driveSource = await this.loadDriveSourceForDocument(projectId, document.id, currentVersion?.id ?? null);
    const notionSource = await this.loadNotionSourceForDocument(projectId, document.id, currentVersion?.id ?? null);

    return {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      kind: document.kind,
      visibility: document.visibility,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      parseStatus: currentVersion?.status ?? null,
      currentVersion: currentVersion ? this.toVersionSummary(currentVersion, true) : null,
      versions: versions.map((version) => this.toVersionSummary(version, version.id === document.currentVersionId)),
      sourceProvider: driveSource ? "google_drive" : notionSource ? "notion" : currentVersion?.sourceLabel ?? "upload",
      sourceLabel: driveSource ? "Google Drive" : notionSource ? "Notion" : currentVersion?.sourceLabel ?? "Upload",
      source: driveSource ?? notionSource
    };
  }

  async archiveDocument(projectId: string, documentId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectMemberCanUploadContext(projectId, actorUserId);
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, projectId, archivedAt: null },
      select: { id: true, title: true, project: { select: { orgId: true } } }
    });
    if (!document) {
      throw new AppError(404, "Document not found", "document_not_found");
    }

    const archivedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.document.updateMany({
        where: { id: documentId, projectId, archivedAt: null },
        data: { archivedAt }
      });
      if (updated.count !== 1) {
        throw new AppError(409, "Document was already removed", "document_already_archived");
      }
      await this.auditService.recordWithClient(tx, {
        orgId: document.project.orgId,
        projectId,
        actorUserId,
        eventType: "memory_document_archived",
        entityType: "document",
        entityId: document.id,
        payload: { title: document.title, archivedAt: archivedAt.toISOString(), projectRole: member.projectRole }
      });
    });
    invalidateProjectAggregateCaches(projectId);

    return { documentId: document.id, archivedAt: archivedAt.toISOString() };
  }

  async getViewerPayload(
    projectId: string,
    documentId: string,
    actorUserId: string,
    opts: ViewerPayloadOptions = {}
  ) {
    const startedAt = process.hrtime.bigint();
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const document = await this.ensureAccessibleDocument(projectId, documentId, member.projectRole);

    const resolvedVersion = await this.resolveDocumentVersion(
      projectId,
      document,
      opts.versionId,
      true
    );
    const preResolvedHighlight = opts.highlightCitationId
      ? await this.resolveHighlightCandidate(projectId, document.id, opts.highlightCitationId, member.projectRole)
      : null;

    const explicitTarget = await this.resolveExplicitTarget(projectId, document.id, resolvedVersion.id, opts);
    const highlight = await this.resolveHighlightForVersion(
      projectId,
      document.id,
      resolvedVersion.id,
      opts.highlightCitationId,
      member.projectRole,
      preResolvedHighlight
    );
    const effectiveTarget = explicitTarget ?? highlight;

    const pageSize = Math.min(opts.pageSize ?? 200, 200);
    const totalCount = await this.prisma.documentSection.count({
      where: {
        documentVersionId: resolvedVersion.id,
        parseRevision: resolvedVersion.parseRevision
      }
    });
    const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
    const selectedPage = effectiveTarget != null
      ? Math.floor(effectiveTarget.section.orderIndex / pageSize) + 1
      : Math.min(Math.max(opts.page ?? 1, 1), totalPages);
    const skip = (selectedPage - 1) * pageSize;

    const sections = await this.prisma.documentSection.findMany({
      where: {
        documentVersionId: resolvedVersion.id,
        parseRevision: resolvedVersion.parseRevision
      },
      orderBy: {
        orderIndex: "asc"
      },
      skip,
      take: pageSize
    });

    const sectionPayloads = await this.buildSectionPayloads(
      projectId,
      document,
      resolvedVersion,
      sections,
      member.projectRole
    );

    const driveSource = await this.loadDriveSourceForDocument(projectId, document.id, resolvedVersion.id);

    const payload = {
      document: this.toDocumentIdentity(document),
      version: this.toVersionSummary(resolvedVersion, resolvedVersion.id === document.currentVersionId),
      source: driveSource,
      viewerState: effectiveTarget
        ? {
            documentId: document.id,
            documentVersionId: resolvedVersion.id,
            pageNumber: effectiveTarget.section.pageNumber,
            anchorId: effectiveTarget.section.anchorId
          }
        : null,
      selected: effectiveTarget
        ? {
            source: effectiveTarget.source,
            documentId: document.id,
            documentVersionId: resolvedVersion.id,
            sectionId: effectiveTarget.section.id,
            anchorId: effectiveTarget.section.anchorId,
            pageNumber: effectiveTarget.section.pageNumber,
            chunkId: effectiveTarget.chunkId ?? null
          }
        : null,
      highlight:
        highlight != null
          ? this.toHighlight(
              document.id,
              document.title,
              resolvedVersion.id,
              highlight.section,
              highlight.citationId,
              highlight.citationType,
              highlight.chunkId
            )
          : null,
      sections: sectionPayloads,
      meta: {
        page: selectedPage,
        pageSize,
        totalCount,
        totalPages,
        hasMore: skip + sections.length < totalCount
      }
    };

    await this.recordViewerAction(projectId, actorUserId, "open_document", {
      documentId: document.id,
      versionId: resolvedVersion.id,
      projectRole: member.projectRole,
      page: payload.meta.page,
      pageSize,
      targetSource: effectiveTarget?.source ?? null,
      selectedAnchorId: payload.selected?.anchorId ?? null,
      highlightedCitationId: payload.highlight?.citationId ?? null
    });
    this.observeViewerActionDuration(startedAt, "open_document", member.projectRole);

    return payload;
  }

  async getOriginalFile(projectId: string, documentId: string, actorUserId: string) {
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const document = await this.ensureAccessibleDocument(projectId, documentId, member.projectRole);
    // Native originals were validated and stored before parsing. A failed
    // optional model call must not make the user's source bytes inaccessible.
    const version = await this.resolveDocumentVersion(projectId, document, undefined, this.env?.RUNTIME_PROFILE !== 'desktop-local');
    const stored = await this.storage.getObjectStream(version.fileKey);
    return {
      stream: stored.stream,
      size: stored.size ?? Number(version.fileSize),
      contentType: version.mimeType,
      fileName: `${document.title}${extensionForMimeType(version.mimeType)}`
    };
  }

  async getAnchor(
    projectId: string,
    documentId: string,
    anchorId: string,
    actorUserId: string,
    opts: AnchorOptions = {}
  ) {
    const startedAt = process.hrtime.bigint();
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const document = await this.ensureAccessibleDocument(projectId, documentId, member.projectRole);
    const version = await this.resolveDocumentVersion(projectId, document, opts.versionId, true);
    const section = await this.loadSectionByAnchor(projectId, version.id, version.parseRevision, anchorId);
    const [sectionPayload] = await this.buildSectionPayloads(projectId, document, version, [section], member.projectRole);
    const highlight = await this.resolveHighlightForVersion(
      projectId,
      document.id,
      version.id,
      opts.highlightCitationId,
      member.projectRole
    );

    const payload = {
      document: this.toDocumentIdentity(document),
      version: this.toVersionSummary(version, version.id === document.currentVersionId),
      viewerState: {
        documentId: document.id,
        documentVersionId: version.id,
        pageNumber: section.pageNumber,
        anchorId: section.anchorId
      },
      selected: {
        source: "anchor" as const,
        documentId: document.id,
        documentVersionId: version.id,
        sectionId: section.id,
        anchorId: section.anchorId,
        pageNumber: section.pageNumber,
        chunkId: null
      },
      highlight:
        highlight != null
          ? this.toHighlight(
              document.id,
              document.title,
              version.id,
              highlight.section,
              highlight.citationId,
              highlight.citationType,
              highlight.chunkId
            )
          : null,
      section: sectionPayload
    };

    await this.recordViewerAction(projectId, actorUserId, "open_anchor", {
      documentId: document.id,
      versionId: version.id,
      projectRole: member.projectRole,
      anchorId: section.anchorId,
      highlightedCitationId: payload.highlight?.citationId ?? null
    });
    this.observeViewerActionDuration(startedAt, "open_anchor", member.projectRole);

    return payload;
  }

  async searchDocument(
    projectId: string,
    documentId: string,
    actorUserId: string,
    opts: DocumentSearchOptions
  ) {
    const startedAt = process.hrtime.bigint();
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const document = await this.ensureAccessibleDocument(projectId, documentId, member.projectRole);
    const version = await this.resolveDocumentVersion(projectId, document, opts.versionId, true);
    const limit = Math.min(opts.limit ?? 20, 50);

    const sections = await this.prisma.documentSection.findMany({
      where: {
        documentVersionId: version.id,
        parseRevision: version.parseRevision,
        normalizedText: {
          contains: opts.q,
          mode: "insensitive"
        }
      },
      orderBy: {
        orderIndex: "asc"
      },
      take: 250
    });

    const items = sections
      .map((section) => ({
        sectionId: section.id,
        anchorId: section.anchorId,
        citationLabel: this.buildCitationLabel(document.title, section.headingPath, section.pageNumber, section.anchorId),
        pageNumber: section.pageNumber,
        headingPath: section.headingPath,
        orderIndex: section.orderIndex,
        snippet: buildExcerpt(section.normalizedText, opts.q),
        score: computeSearchScore(section.normalizedText, opts.q, section.headingPath),
        openTarget: this.buildDocumentSectionOpenTarget(document.id, version.id, section.anchorId, section.pageNumber)
      }))
      .sort((left, right) => right.score - left.score || left.orderIndex - right.orderIndex)
      .slice(0, limit);

    const payload = {
      items,
      meta: {
        query: opts.q,
        count: items.length,
        versionId: version.id,
        limited: sections.length > limit
      }
    };

    await this.recordViewerAction(projectId, actorUserId, "search_document", {
      documentId: document.id,
      versionId: version.id,
      projectRole: member.projectRole,
      query: opts.q,
      limit,
      resultCount: items.length
    });
    this.observeViewerActionDuration(startedAt, "search_document", member.projectRole);

    return payload;
  }

  async getAnchorProvenance(
    projectId: string,
    documentId: string,
    anchorId: string,
    actorUserId: string,
    opts: AnchorOptions = {}
  ) {
    const startedAt = process.hrtime.bigint();
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    const document = await this.ensureAccessibleDocument(projectId, documentId, member.projectRole);
    const version = await this.resolveDocumentVersion(projectId, document, opts.versionId, true);
    const section = await this.loadSectionByAnchor(projectId, version.id, version.parseRevision, anchorId);
    const [selectedSection] = await this.buildSectionPayloads(projectId, document, version, [section], member.projectRole);
    const supportingSectionsRaw = await this.prisma.documentSection.findMany({
      where: {
        documentVersionId: version.id,
        parseRevision: version.parseRevision,
        orderIndex: {
          gte: Math.max(section.orderIndex - 1, 0),
          lte: section.orderIndex + 1
        },
        id: {
          not: section.id
        }
      },
      orderBy: {
        orderIndex: "asc"
      }
    });
    const supportingSections = await this.buildSectionPayloads(
      projectId,
      document,
      version,
      supportingSectionsRaw,
      member.projectRole
    );
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        documentVersionId: version.id,
        parseRevision: version.parseRevision,
        sectionId: section.id
      },
      orderBy: {
        chunkIndex: "asc"
      }
    });

    const currentGraph = await this.prisma.artifactVersion.findFirst({
        where: {
        projectId,
        artifactType: "brain_graph",
        status: "accepted"
      },
      orderBy: [{ acceptedAt: "desc" }, { createdAt: "desc" }]
    });

    const brainLinks = currentGraph
      ? await this.prisma.brainSectionLink.findMany({
          where: {
            projectId,
            artifactVersionId: currentGraph.id,
            documentSectionId: section.id
          },
          include: {
            brainNode: true
          }
        })
      : [];

    const visibleBrainLinks =
      member.projectRole === "client" ? await this.filterClientSafeBrainLinks(projectId, brainLinks) : brainLinks;
    const nodeIds = visibleBrainLinks.map((link) => link.brainNodeId);
    const edges =
      nodeIds.length > 0 && currentGraph
        ? await this.prisma.brainEdge.findMany({
            where: {
              projectId,
              artifactVersionId: currentGraph.id,
              OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }]
            }
          })
        : [];

    const acceptedLinks = await this.prisma.specChangeLink.findMany({
      where: {
        projectId,
        linkType: "document_section",
        linkRefId: section.id,
        proposal: {
          status: "accepted"
        }
      },
      include: {
        proposal: {
          include: {
            decisionRecord: true
          }
        }
      }
    });

    const proposalIds = acceptedLinks.map((link) => link.specChangeProposalId);
    const relatedLinks = proposalIds.length
      ? await this.prisma.specChangeLink.findMany({
          where: {
            projectId,
            specChangeProposalId: {
              in: proposalIds
            },
            linkType: {
              in: ["message", "thread", "brain_node"]
            }
          }
        })
      : [];
    const relatedMessageRefs = member.projectRole === "client" ? [] : await this.loadRelatedMessageRefs(projectId, relatedLinks);

    const linkedDecisions =
      member.projectRole === "client"
        ? []
        : uniqueStrings(acceptedLinks.map((link) => link.proposal.decisionRecordId))
            .map((decisionId) => {
              const proposal = acceptedLinks.find((item) => item.proposal.decisionRecordId === decisionId)?.proposal;
              return proposal?.decisionRecord
                ? {
                    id: proposal.decisionRecord.id,
                    title: proposal.decisionRecord.title,
                    statement: proposal.decisionRecord.statement,
                    status: proposal.decisionRecord.status,
                    openTarget: this.buildDecisionOpenTarget(proposal.decisionRecord.id)
                  }
                : null;
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

    const linkedChanges = acceptedLinks.map((link) => {
      const proposalLinks = relatedLinks.filter((candidate) => candidate.specChangeProposalId === link.specChangeProposalId);
      const linkedBrainNodeIds = proposalLinks
        .filter((candidate) => candidate.linkType === "brain_node")
        .map((candidate) => candidate.linkRefId);
      const linkedThreadIds = proposalLinks
        .filter((candidate) => candidate.linkType === "thread")
        .map((candidate) => candidate.linkRefId);
      const linkedMessageRefs = relatedMessageRefs.filter((candidate) =>
        candidate.type === "thread"
          ? linkedThreadIds.includes(candidate.id)
          : proposalLinks.some((proposalLink) => proposalLink.linkType === "message" && proposalLink.linkRefId === candidate.id)
      );

      return {
        proposalId: member.projectRole === "client" ? null : link.proposal.id,
        proposalType: link.proposal.proposalType,
        status: link.proposal.status,
        title: link.proposal.title,
        summary: link.proposal.summary,
        acceptedAt: link.proposal.acceptedAt?.toISOString() ?? null,
        acceptedBy: member.projectRole === "client" ? null : link.proposal.acceptedBy,
        linkedBrainNodeIds: member.projectRole === "client" ? [] : linkedBrainNodeIds,
        linkedThreadIds: member.projectRole === "client" ? [] : linkedThreadIds,
        linkedMessageRefs: member.projectRole === "client" ? [] : linkedMessageRefs,
        openTarget: member.projectRole === "client" ? null : this.buildChangeProposalOpenTarget(link.proposal.id)
      };
    });

    const linkedBrainNodes = visibleBrainLinks.map((link) => ({
      nodeId: link.brainNode.id,
      title: link.brainNode.title,
      nodeType: link.brainNode.nodeType,
      status: link.brainNode.status,
      relationship: link.relationship,
      openTarget: this.buildBrainNodeOpenTarget(link.brainNode.id, currentGraph?.id),
      graphRelationships: edges
        .filter((edge) => edge.fromNodeId === link.brainNodeId || edge.toNodeId === link.brainNodeId)
        .map((edge) => ({
          edgeType: edge.edgeType,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId
        }))
    }));

    const payload = {
      document: this.toDocumentIdentity(document),
      version: this.toVersionSummary(version, version.id === document.currentVersionId),
      selectedSection,
      supportingSections,
      supportingEvidence: chunks.map((chunk) => ({
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber,
        tokenCount: chunk.tokenCount,
        excerpt: chunk.content.slice(0, 220)
      })),
      linkedBrainNodes,
      linkedChanges,
      linkedDecisions,
      linkedMessageRefs: member.projectRole === "client" ? [] : relatedMessageRefs,
      currentTruth: {
        differsFromSource: selectedSection.hasCurrentTruthOverlay,
        summaries: selectedSection.currentTruthSummary ?? []
      },
      openTargets: {
        selectedSection: this.buildDocumentSectionOpenTarget(document.id, version.id, section.anchorId, section.pageNumber),
        supportingSections: supportingSections.map((candidate) =>
          this.buildDocumentSectionOpenTarget(document.id, version.id, candidate.anchorId, candidate.pageNumber)
        )
      }
    };

    await this.recordViewerAction(projectId, actorUserId, "open_provenance", {
      documentId: document.id,
      versionId: version.id,
      projectRole: member.projectRole,
      anchorId: section.anchorId,
      supportingSectionCount: supportingSections.length,
      linkedChangeCount: linkedChanges.length,
      linkedMessageCount: payload.linkedMessageRefs.length
    });
    this.observeViewerActionDuration(startedAt, "open_provenance", member.projectRole);

    return payload;
  }

  async getMessageEvidence(projectId: string, messageId: string, actorUserId: string) {
    const startedAt = process.hrtime.bigint();
    const member = await this.projectService.ensureProjectAccess(projectId, actorUserId);
    if (member.projectRole === "client") {
      throw new AppError(403, "Client access is not allowed for message evidence", "client_message_access_forbidden");
    }

    const message = await this.prisma.communicationMessage.findFirstOrThrow({
      where: {
        id: messageId,
        projectId
      },
      include: {
        thread: true
      }
    });

    const proposalLinks = await this.prisma.specChangeLink.findMany({
      where: {
        projectId,
        OR: [
          { linkType: "message", linkRefId: message.id },
          ...(message.threadId ? [{ linkType: "thread" as const, linkRefId: message.threadId }] : [])
        ]
      },
      include: {
        proposal: {
          include: {
            decisionRecord: true
          }
        }
      }
    });

    const proposalIds = uniqueStrings(proposalLinks.map((link) => link.specChangeProposalId));
    const sectionLinks = proposalIds.length
      ? await this.prisma.specChangeLink.findMany({
          where: {
            projectId,
            specChangeProposalId: {
              in: proposalIds
            },
            linkType: "document_section"
          }
        })
      : [];
    const sections = sectionLinks.length
      ? await this.prisma.documentSection.findMany({
          where: {
            projectId,
            id: {
              in: sectionLinks.map((link) => link.linkRefId)
            }
          },
          include: {
            documentVersion: {
              include: {
                document: true
              }
            }
          },
          orderBy: {
            orderIndex: "asc"
          }
        })
      : [];
    const sectionsById = new Map(sections.map((section) => [section.id, section]));

    const linkedDocuments = sectionLinks
      .map((link) => {
        const section = sectionsById.get(link.linkRefId);
        if (!section) {
          return null;
        }

        return {
          sectionId: section.id,
          anchorId: section.anchorId,
          pageNumber: section.pageNumber,
          headingPath: section.headingPath,
          documentId: section.documentVersion.documentId,
          documentTitle: section.documentVersion.document.title,
          openTarget: this.buildDocumentSectionOpenTarget(
            section.documentVersion.documentId,
            section.documentVersionId,
            section.anchorId,
            section.pageNumber
          )
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .filter(
        (item, index, collection) =>
          collection.findIndex((candidate) => candidate.sectionId === item.sectionId) === index
      );

    const uniqueProposalLinks = proposalLinks.filter(
      (link, index, collection) =>
        collection.findIndex((candidate) => candidate.specChangeProposalId === link.specChangeProposalId) === index
    );

    const linkedDecisions = uniqueStrings(uniqueProposalLinks.map((link) => link.proposal.decisionRecordId))
      .map((decisionId) => {
        const proposal = uniqueProposalLinks.find((link) => link.proposal.decisionRecordId === decisionId)?.proposal;
        return proposal?.decisionRecord
          ? {
              id: proposal.decisionRecord.id,
              title: proposal.decisionRecord.title,
              statement: proposal.decisionRecord.statement,
              status: proposal.decisionRecord.status,
              openTarget: this.buildDecisionOpenTarget(proposal.decisionRecord.id)
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const payload = {
      message: {
        id: message.id,
        threadId: message.threadId,
        senderLabel: message.senderLabel,
        sentAt: message.sentAt.toISOString(),
        bodyText: message.bodyText,
        messageType: message.messageType,
        replyToMessageId: message.replyToMessageId
      },
      thread: {
        id: message.thread.id,
        subject: message.thread.subject,
        participants: message.thread.participantsJson,
        startedAt: message.thread.startedAt?.toISOString() ?? null,
        lastMessageAt: message.thread.lastMessageAt?.toISOString() ?? null
      },
      linkedDocuments,
      linkedChanges: uniqueProposalLinks.map((link) => ({
        proposalId: link.proposal.id,
        title: link.proposal.title,
        summary: link.proposal.summary,
        proposalType: link.proposal.proposalType,
        status: link.proposal.status,
        openTarget: this.buildChangeProposalOpenTarget(link.proposal.id)
      })),
      linkedDecisions,
      openTargets: {
        thread: this.buildThreadOpenTarget(message.threadId),
        documents: linkedDocuments.map((documentLink) => documentLink.openTarget)
      }
    };

    await this.recordViewerAction(projectId, actorUserId, "open_message_evidence", {
      messageId: message.id,
      threadId: message.threadId,
      projectRole: member.projectRole,
      linkedDocumentCount: linkedDocuments.length,
      linkedChangeCount: uniqueProposalLinks.length
    });
    this.observeViewerActionDuration(startedAt, "open_message_evidence", member.projectRole);

    return payload;
  }

  async reprocess(projectId: string, documentId: string, actorUserId: string) {
    await this.projectService.ensureProjectMemberCanUploadContext(projectId, actorUserId);
    const document = await this.prisma.document.findFirstOrThrow({
      where: {
        id: documentId,
        projectId
      },
      include: {
        project: true
      }
    });

    if (!document.currentVersionId) {
      throw new AppError(400, "Document has no current version", "missing_current_version");
    }

    const version = await this.prisma.documentVersion.findUniqueOrThrow({
      where: {
        id: document.currentVersionId
      }
    });

    const nextParseRevision = version.parseRevision + 1;
    await this.prisma.documentVersion.update({
      where: { id: version.id },
      data: {
        status: "pending",
        parseRevision: nextParseRevision,
        parseConfidence: null,
        parseWarningJson: Prisma.DbNull,
        processedAt: null
      }
    });

    const payload = {
      documentVersionId: version.id,
      parseRevision: nextParseRevision
    };
    const parseKey = jobKeys.parseDocument(version.id, nextParseRevision);

    await this.recordQueuedJob(JobNames.parseDocument, parseKey, payload);
    await this.jobs.enqueue(JobNames.parseDocument, payload, parseKey);

    await this.auditService.record({
      orgId: document.project.orgId,
      projectId,
      actorUserId,
      eventType: "document_reprocessed",
      entityType: "document_version",
      entityId: version.id,
      payload: {
        parseRevision: nextParseRevision
      }
    });

    await this.enqueueDashboardRefresh(projectId, "document_reprocessed");

    return {
      ok: true,
      documentVersionId: version.id,
      parseRevision: nextParseRevision
    };
  }

  async processDocumentVersion(documentVersionId: string, parseRevision?: number) {
    const version = await this.prisma.documentVersion.findUniqueOrThrow({
      where: { id: documentVersionId },
      include: {
        document: true
      }
    });

    const targetParseRevision = parseRevision ?? version.parseRevision;
    const parseKey = jobKeys.parseDocument(documentVersionId, targetParseRevision);

    if (version.parseRevision !== targetParseRevision) {
      await this.finishJob(JobNames.parseDocument, parseKey);
      return { skipped: true, reason: "stale_parse_revision" as const };
    }

    await this.startJob(JobNames.parseDocument, parseKey, {
      documentVersionId,
      parseRevision: targetParseRevision
    });
    await this.prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: { status: "processing" }
    });

    try {
      const buffer = await this.storage.getObject(version.fileKey);
      const parsed = await this.parseVersionContent(version.mimeType, buffer, version.document.title);
      const sections = ensureNonEmptySections(parsed.sections);

      if (sections.length === 0) {
        throw new AppError(422, "Parser returned no usable sections", "empty_parse_result");
      }

      await this.prisma.documentChunk.deleteMany({
        where: {
          documentVersionId,
          parseRevision: targetParseRevision
        }
      });
      await this.prisma.documentSection.deleteMany({
        where: {
          documentVersionId,
          parseRevision: targetParseRevision
        }
      });

      for (const [index, section] of sections.entries()) {
        await this.prisma.documentSection.create({
          data: {
            documentVersionId,
            projectId: version.projectId,
            parseRevision: targetParseRevision,
            sectionKey: `${targetParseRevision}-${index + 1}`,
            headingPath: section.headingPath,
            pageNumber: section.pageNumber,
            pageStart: section.pageNumber,
            pageEnd: section.pageNumber,
            anchorId: toAnchorId(section.title, index),
            anchorText: section.title,
            normalizedText: section.text,
            orderIndex: index,
            metadataJson: { title: section.title, ...(section.metadataJson ?? {}) }
          }
        });
      }

      await this.prisma.documentVersion.updateMany({
        where: {
          id: documentVersionId,
          parseRevision: targetParseRevision
        },
        data: {
          status: "processing",
          parseConfidence: "0.900",
          parseWarningJson: Prisma.DbNull,
          processedAt: new Date()
        }
      });

      await this.finishJob(JobNames.parseDocument, parseKey);
      const payload = {
        documentVersionId,
        parseRevision: targetParseRevision
      };
      const chunkKey = jobKeys.chunkDocument(documentVersionId, targetParseRevision);
      await this.recordQueuedJob(JobNames.chunkDocument, chunkKey, payload);
      await this.jobs.enqueue(JobNames.chunkDocument, payload, chunkKey);
      await this.enqueueDashboardRefresh(version.projectId, "document_parsed");
      return { skipped: false };
    } catch (error) {
      await this.prisma.documentVersion.updateMany({
        where: {
          id: documentVersionId,
          parseRevision: targetParseRevision
        },
        data: {
          status: "failed",
          parseWarningJson: {
            error: error instanceof Error ? error.message : "Unknown parse error"
          }
        }
      });
      await this.failJob(JobNames.parseDocument, parseKey, error);
      await this.enqueueDashboardRefresh(version.projectId, "document_parse_failed");
      throw error;
    }
  }

  async chunkDocumentVersion(documentVersionId: string, parseRevision?: number) {
    const version = await this.prisma.documentVersion.findUniqueOrThrow({
      where: { id: documentVersionId },
      include: {
        document: true
      }
    });

    const targetParseRevision = parseRevision ?? version.parseRevision;
    const chunkKey = jobKeys.chunkDocument(documentVersionId, targetParseRevision);

    if (version.parseRevision !== targetParseRevision) {
      await this.finishJob(JobNames.chunkDocument, chunkKey);
      return { skipped: true, reason: "stale_parse_revision" as const };
    }

    await this.startJob(JobNames.chunkDocument, chunkKey, {
      documentVersionId,
      parseRevision: targetParseRevision
    });

    try {
      const sections = await this.prisma.documentSection.findMany({
        where: {
          documentVersionId,
          parseRevision: targetParseRevision
        },
        orderBy: {
          orderIndex: "asc"
        }
      });

      if (sections.length === 0) {
        throw new AppError(422, "No parsed sections available to chunk", "missing_sections_for_chunking");
      }

      await this.prisma.documentChunk.deleteMany({
        where: {
          documentVersionId,
          parseRevision: targetParseRevision
        }
      });

      let globalChunkIndex = 0;
      for (const section of sections) {
        const chunks = chunkText({
          content: section.normalizedText,
          documentTitle: version.document.title,
          kind: version.document.kind,
          headingPath: section.headingPath,
          pageNumber: section.pageNumber
        });

        for (const chunk of chunks) {
          await this.prisma.documentChunk.create({
            data: {
              documentVersionId,
              sectionId: section.id,
              projectId: version.projectId,
              parseRevision: targetParseRevision,
              chunkIndex: globalChunkIndex,
              content: chunk.content,
              contextualContent: chunk.contextualContent,
              lexicalContent: chunk.contextualContent,
              tokenCount: chunk.tokenCount,
              pageNumber: section.pageNumber,
              metadataJson: {
                headingPath: section.headingPath,
                anchorId: section.anchorId,
                sectionChunkIndex: chunk.chunkIndex
              }
            }
          });
          globalChunkIndex += 1;
        }
      }

      await this.finishJob(JobNames.chunkDocument, chunkKey);
      const payload = {
        documentVersionId,
        parseRevision: targetParseRevision
      };
      const embedKey = jobKeys.embedDocumentChunks(documentVersionId, targetParseRevision);
      await this.recordQueuedJob(JobNames.embedDocumentChunks, embedKey, payload);
      await this.jobs.enqueue(JobNames.embedDocumentChunks, payload, embedKey);
      return { skipped: false };
    } catch (error) {
      await this.failJob(JobNames.chunkDocument, chunkKey, error);
      throw error;
    }
  }

  async embedDocumentChunks(documentVersionId: string, parseRevision?: number) {
    const version = await this.prisma.documentVersion.findUniqueOrThrow({
      where: { id: documentVersionId }
    });

    const targetParseRevision = parseRevision ?? version.parseRevision;
    const embedKey = jobKeys.embedDocumentChunks(documentVersionId, targetParseRevision);

    if (version.parseRevision !== targetParseRevision) {
      await this.finishJob(JobNames.embedDocumentChunks, embedKey);
      return { skipped: true, reason: "stale_parse_revision" as const };
    }

    await this.startJob(JobNames.embedDocumentChunks, embedKey, {
      documentVersionId,
      parseRevision: targetParseRevision
    });
    try {
      const chunks = await this.prisma.documentChunk.findMany({
        where: {
          documentVersionId,
          parseRevision: targetParseRevision
        },
        orderBy: {
          chunkIndex: "asc"
        }
      });

      if (chunks.length === 0) {
        throw new AppError(422, "No chunks available to embed", "missing_chunks_for_embedding");
      }

      let lexicalOnly = Boolean(this.embeddings.unavailable);
      for (const chunk of chunks) {
        if (lexicalOnly) break;
        let embedding: number[];
        try {
          embedding = await this.embeddings.embedText(chunk.contextualContent ?? chunk.content);
        } catch (error) {
          // Commit already parsed lexical evidence rather than rolling it back
          // with the desktop worker's effect transaction. Never invent vectors.
          if (this.env?.RUNTIME_PROFILE !== 'desktop-local' || !(error instanceof AppError) ||
              !['ai_request_budget_exceeded','embedding_not_configured','ai_provider_failed','ai_revoked','ai_busy'].includes(error.code)) throw error;
          lexicalOnly = true;
          break;
        }
        const vectorLiteral = `[${embedding.join(",")}]`;
        await this.prisma.$executeRawUnsafe(
          "UPDATE document_chunks SET embedding = CAST($1 AS extensions.vector) WHERE id = CAST($2 AS uuid)",
          vectorLiteral,
          chunk.id
        );
      }

      await this.prisma.documentVersion.updateMany({
        where: {
          id: documentVersionId,
          parseRevision: targetParseRevision
        },
        data: { status: lexicalOnly ? "partial" : "ready" }
      });

      // Invalidate stale Socrates suggestions immediately. The brain pipeline
      // that follows may fail partway through; waiting until it completes
      // (createAcceptedArtifact) would leave clients on stale answers.
      await this.prisma.socratesSuggestion.deleteMany({
        where: { session: { projectId: version.projectId } }
      });
      if (this.env?.RUNTIME_PROFILE === 'desktop-local' && this.prisma.projectDriveFile) {
        await this.prisma.projectDriveFile.updateMany({
          where: { documentVersionId, metadataJson: { path: ['desktop'], equals: true }, documentVersion: { parseRevision: targetParseRevision } },
          data: lexicalOnly
            ? { indexStatus: 'failed', lastIndexedAt: null, lastError: 'Semantic indexing is unavailable; parsed text remains readable.' }
            : { indexStatus: 'indexed', lastIndexedAt: new Date(), lastError: null }
        });
      }

      await this.finishJob(JobNames.embedDocumentChunks, embedKey);
      // Desktop owns a durable offline projection worker. The hosted beta
      // shortcut must not leave newly uploaded local sources out of its Brain.
      if (this.isMvpBetaMode() && this.env?.RUNTIME_PROFILE !== "desktop-local") {
        await this.enqueueDashboardRefresh(version.projectId, "document_ready");
        return { skipped: false };
      }

      const sourceKey = jobKeys.generateSourcePackage(
        version.projectId,
        await this.buildSourcePackageSignature(version.projectId)
      );
      await this.recordQueuedJob(JobNames.generateSourcePackage, sourceKey, { projectId: version.projectId });
      await this.jobs.enqueue(JobNames.generateSourcePackage, { projectId: version.projectId }, sourceKey);
      await this.enqueueDashboardRefresh(version.projectId, "document_ready");
      return { skipped: false };
    } catch (error) {
      await this.prisma.documentVersion.updateMany({
        where: {
          id: documentVersionId,
          parseRevision: targetParseRevision
        },
        data: { status: "partial" }
      });
      await this.failJob(JobNames.embedDocumentChunks, embedKey, error);
      await this.enqueueDashboardRefresh(version.projectId, "document_partial");
      throw error;
    }
  }

  private async enqueueDashboardRefresh(projectId: string, reason: string) {
    await enqueueProjectDashboardRefreshByProjectId(this.prisma, this.jobs, projectId, reason, {
      skip: this.isMvpBetaMode()
    });
  }

  private isMvpBetaMode() {
    return this.env ? isMvpBetaMode(this.env) : false;
  }

  private async buildSourcePackageSignature(projectId: string) {
    const documents = await this.prisma.document.findMany({
      where: {
        projectId,
        currentVersionId: { not: null }
      },
      select: {
        id: true,
        currentVersionId: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });
    const currentVersionIds = uniqueStrings(documents.map((document) => document.currentVersionId));
    if (currentVersionIds.length === 0) {
      return createHash("sha256").update(JSON.stringify([])).digest("hex").slice(0, 16);
    }

    const currentVersions = await this.prisma.documentVersion.findMany({
      where: {
        projectId,
        id: { in: currentVersionIds },
        status: { in: ["ready", "partial"] }
      },
      select: {
        id: true,
        checksumSha256: true,
        parseRevision: true,
        processedAt: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });
    const versionById = new Map(currentVersions.map((version) => [version.id, version]));
    const signatureInput = documents.flatMap((document) => {
      const version = document.currentVersionId ? versionById.get(document.currentVersionId) : null;
      if (!version) {
        return [];
      }

      return [
        {
          id: version.id,
          checksumSha256: version.checksumSha256,
          parseRevision: version.parseRevision,
          processedAt: version.processedAt?.toISOString() ?? null
        }
      ];
    });

    return createHash("sha256").update(JSON.stringify(signatureInput)).digest("hex").slice(0, 16);
  }

  private async recordQueuedJob(jobType: string, idempotencyKey: string, payload: unknown) {
    await this.prisma.jobRun.upsert({
      where: { idempotencyKey },
      update: {
        status: "pending",
        payloadJson: payload as object,
        lastError: null,
        finishedAt: null
      },
      create: {
        jobType,
        status: "pending",
        idempotencyKey,
        payloadJson: payload as object
      }
    });
  }

  private async startJob(jobType: string, idempotencyKey: string, payload?: unknown) {
    await this.prisma.jobRun.upsert({
      where: { idempotencyKey },
      update: {
        jobType,
        status: "running",
        payloadJson: payload as object | undefined,
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
        attemptCount: {
          increment: 1
        }
      },
      create: {
        jobType,
        status: "running",
        idempotencyKey,
        payloadJson: payload as object | undefined,
        startedAt: new Date(),
        attemptCount: 1
      }
    });
  }

  private async finishJob(jobType: string, idempotencyKey: string) {
    await this.prisma.jobRun.upsert({
      where: { idempotencyKey },
      update: {
        jobType,
        status: "completed",
        finishedAt: new Date(),
        lastError: null
      },
      create: {
        jobType,
        status: "completed",
        idempotencyKey,
        finishedAt: new Date()
      }
    });
  }

  private async failJob(jobType: string, idempotencyKey: string, error: unknown) {
    await this.prisma.jobRun.upsert({
      where: { idempotencyKey },
      update: {
        jobType,
        status: "failed",
        finishedAt: new Date(),
        lastError: error instanceof Error ? error.message : "Unknown error"
      },
      create: {
        jobType,
        status: "failed",
        idempotencyKey,
        finishedAt: new Date(),
        lastError: error instanceof Error ? error.message : "Unknown error"
      }
    });
  }

  private async ensureAccessibleDocument(projectId: string, documentId: string, projectRole: string) {
    return this.prisma.document.findFirstOrThrow({
      where: {
        id: documentId,
        projectId,
        archivedAt: null,
        ...(this.clientDocumentFilter(projectRole) ?? {})
      }
    });
  }

  private async loadCurrentVersions(documents: Array<{ currentVersionId: string | null }>) {
    const versionIds = uniqueStrings(documents.map((document) => document.currentVersionId));
    if (versionIds.length === 0) {
      return new Map<string, Awaited<ReturnType<typeof this.prisma.documentVersion.findMany>>[number]>();
    }

    const versions = await this.prisma.documentVersion.findMany({
      where: {
        id: {
          in: versionIds
        }
      },
      select: {
        id: true,
        status: true,
        mimeType: true,
        parseRevision: true,
        parseConfidence: true,
        sourceLabel: true,
        createdAt: true,
        processedAt: true
      }
    });

    return new Map(versions.map((version) => [version.id, version]));
  }

  private async loadDriveSourcesForDocuments(
    projectId: string,
    documents: Array<{ id: string; currentVersionId: string | null }>,
    currentVersions: Map<string, { id: string }>
  ) {
    const documentIds = uniqueStrings(documents.map((document) => document.id));
    const versionIds = uniqueStrings(
      documents.map((document) => currentVersions.get(document.currentVersionId ?? "")?.id ?? document.currentVersionId)
    );
    if ((documentIds.length === 0 && versionIds.length === 0) || !this.prisma.projectDriveFile) {
      return new Map<string, DriveSourceReadModel>();
    }

    const files = await this.prisma.projectDriveFile.findMany({
      where: {
        projectId,
        OR: [
          ...(documentIds.length > 0 ? [{ documentId: { in: documentIds } }] : []),
          ...(versionIds.length > 0 ? [{ documentVersionId: { in: versionIds } }] : [])
        ]
      },
      select: {
        id: true,
        projectId: true,
        documentId: true,
        documentVersionId: true,
        driveFileId: true,
        name: true,
        mimeType: true,
        webViewLink: true,
        iconLink: true,
        ownersSummary: true,
        lastModifyingUserSummary: true,
        createdTime: true,
        modifiedTime: true,
        sharedDrive: true,
        indexStatus: true
      },
      orderBy: [{ lastIndexedAt: "desc" }, { modifiedTime: "desc" }, { updatedAt: "desc" }]
    });
    const byDocumentId = new Map<string, DriveSourceReadModel>();
    for (const file of files) {
      const documentId = file.documentId;
      if (!documentId || byDocumentId.has(documentId)) continue;
      byDocumentId.set(documentId, this.toDriveSourceReadModel(file));
    }
    return byDocumentId;
  }

  private async loadDriveSourceForDocument(projectId: string, documentId: string, documentVersionId: string | null) {
    if (!this.prisma.projectDriveFile) {
      return null;
    }
    const file = await this.prisma.projectDriveFile.findFirst({
      where: {
        projectId,
        OR: [
          { documentId },
          ...(documentVersionId ? [{ documentVersionId }] : [])
        ]
      },
      orderBy: [{ lastIndexedAt: "desc" }, { modifiedTime: "desc" }, { updatedAt: "desc" }]
    });
    return file ? this.toDriveSourceReadModel(file) : null;
  }

  private async loadNotionSourcesForDocuments(
    projectId: string,
    documents: Array<{ id: string; currentVersionId: string | null }>,
    currentVersions: Map<string, { id: string }>
  ) {
    const documentIds = uniqueStrings(documents.map((document) => document.id));
    const versionIds = uniqueStrings(
      documents.map((document) => currentVersions.get(document.currentVersionId ?? "")?.id ?? document.currentVersionId)
    );
    if (documentIds.length === 0 && versionIds.length === 0) {
      return new Map<string, NotionSourceReadModel>();
    }

    const resources = await this.prisma.projectNotionResource.findMany({
      where: {
        projectId,
        OR: [
          ...(documentIds.length > 0 ? [{ documentId: { in: documentIds } }] : []),
          ...(versionIds.length > 0 ? [{ documentVersionId: { in: versionIds } }] : [])
        ]
      },
      select: {
        id: true,
        projectId: true,
        documentId: true,
        documentVersionId: true,
        notionResourceId: true,
        resourceType: true,
        title: true,
        url: true,
        selectedResourceId: true,
        selectedResourceLabel: true,
        lastEditedAt: true,
        indexStatus: true
      },
      orderBy: [{ lastIndexedAt: "desc" }, { lastEditedAt: "desc" }, { updatedAt: "desc" }]
    });
    const byDocumentId = new Map<string, NotionSourceReadModel>();
    for (const resource of resources) {
      const documentId = resource.documentId;
      if (!documentId || byDocumentId.has(documentId)) continue;
      byDocumentId.set(documentId, this.toNotionSourceReadModel(resource));
    }
    return byDocumentId;
  }

  private async loadNotionSourceForDocument(projectId: string, documentId: string, documentVersionId: string | null) {
    const resource = await this.prisma.projectNotionResource.findFirst({
      where: {
        projectId,
        OR: [
          { documentId },
          ...(documentVersionId ? [{ documentVersionId }] : [])
        ]
      },
      orderBy: [{ lastIndexedAt: "desc" }, { lastEditedAt: "desc" }, { updatedAt: "desc" }]
    });
    return resource ? this.toNotionSourceReadModel(resource) : null;
  }

  private toDriveSourceReadModel(file: {
    id: string;
    projectId: string;
    documentId: string | null;
    documentVersionId: string | null;
    driveFileId: string;
    name: string;
    mimeType: string;
    webViewLink: string | null;
    iconLink: string | null;
    ownersSummary: string | null;
    lastModifyingUserSummary: string | null;
    createdTime: Date | null;
    modifiedTime: Date | null;
    sharedDrive: boolean;
    indexStatus: string;
  }): DriveSourceReadModel {
    return {
      provider: "google_drive",
      label: "Google Drive",
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink,
      iconLink: file.iconLink,
      ownersSummary: file.ownersSummary,
      lastModifyingUserSummary: file.lastModifyingUserSummary,
      createdTime: file.createdTime?.toISOString() ?? null,
      modifiedTime: file.modifiedTime?.toISOString() ?? null,
      sharedDrive: file.sharedDrive,
      indexStatus: file.indexStatus,
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
          }
    };
  }

  private toNotionSourceReadModel(resource: {
    id: string;
    projectId: string;
    documentId: string | null;
    documentVersionId: string | null;
    notionResourceId: string;
    resourceType: string;
    title: string;
    url: string | null;
    selectedResourceId: string | null;
    selectedResourceLabel: string | null;
    lastEditedAt: Date | null;
    indexStatus: string;
  }): NotionSourceReadModel {
    return {
      provider: "notion",
      label: "Notion",
      resourceId: resource.id,
      notionResourceId: resource.notionResourceId,
      resourceType: resource.resourceType,
      title: resource.title,
      url: resource.url,
      selectedResourceId: resource.selectedResourceId,
      selectedResourceLabel: resource.selectedResourceLabel,
      lastEditedAt: resource.lastEditedAt?.toISOString() ?? null,
      indexStatus: resource.indexStatus,
      openTarget: resource.documentId
        ? {
            targetType: "document",
            targetRef: {
              projectId: resource.projectId,
              documentId: resource.documentId,
              documentVersionId: resource.documentVersionId,
              notionResourceId: resource.id
            }
          }
        : {
            targetType: "notion_resource",
            targetRef: {
              projectId: resource.projectId,
              notionResourceId: resource.id
            }
          }
    };
  }

  private async resolveDocumentVersion(
    projectId: string,
    document: { id: string; currentVersionId: string | null },
    versionId?: string,
    requireParsed = false
  ) {
    const resolvedVersionId = versionId ?? document.currentVersionId;
    if (!resolvedVersionId) {
      throw new AppError(400, "Document has no current version", "missing_current_version");
    }

    const version = await this.prisma.documentVersion.findFirstOrThrow({
      where: {
        id: resolvedVersionId,
        documentId: document.id,
        projectId
      }
    });

    if (!requireParsed) {
      return version;
    }

    if (version.status === "ready" || version.status === "partial") {
      return version;
    }

    throw new AppError(
      409,
      versionId
        ? "Requested document version is not ready for parsed viewing yet"
        : "Current document version is not ready for parsed viewing yet",
      "document_version_not_viewable"
    );
  }

  private async lookupProjectOrgId(projectId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { orgId: true }
    });

    return project.orgId;
  }

  private async recordViewerAction(
    projectId: string,
    actorUserId: string,
    action: ViewerAction,
    payload: Record<string, unknown>
  ) {
    try {
      const orgId = await this.lookupProjectOrgId(projectId);
      await this.auditService.record({
        orgId,
        projectId,
        actorUserId,
        eventType: action,
        entityType: "viewer",
        entityId: null,
        payload
      });
    } catch {
      this.telemetry.increment("orchestra_viewer_audit_failures_total", {
        action
      });
    }
  }

  private observeViewerActionDuration(startedAt: bigint, action: ViewerAction, projectRole: string) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.telemetry.increment("orchestra_viewer_requests_total", {
      action,
      project_role: projectRole
    });
    this.telemetry.observeDuration("orchestra_viewer_request_duration_ms", durationMs, {
      action,
      project_role: projectRole
    });
  }

  private async loadSectionById(projectId: string, versionId: string, parseRevision: number, sectionId: string) {
    return this.prisma.documentSection.findFirstOrThrow({
      where: {
        id: sectionId,
        projectId,
        documentVersionId: versionId,
        parseRevision
      }
    });
  }

  private async loadSectionByAnchor(projectId: string, versionId: string, parseRevision: number, anchorId: string) {
    return this.prisma.documentSection.findFirstOrThrow({
      where: {
        projectId,
        documentVersionId: versionId,
        parseRevision,
        anchorId
      }
    });
  }

  private async resolveExplicitTarget(
    projectId: string,
    _documentId: string,
    versionId: string,
    opts: ViewerPayloadOptions
  ): Promise<TargetSection | null> {
    const version = await this.prisma.documentVersion.findFirstOrThrow({
      where: {
        id: versionId,
        projectId
      }
    });

    if (opts.chunkId) {
      const chunk = await this.prisma.documentChunk.findFirstOrThrow({
        where: {
          id: opts.chunkId,
          projectId,
          documentVersionId: versionId,
          parseRevision: version.parseRevision
        }
      });
      if (!chunk.sectionId) {
        throw new AppError(409, "Chunk is not attached to a parsed section", "chunk_missing_section");
      }
      const section = await this.loadSectionById(projectId, versionId, version.parseRevision, chunk.sectionId);
      return { source: "chunk", section, chunkId: chunk.id };
    }

    if (opts.sectionId) {
      const section = await this.loadSectionById(projectId, versionId, version.parseRevision, opts.sectionId);
      return { source: "section", section };
    }

    if (opts.anchorId) {
      const section = await this.loadSectionByAnchor(projectId, versionId, version.parseRevision, opts.anchorId);
      return { source: "anchor", section };
    }

    return null;
  }

  private async resolveHighlightCandidate(
    projectId: string,
    documentId: string,
    citationId: string,
    projectRole: string
  ) {
    const ensureCurrentViewableCitationVersion = (input: {
      version: { id: string; status: string; parseRevision: number; document: { currentVersionId: string | null } };
      parseRevision: number;
    }) => {
      const isParsed = input.version.status === "ready" || input.version.status === "partial";
      const isCurrent = input.version.document.currentVersionId === input.version.id;
      const parseRevisionMatches = input.parseRevision === input.version.parseRevision;
      if (!isParsed || !isCurrent || !parseRevisionMatches) {
        throw new AppError(
          409,
          "Highlighted citation is not on the current parsed document version",
          "stale_viewer_highlight"
        );
      }
    };

    const citation = await this.prisma.socratesCitation.findFirstOrThrow({
      where: {
        id: citationId,
        projectId
      }
    });

    if (citation.citationType !== "document_section" && citation.citationType !== "document_chunk") {
      throw new AppError(422, "Citation cannot be highlighted inside the document viewer", "invalid_viewer_highlight");
    }

    if (citation.citationType === "document_section") {
      const section = await this.prisma.documentSection.findFirstOrThrow({
        where: {
          id: citation.refId,
          projectId
        },
        include: {
          documentVersion: {
            include: {
              document: true
            }
          }
        }
      });

      if (section.documentVersion.documentId !== documentId) {
        throw new AppError(409, "Citation does not belong to the requested document", "citation_document_mismatch");
      }

      if (projectRole === "client" && section.documentVersion.document.visibility === "internal") {
        throw new AppError(403, "Client access is not allowed for internal citations", "client_highlight_forbidden");
      }

      ensureCurrentViewableCitationVersion({
        version: section.documentVersion,
        parseRevision: section.parseRevision
      });

      return {
        citationId: citation.id,
        citationType: citation.citationType,
        versionId: section.documentVersionId,
        section,
        chunkId: null
      };
    }

    const chunk = await this.prisma.documentChunk.findFirstOrThrow({
      where: {
        id: citation.refId,
        projectId
      },
      include: {
        documentVersion: {
          include: {
            document: true
          }
        }
      }
    });

    if (chunk.documentVersion.documentId !== documentId) {
      throw new AppError(409, "Citation does not belong to the requested document", "citation_document_mismatch");
    }

    if (projectRole === "client" && chunk.documentVersion.document.visibility === "internal") {
      throw new AppError(403, "Client access is not allowed for internal citations", "client_highlight_forbidden");
    }

    ensureCurrentViewableCitationVersion({
      version: chunk.documentVersion,
      parseRevision: chunk.parseRevision
    });

    if (!chunk.sectionId) {
      throw new AppError(409, "Citation chunk is missing its parent section", "citation_chunk_missing_section");
    }

    const section = await this.prisma.documentSection.findFirstOrThrow({
      where: {
        id: chunk.sectionId,
        projectId,
        documentVersionId: chunk.documentVersionId,
        parseRevision: chunk.parseRevision
      }
    });

    return {
      citationId: citation.id,
      citationType: citation.citationType,
      versionId: chunk.documentVersionId,
      section,
      chunkId: chunk.id
    };
  }

  private async resolveHighlightForVersion(
    projectId: string,
    documentId: string,
    versionId: string,
    highlightCitationId: string | undefined,
    projectRole: string,
    preResolved?: Awaited<ReturnType<DocumentService["resolveHighlightCandidate"]>> | null
  ): Promise<TargetSection | null> {
    if (!highlightCitationId) {
      return null;
    }

    const candidate =
      preResolved ?? (await this.resolveHighlightCandidate(projectId, documentId, highlightCitationId, projectRole));

    if (candidate.versionId !== versionId) {
      throw new AppError(
        409,
        "Highlighted citation belongs to a different document version than the requested viewer state",
        "citation_version_mismatch"
      );
    }

    return {
      source: "citation",
      section: candidate.section,
      chunkId: candidate.chunkId,
      citationId: candidate.citationId,
      citationType: candidate.citationType
    };
  }

  private async buildSectionPayloads(
    projectId: string,
    document: { id: string; title: string },
    version: { id: string; parseRevision: number },
    sections: Array<{
      id: string;
      anchorId: string;
      pageNumber: number | null;
      headingPath: string[];
      normalizedText: string;
      orderIndex: number;
    }>,
    projectRole: string
  ) {
    if (sections.length === 0) {
      return [] satisfies SectionReadModel[];
    }

    const overlays = await this.loadSectionOverlays(projectId, sections.map((section) => section.id), projectRole);

    return sections.map((section) => ({
      sectionId: section.id,
      anchorId: section.anchorId,
      citationLabel: this.buildCitationLabel(document.title, section.headingPath, section.pageNumber, section.anchorId),
      pageNumber: section.pageNumber,
      headingPath: section.headingPath,
      orderIndex: section.orderIndex,
      text: section.normalizedText,
      changeMarkers: overlays.markersBySection[section.id] ?? [],
      linkedDecisionIds: overlays.decisionIdsBySection[section.id] ?? [],
      linkedMessageRefs: overlays.messageRefsBySection[section.id] ?? [],
      hasCurrentTruthOverlay: (overlays.markersBySection[section.id] ?? []).length > 0,
      currentTruthSummary: overlays.truthSummariesBySection[section.id]?.length
        ? overlays.truthSummariesBySection[section.id]
        : null
    }));
  }

  private async loadSectionOverlays(projectId: string, sectionIds: string[], projectRole: string): Promise<SectionOverlayBundle> {
    if (sectionIds.length === 0) {
      return {
        markersBySection: {},
        decisionIdsBySection: {},
        messageRefsBySection: {},
        truthSummariesBySection: {}
      };
    }

    const acceptedLinks = await this.prisma.specChangeLink.findMany({
      where: {
        projectId,
        linkType: "document_section",
        linkRefId: {
          in: sectionIds
        },
        proposal: {
          status: "accepted"
        }
      },
      include: {
        proposal: {
          include: {
            decisionRecord: true
          }
        }
      }
    });

    const proposalIds = uniqueStrings(acceptedLinks.map((link) => link.specChangeProposalId));
    const relatedLinks = proposalIds.length
      ? await this.prisma.specChangeLink.findMany({
          where: {
            projectId,
            specChangeProposalId: {
              in: proposalIds
            },
            linkType: {
              in: ["message", "thread", "brain_node"]
            }
          }
        })
      : [];

    const relatedMessageRefs = projectRole === "client" ? [] : await this.loadRelatedMessageRefs(projectId, relatedLinks);
    const proposalMessageRefs = relatedLinks.reduce<Record<string, MessageRef[]>>((accumulator, link) => {
      if (projectRole === "client") {
        return accumulator;
      }

      accumulator[link.specChangeProposalId] ??= [];
      if (link.linkType === "thread") {
        const threadRef = relatedMessageRefs.find(
          (candidate) => candidate.type === "thread" && candidate.id === link.linkRefId
        );
        if (threadRef) {
          accumulator[link.specChangeProposalId].push(threadRef);
        }
      }

      if (link.linkType === "message") {
        const messageRef = relatedMessageRefs.find(
          (candidate) => candidate.type === "message" && candidate.id === link.linkRefId
        );
        if (messageRef) {
          accumulator[link.specChangeProposalId].push(messageRef);
        }
      }

      return accumulator;
    }, {});
    const proposalBrainNodeIds = relatedLinks.reduce<Record<string, string[]>>((accumulator, link) => {
      if (link.linkType !== "brain_node") {
        return accumulator;
      }

      accumulator[link.specChangeProposalId] ??= [];
      accumulator[link.specChangeProposalId].push(link.linkRefId);
      return accumulator;
    }, {});
    const proposalThreadIds = relatedLinks.reduce<Record<string, string[]>>((accumulator, link) => {
      if (link.linkType !== "thread") {
        return accumulator;
      }

      accumulator[link.specChangeProposalId] ??= [];
      accumulator[link.specChangeProposalId].push(link.linkRefId);
      return accumulator;
    }, {});

    const markersBySection = acceptedLinks.reduce<Record<string, ViewerChangeMarker[]>>((accumulator, link) => {
      const messageRefs = proposalMessageRefs[link.specChangeProposalId] ?? [];
      const marker: ViewerChangeMarker = {
        changeProposalId: projectRole === "client" ? null : link.proposal.id,
        proposalType: link.proposal.proposalType,
        status: link.proposal.status,
        acceptedAt: link.proposal.acceptedAt?.toISOString() ?? null,
        acceptedBy: projectRole === "client" ? null : link.proposal.acceptedBy,
        title: link.proposal.title,
        summary: link.proposal.summary,
        decisionRecordId: projectRole === "client" ? null : link.proposal.decisionRecordId,
        linkedBrainNodeIds: projectRole === "client" ? [] : proposalBrainNodeIds[link.specChangeProposalId] ?? [],
        linkedThreadIds: projectRole === "client" ? [] : proposalThreadIds[link.specChangeProposalId] ?? [],
        linkedMessageRefs: projectRole === "client" ? [] : messageRefs
      };
      accumulator[link.linkRefId] ??= [];
      accumulator[link.linkRefId].push(marker);
      return accumulator;
    }, {});

    const decisionIdsBySection =
      projectRole === "client"
        ? {}
        : acceptedLinks.reduce<Record<string, string[]>>((accumulator, link) => {
            if (!link.proposal.decisionRecordId) {
              return accumulator;
            }

            accumulator[link.linkRefId] ??= [];
            accumulator[link.linkRefId].push(link.proposal.decisionRecordId);
            return accumulator;
          }, {});

    const messageRefsBySection =
      projectRole === "client"
        ? {}
        : acceptedLinks.reduce<Record<string, MessageRef[]>>((accumulator, link) => {
            accumulator[link.linkRefId] ??= [];
            accumulator[link.linkRefId].push(...(proposalMessageRefs[link.specChangeProposalId] ?? []));
            return accumulator;
          }, {});

    const truthSummariesBySection = acceptedLinks.reduce<Record<string, string[]>>((accumulator, link) => {
      accumulator[link.linkRefId] ??= [];
      accumulator[link.linkRefId].push(link.proposal.summary);
      return accumulator;
    }, {});

    return {
      markersBySection: Object.fromEntries(
        Object.entries(markersBySection).map(([sectionId, markers]) => [
          sectionId,
          [...markers].sort((left, right) => {
            const leftTime = left.acceptedAt ? Date.parse(left.acceptedAt) : 0;
            const rightTime = right.acceptedAt ? Date.parse(right.acceptedAt) : 0;
            return rightTime - leftTime || left.title.localeCompare(right.title);
          })
        ])
      ),
      decisionIdsBySection: Object.fromEntries(
        Object.entries(decisionIdsBySection).map(([sectionId, decisionIds]) => [sectionId, uniqueStrings(decisionIds)])
      ),
      messageRefsBySection: Object.fromEntries(
        Object.entries(messageRefsBySection).map(([sectionId, refs]) => [
          sectionId,
          refs.filter(
            (ref, index, collection) =>
              collection.findIndex(
                (candidate) => candidate.type === ref.type && candidate.id === ref.id
              ) === index
          )
        ])
      ),
      truthSummariesBySection: Object.fromEntries(
        Object.entries(truthSummariesBySection).map(([sectionId, summaries]) => [sectionId, uniqueStrings(summaries)])
      )
    };
  }

  private async loadRelatedMessageRefs(projectId: string, relatedLinks: Array<{ linkType: string; linkRefId: string }>) {
    const messageIds = relatedLinks.filter((link) => link.linkType === "message").map((link) => link.linkRefId);
    const threadIds = relatedLinks.filter((link) => link.linkType === "thread").map((link) => link.linkRefId);

    const [messages, threads] = await Promise.all([
      messageIds.length
        ? this.prisma.communicationMessage.findMany({
            where: {
              projectId,
              isDeletedByProvider: false,
              id: {
                in: messageIds
              }
            }
          })
        : Promise.resolve([]),
      threadIds.length
        ? this.prisma.communicationThread.findMany({
            where: {
              projectId,
              id: {
                in: threadIds
              }
            }
          })
        : Promise.resolve([])
    ]);

    return [
      ...messages
        .filter((message) => !message.isDeletedByProvider)
        .map((message) => ({
          type: "message" as const,
          id: message.id,
          senderLabel: message.senderLabel,
          sentAt: message.sentAt.toISOString(),
          threadId: message.threadId
        })),
      ...threads.map((thread) => ({
        type: "thread" as const,
        id: thread.id,
        subject: thread.subject ?? null,
        lastMessageAt: thread.lastMessageAt?.toISOString() ?? null
      }))
    ];
  }

  private async filterClientSafeBrainLinks(
    projectId: string,
    links: Array<{
      brainNodeId: string;
      relationship: string;
      brainNode: {
        id: string;
        title: string;
        nodeType: string;
        status: string;
      };
    }>
  ) {
    const nodeIds = uniqueStrings(links.map((link) => link.brainNodeId));
    if (nodeIds.length === 0) {
      return [];
    }

    const graphLinks = await this.prisma.brainSectionLink.findMany({
      where: {
        projectId,
        brainNodeId: {
          in: nodeIds
        }
      },
      include: {
        documentSection: {
          include: {
            documentVersion: {
              include: {
                document: true
              }
            }
          }
        }
      }
    });

    const safeNodeIds = new Set(
      nodeIds.filter((nodeId) => {
        const nodeLinks = graphLinks.filter((link) => link.brainNodeId === nodeId);
        return (
          nodeLinks.length > 0 &&
          nodeLinks.every((link) => link.documentSection.documentVersion.document.visibility === "shared_with_client")
        );
      })
    );

    return links.filter((link) => safeNodeIds.has(link.brainNodeId));
  }

  private toDocumentListItem(
    document: {
      id: string;
      projectId: string;
      title: string;
      kind: string;
      visibility: DocumentVisibility;
      currentVersionId: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    currentVersion:
      | {
          id: string;
          status: string;
          parseRevision: number;
          parseConfidence: Prisma.Decimal | null;
          sourceLabel: string | null;
          createdAt: Date;
          processedAt: Date | null;
        }
      | undefined,
    driveSource?: DriveSourceReadModel,
    notionSource?: NotionSourceReadModel
  ) {
    return {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      kind: document.kind,
      visibility: document.visibility,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      parseStatus: currentVersion?.status ?? null,
      lastProcessedAt: currentVersion?.processedAt?.toISOString() ?? null,
      currentVersion: currentVersion ? this.toVersionSummary(currentVersion, true) : null,
      sourceProvider: driveSource ? "google_drive" : notionSource ? "notion" : currentVersion?.sourceLabel ?? "upload",
      sourceLabel: driveSource ? "Google Drive" : notionSource ? "Notion" : currentVersion?.sourceLabel ?? "Upload",
      source: driveSource ?? notionSource ?? null
    };
  }

  private toDocumentIdentity(document: {
    id: string;
    projectId: string;
    title: string;
    kind: string;
    visibility: DocumentVisibility;
    currentVersionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: document.id,
      projectId: document.projectId,
      title: document.title,
      kind: document.kind,
      visibility: document.visibility,
      currentVersionId: document.currentVersionId,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString()
    };
  }

  private toVersionSummary(
    version: {
      id: string;
      status: string;
      mimeType?: string;
      parseRevision: number;
      parseConfidence: Prisma.Decimal | string | null;
      sourceLabel: string | null;
      createdAt: Date;
      processedAt: Date | null;
    },
    isCurrent: boolean
  ) {
    return {
      id: version.id,
      status: version.status,
      mimeType: "mimeType" in version ? version.mimeType : null,
      parseRevision: version.parseRevision,
      parseConfidence: version.parseConfidence ? Number(version.parseConfidence) : null,
      sourceLabel: version.sourceLabel,
      createdAt: version.createdAt.toISOString(),
      processedAt: version.processedAt?.toISOString() ?? null,
      isCurrent
    };
  }

  private buildCitationLabel(documentTitle: string, headingPath: string[], pageNumber: number | null, anchorId: string) {
    const headingLabel = headingPath.length > 0 ? headingPath.join(" > ") : anchorId;
    const pageLabel = pageNumber ? `p.${pageNumber}` : "section";
    return `${documentTitle} · ${pageLabel} · ${headingLabel}`;
  }

  private toHighlight(
    documentId: string,
    documentTitle: string,
    documentVersionId: string,
    section: {
      id: string;
      anchorId: string;
      pageNumber: number | null;
      headingPath: string[];
    },
    citationId?: string,
    citationType?: string,
    chunkId?: string | null
  ): HighlightReadModel & { openTarget: ReturnType<DocumentService["buildDocumentSectionOpenTarget"]> } {
    return {
      citationId,
      citationType,
      refId: chunkId ?? section.id,
      sectionId: section.id,
      anchorId: section.anchorId,
      pageNumber: section.pageNumber,
      chunkId: chunkId ?? null,
      citationLabel: this.buildCitationLabel(documentTitle, section.headingPath, section.pageNumber, section.anchorId),
      openTarget: this.buildDocumentSectionOpenTarget(documentId, documentVersionId, section.anchorId, section.pageNumber)
    };
  }

  private buildDocumentSectionOpenTarget(
    documentId: string,
    documentVersionId: string,
    anchorId: string,
    pageNumber: number | null
  ) {
    return {
      targetType: "document_section" as const,
      targetRef: {
        documentId,
        documentVersionId,
        anchorId,
        pageNumber: pageNumber ?? undefined
      }
    };
  }

  private buildBrainNodeOpenTarget(nodeId: string, artifactVersionId?: string) {
    return {
      targetType: "brain_node" as const,
      targetRef: {
        nodeId,
        artifactVersionId
      }
    };
  }

  private buildChangeProposalOpenTarget(proposalId: string) {
    return {
      targetType: "change_proposal" as const,
      targetRef: {
        proposalId
      }
    };
  }

  private buildDecisionOpenTarget(decisionId: string) {
    return {
      targetType: "decision_record" as const,
      targetRef: {
        decisionId
      }
    };
  }

  private buildThreadOpenTarget(threadId: string) {
    return {
      targetType: "thread" as const,
      targetRef: {
        threadId
      }
    };
  }

  private clientDocumentFilter(projectRole: string) {
    if (projectRole !== "client") {
      return null;
    }

    return {
      visibility: "shared_with_client" as DocumentVisibility
    };
  }

  private async parseVersionContent(contentType: string, buffer: Buffer, title: string) {
    const startedAt = process.hrtime.bigint();
    try {
      if (contentType.toLowerCase().startsWith("audio/")) {
        const transcript = await this.transcriptionProvider.transcribeAudio({
          fileName: title,
          contentType,
          buffer
        });

        this.telemetry.increment("orchestra_voice_transcriptions_total", {
          provider: transcript.provider
        });
        return parseTextDocument(transcript.text);
      }

      return await parseDocumentBuffer(contentType, buffer, title);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.telemetry.observeDuration("orchestra_document_parse_duration_ms", durationMs, {
        parser: contentType.toLowerCase().startsWith("audio/") ? "audio_transcription" : "document_parser"
      });
    }
  }
}
