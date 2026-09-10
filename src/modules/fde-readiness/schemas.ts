import { z } from "zod";

export const fdeReadinessParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const fdeTraceParamsSchema = fdeReadinessParamsSchema.extend({
  traceId: z.string().uuid()
});

export const safeToTouchFileQuerySchema = z.object({
  filePath: z.string().trim().min(1).max(1000)
});

export const fdeFindingQuerySchema = z.object({
  status: z.string().trim().min(1).max(80).optional(),
  severity: z.string().trim().min(1).max(80).optional(),
  targetKind: z.string().trim().min(1).max(80).optional(),
  targetRef: z.string().trim().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const rationaleTraceInputSchema = z.object({
  anchorType: z.enum(["file", "module", "route", "api", "pr", "branch", "decision", "product_brain_node", "live_doc_section", "claim"]),
  anchorRef: z.string().trim().min(1).max(1000),
  includeWeakSemantic: z.boolean().default(false)
});

export const decisionEngineeringLinkInputSchema = z.object({
  decisionId: z.string().uuid(),
  targetType: z.enum(["file", "module", "route", "branch", "pull_request", "product_brain_node", "live_doc_section", "document_section", "agent_run", "manual"]),
  targetRef: z.string().trim().min(1).max(1000),
  relationshipType: z.enum([
    "implements_decision",
    "influenced_by_decision",
    "supersedes_prior_approach",
    "rejected_alternative",
    "decision_context",
    "possible_related",
    "manual_linked"
  ]),
  confidence: z.enum(["exact_link", "strong_semantic", "weak_semantic", "manual_linked", "unverified"]).default("manual_linked"),
  evidenceIds: z.array(z.string().uuid()).max(100).default([]),
  citations: z.array(z.record(z.unknown())).max(50).default([]),
  openTargets: z.array(z.record(z.unknown())).max(50).default([]),
  limitations: z.array(z.string().trim().max(1000)).max(50).default([]),
  metadata: z.record(z.unknown()).default({})
});

export type FdeFindingQuery = z.infer<typeof fdeFindingQuerySchema>;
export type RationaleTraceInput = z.infer<typeof rationaleTraceInputSchema>;
export type DecisionEngineeringLinkInput = z.infer<typeof decisionEngineeringLinkInputSchema>;
