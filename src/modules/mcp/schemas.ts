import { z } from "zod";

const safeTextPattern =
  /<\s*script\b|<\/\s*script\b|javascript\s*:|data\s*:|vbscript\s*:|sk-[A-Za-z0-9_-]{12,}|xox[abprs]-[A-Za-z0-9-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|mcp_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|postgresql:\/\/\S+:\S+@\S+|OPENAI_API_KEY\s*=|ANTHROPIC_API_KEY\s*=|FIREFLIES_API_KEY\s*=|JWT_ACCESS_SECRET\s*=|JWT_REFRESH_SECRET\s*=|CLIENT_SHARE_TOKEN_SECRET\s*=|DATABASE_URL\s*=|SUPABASE_SERVICE_ROLE_KEY\s*=|SUPABASE_ANON_KEY\s*=|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/i;

const safeText = (label: string, min = 1, max = 500) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !safeTextPattern.test(value), { message: `${label} contains unsafe content` });

export const mcpTokenModeSchema = z.enum(["local_dev", "team_internal", "client_safe_future"]);

export const mcpToolNameSchema = z.enum([
  "orchestra.list_projects",
  "orchestra.search_project_context",
  "orchestra.get_product_brain",
  "orchestra.get_live_doc",
  "orchestra.get_live_doc_section",
  "orchestra.get_document_section",
  "orchestra.get_coding_requirements",
  "orchestra.get_diagrams",
  "orchestra.get_responsibilities",
  "orchestra.list_context_packs",
  "orchestra.get_context_pack",
  "orchestra.list_agent_runs",
  "orchestra.get_agent_run",
  "orchestra.list_agent_quality_reviews",
  "orchestra.get_agent_quality_review",
  "orchestra.get_project_review_pressure",
  "orchestra.list_agent_files",
  "orchestra.get_agent_file",
  "orchestra.get_agent_file_status",
  "orchestra.get_stale_agent_files",
  "orchestra.get_agent_file_quality",
  "orchestra.get_agent_file_drift",
  "orchestra.get_agent_file_sync_status",
  "orchestra.get_agent_file_github_readiness",
  "orchestra.refresh_agent_files",
  "orchestra.list_open_questions",
  "orchestra.list_pending_changes",
  "orchestra.get_accepted_changes",
  "orchestra.get_accepted_decisions",
  "orchestra.get_dashboard_summary",
  "orchestra.get_readiness_dashboard",
  "orchestra.get_conflict_radar",
  "orchestra.get_safe_to_touch",
  "orchestra.get_live_working_map",
  "orchestra.get_rationale_trace",
  "orchestra.resolve_open_target",
  "orchestra.record_agent_run"
]);

export const mcpPromptNameSchema = z.enum([
  "implement_feature_from_product_brain",
  "review_pr_against_product_brain",
  "write_tests_from_coding_requirements",
  "debug_with_project_context",
  "summarize_project_for_new_developer",
  "generate_frontend_integration_plan",
  "update_docs_from_accepted_changes",
  "check_implementation_assumptions",
  "continue_from_last_agent_run",
  "create_safe_implementation_brief"
]);

export const createMcpTokenSchema = z
  .object({
    label: safeText("label", 2, 120),
    mode: mcpTokenModeSchema.default("local_dev"),
    projectIds: z.array(z.string().uuid()).min(1).max(100),
    allowedTools: z.array(mcpToolNameSchema).max(50).optional(),
    allowControlledWrites: z.boolean().default(false),
    expiresAt: z.coerce.date().optional()
  })
  .strict();

export const revokeMcpTokenParamsSchema = z.object({
  tokenId: z.string().uuid()
});

export const mcpJsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.enum([
      "initialize",
      "ping",
      "notifications/initialized",
      "notifications/cancelled",
      "resources/list",
      "resources/read",
      "tools/list",
      "tools/call",
      "prompts/list",
      "prompts/get"
    ]),
    params: z.record(z.unknown()).optional().default({})
  })
  .strict();

export const mcpToolCallParamsSchema = z.object({
  name: mcpToolNameSchema,
  arguments: z.record(z.unknown()).default({})
});

export const mcpResourceReadParamsSchema = z.object({
  uri: safeText("resource uri", 1, 500)
});

export const mcpPromptGetParamsSchema = z.object({
  name: mcpPromptNameSchema,
  arguments: z.record(z.unknown()).default({})
});

export type CreateMcpTokenInput = z.infer<typeof createMcpTokenSchema>;
export type McpToolName = z.infer<typeof mcpToolNameSchema>;
export type McpPromptName = z.infer<typeof mcpPromptNameSchema>;
