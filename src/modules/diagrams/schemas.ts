import { z } from "zod";
import { maxMermaidSourceLength, validateMermaidSource } from "./mermaid-validation.js";

export const projectDiagramTypeSchema = z.enum([
  "flowchart",
  "coding_flow",
  "requirement_flow",
  "system_process",
  "sequence",
  "module_dependency",
  "architecture"
]);

export const projectDiagramSourceSchema = z.enum(["user_created", "socrates_generated"]);

const safeTextPattern =
  /<\s*script\b|<\/\s*script\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|javascript\s*:|data\s*:|vbscript\s*:/i;

const safeText = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !safeTextPattern.test(value), { message: `${label} contains unsafe content` });

const linkedIdsSchema = z.array(z.string().uuid()).max(50).default([]);

export const projectDiagramParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const projectDiagramEntryParamsSchema = z.object({
  projectId: z.string().uuid(),
  diagramId: z.string().uuid()
});

export const liveDocDiagramParamsSchema = projectDiagramEntryParamsSchema.extend({
  sectionKey: z.string().trim().min(1).max(200)
});

const baseDiagramFields = {
  title: safeText("title", 2, 200),
  description: safeText("description", 1, 4000).optional().nullable(),
  diagramType: projectDiagramTypeSchema,
  mermaidSource: z.string().trim().min(1).max(maxMermaidSourceLength),
  linkedDocumentSectionIds: linkedIdsSchema,
  linkedBrainNodeIds: linkedIdsSchema,
  linkedContextEntryIds: linkedIdsSchema,
  linkedArtifactVersionId: z.string().uuid().optional().nullable()
};

export const createDiagramSchema = z
  .object({
    ...baseDiagramFields,
    source: projectDiagramSourceSchema.default("user_created")
  })
  .superRefine((value, ctx) => {
    try {
      validateMermaidSource({ diagramType: value.diagramType, mermaidSource: value.mermaidSource });
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mermaidSource"],
        message: error instanceof Error ? error.message : "Invalid Mermaid source"
      });
    }
  });

export const updateDiagramSchema = z
  .object({
    title: baseDiagramFields.title.optional(),
    description: baseDiagramFields.description,
    diagramType: baseDiagramFields.diagramType.optional(),
    mermaidSource: baseDiagramFields.mermaidSource.optional(),
    linkedDocumentSectionIds: linkedIdsSchema.optional(),
    linkedBrainNodeIds: linkedIdsSchema.optional(),
    linkedContextEntryIds: linkedIdsSchema.optional(),
    linkedArtifactVersionId: z.string().uuid().optional().nullable()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one diagram field must be provided"
  });

export const diagramSourceRefSchema = z.object({
  type: z.enum(["document_section", "brain_node", "project_context", "responsibility", "artifact_version"]),
  id: z.string().uuid()
});

export const generateDiagramSchema = z.object({
  diagramType: projectDiagramTypeSchema,
  prompt: safeText("prompt", 1, 4000),
  sourceRefs: z.array(diagramSourceRefSchema).max(20).default([]),
  title: safeText("title", 2, 200).optional(),
  description: safeText("description", 1, 4000).optional(),
  save: z.boolean().default(false)
});

export const listDiagramsQuerySchema = z.object({
  diagramType: projectDiagramTypeSchema.optional(),
  source: projectDiagramSourceSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  includeDeleted: z.coerce.boolean().default(false)
});

export const embedDiagramSchema = z.object({
  sortOrder: z.coerce.number().int().min(-10000).max(10000).default(0)
});

export type CreateDiagramInput = z.infer<typeof createDiagramSchema>;
export type UpdateDiagramInput = z.infer<typeof updateDiagramSchema>;
export type GenerateDiagramInput = z.infer<typeof generateDiagramSchema>;
export type ListDiagramsQuery = z.infer<typeof listDiagramsQuerySchema>;
export type EmbedDiagramInput = z.infer<typeof embedDiagramSchema>;
export type DiagramSourceRef = z.infer<typeof diagramSourceRefSchema>;
