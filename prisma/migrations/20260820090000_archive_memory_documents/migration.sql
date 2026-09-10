ALTER TABLE "documents"
ADD COLUMN "archived_at" TIMESTAMPTZ(6);

CREATE INDEX "documents_active_project_created_at_idx"
ON "documents"("project_id", "created_at" DESC)
WHERE "archived_at" IS NULL;
