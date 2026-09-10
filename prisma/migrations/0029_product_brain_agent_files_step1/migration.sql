-- Feature 12 Step 1: Product Brain Agent Files foundation.
-- Additive only: creates internal metadata/version tables for generated Markdown projections.

CREATE TYPE "AgentMarkdownBranchProfile" AS ENUM ('main', 'mvp-v0', 'custom');
CREATE TYPE "AgentMarkdownFileSetStatus" AS ENUM ('active', 'archived');
CREATE TYPE "AgentMarkdownFileKind" AS ENUM (
  'agents',
  'root_context',
  'product_brain',
  'coding_requirements',
  'open_questions',
  'agent_memory',
  'drift_and_review',
  'custom'
);
CREATE TYPE "AgentMarkdownFileStatus" AS ENUM ('active', 'archived');
CREATE TYPE "AgentMarkdownFileVersionStatus" AS ENUM ('generated', 'archived');
CREATE TYPE "AgentMarkdownSyncMode" AS ENUM ('preview', 'generate', 'future_download', 'future_local_cli', 'future_github_pr');
CREATE TYPE "AgentMarkdownSyncStatus" AS ENUM ('running', 'completed', 'completed_with_warnings', 'failed');

CREATE TABLE "agent_markdown_file_sets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "repo_owner" TEXT,
  "repo_name" TEXT,
  "target_branch" TEXT NOT NULL,
  "branch_profile" "AgentMarkdownBranchProfile" NOT NULL,
  "status" "AgentMarkdownFileSetStatus" NOT NULL DEFAULT 'active',
  "visibility" "AgentContextPackVisibility" NOT NULL DEFAULT 'internal',
  "redaction_mode" TEXT NOT NULL DEFAULT 'internal',
  "source_domains_json" JSONB NOT NULL DEFAULT '[]',
  "default_template_version" TEXT NOT NULL DEFAULT 'feature12-step1-v1',
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_markdown_file_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_markdown_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "file_set_id" UUID NOT NULL,
  "file_path" TEXT NOT NULL,
  "file_kind" "AgentMarkdownFileKind" NOT NULL,
  "template_key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "AgentMarkdownFileStatus" NOT NULL DEFAULT 'active',
  "source_domains_json" JSONB NOT NULL DEFAULT '[]',
  "generation_order" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_markdown_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_markdown_file_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "file_set_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "content_markdown" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "generated_from_product_brain_version_id" UUID,
  "generated_from_live_doc_version_id" UUID,
  "generated_from_document_version_ids_json" JSONB NOT NULL DEFAULT '[]',
  "generated_from_artifact_version_ids_json" JSONB NOT NULL DEFAULT '[]',
  "context_pack_ids_json" JSONB NOT NULL DEFAULT '[]',
  "agent_run_cutoff_at" TIMESTAMPTZ(6),
  "review_cutoff_at" TIMESTAMPTZ(6),
  "source_refs_json" JSONB NOT NULL DEFAULT '[]',
  "citations_json" JSONB NOT NULL DEFAULT '[]',
  "open_targets_json" JSONB NOT NULL DEFAULT '[]',
  "limitations_json" JSONB NOT NULL DEFAULT '[]',
  "warnings_json" JSONB NOT NULL DEFAULT '[]',
  "stale_reasons_json" JSONB NOT NULL DEFAULT '[]',
  "status" "AgentMarkdownFileVersionStatus" NOT NULL DEFAULT 'generated',
  "generated_by_user_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_markdown_file_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_markdown_sync_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "file_set_id" UUID NOT NULL,
  "mode" "AgentMarkdownSyncMode" NOT NULL,
  "status" "AgentMarkdownSyncStatus" NOT NULL DEFAULT 'running',
  "summary_json" JSONB NOT NULL DEFAULT '{}',
  "changed_files_json" JSONB NOT NULL DEFAULT '[]',
  "warnings_json" JSONB NOT NULL DEFAULT '[]',
  "limitations_json" JSONB NOT NULL DEFAULT '[]',
  "created_by_user_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_markdown_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "amf_file_set_path_key" ON "agent_markdown_files"("file_set_id", "file_path");
CREATE UNIQUE INDEX "amfv_file_version_key" ON "agent_markdown_file_versions"("file_id", "version_number");

CREATE INDEX "amfs_org_project_status_updated_idx" ON "agent_markdown_file_sets"("org_id", "project_id", "status", "updated_at");
CREATE INDEX "amfs_project_profile_branch_idx" ON "agent_markdown_file_sets"("project_id", "branch_profile", "target_branch");
CREATE INDEX "amf_org_project_status_idx" ON "agent_markdown_files"("org_id", "project_id", "status");
CREATE INDEX "amf_project_kind_idx" ON "agent_markdown_files"("project_id", "file_kind");
CREATE INDEX "amfv_org_project_generated_idx" ON "agent_markdown_file_versions"("org_id", "project_id", "generated_at");
CREATE INDEX "amfv_project_set_generated_idx" ON "agent_markdown_file_versions"("project_id", "file_set_id", "generated_at");
CREATE INDEX "amfv_project_hash_idx" ON "agent_markdown_file_versions"("project_id", "content_hash");
CREATE INDEX "amsr_org_project_status_created_idx" ON "agent_markdown_sync_runs"("org_id", "project_id", "status", "created_at");
CREATE INDEX "amsr_project_set_created_idx" ON "agent_markdown_sync_runs"("project_id", "file_set_id", "created_at");

ALTER TABLE "agent_markdown_files"
  ADD CONSTRAINT "agent_markdown_files_file_set_id_fkey"
  FOREIGN KEY ("file_set_id") REFERENCES "agent_markdown_file_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_markdown_file_versions"
  ADD CONSTRAINT "agent_markdown_file_versions_file_set_id_fkey"
  FOREIGN KEY ("file_set_id") REFERENCES "agent_markdown_file_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_markdown_file_versions"
  ADD CONSTRAINT "agent_markdown_file_versions_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "agent_markdown_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_markdown_sync_runs"
  ADD CONSTRAINT "agent_markdown_sync_runs_file_set_id_fkey"
  FOREIGN KEY ("file_set_id") REFERENCES "agent_markdown_file_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
