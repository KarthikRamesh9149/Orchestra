import { z } from "zod";

export const proposalParamsSchema = z.object({
  projectId: z.string().guid(),
  proposalId: z.string().guid()
});

export const createProposalSchema = z.object({
  title: z.string().min(2),
  summary: z.string().min(2),
  proposalType: z.enum(["requirement_change", "decision_change", "clarification", "contradiction_resolution"]),
  oldUnderstanding: z.record(z.string(), z.any()).optional(),
  newUnderstanding: z.record(z.string(), z.any()).optional(),
  impactSummary: z.record(z.string(), z.any()).optional(),
  affectedDocumentSectionIds: z.array(z.string().guid()).default([]),
  affectedBrainNodeIds: z.array(z.string().guid()).default([]),
  communicationMessageIds: z.array(z.string().guid()).default([]),
  externalEvidenceRefs: z.array(z.string()).default([])
}).superRefine((value, context) => {
  if (value.affectedDocumentSectionIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["affectedDocumentSectionIds"],
      message: "At least one affected document section is required."
    });
  }

  if (value.affectedBrainNodeIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["affectedBrainNodeIds"],
      message: "At least one affected brain node is required."
    });
  }

  if (value.communicationMessageIds.length === 0 && value.externalEvidenceRefs.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["externalEvidenceRefs"],
      message: "A proposal must include source message ids or explicit external evidence refs."
    });
  }
});
