CREATE TYPE "SocratesActionStatus" AS ENUM (
  'proposed',
  'applied',
  'rejected',
  'failed'
);

CREATE TYPE "SocratesActionType" AS ENUM (
  'generate_prd',
  'generate_srs',
  'create_context_note',
  'create_diagram',
  'embed_diagram_in_live_doc',
  'generate_coding_requirements',
  'create_responsibility',
  'assign_task',
  'update_team_member_responsibility',
  'create_calendar_event'
);

CREATE TABLE "socrates_actions" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "session_id" UUID,
  "proposed_by_message_id" UUID,
  "action_type" "SocratesActionType" NOT NULL,
  "label" TEXT NOT NULL,
  "payload_json" JSONB NOT NULL,
  "status" "SocratesActionStatus" NOT NULL DEFAULT 'proposed',
  "result_json" JSONB,
  "failure_reason" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "applied_by_user_id" UUID,
  "rejected_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_at" TIMESTAMPTZ(6),
  "rejected_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "socrates_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "socrates_actions_org_id_idx" ON "socrates_actions"("org_id");
CREATE INDEX "socrates_actions_project_id_status_idx" ON "socrates_actions"("project_id", "status");
CREATE INDEX "socrates_actions_project_id_action_type_idx" ON "socrates_actions"("project_id", "action_type");
CREATE INDEX "socrates_actions_project_id_session_id_idx" ON "socrates_actions"("project_id", "session_id");
CREATE INDEX "socrates_actions_project_id_created_at_idx" ON "socrates_actions"("project_id", "created_at" DESC);

ALTER TABLE "socrates_actions"
  ADD CONSTRAINT "socrates_actions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_actions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_actions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "socrates_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_actions_proposed_by_message_id_fkey"
  FOREIGN KEY ("proposed_by_message_id") REFERENCES "socrates_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_actions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_actions_applied_by_user_id_fkey"
  FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "socrates_actions_rejected_by_user_id_fkey"
  FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
