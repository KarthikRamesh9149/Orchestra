-- MVP Part 4 manual context evidence system.

ALTER TYPE "SocratesCitationType" ADD VALUE IF NOT EXISTS 'project_context';
ALTER TYPE "SocratesOpenTargetType" ADD VALUE IF NOT EXISTS 'project_context';

CREATE TYPE "ProjectContextType" AS ENUM (
  'manual_note',
  'decision_note',
  'team_note',
  'task_note',
  'chat_export',
  'manual_transcript',
  'meeting_note',
  'chart_caption',
  'screenshot_caption',
  'generated_prd',
  'generated_srs',
  'other'
);

CREATE TYPE "ProjectContextImportance" AS ENUM ('normal', 'high');
CREATE TYPE "ProjectContextSource" AS ENUM ('manual', 'socrates', 'generated', 'imported');
CREATE TYPE "ProjectContextStatus" AS ENUM ('active', 'deleted');

CREATE TABLE "project_context_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "type" "ProjectContextType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "source_date" TIMESTAMPTZ(6),
  "participants_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "tags_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "linked_member_id" UUID,
  "importance" "ProjectContextImportance" NOT NULL DEFAULT 'normal',
  "source" "ProjectContextSource" NOT NULL DEFAULT 'manual',
  "status" "ProjectContextStatus" NOT NULL DEFAULT 'active',
  "body_hash" TEXT NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_context_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_context_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_entries_linked_member_id_fkey" FOREIGN KEY ("linked_member_id") REFERENCES "project_members"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "project_context_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_entries_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_entries_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "project_context_chunks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "context_entry_id" UUID NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "raw_text" TEXT NOT NULL,
  "contextual_text" TEXT NOT NULL,
  "lexical_text" TEXT,
  "embedding" vector(1536),
  "token_estimate" INTEGER,
  "metadata_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_context_chunks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_context_chunks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_chunks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_chunks_context_entry_id_fkey" FOREIGN KEY ("context_entry_id") REFERENCES "project_context_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "project_context_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "context_entry_id" UUID NOT NULL,
  "filename" TEXT,
  "mime_type" TEXT,
  "file_size" BIGINT,
  "storage_key" TEXT,
  "provider_url" TEXT,
  "storage_status" TEXT NOT NULL DEFAULT 'metadata_only',
  "metadata_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_context_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_context_attachments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_context_attachments_context_entry_id_fkey" FOREIGN KEY ("context_entry_id") REFERENCES "project_context_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "project_context_entries_org_id_idx" ON "project_context_entries"("org_id");
CREATE INDEX "project_context_entries_project_id_type_idx" ON "project_context_entries"("project_id", "type");
CREATE INDEX "project_context_entries_project_id_status_idx" ON "project_context_entries"("project_id", "status");
CREATE INDEX "project_context_entries_project_id_importance_idx" ON "project_context_entries"("project_id", "importance");
CREATE INDEX "project_context_entries_project_id_source_date_idx" ON "project_context_entries"("project_id", "source_date");
CREATE INDEX "project_context_entries_project_id_linked_member_id_idx" ON "project_context_entries"("project_id", "linked_member_id");
CREATE INDEX "project_context_entries_project_id_created_at_idx" ON "project_context_entries"("project_id", "created_at");

CREATE UNIQUE INDEX "project_context_chunks_context_entry_id_chunk_index_key" ON "project_context_chunks"("context_entry_id", "chunk_index");
CREATE INDEX "project_context_chunks_project_id_idx" ON "project_context_chunks"("project_id");
CREATE INDEX "project_context_chunks_project_id_context_entry_id_idx" ON "project_context_chunks"("project_id", "context_entry_id");
CREATE INDEX "project_context_chunks_lexical_text_idx" ON "project_context_chunks" USING GIN (to_tsvector('english', coalesce("lexical_text", "contextual_text")));
CREATE INDEX "project_context_chunks_embedding_idx" ON "project_context_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);

CREATE INDEX "project_context_attachments_project_id_idx" ON "project_context_attachments"("project_id");
CREATE INDEX "project_context_attachments_context_entry_id_idx" ON "project_context_attachments"("context_entry_id");
