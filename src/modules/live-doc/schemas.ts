import { z } from "zod";

export const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const setLiveDocSourceBodySchema = z.object({
  documentId: z.string().uuid()
});

export const sectionParamsSchema = projectParamsSchema.extend({
  sectionKey: z.string().min(1).max(200)
});

export const reviewItemParamsSchema = projectParamsSchema.extend({
  proposalId: z.string().uuid()
});

export const liveDocCurrentQuerySchema = z.object({
  forceRefresh: z.coerce.boolean().optional().default(false)
});

export const patchSectionBodySchema = z.object({
  content: z.string().min(1).max(40000),
  comment: z.string().min(1).max(4000).optional()
});

export const listCommentsQuerySchema = z.object({
  sectionKey: z.string().min(1).max(200).optional()
});

export const createCommentBodySchema = z.object({
  sectionKey: z.string().min(1).max(200),
  draftId: z.string().uuid().optional(),
  bodyText: z.string().min(1).max(4000)
});

export const generateDiagramBodySchema = z.object({
  kind: z.enum(["system", "usecase", "flowchart", "sequence"])
});

export const liveDocSourceRefSchema = z.object({
  refType: z.enum(["document_section", "brain_node", "change_proposal", "decision_record", "message"]),
  refId: z.string(),
  label: z.string(),
  documentId: z.string().uuid().optional(),
  documentVersionId: z.string().uuid().optional(),
  anchorId: z.string().optional(),
  pageNumber: z.number().int().positive().optional()
});

export const liveDocSectionArtifactSchema = z.object({
  sectionKey: z.string(),
  anchorId: z.string(),
  sectionLabel: z.string(),
  type: z.enum(["title", "section-heading", "body", "highlighted"]),
  content: z.string(),
  highlight: z.string().nullable().optional(),
  sourceRefs: z.array(liveDocSourceRefSchema).default([])
});

export const liveDocArtifactSchema = z.object({
  generatedFromProductBrainId: z.string().uuid(),
  sections: z.array(liveDocSectionArtifactSchema),
  sourceRefs: z.array(liveDocSourceRefSchema).default([])
});

export type LiveDocArtifact = z.infer<typeof liveDocArtifactSchema>;
export type LiveDocSectionArtifact = z.infer<typeof liveDocSectionArtifactSchema>;
