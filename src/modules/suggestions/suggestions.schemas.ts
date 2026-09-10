import { z } from "zod";

export const suggestionProjectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const suggestionParamsSchema = suggestionProjectParamsSchema.extend({
  suggestionId: z.string().trim().min(8).max(120)
});

export const suggestionListQuerySchema = z.object({
  category: z
    .enum([
      "merge_conflicts",
      "spec_drift",
      "stalled_work",
      "reviewer_suggestions",
      "risk_flags",
      "decision_conflicts",
      "ownership_gaps",
      "coverage_gaps"
    ])
    .optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["active", "dismissed", "converted_to_timeline", "converted_to_review", "resolved", "superseded"]).optional(),
  source: z.string().trim().max(80).optional(),
  includeDismissed: z.coerce.boolean().optional().default(false),
  refresh: z.coerce.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(1000).optional().default(0)
});

export const suggestionActionBodySchema = z.object({
  note: z.string().trim().max(1000).optional()
});

export type SuggestionListQuery = z.infer<typeof suggestionListQuerySchema>;
