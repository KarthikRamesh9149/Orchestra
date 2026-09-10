import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { internalAuthGuard as authGuard } from "../../app/auth.js";
import { AppError } from "../../app/errors.js";
import { rateLimitRouteOptions } from "../../app/security.js";
import {
  createProjectContextEntrySchema,
  listProjectContextEntriesQuerySchema,
  projectContextAttachmentParamsSchema,
  projectContextEntryParamsSchema,
  projectContextParamsSchema,
  projectContextUploadTypeSchema,
  updateProjectContextEntrySchema
} from "./context.schemas.js";

const unsafeMarkupPattern = /<\s*script\b/i;
const maxMultipartFieldLength = 10_000;
const multipartFieldSchema = z.object({
  type: projectContextUploadTypeSchema,
  title: z.string().trim().min(2).max(200).refine((value) => !unsafeMarkupPattern.test(value), {
    message: "title contains unsafe markup"
  }),
  caption: z.string().trim().min(1).max(2000).refine((value) => !unsafeMarkupPattern.test(value), {
    message: "caption contains unsafe markup"
  }).optional(),
  description: z.string().trim().min(1).max(8000).refine((value) => !unsafeMarkupPattern.test(value), {
    message: "description contains unsafe markup"
  }).optional(),
  sourceDate: z.string().datetime().optional(),
  participants: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
  tags: z
    .array(z.string().trim().min(1).max(50))
    .max(30)
    .default([])
    .transform((tags) => Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))),
  linkedMemberId: z.string().uuid().optional(),
  importance: z.enum(["normal", "high"]).default("normal")
});

