-- Feature 11 Step 1: Agent Context Pack foundation
CREATE TYPE "AgentContextPackStatus" AS ENUM ('active', 'archived', 'deleted', 'failed');
CREATE TYPE "AgentContextPackTaskType" AS ENUM ('implementation', 'review', 'test_writing', 'planning', 'debugging', 'documentation', 'handoff', 'other');
CREATE TYPE "AgentContextPackSourceMode" AS ENUM ('task_prompt', 'product_brain_node', 'product_brain_area', 'live_doc_section', 'coding_requirement', 'diagram', 'document_section', 'manual_context', 'responsibility_or_task', 'other');
CREATE TYPE "AgentContextPackBudgetPreset" AS ENUM ('compact', 'normal', 'detailed');
CREATE TYPE "AgentContextPackVisibility" AS ENUM ('internal', 'redacted');
CREATE TYPE "AgentContextEvidenceStatus" AS ENUM ('original_source', 'current_accepted_truth', 'accepted_change', 'accepted_decision', 'communication_evidence', 'transcript_evidence', 'manual_context', 'derived_artifact', 'diagram', 'coding_requirement', 'responsibility_task', 'dashboard_signal', 'pending_suggestion', 'limitation');

CREATE TABLE "agent_context_packs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID,
  "refreshed_by_user_id" UUID,
  "title" TEXT NOT NULL,
  "task_prompt" TEXT NOT NULL,
  "task_type" "AgentContextPackTaskType" NOT NULL,
  "target_agent_json" JSONB,
  "source_mode" "AgentContextPackSourceMode" NOT NULL,
  "seed_ref_json" JSONB,
  "status" "AgentContextPackStatus" NOT NULL DEFAULT 'active',
  "visibility" "AgentContextPackVisibility" NOT NULL DEFAULT 'internal',
  "budget_preset" "AgentContextPackBudgetPreset" NOT NULL DEFAULT 'normal',
  "max_token_budget" INTEGER,
  "token_estimate" INTEGER NOT NULL,
  "token_estimate_method" TEXT NOT NULL,
  "source_count" INTEGER NOT NULL,
  "evidence_count" INTEGER NOT NULL,
  "citation_count" INTEGER NOT NULL,
  "open_target_count" INTEGER NOT NULL,
  "product_brain_version_id" UUID,
  "live_doc_version_id" UUID,
  "document_version_id" UUID,
  "artifact_version_id" UUID,
  "sections_json" JSONB NOT NULL,
  "body_markdown" TEXT NOT NULL,
  "limitations_json" JSONB NOT NULL,
  "warnings_json" JSONB NOT NULL,
  "errors_json" JSONB,
  "generated_at" TIMESTAMPTZ(6) NOT NULL,
  "refreshed_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_context_packs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_context_pack_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "pack_id" UUID NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_ref_type" TEXT NOT NULL,
  "source_ref_id" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "excerpt" TEXT,
  "summary" TEXT,
  "why_it_matters" TEXT,
  "citation_json" JSONB,
  "open_target_json" JSONB,
  "evidence_status" "AgentContextEvidenceStatus" NOT NULL,
  "confidence" DOUBLE PRECISION,
  "sort_order" INTEGER NOT NULL,
  "visibility" "AgentContextPackVisibility" NOT NULL DEFAULT 'internal',
  "provider" TEXT,
  "source_domain" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_context_pack_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agent_context_pack_sources_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "agent_context_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "agent_context_packs_org_id_project_id_status_updated_at_idx" ON "agent_context_packs"("org_id", "project_id", "status", "updated_at");
CREATE INDEX "agent_context_packs_project_id_created_at_idx" ON "agent_context_packs"("project_id", "created_at");
CREATE INDEX "agent_context_pack_sources_org_id_project_id_idx" ON "agent_context_pack_sources"("org_id", "project_id");
CREATE INDEX "agent_context_pack_sources_pack_id_sort_order_idx" ON "agent_context_pack_sources"("pack_id", "sort_order");
CREATE INDEX "agent_context_pack_sources_project_id_source_ref_type_source_ref_id_idx" ON "agent_context_pack_sources"("project_id", "source_ref_type", "source_ref_id");
