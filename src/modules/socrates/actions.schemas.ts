import { z } from "zod";
import { validateMermaidSource } from "../diagrams/mermaid-validation.js";

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const secretKeyPattern = /token|secret|password|credential|apiKey|api[_-]?key|authorization|privateKey|signingKey/i;
const secretValuePattern =
  /\b(sk-[A-Za-z0-9_-]{12,}|xox[abprs]-[A-Za-z0-9-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|FIREFLIES_API_KEY|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|CLIENT_SHARE_TOKEN_SECRET|DATABASE_URL)\s*=)/i;
const unsafeTextPattern =
  /<\s*script\b|<\/\s*script\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|<\s*svg\b|<\s*img\b|javascript\s*:|data\s*:|vbscript\s*:/i;

const safeText = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !unsafeTextPattern.test(value), { message: `${label} contains unsafe content` });

const boundedUuidArray = (max = 20) => z.array(uuidSchema).max(max).default([]);

export const socratesActionTypeSchema = z.enum([
  "generate_prd",
  "generate_srs",
  "create_context_note",
  "create_diagram",
  "embed_diagram_in_live_doc",
  "generate_coding_requirements",
  "create_responsibility",
  "assign_task",
  "update_team_member_responsibility",
  "create_calendar_event"
]);

export const socratesActionStatusSchema = z.enum(["proposed", "applying", "applied", "rejected", "failed"]);

const documentGenerationBasePayloadSchema = z
  .object({
    prompt: safeText("prompt", 10, 4000),
    title: safeText("title", 2, 160).optional(),
    includeCodingHints: z.boolean().default(true),
    contextIds: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    rebuildBrain: z.boolean().default(false)
  })
  .strict();

export const generatePrdPayloadSchema = documentGenerationBasePayloadSchema.extend({
  template: z.literal("basic_mvp").default("basic_mvp")
});

export const generateSrsPayloadSchema = documentGenerationBasePayloadSchema.extend({
  template: z.literal("basic_srs").default("basic_srs")
});

export const contextNotePayloadSchema = z
  .object({
    type: z.enum(["manual_note", "decision_note", "team_note", "task_note", "meeting_note", "other"]),
    title: safeText("title", 2, 200),
    body: safeText("body", 1, 60000),
    sourceDate: isoDateTimeSchema.optional(),
    participants: z.array(safeText("participant", 1, 120)).max(50).default([]),
    tags: z.array(safeText("tag", 1, 50)).max(30).default([]),
    linkedMemberId: uuidSchema.nullable().optional(),
    importance: z.enum(["normal", "high"]).default("normal")
  })
  .strict();

const diagramTypeSchema = z.enum([
  "flowchart",
  "coding_flow",
  "requirement_flow",
  "system_process",
  "sequence",
  "module_dependency",
  "architecture"
]);

const diagramSourceRefSchema = z
  .object({
    type: z.enum(["document_section", "brain_node", "project_context", "responsibility", "artifact_version"]),
    id: uuidSchema
  })
  .strict();

export const createDiagramPayloadSchema = z.union([
  z
    .object({
      mode: z.literal("generate"),
      diagramType: diagramTypeSchema,
      prompt: safeText("prompt", 1, 4000),
      title: safeText("title", 2, 200).optional(),
      description: safeText("description", 1, 4000).optional(),
      sourceRefs: z.array(diagramSourceRefSchema).max(20).default([])
    })
    .strict(),
  z
    .object({
      mode: z.literal("save"),
      diagramType: diagramTypeSchema,
      title: safeText("title", 2, 200),
      description: safeText("description", 1, 4000).optional(),
      mermaidSource: z.string().trim().min(1).max(20_000),
      linkedDocumentSectionIds: boundedUuidArray(50),
      linkedBrainNodeIds: boundedUuidArray(50),
      linkedContextEntryIds: boundedUuidArray(50)
    })
    .strict()
    .superRefine((value, context) => {
      try {
        validateMermaidSource({ diagramType: value.diagramType, mermaidSource: value.mermaidSource });
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mermaidSource"],
          message: error instanceof Error ? error.message : "Invalid Mermaid source"
        });
      }
    })
]);

export const embedDiagramPayloadSchema = z
  .object({
    diagramId: uuidSchema,
    sectionKey: safeText("sectionKey", 1, 200),
    sortOrder: z.number().int().min(-10000).max(10000).default(0)
  })
  .strict();

const codingRequirementsSourceRefSchema = z
  .object({
    type: z.enum([
      "document",
      "document_section",
      "brain_node",
      "project_context",
      "project_responsibility",
      "project_diagram",
      "artifact_version"
    ]),
    id: uuidSchema
  })
  .strict();

export const codingRequirementsPayloadSchema = z
  .object({
    prompt: safeText("prompt", 1, 4000).optional(),
    focus: z
      .enum(["full_project", "frontend", "backend", "api", "ai", "data_model", "integrations", "testing", "deployment"])
      .default("full_project"),
    includeMermaid: z.literal(true).default(true),
    saveFlowchart: z.boolean().default(true),
    sourceRefs: z.array(codingRequirementsSourceRefSchema).max(20).default([])
  })
  .strict();

const responsibilityAreaSchema = z.enum(["frontend", "backend", "api", "ai", "design", "qa", "docs", "devops", "product", "other"]);
const responsibilityStatusSchema = z.enum(["open", "in_progress", "done", "blocked"]);

