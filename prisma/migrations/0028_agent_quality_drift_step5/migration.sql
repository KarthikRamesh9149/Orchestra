-- Feature 11 Step 5: Agent Quality and Drift Detection.
-- Additive only: creates review enums/table for deterministic quality/drift reports.

ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'agent_quality_review';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'agent_quality_review';

CREATE TYPE "AgentQualityReviewStatus" AS ENUM ('queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'archived');

CREATE TYPE "AgentQualityReviewType" AS ENUM ('context_pack_quality', 'agent_run_review');

CREATE TYPE "AgentQualityScoreLabel" AS ENUM ('excellent', 'good', 'usable_with_warnings', 'needs_improvement', 'unsafe_or_blocked');

CREATE TYPE "AgentQualityRecommendation" AS ENUM ('looks_aligned', 'aligned_with_warnings', 'needs_human_review', 'needs_follow_up', 'possible_drift', 'blocked_by_missing_evidence', 'unsafe_or_noncompliant');

CREATE TABLE "agent_quality_reviews" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "context_pack_id" UUID,
  "agent_run_id" UUID,
  "export_ref_json" JSONB,
  "created_by_user_id" UUID NOT NULL,
  "archived_by_user_id" UUID,
  "review_type" "AgentQualityReviewType" NOT NULL,
  "review_mode" TEXT NOT NULL DEFAULT 'deterministic',
  "status" "AgentQualityReviewStatus" NOT NULL DEFAULT 'completed',
  "overall_score" DOUBLE PRECISION NOT NULL,
  "score_label" "AgentQualityScoreLabel" NOT NULL,
  "recommendation" "AgentQualityRecommendation" NOT NULL,
  "readiness_to_export" BOOLEAN,
  "needs_follow_up" BOOLEAN NOT NULL DEFAULT false,
  "high_severity_finding_count" INTEGER NOT NULL DEFAULT 0,
  "critical_finding_count" INTEGER NOT NULL DEFAULT 0,
  "summary" TEXT NOT NULL,
  "input_summary" TEXT,
  "scores_json" JSONB NOT NULL,
  "findings_json" JSONB NOT NULL,
  "matched_requirements_json" JSONB NOT NULL,
  "missing_requirements_json" JSONB NOT NULL,
  "hallucinated_assumptions_json" JSONB NOT NULL,
  "drift_findings_json" JSONB NOT NULL,
  "risk_findings_json" JSONB NOT NULL,
  "test_gaps_json" JSONB NOT NULL,
  "docs_gaps_json" JSONB NOT NULL,
  "open_questions_json" JSONB NOT NULL,
  "carry_forward_notes_json" JSONB NOT NULL,
  "citations_json" JSONB NOT NULL,
  "open_targets_json" JSONB NOT NULL,
  "limitations_json" JSONB NOT NULL,
  "warnings_json" JSONB NOT NULL,
  "model_metadata_json" JSONB,
  "fallback_metadata_json" JSONB,
  "indexed_for_socrates" BOOLEAN NOT NULL DEFAULT true,
  "indexed_at" TIMESTAMPTZ(6),
  "retrieval_summary" TEXT,
  "archived_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_quality_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_quality_reviews_org_id_project_id_review_type_status_created_at_idx" ON "agent_quality_reviews"("org_id", "project_id", "review_type", "status", "created_at");
CREATE INDEX "agent_quality_reviews_project_id_context_pack_id_review_type_created_at_idx" ON "agent_quality_reviews"("project_id", "context_pack_id", "review_type", "created_at");
CREATE INDEX "agent_quality_reviews_project_id_agent_run_id_review_type_created_at_idx" ON "agent_quality_reviews"("project_id", "agent_run_id", "review_type", "created_at");
CREATE INDEX "agent_quality_reviews_project_id_score_label_created_at_idx" ON "agent_quality_reviews"("project_id", "score_label", "created_at");
CREATE INDEX "agent_quality_reviews_project_id_needs_follow_up_created_at_idx" ON "agent_quality_reviews"("project_id", "needs_follow_up", "created_at");
