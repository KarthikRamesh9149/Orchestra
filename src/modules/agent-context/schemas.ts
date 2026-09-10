import { z } from "zod";

const unsafeTextPattern =
  /<\s*script\b|<\/\s*script\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|javascript\s*:|data\s*:|vbscript\s*:|sk-[A-Za-z0-9_-]{12,}|xox[abprs]-[A-Za-z0-9-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|mcp_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|postgresql:\/\/\S+:\S+@\S+|OPENAI_API_KEY\s*=|ANTHROPIC_API_KEY\s*=|FIREFLIES_API_KEY\s*=|JWT_ACCESS_SECRET\s*=|JWT_REFRESH_SECRET\s*=|CLIENT_SHARE_TOKEN_SECRET\s*=|DATABASE_URL\s*=|SUPABASE_SERVICE_ROLE_KEY\s*=|SUPABASE_ANON_KEY\s*=|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/i;

const safeText = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !unsafeTextPattern.test(value), { message: `${label} contains unsafe content` });

export const agentContextTaskTypeSchema = z.enum([
  "implementation",
  "review",
  "test_writing",
  "planning",
  "debugging",
  "documentation",
  "handoff",
  "other"
]);

export const agentContextSourceModeSchema = z.enum([
  "task_prompt",
  "product_brain_node",
  "product_brain_area",
  "live_doc_section",
  "coding_requirement",
  "diagram",
  "document_section",
  "manual_context",
  "responsibility_or_task",
  "other"
]);

export const agentContextBudgetPresetSchema = z.enum(["compact", "normal", "detailed"]);
export const agentContextVisibilitySchema = z.enum(["internal", "redacted"]);
export const agentContextExportFormatSchema = z.enum([
  "markdown",
  "claude_prompt",
  "codex_prompt",
  "cursor_context",
  "agents_md",
  "json",
  "github_issue",
  "github_pr_brief"
]);
export const agentContextExportRedactionModeSchema = z.enum(["internal", "implementation_only", "client_safe"]);
export const agentRunStatusSchema = z.enum([
  "planned",
  "context_generated",
  "sent_to_agent",
  "running",
  "completed",
  "human_reviewed",
  "accepted",
  "rejected",
  "needs_follow_up",
  "failed"
]);
export const agentRunExecutionStatusSchema = z.enum([
  "planned",
  "context_generated",
  "sent_to_agent",
  "running",
  "completed",
  "failed"
]);
export const agentRunTaskTypeSchema = z.enum([
  "implementation",
  "review",
  "test_writing",
  "planning",
  "debugging",
  "documentation",
  "refactor",
  "handoff",
  "research",
  "other"
]);
export const agentRunPromptSourceSchema = z.enum(["context_pack", "export", "manually_pasted", "external"]);
export const agentRunReviewResultSchema = z.enum(["accepted", "rejected", "needs_follow_up", "failed"]);
export const agentQualityReviewModeSchema = z.enum(["deterministic", "ai_assisted"]).default("deterministic");
export const agentQualityReviewStatusSchema = z.enum(["completed", "completed_with_warnings", "failed", "archived"]);
export const agentQualityReviewTypeSchema = z.enum(["context_pack_quality", "agent_run_review"]);

const agentRunText = (max: number) => z.string().trim().min(1).max(max);
const optionalAgentRunText = (max: number) => z.string().trim().max(max).optional().nullable();
const stringList = (label: string, maxItem = 500, maxItems = 100) => z.array(safeText(label, 1, maxItem)).max(maxItems).default([]);
const exportReferenceSchema = z
  .object({
    format: agentContextExportFormatSchema.optional(),
    generatedAt: safeText("export generated at", 1, 80).optional(),
    suggestedFilename: safeText("export suggested filename", 1, 160).optional(),
    contentHash: safeText("export content hash", 1, 160).optional()
  })
  .strict();

export const agentContextSeedReferenceSchema = z.object({
  type: z
    .enum([
      "product_brain",
      "brain_node",
      "live_doc_section",
      "coding_requirement",
      "diagram",
      "document_section",
      "manual_context",
      "responsibility",
      "change_proposal",
      "decision_record",
      "dashboard",
      "other"
    ])
    .or(safeText("seed reference type", 2, 80)),
  id: safeText("seed reference id", 1, 180),
  label: safeText("seed reference label", 1, 160).optional()
});