export const registerProjectContextRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/projects/:projectId/context",
    rateLimitRouteOptions(app.appContext.env, "upload"),
    authGuard(async (request) => {
      const params = projectContextParamsSchema.parse(request.params);
      if (isMultipartRequest(request)) {
        await request.appContext.services.projectService.ensureProjectMemberCanManageTeamContext(
          params.projectId,
          request.authUser!.userId
        );
        const upload = await readMultipartContextUpload(request);
        const result = await request.appContext.services.projectContextService.createContextFromUpload(
          params.projectId,
          request.authUser!.userId,
          upload
        );
        return { data: result, meta: null, error: null };
      }
      const body = createProjectContextEntrySchema.parse(request.body);
      const result = await request.appContext.services.projectContextService.createContext(
        params.projectId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/context",
    authGuard(async (request) => {
      const params = projectContextParamsSchema.parse(request.params);
      const query = listProjectContextEntriesQuerySchema.parse(request.query);
      const result = await request.appContext.services.projectContextService.listContext(
        params.projectId,
        request.authUser!.userId,
        query
      );
      return { data: result.items, meta: result.meta, error: null };
    })
  );

  app.get(
    "/projects/:projectId/context/:contextId",
    authGuard(async (request) => {
      const params = projectContextEntryParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectContextService.getContext(
        params.projectId,
        params.contextId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/context/:contextId/attachments/:attachmentId/signed-url",
    authGuard(async (request) => {
      const params = projectContextAttachmentParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectContextService.getContextAttachmentSignedUrl(
        params.projectId,
        params.contextId,
        params.attachmentId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.get(
    "/projects/:projectId/context/:contextId/attachments/:attachmentId/content",
    authGuard(async (request, reply) => {
      const params = projectContextAttachmentParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectContextService.getContextAttachmentFile(
        params.projectId,
        params.contextId,
        params.attachmentId,
        request.authUser!.userId
      );
      reply.header("Content-Type", result.mimeType ?? "application/octet-stream");
      if (result.size !== undefined) reply.header("Content-Length", result.size);
      reply.header(
        "Content-Disposition",
        `inline; filename="${encodeHeaderFilename(result.originalFilename ?? "context-attachment")}"`
      );
      return reply.send(result.stream);
    })
  );

  app.patch(
    "/projects/:projectId/context/:contextId",
    authGuard(async (request) => {
      const params = projectContextEntryParamsSchema.parse(request.params);
      const body = updateProjectContextEntrySchema.parse(request.body);
      const result = await request.appContext.services.projectContextService.updateContext(
        params.projectId,
        params.contextId,
        request.authUser!.userId,
        body
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.delete(
    "/projects/:projectId/context/:contextId",
    authGuard(async (request) => {
      const params = projectContextEntryParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectContextService.deleteContext(
        params.projectId,
        params.contextId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );

  app.post(
    "/projects/:projectId/context/:contextId/reindex",
    authGuard(async (request) => {
      const params = projectContextEntryParamsSchema.parse(request.params);
      const result = await request.appContext.services.projectContextService.reindexContext(
        params.projectId,
        params.contextId,
        request.authUser!.userId
      );
      return { data: result, meta: null, error: null };
    })
  );
};

function isMultipartRequest(request: FastifyRequest) {
  const contentType = request.headers["content-type"] ?? "";
  return typeof contentType === "string" && contentType.toLowerCase().includes("multipart/form-data");
}

async function readMultipartContextUpload(request: FastifyRequest) {
  const fields: Record<string, string> = {};
  let file:
    | {
        filename: string;
        mimeType: string;
        size: number;
        buffer: Buffer;
      }
    | null = null;

  for await (const part of request.parts({
    limits: {
      fileSize: request.appContext.env.MVP_CONTEXT_ATTACHMENT_MAX_FILE_SIZE_BYTES
    }
  })) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        throw new AppError(400, "Unexpected multipart file field", "unexpected_context_upload_file_field");
      }
      if (file) {
        throw new AppError(400, "Multipart context upload accepts exactly one file", "duplicate_context_upload_file");
      }
      const buffer = await part.toBuffer();
      file = {
        filename: part.filename,
        mimeType: part.mimetype,
        size: buffer.length,
        buffer
      };
      continue;
    }

    const value = typeof part.value === "string" ? part.value : String(part.value ?? "");
    if (value.length > maxMultipartFieldLength) {
      throw new AppError(413, "Multipart context field exceeds size limit", "context_upload_field_too_large");
    }
    fields[part.fieldname] = value;
  }

  if (!file) {
    throw new AppError(400, "Multipart context upload requires a file field", "context_upload_file_required");
  }

  const parsedFields = multipartFieldSchema.parse({
    type: getMultipartField(fields, "type") ?? "other",
    title: getMultipartField(fields, "title"),
    caption: emptyToUndefined(getMultipartField(fields, "caption")),
    description: emptyToUndefined(getMultipartField(fields, "description")),
    sourceDate: emptyToUndefined(getMultipartField(fields, "sourceDate")),
    participants: parseStringList(getMultipartField(fields, "participants")),
    tags: parseStringList(getMultipartField(fields, "tags")),
    linkedMemberId: emptyToUndefined(getMultipartField(fields, "linkedMemberId")),
    importance: getMultipartField(fields, "importance") ?? "normal"
  });
  return {
    ...parsedFields,
    caption: parsedFields.caption ?? null,
    description: parsedFields.description ?? null,
    sourceDate: parsedFields.sourceDate ?? null,
    linkedMemberId: parsedFields.linkedMemberId ?? null,
    file
  };
}

function getMultipartField(fields: Record<string, unknown>, key: string) {
  const field = fields[key];
  return typeof field === "string" ? field : undefined;
}

function emptyToUndefined(value: string | undefined) {
  return value?.trim() ? value.trim() : undefined;
}

function parseStringList(value: string | undefined) {
  if (!value?.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new AppError(400, "Invalid multipart list field", "invalid_context_upload_list_field");
    }
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

function encodeHeaderFilename(value: string) {
  return value.replace(/["\r\n\\]/g, "_").slice(0, 180);
}
