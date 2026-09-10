-- Feature 12 Step 3: Product Brain Agent Files repo sync readiness, quality, and drift reports.
-- Additive only: no existing table, column, enum value, or data is removed.

ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'github_pr';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'github_branch';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'quality';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'drift';
ALTER TYPE "AgentMarkdownSyncMode" ADD VALUE IF NOT EXISTS 'release_gate';

ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'agent_markdown_file';
ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'agent_markdown_file_version';
ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'agent_markdown_quality_report';
ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'agent_markdown_drift_report';
ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'agent_markdown_sync_run';

ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'agent_markdown_file';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'agent_markdown_file_version';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'agent_markdown_quality_report';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'agent_markdown_drift_report';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'agent_markdown_sync_run';

DO $$ BEGIN
  CREATE TYPE "AgentMarkdownQualityLabel" AS ENUM ('excellent', 'good', 'usable_with_warnings', 'needs_improvement', 'unsafe_or_blocked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgentMarkdownDriftSeverity" AS ENUM ('info', 'low', 'medium', 'high', 'critical');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "agent_markdown_file_quality_reports" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "file_set_id" uuid NOT NULL,
  "overall_score" integer NOT NULL,
  "score_label" "AgentMarkdownQualityLabel" NOT NULL,
  "critical_issue_count" integer NOT NULL DEFAULT 0,
  "warning_count" integer NOT NULL DEFAULT 0,
  "per_file_scores_json" jsonb NOT NULL DEFAULT '[]',
  "findings_json" jsonb NOT NULL DEFAULT '[]',
  "invalid_open_targets_json" jsonb NOT NULL DEFAULT '[]',
  "stale_files_json" jsonb NOT NULL DEFAULT '[]',
  "missing_files_json" jsonb NOT NULL DEFAULT '[]',
  "readiness_json" jsonb NOT NULL DEFAULT '{}',
  "limitations_json" jsonb NOT NULL DEFAULT '[]',
  "warnings_json" jsonb NOT NULL DEFAULT '[]',
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_markdown_file_quality_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agent_markdown_file_drift_reports" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "file_set_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'completed',
  "highest_severity" "AgentMarkdownDriftSeverity" NOT NULL DEFAULT 'info',
  "critical_finding_count" integer NOT NULL DEFAULT 0,
  "high_finding_count" integer NOT NULL DEFAULT 0,
  "findings_json" jsonb NOT NULL DEFAULT '[]',
  "recommendations_json" jsonb NOT NULL DEFAULT '[]',
  "citations_json" jsonb NOT NULL DEFAULT '[]',
  "open_targets_json" jsonb NOT NULL DEFAULT '[]',
  "limitations_json" jsonb NOT NULL DEFAULT '[]',
  "warnings_json" jsonb NOT NULL DEFAULT '[]',
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_markdown_file_drift_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "amfqr_org_project_label_created_idx"
  ON "agent_markdown_file_quality_reports"("org_id", "project_id", "score_label", "created_at");

CREATE INDEX IF NOT EXISTS "amfqr_project_set_created_idx"
  ON "agent_markdown_file_quality_reports"("project_id", "file_set_id", "created_at");

CREATE INDEX IF NOT EXISTS "amfdr_org_project_severity_created_idx"
  ON "agent_markdown_file_drift_reports"("org_id", "project_id", "highest_severity", "created_at");

CREATE INDEX IF NOT EXISTS "amfdr_project_set_created_idx"
  ON "agent_markdown_file_drift_reports"("project_id", "file_set_id", "created_at");

ALTER TABLE "agent_markdown_file_quality_reports"
  ADD CONSTRAINT "agent_markdown_file_quality_reports_file_set_id_fkey"
  FOREIGN KEY ("file_set_id") REFERENCES "agent_markdown_file_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_markdown_file_drift_reports"
  ADD CONSTRAINT "agent_markdown_file_drift_reports_file_set_id_fkey"
  FOREIGN KEY ("file_set_id") REFERENCES "agent_markdown_file_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
