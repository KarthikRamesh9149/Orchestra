ALTER TABLE "project_join_codes" ADD COLUMN "invited_email" TEXT;

CREATE INDEX "project_join_codes_project_invited_email_idx" ON "project_join_codes"("project_id", "invited_email");