const responsibilityBasePayloadSchema = z
  .object({
    memberId: uuidSchema.nullable().optional(),
    assigneeName: safeText("assigneeName", 1, 120).nullable().optional(),
    title: safeText("title", 2, 200),
    description: safeText("description", 1, 2000).nullable().optional(),
    area: responsibilityAreaSchema,
    status: responsibilityStatusSchema.default("open")
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.memberId && !value.assigneeName) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["memberId"], message: "Provide memberId or assigneeName" });
    }
  });

export const createResponsibilityPayloadSchema = responsibilityBasePayloadSchema;

export const assignTaskPayloadSchema = z
  .object({
    memberId: uuidSchema.nullable().optional(),
    assigneeName: safeText("assigneeName", 1, 120).nullable().optional(),
    taskTitle: safeText("taskTitle", 2, 200),
    taskDescription: safeText("taskDescription", 1, 2000).nullable().optional(),
    area: responsibilityAreaSchema,
    status: responsibilityStatusSchema.default("open")
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.memberId && !value.assigneeName) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["memberId"], message: "Provide memberId or assigneeName" });
    }
  });

export const updateTeamMemberResponsibilityPayloadSchema = z
  .object({
    responsibilityId: uuidSchema,
    memberId: uuidSchema.nullable().optional(),
    assigneeName: safeText("assigneeName", 1, 120).nullable().optional(),
    title: safeText("title", 2, 200).optional(),
    description: safeText("description", 1, 2000).nullable().optional(),
    area: responsibilityAreaSchema.optional(),
    status: responsibilityStatusSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== "responsibilityId"), {
    message: "At least one responsibility update field must be provided"
  });

export const createCalendarEventPayloadSchema = z
  .object({
    title: safeText("title", 1, 200),
    description: safeText("description", 1, 5000).optional(),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema.optional(),
    location: safeText("location", 1, 500).optional(),
    attendeeMemberIds: boundedUuidArray(50),
    source: z.enum(["manual", "socrates"]).default("socrates")
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endsAt && new Date(value.endsAt).getTime() < new Date(value.startsAt).getTime()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "endsAt must be after startsAt" });
    }
  });

export const actionPayloadSchemas = {
  generate_prd: generatePrdPayloadSchema,
  generate_srs: generateSrsPayloadSchema,
  create_context_note: contextNotePayloadSchema,
  create_diagram: createDiagramPayloadSchema,
  embed_diagram_in_live_doc: embedDiagramPayloadSchema,
  generate_coding_requirements: codingRequirementsPayloadSchema,
  create_responsibility: createResponsibilityPayloadSchema,
  assign_task: assignTaskPayloadSchema,
  update_team_member_responsibility: updateTeamMemberResponsibilityPayloadSchema,
  create_calendar_event: createCalendarEventPayloadSchema
} as const;

export const actionParamsSchema = z.object({
  projectId: uuidSchema,
  actionId: uuidSchema
});

export const sessionActionParamsSchema = z.object({
  projectId: uuidSchema,
  sessionId: uuidSchema
});

export const listActionsQuerySchema = z.object({
  status: socratesActionStatusSchema.optional(),
  actionType: socratesActionTypeSchema.optional(),
  sessionId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const rejectActionBodySchema = z
  .object({
    reason: safeText("reason", 1, 1000).optional()
  })
  .strict();

export const createActionBodySchema = z
  .object({
    actionType: socratesActionTypeSchema,
    label: safeText("label", 2, 200),
    payload: z.unknown(),
    proposedByMessageId: uuidSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    const parsed = parseActionPayload(value.actionType, value.payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({ ...issue, path: ["payload", ...issue.path] });
      }
    }
  });

export const suggestedActionSchema = z
  .object({
    type: socratesActionTypeSchema,
    label: safeText("label", 2, 200),
    payload: z.unknown(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    requiresConfirmation: z.literal(true).default(true)
  })
  .strict()
  .superRefine((value, context) => {
    const parsed = parseActionPayload(value.type, value.payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({ ...issue, path: ["payload", ...issue.path] });
      }
    }
  });

export function parseActionPayload(actionType: SocratesActionTypeInput, payload: unknown) {
  const secretScan = findSecretLikeKey(payload);
  if (secretScan) {
    return z.any().refine(() => false, `Payload key ${secretScan} is not allowed`).safeParse(payload);
  }
  const secretValueScan = findSecretLikeValue(payload);
  if (secretValueScan) {
    return z.any().refine(() => false, `Payload value at ${secretValueScan} is not allowed`).safeParse(payload);
  }
  return actionPayloadSchemas[actionType].safeParse(payload);
}

function findSecretLikeKey(value: unknown, path: string[] = []): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findSecretLikeKey(item, [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (secretKeyPattern.test(key)) return [...path, key].join(".");
    const found = findSecretLikeKey((value as Record<string, unknown>)[key], [...path, key]);
    if (found) return found;
  }
  return null;
}

function findSecretLikeValue(value: unknown, path: string[] = []): string | null {
  if (typeof value === "string") {
    return secretValuePattern.test(value) ? path.join(".") || "$" : null;
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findSecretLikeValue(item, [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const found = findSecretLikeValue(item, [...path, key]);
    if (found) return found;
  }
  return null;
}

export type SocratesActionTypeInput = z.infer<typeof socratesActionTypeSchema>;
export type CreateActionBodyInput = z.infer<typeof createActionBodySchema>;
export type ListActionsQueryInput = z.infer<typeof listActionsQuerySchema>;
export type RejectActionBodyInput = z.infer<typeof rejectActionBodySchema>;
export type SuggestedActionInput = z.infer<typeof suggestedActionSchema>;
