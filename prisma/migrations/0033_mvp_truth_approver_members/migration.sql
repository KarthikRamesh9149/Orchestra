ALTER TABLE "project_members"
  ADD COLUMN "can_approve_truth_changes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "truth_approval_granted_by_user_id" UUID,
  ADD COLUMN "truth_approval_granted_at" TIMESTAMPTZ(6),
  ADD COLUMN "truth_approval_revoked_by_user_id" UUID,
  ADD COLUMN "truth_approval_revoked_at" TIMESTAMPTZ(6);

CREATE INDEX "project_members_project_id_can_approve_truth_changes_is_active_idx"
  ON "project_members"("project_id", "can_approve_truth_changes", "is_active");
