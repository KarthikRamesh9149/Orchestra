import { z } from "zod";

export const projectContextTypeSchema = z.enum([
  "manual_note",
  "decision_note",
  "team_note",
  "task_note",
  "chat_export",
  "manual_transcript",
  "meeting_note",
  "chart_caption",
  "screenshot_caption",
  "generated_prd",
  "generated_srs",
  "other"
]);

export const userCreatableProjectContextTypeSchema = projectContextTypeSchema.refine(
  (value) => value !== "generated_prd" && value !== "generated_srs",
  { message: "generated_prd and generated_srs are reserved context types" }
);

export const projectContextImportanceSchema = z.enum(["normal", "high"]);

const unsafeMarkupPattern = /<\s*script\b/i;

const safeText = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !unsafeMarkupPattern.test(value), { message: `${label} contains unsafe markup` });

const normalizedTagsSchema = z
  .array(safeText("tag", 1, 50))
  .max(30)
  .default([])
  .transform((tags) => Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))));

const participantsSchema = z.array(safeText("participant", 1, 120)).max(50).default([]);

const attachmentSchema = z.object({
  filename: safeText("filename", 1, 240).optional().nullable(),
  mimeType: safeText("mimeType", 1, 120).optional().nullable(),
  fileSize: z.coerce.bigint().nonnegative().optional().nullable(),
  providerUrl: z.string().trim().url().max(2000).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().default({})
});

export const projectContextParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const projectContextEntryParamsSchema = z.object({
  projectId: z.string().uuid(),
  contextId: z.string().uuid()
});

export const projectContextAttachmentParamsSchema = z.object({
  projectId: z.string().uuid(),
  contextId: z.string().uuid(),
  attachmentId: z.string().uuid()
});

export const projectContextUploadTypeSchema = z.enum([
  "chart_image",
  "chart_caption",
  "screenshot",
  "screenshot_caption",
  "chat_screenshot",
  "whatsapp_screenshot",
  "chat_export",
  "manual_transcript",
  "meeting_note",
  "other"
]);

export const createProjectContextEntrySchema = z.object({
  type: userCreatableProjectContextTypeSchema,
  title: safeText("title", 2, 200),
  body: safeText("body", 1, 60000),
  sourceDate: z.string().datetime().optional().nullable(),
  participants: participantsSchema,
  tags: normalizedTagsSchema,
  linkedMemberId: z.string().uuid().optional().nullable(),
  importance: projectContextImportanceSchema.default("normal"),
  attachments: z.array(attachmentSchema).max(10).default([])
});

export const updateProjectContextEntrySchema = z
  .object({
    type: userCreatableProjectContextTypeSchema.optional(),
    title: safeText("title", 2, 200).optional(),
    body: safeText("body", 1, 60000).optional(),
    sourceDate: z.string().datetime().optional().nullable(),
    participants: participantsSchema.optional(),
    tags: normalizedTagsSchema.optional(),
    linkedMemberId: z.string().uuid().optional().nullable(),
    importance: projectContextImportanceSchema.optional(),
    attachments: z.array(attachmentSchema).max(10).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one context field must be provided"
  });

export const listProjectContextEntriesQuerySchema = z.object({
  type: projectContextTypeSchema.optional(),
  importance: projectContextImportanceSchema.optional(),
  linkedMemberId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(50).transform((value) => value.toLowerCase()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  includeDeleted: z.coerce.boolean().default(false)
});

export type CreateProjectContextEntryInput = z.infer<typeof createProjectContextEntrySchema>;
export type UpdateProjectContextEntryInput = z.infer<typeof updateProjectContextEntrySchema>;
export type ListProjectContextEntriesQuery = z.infer<typeof listProjectContextEntriesQuerySchema>;
export type ProjectContextUploadType = z.infer<typeof projectContextUploadTypeSchema>;

export type CreateProjectContextUploadInput = {
  type: ProjectContextUploadType;
  title: string;
  caption?: string | null;
  description?: string | null;
  sourceDate?: string | null;
  participants?: string[];
  tags?: string[];
  linkedMemberId?: string | null;
  importance?: z.infer<typeof projectContextImportanceSchema>;
  file: {
    filename: string;
    mimeType: string;
    size: number;
    buffer: Buffer;
  };
};
