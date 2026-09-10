import { z } from "zod";

export const documentKindSchema = z.enum(["prd", "srs", "meeting_note", "call_note", "reference", "internal_note", "other"]);

export const pastedTextUploadSchema = z.object({
  kind: documentKindSchema,
  title: z.string().min(2),
  visibility: z.enum(["internal", "shared_with_client"]).default("internal"),
  sourceLabel: z.string().optional(),
  makePrimaryLiveDoc: z.boolean().optional().default(false),
  pastedText: z.string().min(1)
});

export const multipartUploadMetadataSchema = z.object({
  kind: documentKindSchema.default("other"),
  title: z.string().min(2),
  visibility: z.enum(["internal", "shared_with_client"]).default("internal"),
  sourceLabel: z.string().min(1).optional(),
  makePrimaryLiveDoc: z.coerce.boolean().optional().default(false)
});

export const betaMultipartUploadMetadataSchema = multipartUploadMetadataSchema.extend({
  kind: z.preprocess((value) => {
    if (typeof value !== "string") return "reference";
    return documentKindSchema.safeParse(value).success ? value : "reference";
  }, documentKindSchema.default("reference"))
});

export const documentParamsSchema = z.object({
  projectId: z.string().uuid(),
  documentId: z.string().uuid()
});

export const uploadOperationParamsSchema = z.object({
  projectId: z.string().uuid(),
  operationId: z.string().uuid()
});

export const uploadOperationIdSchema = z.string().uuid();

export const anchorParamsSchema = z.object({
  projectId: z.string().uuid(),
  documentId: z.string().uuid(),
  anchorId: z.string().min(1)
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25)
});

export const viewerQuerySchema = z.object({
  versionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  anchorId: z.string().min(1).optional(),
  sectionId: z.string().uuid().optional(),
  chunkId: z.string().uuid().optional(),
  highlightCitationId: z.string().uuid().optional()
}).superRefine((value, context) => {
  const exactTargets = [value.anchorId, value.sectionId, value.chunkId].filter((candidate) => candidate !== undefined);
  if (exactTargets.length > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Only one of anchorId, sectionId, or chunkId may be provided at a time",
      path: ["anchorId"]
    });
  }
});

export const anchorQuerySchema = z.object({
  versionId: z.string().uuid().optional(),
  highlightCitationId: z.string().uuid().optional()
});

export const documentSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  versionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export const documentGenerationKindSchema = z.enum(["prd", "srs"]);
export const documentGenerationTemplateSchema = z.enum(["basic_mvp", "basic_srs"]);

export const documentGenerationBodySchema = z.object({
  kind: documentGenerationKindSchema,
  template: documentGenerationTemplateSchema,
  prompt: z.string().trim().min(10).max(4000),
  contextIds: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  tone: z.enum(["plain"]).default("plain"),
  includeCodingHints: z.boolean().default(true),
  title: z.string().trim().min(2).max(160).optional(),
  rebuildBrain: z.boolean().default(false),
  makePrimaryLiveDoc: z.boolean().optional()
}).superRefine((value, context) => {
  if (value.kind === "prd" && value.template !== "basic_mvp") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Template basic_mvp must be used for PRD generation",
      path: ["template"]
    });
  }
  if (value.kind === "srs" && value.template !== "basic_srs") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Template basic_srs must be used for SRS generation",
      path: ["template"]
    });
  }
});

export type DocumentGenerationBody = z.infer<typeof documentGenerationBodySchema>;
