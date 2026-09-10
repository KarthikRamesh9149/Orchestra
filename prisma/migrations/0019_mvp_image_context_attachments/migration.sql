CREATE TYPE "ProjectContextAttachmentKind" AS ENUM ('image', 'document', 'text', 'other');
CREATE TYPE "ProjectContextAttachmentStorageStatus" AS ENUM ('stored', 'metadata_only', 'failed');

ALTER TABLE "project_context_attachments"
  ADD COLUMN "attachment_kind" "ProjectContextAttachmentKind" NOT NULL DEFAULT 'other',
  ADD COLUMN "original_filename" TEXT,
  ADD COLUMN "safe_filename" TEXT,
  ADD COLUMN "checksum_sha256" TEXT,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "created_by_user_id" UUID;

UPDATE "project_context_attachments" AS attachment
SET
  "original_filename" = attachment."filename",
  "safe_filename" = attachment."filename",
  "attachment_kind" = CASE
    WHEN attachment."mime_type" IN ('image/png', 'image/jpeg', 'image/webp') THEN 'image'::"ProjectContextAttachmentKind"
    WHEN attachment."mime_type" IN ('text/plain', 'text/markdown') THEN 'text'::"ProjectContextAttachmentKind"
    WHEN attachment."mime_type" IN (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) THEN 'document'::"ProjectContextAttachmentKind"
    ELSE 'other'::"ProjectContextAttachmentKind"
  END,
  "created_by_user_id" = entry."created_by_user_id"
FROM "project_context_entries" AS entry
WHERE entry."id" = attachment."context_entry_id";

ALTER TABLE "project_context_attachments"
  ALTER COLUMN "created_by_user_id" SET NOT NULL;

ALTER TABLE "project_context_attachments"
  ALTER COLUMN "storage_status" DROP DEFAULT,
  ALTER COLUMN "storage_status" TYPE "ProjectContextAttachmentStorageStatus"
    USING CASE
      WHEN "storage_status" = 'stored' THEN 'stored'::"ProjectContextAttachmentStorageStatus"
      WHEN "storage_status" = 'failed' THEN 'failed'::"ProjectContextAttachmentStorageStatus"
      ELSE 'metadata_only'::"ProjectContextAttachmentStorageStatus"
    END,
  ALTER COLUMN "storage_status" SET DEFAULT 'metadata_only';

ALTER TABLE "project_context_attachments"
  ADD CONSTRAINT "project_context_attachments_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "project_context_attachments_project_id_attachment_kind_idx"
  ON "project_context_attachments"("project_id", "attachment_kind");
