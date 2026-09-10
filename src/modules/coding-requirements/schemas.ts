import { z } from "zod";
import { citationSchema, openTargetRefSchema } from "../socrates/schemas.js";
import { rejectUnsafeText, validateCodingFlowchart } from "./validation.js";

const safeTextPattern =
  /<\s*script\b|<\/\s*script\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|javascript\s*:|data\s*:|vbscript\s*:/i;

const safeText = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !safeTextPattern.test(value), { message: `${label} contains unsafe content` });

const boundedStringArray = (maxItems: number, maxLength: number) =>
  z.array(safeText("item", 1, maxLength)).max(maxItems).default([]);

export const codingRequirementsFocusSchema = z.enum([
  "full_project",
  "frontend",
  "backend",
  "api",
  "ai",
  "data_model",
  "integrations",
  "testing",
  "deployment"
]);

export const codingRequirementsSourceRefSchema = z.object({
  type: z.enum([
    "document",
    "document_section",
    "brain_node",
    "project_context",
    "project_responsibility",
    "project_diagram",
    "artifact_version"
  ]),
  id: z.string().uuid()
});

export const generateCodingRequirementsSchema = z.object({
  prompt: safeText("prompt", 1, 4000).optional(),
  focus: codingRequirementsFocusSchema.default("full_project"),
  includeMermaid: z.literal(true).default(true),
  saveFlowchart: z.boolean().default(true),
  sourceRefs: z.array(codingRequirementsSourceRefSchema).max(20).default([])
});

export const codingRequirementsParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const codingRequirementsArtifactParamsSchema = codingRequirementsParamsSchema.extend({
  codingRequirementsId: z.string().uuid()
});

export const codingRequirementsHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20)
});

export const codingBuildOrderItemSchema = z
  .object({
    order: z.number().int().min(1).max(200),
    moduleName: safeText("moduleName", 1, 160),
    reason: safeText("reason", 1, 1000),
    dependencies: boundedStringArray(20, 160)
  })
  .strict();

export const codingRequirementModuleSchema = z
  .object({
    name: safeText("name", 1, 160),
    purpose: safeText("purpose", 1, 1000),
    requirements: boundedStringArray(30, 400),
    apis: boundedStringArray(30, 260),
    dataModels: boundedStringArray(30, 260),
    dependencies: boundedStringArray(30, 160),
    risks: boundedStringArray(20, 400),
    suggestedBuildOrder: z.number().int().min(1).max(200),
    assumptions: boundedStringArray(20, 300),
    unknowns: boundedStringArray(20, 300),
    citations: z.array(citationSchema).max(20).default([]),
    openTargets: z.array(openTargetRefSchema).max(20).default([])
  })
  .strict();

export const codingRequirementsPayloadSchema = z
  .object({
    summary: safeText("summary", 1, 2000),
    modules: z.array(codingRequirementModuleSchema).min(1).max(40),
    globalRequirements: boundedStringArray(50, 400),
    integrationPoints: boundedStringArray(40, 300),
    assumptions: boundedStringArray(40, 300),
    unknowns: boundedStringArray(50, 300),
    suggestedBuildOrder: z.array(codingBuildOrderItemSchema).min(1).max(80),
    mermaid: z.string().trim().min(1).max(20_000),
    citations: z.array(citationSchema).max(80).default([]),
    openTargets: z.array(openTargetRefSchema).max(80).default([]),
    generatedAt: z.string().datetime(),
    evidenceSummary: z
      .object({
        sourceCounts: z.record(z.number().int().min(0)),
        lowEvidence: z.boolean(),
        limitations: boundedStringArray(20, 400)
      })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    try {
      rejectUnsafeText(JSON.stringify(value), "coding requirements payload");
      validateCodingFlowchart(value.mermaid);
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: error instanceof Error && error.message.includes("flowchart") ? ["mermaid"] : [],
        message: error instanceof Error ? error.message : "Invalid coding requirements payload"
      });
    }
  });

export type GenerateCodingRequirementsInput = z.infer<typeof generateCodingRequirementsSchema>;
export type CodingRequirementsPayload = z.infer<typeof codingRequirementsPayloadSchema>;
export type CodingRequirementsSourceRef = z.infer<typeof codingRequirementsSourceRefSchema>;
export type CodingRequirementsFocus = z.infer<typeof codingRequirementsFocusSchema>;