export const createAgentContextPackSchema = z.object({
  title: safeText("title", 2, 200).optional(),
  taskPrompt: safeText("task prompt", 4, 6000),
  taskType: agentContextTaskTypeSchema,
  sourceMode: agentContextSourceModeSchema,
  seedReference: agentContextSeedReferenceSchema.optional(),
  targetAgent: z
    .object({
      name: safeText("target agent name", 1, 120).optional(),
      kind: z.enum(["claude", "codex", "cursor", "github_agent", "other"]).optional()
    })
    .strict()
    .optional(),
  budgetPreset: agentContextBudgetPresetSchema.default("normal"),
  maxTokenBudget: z.number().int().min(500).max(60_000).optional(),
  visibility: agentContextVisibilitySchema.default("internal"),
  includeEvidenceDomains: z.array(safeText("include evidence domain", 1, 80)).max(20).optional(),
  excludeEvidenceDomains: z.array(safeText("exclude evidence domain", 1, 80)).max(20).optional()
});

export const listAgentContextPacksQuerySchema = z.object({
  status: z.enum(["active", "archived", "deleted", "failed"]).optional(),
  taskType: agentContextTaskTypeSchema.optional(),
  sourceMode: agentContextSourceModeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const projectAgentContextParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const agentContextPackParamsSchema = projectAgentContextParamsSchema.extend({
  packId: z.string().uuid()
});

export const agentContextExportRequestSchema = z.object({
  format: agentContextExportFormatSchema,
  budgetPreset: agentContextBudgetPresetSchema.default("normal"),
  redactionMode: agentContextExportRedactionModeSchema.default("internal"),
  titleOverride: safeText("title override", 2, 200).optional(),
  targetFilename: safeText("target filename", 1, 160).optional(),
  includeEvidenceDomains: z.array(safeText("include evidence domain", 1, 80)).max(20).optional(),
  excludeEvidenceDomains: z.array(safeText("exclude evidence domain", 1, 80)).max(20).optional(),
  includeCitations: z.boolean().default(true),
  includeOpenTargets: z.boolean().default(true),
  includeLimitations: z.boolean().default(true)
});

export const createAgentRunSchema = z.object({
  contextPackId: z.string().uuid().optional(),
  exportReference: exportReferenceSchema.optional(),
  exportFormat: agentContextExportFormatSchema.optional(),
  targetAgent: z
    .object({
      name: safeText("agent name", 1, 120).optional(),
      kind: z.enum(["claude", "codex", "cursor", "github_agent", "copilot", "other"]).optional()
    })
    .strict()
    .optional(),
  provider: safeText("provider", 1, 80).optional(),
  agentLabel: safeText("agent label", 1, 160).optional(),
  taskTitle: safeText("task title", 2, 200),
  taskType: agentRunTaskTypeSchema,
  taskDescription: optionalAgentRunText(4000),
  promptSource: agentRunPromptSourceSchema.default("manually_pasted"),
  promptSent: optionalAgentRunText(60000),
  status: agentRunExecutionStatusSchema.default("planned"),
  outputSummary: optionalAgentRunText(8000),
  fullOutput: optionalAgentRunText(120000),
  implementationNotes: optionalAgentRunText(12000),
  branchName: safeText("branch name", 1, 200).optional(),
  commitSha: z.string().trim().regex(/^[a-f0-9]{7,64}$/i).optional(),
  prUrl: z.string().trim().url().refine((value) => value.startsWith("https://"), "PR URL must be HTTPS").optional(),
  filesChanged: stringList("file changed", 400, 200),
  modulesTouched: stringList("module touched", 200, 80),
  testsRun: stringList("test run", 500, 100),
  testStatus: z.enum(["not_run", "passed", "failed", "partial", "unknown"]).optional(),
  docsUpdated: stringList("doc updated", 400, 100),
  risksFound: stringList("risk found", 1000, 100),
  followUpQuestions: stringList("follow-up question", 1000, 100),
  possibleProductBrainImplications: z.boolean().default(false),
  productBrainImplications: z.array(agentRunText(1000)).max(100).default([]),
  limitations: z.array(agentRunText(1000)).max(100).default([]),
  warnings: z.array(agentRunText(1000)).max(100).default([]),
  visibility: agentContextVisibilitySchema.default("internal")
});

export const updateAgentRunSchema = createAgentRunSchema.partial().omit({ status: true }).strict();

export const updateAgentRunStatusSchema = z.object({
  status: agentRunExecutionStatusSchema,
  note: optionalAgentRunText(2000)
});

export const reviewAgentRunSchema = z.object({
  reviewResult: agentRunReviewResultSchema,
  humanReviewNotes: optionalAgentRunText(8000),
  possibleProductBrainImplications: z.boolean().optional(),
  productBrainImplications: z.array(agentRunText(1000)).max(100).optional()
});

export const listAgentRunsQuerySchema = z.object({
  status: z
    .enum([
      "planned",
      "context_generated",
      "sent_to_agent",
      "running",
      "completed",
      "human_reviewed",
      "accepted",
      "rejected",
      "needs_follow_up",
      "failed",
      "archived",
      "deleted"
    ])
    .optional(),
  provider: safeText("provider", 1, 80).optional(),
  taskType: agentRunTaskTypeSchema.optional(),
  contextPackId: z.string().uuid().optional(),
  createdByUserId: z.string().uuid().optional(),
  reviewState: z.enum(["unreviewed", "accepted", "rejected", "needs_follow_up", "failed"]).optional(),
  needsFollowUp: z.coerce.boolean().optional(),
  branchName: safeText("branch name", 1, 200).optional(),
  hasPrUrl: z.coerce.boolean().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const agentRunParamsSchema = projectAgentContextParamsSchema.extend({
  runId: z.string().uuid()
});

export const agentQualityReviewParamsSchema = projectAgentContextParamsSchema.extend({
  reviewId: z.string().uuid()
});

export const createQualityReviewSchema = z.object({
  reviewMode: agentQualityReviewModeSchema,
  forceRefresh: z.boolean().default(false),
  includeEvidence: z.boolean().default(true),
  includeCitations: z.boolean().default(true),
  includeOpenTargets: z.boolean().default(true),
  deterministicOnly: z.boolean().default(true),
  includeLowConfidenceFindings: z.boolean().default(true)
});

export const listQualityReviewsQuerySchema = z.object({
  status: agentQualityReviewStatusSchema.optional(),
  reviewType: agentQualityReviewTypeSchema.optional(),
  scoreLabel: z.enum(["excellent", "good", "usable_with_warnings", "needs_improvement", "unsafe_or_blocked"]).optional(),
  needsFollowUp: z.coerce.boolean().optional(),
  includeArchived: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

export const listReviewFindingsQuerySchema = z.object({
  severity: z.enum(["info", "low", "medium", "high", "critical"]).optional(),
  type: safeText("finding type", 1, 80).optional(),
  includeLowConfidence: z.coerce.boolean().default(true)
});

export type CreateAgentContextPackInput = z.infer<typeof createAgentContextPackSchema>;
export type ListAgentContextPacksQuery = z.infer<typeof listAgentContextPacksQuerySchema>;
export type AgentContextExportRequestInput = z.infer<typeof agentContextExportRequestSchema>;
export type CreateAgentRunInput = z.infer<typeof createAgentRunSchema>;
export type UpdateAgentRunInput = z.infer<typeof updateAgentRunSchema>;
export type UpdateAgentRunStatusInput = z.infer<typeof updateAgentRunStatusSchema>;
export type ReviewAgentRunInput = z.infer<typeof reviewAgentRunSchema>;
export type ListAgentRunsQuery = z.infer<typeof listAgentRunsQuerySchema>;
export type CreateQualityReviewInput = z.infer<typeof createQualityReviewSchema>;
export type ListQualityReviewsQuery = z.infer<typeof listQualityReviewsQuerySchema>;
export type ListReviewFindingsQuery = z.infer<typeof listReviewFindingsQuerySchema>;
