CREATE TABLE IF NOT EXISTS "project_notion_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "connector_id" uuid NOT NULL,
  "notion_resource_id" text NOT NULL,
  "resource_type" text NOT NULL,
  "parent_resource_id" text,
  "title" text NOT NULL,
  "url" text,
  "selected_resource_id" text,
  "selected_resource_label" text,
  "last_edited_at" timestamptz(6),
  "document_id" uuid,
  "document_version_id" uuid,
  "index_status" text NOT NULL DEFAULT 'pending',
  "last_indexed_at" timestamptz(6),
  "last_error" text,
  "content_hash" text,
  "metadata_json" jsonb,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "project_notion_resources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_notion_resources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_notion_resources_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_notion_resources_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "project_notion_resources_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_notion_resources_project_connector_resource_key" ON "project_notion_resources"("project_id", "connector_id", "notion_resource_id");
CREATE INDEX IF NOT EXISTS "project_notion_resources_connector_type_idx" ON "project_notion_resources"("connector_id", "resource_type");
CREATE INDEX IF NOT EXISTS "project_notion_resources_project_status_edited_idx" ON "project_notion_resources"("project_id", "index_status", "last_edited_at");
CREATE INDEX IF NOT EXISTS "project_notion_resources_document_idx" ON "project_notion_resources"("document_id");
CREATE INDEX IF NOT EXISTS "project_notion_resources_document_version_idx" ON "project_notion_resources"("document_version_id");
