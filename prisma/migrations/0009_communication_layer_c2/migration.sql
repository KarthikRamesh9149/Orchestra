DO $$
BEGIN
  CREATE TYPE "MessageInsightType" AS ENUM (
    'info',
    'clarification',
    'decision',
    'requirement_change',
    'contradiction',
    'blocker',
    'action_needed',
    'risk',
    'approval'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "MessageInsightStatus" AS ENUM (
    'detected',
    'ignored',
    'converted_to_proposal',
    'converted_to_decision',
    'superseded'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "message_insights" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "provider" "CommunicationProvider" NOT NULL,
  "message_id" UUID NOT NULL,
  "thread_id" UUID NOT NULL,
  "body_hash" TEXT NOT NULL,
  "insight_type" "MessageInsightType" NOT NULL,
  "status" "MessageInsightStatus" NOT NULL DEFAULT 'detected',
  "summary" TEXT NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "should_create_proposal" BOOLEAN NOT NULL DEFAULT false,
  "should_create_decision" BOOLEAN NOT NULL DEFAULT false,
  "proposal_type" "ProposalType",
  "affected_refs_json" JSONB,
  "evidence_json" JSONB,
  "old_understanding_json" JSONB,
  "new_understanding_json" JSONB,
  "decision_statement" TEXT,
  "impact_summary_json" JSONB,
  "uncertainty_json" JSONB,
  "model_json" JSONB,
  "generated_proposal_id" UUID,
  "generated_decision_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "message_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_insights_message_id_body_hash_key"
  ON "message_insights"("message_id", "body_hash");

CREATE INDEX IF NOT EXISTS "message_insights_project_id_insight_type_status_idx"
  ON "message_insights"("project_id", "insight_type", "status");

CREATE INDEX IF NOT EXISTS "message_insights_project_id_status_created_at_idx"
  ON "message_insights"("project_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "message_insights_thread_id_created_at_idx"
  ON "message_insights"("thread_id", "created_at" DESC);

ALTER TABLE "message_insights"
  ADD CONSTRAINT "message_insights_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_insights"
  ADD CONSTRAINT "message_insights_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "message_insights"
  ADD CONSTRAINT "message_insights_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_insights"
  ADD CONSTRAINT "message_insights_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "communication_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_insights"
  ADD CONSTRAINT "message_insights_generated_proposal_id_fkey"
  FOREIGN KEY ("generated_proposal_id") REFERENCES "spec_change_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "message_insights"
  ADD CONSTRAINT "message_insights_generated_decision_id_fkey"
  FOREIGN KEY ("generated_decision_id") REFERENCES "decision_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "thread_insights" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "provider" "CommunicationProvider" NOT NULL,
  "thread_id" UUID NOT NULL,
  "thread_state_hash" TEXT NOT NULL,
  "insight_type" "MessageInsightType" NOT NULL,
  "status" "MessageInsightStatus" NOT NULL DEFAULT 'detected',
  "summary" TEXT NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "should_create_proposal" BOOLEAN NOT NULL DEFAULT false,
  "should_create_decision" BOOLEAN NOT NULL DEFAULT false,
  "proposal_type" "ProposalType",
  "source_message_ids_json" JSONB NOT NULL,
  "affected_refs_json" JSONB,
  "evidence_json" JSONB,
  "old_understanding_json" JSONB,
  "new_understanding_json" JSONB,
  "decision_statement" TEXT,
  "impact_summary_json" JSONB,
  "uncertainty_json" JSONB,
  "model_json" JSONB,
  "generated_proposal_id" UUID,
  "generated_decision_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "thread_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "thread_insights_thread_id_thread_state_hash_key"
  ON "thread_insights"("thread_id", "thread_state_hash");

CREATE INDEX IF NOT EXISTS "thread_insights_project_id_insight_type_status_idx"
  ON "thread_insights"("project_id", "insight_type", "status");

CREATE INDEX IF NOT EXISTS "thread_insights_project_id_status_created_at_idx"
  ON "thread_insights"("project_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "thread_insights_thread_id_created_at_idx"
  ON "thread_insights"("thread_id", "created_at" DESC);

ALTER TABLE "thread_insights"
  ADD CONSTRAINT "thread_insights_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "thread_insights"
  ADD CONSTRAINT "thread_insights_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "thread_insights"
  ADD CONSTRAINT "thread_insights_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "communication_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "thread_insights"
  ADD CONSTRAINT "thread_insights_generated_proposal_id_fkey"
  FOREIGN KEY ("generated_proposal_id") REFERENCES "spec_change_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "thread_insights"
  ADD CONSTRAINT "thread_insights_generated_decision_id_fkey"
  FOREIGN KEY ("generated_decision_id") REFERENCES "decision_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
