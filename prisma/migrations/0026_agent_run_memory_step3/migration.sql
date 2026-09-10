-- Feature 11 Step 3: Agent Run Memory
ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'agent_run';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'agent_run';

CREATE TYPE "AgentRunStatus" AS ENUM ('planned', 'context_generated', 'sent_to_agent', 'running', 'completed', 'human_reviewed', 'accepted', 'rejected', 'needs_follow_up', 'failed', 'archived', 'deleted');
CREATE TYPE "AgentRunTaskType" AS ENUM ('implementation', 'review', 'test_writing', 'planning', 'debugging', 'documentation', 'refactor', 'handoff', 'research', 'other');
CREATE TYPE "AgentRunPromptSource" AS ENUM ('context_pack', 'export', 'manually_pasted', 'external');
CREATE TYPE "AgentRunReviewResult" AS ENUM ('unreviewed', 'accepted', 'rejected', 'needs_follow_up', 'failed');

CREATE TABLE "agent_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "context_pack_id" UUID,
  "context_pack_generated_at" TIMESTAMPTZ(6),
  "export_ref_json" JSONB,
  "export_format" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "reviewed_by_user_id" UUID,
  "target_agent_json" JSONB,
  "provider" TEXT,
  "agent_label" TEXT,
  "task_title" TEXT NOT NULL,
  "task_type" "AgentRunTaskType" NOT NULL,
  "task_description" TEXT,
  "prompt_source" "AgentRunPromptSource" NOT NULL DEFAULT 'manually_pasted',
  "prompt_sent" TEXT,
  "prompt_hash" TEXT,
  "status" "AgentRunStatus" NOT NULL DEFAULT 'planned',
  "output_summary" TEXT,
  "full_output" TEXT,
  "implementation_notes" TEXT,
  "branch_name" TEXT,
  "commit_sha" TEXT,
  "pr_url" TEXT,
  "files_changed_json" JSONB NOT NULL,
  "modules_touched_json" JSONB NOT NULL,
  "tests_run_json" JSONB NOT NULL,
  "test_status" TEXT,
  "docs_updated_json" JSONB NOT NULL,
  "risks_found_json" JSONB NOT NULL,
  "follow_up_questions_json" JSONB NOT NULL,
  "human_review_result" "AgentRunReviewResult" NOT NULL DEFAULT 'unreviewed',
  "human_review_notes" TEXT,
  "possible_product_brain_implications" BOOLEAN NOT NULL DEFAULT false,
  "product_brain_implications_json" JSONB,
  "limitations_json" JSONB NOT NULL,
  "warnings_json" JSONB NOT NULL,
  "unverified_claims" BOOLEAN NOT NULL DEFAULT true,
  "requires_human_review" BOOLEAN NOT NULL DEFAULT true,
  "visibility" "AgentContextPackVisibility" NOT NULL DEFAULT 'internal',
  "indexed_for_socrates" BOOLEAN NOT NULL DEFAULT true,
  "indexed_at" TIMESTAMPTZ(6),
  "retrieval_summary" TEXT,
  "citation_json" JSONB,
  "open_target_json" JSONB,
  "reviewed_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_runs_org_id_project_id_status_updated_at_idx" ON "agent_runs"("org_id", "project_id", "status", "updated_at");
CREATE INDEX "agent_runs_project_id_context_pack_id_created_at_idx" ON "agent_runs"("project_id", "context_pack_id", "created_at");
CREATE INDEX "agent_runs_project_id_provider_created_at_idx" ON "agent_runs"("project_id", "provider", "created_at");
CREATE INDEX "agent_runs_project_id_task_type_created_at_idx" ON "agent_runs"("project_id", "task_type", "created_at");
CREATE INDEX "agent_runs_project_id_human_review_result_reviewed_at_idx" ON "agent_runs"("project_id", "human_review_result", "reviewed_at");
CREATE INDEX "agent_runs_project_id_branch_name_idx" ON "agent_runs"("project_id", "branch_name");
