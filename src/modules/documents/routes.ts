import type { FastifyPluginAsync } from "fastify";
import { internalAuthGuard as authGuard, requireManager } from "../../app/auth.js";
import { AppError } from "../../app/errors.js";
import { rateLimitRouteOptions } from "../../app/security.js";
import { isMvpBetaMode } from "../../lib/beta/policy.js";
import { isMvpEqualProjectAccessEnabled } from "../../lib/mvp/policy.js";
import { MAX_DOCUMENT_PARSE_BYTES } from "../../lib/parsers/file-safety.js";
import {
  anchorParamsSchema,
  anchorQuerySchema,
  betaMultipartUploadMetadataSchema,
  documentGenerationBodySchema,
  documentParamsSchema,
  documentSearchQuerySchema,
  multipartUploadMetadataSchema,
  paginationQuerySchema,
  pastedTextUploadSchema,
  uploadOperationIdSchema,
  uploadOperationParamsSchema,
  viewerQuerySchema
} from "./schemas.js";

export const registerDocumentRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/documents/generation-templates",
    authGuard(async (request) => {
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const projectId = documentParamsSchema.shape.projectId.parse((request.params as { projectId: string }).projectId);
      await request.appContext.services.projectService.ensureProjectMemberCanUploadContext(
        projectId,
        request.authUser!.userId
      );
      const result = request.appContext.services.documentGenerationService.listGenerationTemplates();
      return { data: { templates: result }, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/documents/generate",
    rateLimitRouteOptions(app.appContext.env, "upload"),
    authGuard(async (request) => {
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const projectId = documentParamsSchema.shape.projectId.parse((request.params as { projectId: string }).projectId);
      const body = documentGenerationBodySchema.parse(request.body);
      const result = await request.appContext.services.documentGenerationService.generateDocument(
        projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/documents/upload",
    rateLimitRouteOptions(app.appContext.env, "upload"),
    authGuard(async (request) => {
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const projectId = documentParamsSchema.shape.projectId.parse((request.params as { projectId: string }).projectId);
      const idempotencyHeader = request.headers["x-idempotency-key"];
      const operationId = typeof idempotencyHeader === "string" && idempotencyHeader.length > 0
        ? uploadOperationIdSchema.parse(idempotencyHeader)
        : undefined;
      await request.appContext.services.projectService.ensureProjectMemberCanUploadContext(
        projectId,
        request.authUser!.userId
      );
      if (operationId) {
        const completed = await request.appContext.services.documentService.getUploadOperation(
          projectId,
          request.authUser!.userId,
          operationId
        );
        if (completed) return { data: completed, meta: null, error: null };
      }
      const contentType = request.headers["content-type"] ?? "";

      if (contentType.includes("application/json")) {
        if (isMvpBetaMode(request.appContext.env)) {
          throw new AppError(403, "Pasted text uploads are disabled in beta", "feature_disabled_in_beta");
        }
        const body = pastedTextUploadSchema.parse(request.body);
        const result = await request.appContext.services.documentService.uploadFile({
          projectId,
          actorUserId: request.authUser!.userId,
          kind: body.kind,
          title: body.title,
          visibility: body.visibility,
          sourceLabel: body.sourceLabel,
          makePrimaryLiveDoc: body.makePrimaryLiveDoc,
          fileName: `${body.title}.md`,
          contentType: "text/markdown",
          buffer: Buffer.from(body.pastedText, "utf8"),
          operationId
        });

        return { data: result, meta: null, error: null };
      }

      const file = await request.file({
        limits: {
          fileSize: Math.min(request.appContext.env.MAX_FILE_SIZE_BYTES, MAX_DOCUMENT_PARSE_BYTES)
        }
      });
      if (!file) {
        throw new Error("Missing file upload");
      }

      if (isMvpBetaMode(request.appContext.env) && !isBetaSupportedMemoryUpload(file.filename, file.mimetype)) {
        throw new AppError(415, "Beta project memory supports PDF, DOCX, CSV, and XLSX uploads only", "unsupported_document_file_type");
      }

      const fields = file.fields as Record<string, { value?: string }>;
      const uploadMetadataSchema = isMvpBetaMode(request.appContext.env)
        ? betaMultipartUploadMetadataSchema
        : multipartUploadMetadataSchema;
      const metadata = uploadMetadataSchema.parse({
        kind: fields.kind?.value ?? "other",
        title: fields.title?.value ?? file.filename,
        visibility: fields.visibility?.value ?? "internal",
        sourceLabel: fields.sourceLabel?.value,
        makePrimaryLiveDoc: fields.makePrimaryLiveDoc?.value
      });

      const result = await request.appContext.services.documentService.uploadFile({
        projectId,
        actorUserId: request.authUser!.userId,
        kind: isMvpBetaMode(request.appContext.env) ? "reference" : metadata.kind,
        title: metadata.title,
        visibility: isMvpBetaMode(request.appContext.env) ? "internal" : metadata.visibility,
        sourceLabel: metadata.sourceLabel,
        makePrimaryLiveDoc: isMvpBetaMode(request.appContext.env) ? false : metadata.makePrimaryLiveDoc,
        fileName: file.filename,
        contentType: file.mimetype,
        buffer: await file.toBuffer(),
        operationId
      });

      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/documents",
    authGuard(async (request) => {
      const projectId = documentParamsSchema.shape.projectId.parse((request.params as { projectId: string }).projectId);
      const query = paginationQuerySchema.parse(request.query);
      const result = await request.appContext.services.documentService.listDocuments(
        projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/documents/uploads/:operationId",
    authGuard(async (request) => {
      const params = uploadOperationParamsSchema.parse(request.params);
      const result = await request.appContext.services.documentService.getUploadOperation(
        params.projectId,
        request.authUser!.userId,
        params.operationId
      );
      if (!result) throw new AppError(404, "Upload operation is not completed yet", "upload_operation_not_found");
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/documents/:documentId",
    authGuard(async (request) => {
      const params = documentParamsSchema.parse(request.params);
      const document = await request.appContext.services.documentService.getDocument(
        params.projectId,
        params.documentId,
        request.authUser!.userId
      );
      return { data: document, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/documents/:documentId",
    authGuard(async (request) => {
      const params = documentParamsSchema.parse(request.params);
      const result = await request.appContext.services.documentService.archiveDocument(
        params.projectId,
        params.documentId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/documents/:documentId/view",
    authGuard(async (request) => {
      const params = documentParamsSchema.parse(request.params);
      const query = viewerQuerySchema.parse(request.query);
      const payload = await request.appContext.services.documentService.getViewerPayload(
        params.projectId,
        params.documentId,
        request.authUser!.userId,
        query
      );
      return { data: payload, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/documents/:documentId/file",
    authGuard(async (request, reply) => {
      const params = documentParamsSchema.parse(request.params);
      const result = await request.appContext.services.documentService.getOriginalFile(
        params.projectId,
        params.documentId,
        request.authUser!.userId
      );
      return reply
        .header("content-type", result.contentType)
        .header("content-length", result.size)
        .header("content-disposition", `inline; filename="${result.fileName.replace(/"/g, "")}"`)
        .send(result.stream);
    })
  );

  app.get(
    "/projects/:projectId/documents/:documentId/anchors/:anchorId",
    authGuard(async (request) => {
      const params = anchorParamsSchema.parse(request.params);
      const query = anchorQuerySchema.parse(request.query);
      const payload = await request.appContext.services.documentService.getAnchor(
        params.projectId,
        params.documentId,
        params.anchorId,
        request.authUser!.userId,
        query
      );
      return { data: payload, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/documents/:documentId/search",
    authGuard(async (request) => {
      const params = documentParamsSchema.parse(request.params);
      const query = documentSearchQuerySchema.parse(request.query);
      const result = await request.appContext.services.documentService.searchDocument(
        params.projectId,
        params.documentId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/documents/:documentId/anchors/:anchorId/provenance",
    authGuard(async (request) => {
      const params = anchorParamsSchema.parse(request.params);
      const query = anchorQuerySchema.parse(request.query);
      const payload = await request.appContext.services.documentService.getAnchorProvenance(
        params.projectId,
        params.documentId,
        params.anchorId,
        request.authUser!.userId,
        query
      );
      return { data: payload, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/documents/:documentId/reprocess",
    authGuard(async (request) => {
      if (!isMvpEqualProjectAccessEnabled(request.appContext.env)) {
        requireManager(request);
      }
      const params = documentParamsSchema.parse(request.params);
      const result = await request.appContext.services.documentService.reprocess(
        params.projectId,
        params.documentId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};

function isBetaSupportedMemoryUpload(fileName: string, mimeType: string) {
  const lower = fileName.toLowerCase();
  const normalizedMime = mimeType.split(";")[0].trim().toLowerCase();
  return (
    (lower.endsWith(".pdf") && normalizedMime === "application/pdf") ||
    (lower.endsWith(".docx") &&
      normalizedMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") ||
    (lower.endsWith(".csv") &&
      ["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"].includes(normalizedMime)) ||
    (lower.endsWith(".xlsx") &&
      normalizedMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  );
}
