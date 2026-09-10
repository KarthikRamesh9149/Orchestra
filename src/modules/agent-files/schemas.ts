import { z } from "zod";

const safeTextPattern =
  /<\s*script\b|<\/\s*script\b|javascript\s*:|sk-[A-Za-z0-9_-]{12,}|xox[abprs]-[A-Za-z0-9-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|mcp_[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|OPENAI_API_KEY\s*=|ANTHROPIC_API_KEY\s*=|FIREFLIES_API_KEY\s*=|DATABASE_URL\s*=|JWT_ACCESS_SECRET\s*=|JWT_REFRESH_SECRET\s*=|CLIENT_SHARE_TOKEN_SECRET\s*=|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/i;

const safeText = (label: string, min = 1, max = 200) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !safeTextPattern.test(value), { message: `${label} contains unsafe content` });

export const agentFileBranchProfileSchema = z.enum(["main", "mvp-v0", "custom"]);
export const agentFileRedactionModeSchema = z.enum(["internal", "implementation_only", "client_safe"]).default("internal");

export const projectAgentFilesParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const agentFileSetParamsSchema = projectAgentFilesParamsSchema.extend({
  fileSetId: z.string().uuid()
});

export const agentFileParamsSchema = agentFileSetParamsSchema.extend({
  fileId: z.string().uuid()
});

export const agentFileVersionParamsSchema = agentFileParamsSchema.extend({
  versionId: z.string().uuid()
});

export const agentFileSyncRunParamsSchema = agentFileSetParamsSchema.extend({
  syncRunId: z.string().uuid()
});

export const createAgentFileSetSchema = z
  .object({
    name: safeText("name", 2, 120).optional(),
    description: safeText("description", 0, 500).optional(),
    repoOwner: safeText("repoOwner", 1, 120).optional(),
    repoName: safeText("repoName", 1, 120).optional(),
    targetBranch: safeText("targetBranch", 1, 120).optional(),
    branchProfile: agentFileBranchProfileSchema.optional(),
    redactionMode: agentFileRedactionModeSchema.optional()
  })
  .strict();

export const previewAgentFileSetSchema = z
  .object({
    branchProfile: agentFileBranchProfileSchema.optional(),
    includeContent: z.boolean().default(true)
  })
  .strict()
  .default({});

export const refreshAgentFileSetSchema = z
  .object({
    branchProfile: agentFileBranchProfileSchema.optional(),
    staleOnly: z.boolean().default(false),
    fileIds: z.array(z.string().uuid()).max(20).optional()
  })
  .strict()
  .default({});

export const agentFileConflictTypeSchema = z.enum([
  "missing_markers",
  "generated_zone_modified",
  "manual_zone_parse_failed",
  "local_file_deleted",
  "local_hash_mismatch",
  "unsupported_file_path",
  "unknown"
]);

export const reportAgentFileConflictSchema = z
  .object({
    fileId: z.string().uuid(),
    conflictType: agentFileConflictTypeSchema,
    markerStatus: z.enum(["valid", "missing_markers", "manual_zone_parse_failed"]).default("missing_markers"),
    localContentHash: safeText("localContentHash", 1, 128).optional(),
    localGeneratedZoneHash: safeText("localGeneratedZoneHash", 1, 128).optional(),
    localManualZoneHash: safeText("localManualZoneHash", 1, 128).optional(),
    conflictSummary: safeText("conflictSummary", 1, 500).optional()
  })
  .strict();

export const syncRunStatusSchema = z.enum(["running", "completed", "completed_with_warnings", "failed"]);

export const createAgentFileSyncRunSchema = z
  .object({
    mode: z.enum(["download", "local_cli"]),
    status: syncRunStatusSchema.default("running"),
    summary: z.record(z.unknown()).optional(),
    changedFiles: z.array(z.record(z.unknown())).max(100).optional(),
    warnings: z.array(safeText("warning", 1, 500)).max(50).optional()
  })
  .strict();

export const updateAgentFileSyncRunSchema = z
  .object({
    status: syncRunStatusSchema,
    summary: z.record(z.unknown()).optional(),
    changedFiles: z.array(z.record(z.unknown())).max(100).optional(),
    warnings: z.array(safeText("warning", 1, 500)).max(50).optional()
  })
  .strict();

export const githubPrSyncSchema = z
  .object({
    baseBranch: safeText("baseBranch", 1, 120).optional(),
    syncBranch: safeText("syncBranch", 1, 160).optional(),
    title: safeText("title", 1, 180).optional(),
    body: safeText("body", 1, 4000).optional(),
    selectedFileIds: z.array(z.string().uuid()).max(20).optional(),
    dryRun: z.boolean().default(true),
    force: z.boolean().default(false)
  })
  .strict()
  .default({});

export const refreshQualityReportSchema = z
  .object({
    includeEvidence: z.boolean().default(false)
  })
  .strict()
  .default({});

export const refreshDriftReportSchema = z
  .object({
    includeEvidence: z.boolean().default(false),
    includeLowConfidenceFindings: z.boolean().default(true)
  })
  .strict()
  .default({});

export const listAgentFileSetsQuerySchema = z
  .object({
    includeArchived: z.coerce.boolean().default(false)
  })
  .strict();

export type CreateAgentFileSetInput = z.infer<typeof createAgentFileSetSchema>;
export type PreviewAgentFileSetInput = z.infer<typeof previewAgentFileSetSchema>;
export type RefreshAgentFileSetInput = z.infer<typeof refreshAgentFileSetSchema>;
export type ReportAgentFileConflictInput = z.infer<typeof reportAgentFileConflictSchema>;
export type SyncRunCreateInput = z.infer<typeof createAgentFileSyncRunSchema>;
export type SyncRunUpdateInput = z.infer<typeof updateAgentFileSyncRunSchema>;
export type ListAgentFileSetsQuery = z.infer<typeof listAgentFileSetsQuerySchema>;
export type GithubPrSyncInput = z.infer<typeof githubPrSyncSchema>;
export type RefreshQualityReportInput = z.infer<typeof refreshQualityReportSchema>;
export type RefreshDriftReportInput = z.infer<typeof refreshDriftReportSchema>;
