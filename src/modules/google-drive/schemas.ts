import { z } from "zod";

const uuidSchema = z.string().uuid();

export const googleDriveProjectParamsSchema = z.object({
  projectId: uuidSchema
});

export const googleDriveFileListQuerySchema = z.object({
  status: z.enum(["pending", "indexed", "failed", "skipped", "unsupported"]).optional(),
  mimeType: z.string().trim().min(1).max(255).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().trim().min(1).optional(),
  includeUnsupported: z.coerce.boolean().optional().default(false),
  includeTrashed: z.coerce.boolean().optional().default(false)
});

export const googleDriveRootCandidateQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
  cursor: z.string().trim().min(1).optional(),
  foldersOnly: z.coerce.boolean().optional().default(false)
});

export const googleDriveConnectSchema = z.object({
  accessMode: z.enum(["full_drive", "selected_files"]).optional().default("full_drive"),
  returnTo: z.string().trim().max(400).optional()
});

export const googleDriveSyncRootsSchema = z.object({
  accessMode: z.enum(["full_drive", "selected_files"]).optional(),
  roots: z
    .array(
      z.object({
        rootType: z.enum(["all_drive", "my_drive", "shared_drive", "folder", "selected_file"]),
        googleDriveId: z.string().trim().max(255).nullable().optional(),
        googleFileId: z.string().trim().max(255).nullable().optional(),
        name: z.string().trim().min(1).max(255),
        selected: z.boolean().optional().default(true),
        includeChildren: z.boolean().optional().default(true)
      })
    )
    .min(1)
    .max(25)
    .optional()
});

export const googleDriveSyncSchema = z.object({
  syncType: z.enum(["full", "incremental", "manual"]).optional().default("manual"),
  rootId: uuidSchema.optional(),
  maxFiles: z.coerce.number().int().min(1).max(500).optional(),
  dryRun: z.boolean().optional().default(false),
  forceReindex: z.boolean().optional().default(false)
});
