ALTER TABLE "project_join_codes"
  ADD COLUMN IF NOT EXISTS "can_approve_truth_changes" boolean NOT NULL DEFAULT false;
