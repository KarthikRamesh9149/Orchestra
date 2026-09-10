import { z } from "zod";

export const githubInstallationIdParamsSchema = z.object({
  installationId: z.string().uuid()
});

export const projectGithubParamsSchema = z.object({
  projectId: z.string().uuid()
});

export const projectGithubRepositoryParamsSchema = z.object({
  projectId: z.string().uuid(),
  repoLinkId: z.string().uuid()
});

export const githubCallbackQuerySchema = z.object({
  installation_id: z.string().min(1).max(100),
  setup_action: z.string().min(1).max(100).optional(),
  state: z.string().min(1).max(4096).optional()
});

export const githubUserCallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(4096).optional(),
  github_user_id: z.string().min(1).max(100).optional(),
  github_login: z.string().min(1).max(100).optional(),
  github_avatar_url: z.string().url().max(2048).optional(),
  github_email: z.string().email().optional()
});

export const linkGithubRepositorySchema = z.object({
  installationId: z.string().uuid().optional(),
  githubInstallationId: z.string().min(1).optional(),
  githubRepositoryId: z.string().min(1),
  owner: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  fullName: z.string().min(1).max(220).optional(),
  defaultBranch: z.string().min(1).max(255).optional(),
  private: z.boolean().default(false),
  fork: z.boolean().default(false),
  htmlUrl: z.string().url().optional()
}).refine((value) => value.installationId || value.githubInstallationId, {
  path: ["installationId"],
  message: "installationId or githubInstallationId is required"
});

export const backfillGithubSchema = z.object({
  repoLinkId: z.string().uuid().optional(),
  dryRun: z.boolean().default(true),
  mode: z.enum(["repository_metadata", "incremental", "full"]).default("repository_metadata")
});

export const syncRunQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25)
});
