import { z } from "zod";

export const engineeringEvidenceParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const engineeringEvidenceItemParamsSchema = engineeringEvidenceParamsSchema.extend({
  evidenceId: z.string().uuid()
});

export const listEngineeringEvidenceQuerySchema = z.object({
  sourceType: z.string().min(1).max(80).optional(),
  sourceSubType: z.string().min(1).max(80).optional(),
  provider: z.string().min(1).max(80).optional(),
  status: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const refreshEngineeringEvidenceSchema = z.object({
  sourceTypes: z.array(z.enum(["github", "agent_run", "route_registry", "manual"])).max(10).default(["github", "agent_run", "route_registry"])
});

export const manualEngineeringEvidenceSchema = z.object({
  entryType: z.enum(["mock_real", "integration_seam", "branch_deploy_truth", "todo_fixme", "general"]),
  targetKind: z.string().min(1).max(120),
  targetRef: z.string().max(500).optional().nullable(),
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().max(4000).optional().nullable(),
  status: z.string().trim().min(1).max(120),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  severity: z.enum(["info", "low", "medium", "high", "critical"]).optional().nullable(),
  citations: z.array(z.record(z.unknown())).max(25).default([]),
  openTargets: z.array(z.record(z.unknown())).max(25).default([]),
  metadata: z.record(z.unknown()).default({})
});

export type RefreshEngineeringEvidenceInput = z.infer<typeof refreshEngineeringEvidenceSchema>;
export type ListEngineeringEvidenceQuery = z.infer<typeof listEngineeringEvidenceQuerySchema>;
export type ManualEngineeringEvidenceInput = z.input<typeof manualEngineeringEvidenceSchema>;
