CREATE TABLE "deep_research_action_completions" (
  "run_id" UUID NOT NULL REFERENCES "deep_research_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "action_id" VARCHAR(64) NOT NULL CHECK ("action_id" ~ '^[a-f0-9]{64}$'),
  "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("run_id", "user_id", "action_id")
);
CREATE INDEX "deep_research_action_completions_user_id_idx" ON "deep_research_action_completions" ("user_id");
ALTER TABLE "deep_research_action_completions" ENABLE ROW LEVEL SECURITY;
