import { z } from "zod";

const category = z.enum([
  "merge_conflicts",
  "spec_drift",
  "stalled_work",
  "risk_flags",
  "decision_conflicts",
  "ownership_gaps",
  "missing_evidence",
  "connector_health",
  "agent_drift",
  "safe_to_touch"
]);

export const truthInboxProjectParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const truthInboxItemParamsSchema = truthInboxProjectParamsSchema.extend({
  itemId: z.string().trim().min(5).max(320)
});

export const truthInboxActionParamsSchema = truthInboxItemParamsSchema.extend({
  action: z.enum([
    "ask_socrates",
    "assign_owner",
    "request_clarification",
    "create_review_item",
    "accept",
    "reject",
    "defer",
    "snooze",
    "dismiss",
    "promote_to_timeline"
  ])
});

export const truthInboxListQuerySchema = z.object({
  category: category.optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["active", "deferred", "snoozed", "dismissed", "resolved", "converted_to_review", "converted_to_timeline"]).optional(),
  owner: z.union([z.string().uuid(), z.literal("unassigned"), z.literal("me")]).optional(),
  source: z.enum(["suggestion", "proposal", "fde", "agent_drift", "connector"]).optional(),
  cursor: z.string().trim().min(4).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  refresh: z.coerce.boolean().default(false)
});

export const truthInboxActionBodySchema = z.object({
  assignedUserId: z.string().uuid().nullable().optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  until: z.string().datetime({ offset: true }).optional()
});

export type TruthInboxListQuery = z.infer<typeof truthInboxListQuerySchema>;
export type TruthInboxActionInput = z.infer<typeof truthInboxActionBodySchema>;
