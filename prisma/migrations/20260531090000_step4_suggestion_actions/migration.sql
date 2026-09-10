CREATE TABLE "project_suggestion_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "suggestion_id" TEXT NOT NULL,
  "source_fingerprint" TEXT NOT NULL,
  "action_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "actor_user_id" UUID NOT NULL,
  "timeline_event_id" UUID,
  "proposal_id" UUID,
  "payload_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_suggestion_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_suggestion_actions_project_suggestion_action_key"
  ON "project_suggestion_actions"("project_id", "suggestion_id", "action_type");

CREATE INDEX "project_suggestion_actions_project_action_created_idx"
  ON "project_suggestion_actions"("project_id", "action_type", "created_at" DESC);

CREATE INDEX "project_suggestion_actions_project_fingerprint_idx"
  ON "project_suggestion_actions"("project_id", "source_fingerprint");