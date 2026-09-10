-- Additive indexes for Project Memory document/source list reads.
-- These match the live list access pattern: project-scoped document pages plus
-- Drive/Notion source lookups by linked document or current document version.

CREATE INDEX IF NOT EXISTS "documents_project_id_created_at_idx"
  ON "documents" ("project_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "documents_project_id_visibility_created_at_idx"
  ON "documents" ("project_id", "visibility", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "project_drive_files_project_document_list_idx"
  ON "project_drive_files" ("project_id", "document_id", "last_indexed_at" DESC, "modified_time" DESC, "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "project_drive_files_project_version_list_idx"
  ON "project_drive_files" ("project_id", "document_version_id", "last_indexed_at" DESC, "modified_time" DESC, "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "project_notion_resources_project_document_list_idx"
  ON "project_notion_resources" ("project_id", "document_id", "last_indexed_at" DESC, "last_edited_at" DESC, "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "project_notion_resources_project_version_list_idx"
  ON "project_notion_resources" ("project_id", "document_version_id", "last_indexed_at" DESC, "last_edited_at" DESC, "updated_at" DESC);
