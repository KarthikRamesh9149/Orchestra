-- Additive indexes for PM Watchtower, GitHub evidence, and communication
-- timeline aggregate reads.

CREATE INDEX IF NOT EXISTS "spec_change_proposals_project_status_updated_idx"
  ON "spec_change_proposals" ("project_id", "status", "updated_at" ASC);

CREATE INDEX IF NOT EXISTS "spec_change_proposals_project_status_accepted_idx"
  ON "spec_change_proposals" ("project_id", "status", "accepted_at" DESC);

CREATE INDEX IF NOT EXISTS "communication_threads_project_last_message_idx"
  ON "communication_threads" ("project_id", "last_message_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "communication_messages_project_thread_sent_idx"
  ON "communication_messages" ("project_id", "thread_id", "sent_at" DESC);

CREATE INDEX IF NOT EXISTS "github_engineering_evidence_project_status_time_idx"
  ON "github_engineering_evidence" ("project_id", "evidence_status", "occurred_at" DESC, "created_at" DESC);

CREATE INDEX IF NOT EXISTS "github_engineering_evidence_project_status_type_time_idx"
  ON "github_engineering_evidence" ("project_id", "evidence_status", "evidence_type", "occurred_at" DESC);
