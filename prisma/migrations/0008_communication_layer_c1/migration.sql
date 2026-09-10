CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO $$
BEGIN
  CREATE TYPE "CommunicationProvider" AS ENUM (
    'manual_import',
    'slack',
    'gmail',
    'outlook',
    'microsoft_teams',
    'whatsapp_business'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CommunicationConnectorStatus" AS ENUM (
    'pending_auth',
    'connected',
    'syncing',
    'error',
    'revoked'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CommunicationSyncType" AS ENUM (
    'manual',
    'webhook',
    'backfill',
    'incremental'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CommunicationSyncStatus" AS ENUM (
    'queued',
    'running',
    'completed',
    'partial',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AttachmentStorageStatus" AS ENUM (
    'metadata_only',
    'stored',
    'extraction_pending',
    'extracted',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "WebhookEventStatus" AS ENUM (
    'received',
    'ignored_duplicate',
    'queued',
    'processed',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "communication_connectors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "project_id" UUID NOT NULL,
  "provider" "CommunicationProvider" NOT NULL,
  "account_label" TEXT NOT NULL,
  "status" "CommunicationConnectorStatus" NOT NULL,
  "credentials_ref" TEXT,
  "config_json" JSONB,
  "provider_cursor_json" JSONB,
  "last_synced_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "communication_connectors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "communication_connectors_project_id_provider_key"
  ON "communication_connectors"("project_id", "provider");

CREATE INDEX IF NOT EXISTS "communication_connectors_project_id_status_idx"
  ON "communication_connectors"("project_id", "status");

ALTER TABLE "communication_connectors"
  ADD CONSTRAINT "communication_connectors_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "communication_connectors"
  ADD CONSTRAINT "communication_connectors_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "communication_sync_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "connector_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "provider" "CommunicationProvider" NOT NULL,
  "sync_type" "CommunicationSyncType" NOT NULL,
  "status" "CommunicationSyncStatus" NOT NULL,
  "cursor_before_json" JSONB,
  "cursor_after_json" JSONB,
  "summary_json" JSONB,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "communication_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "communication_sync_runs_connector_id_created_at_idx"
  ON "communication_sync_runs"("connector_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "communication_sync_runs_project_id_status_idx"
  ON "communication_sync_runs"("project_id", "status");

ALTER TABLE "communication_sync_runs"
  ADD CONSTRAINT "communication_sync_runs_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "communication_sync_runs"
  ADD CONSTRAINT "communication_sync_runs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "oauth_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "provider" "CommunicationProvider" NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "nonce_hash" TEXT NOT NULL,
  "redirect_after" TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_states_nonce_hash_key"
  ON "oauth_states"("nonce_hash");

CREATE INDEX IF NOT EXISTS "oauth_states_project_id_provider_idx"
  ON "oauth_states"("project_id", "provider");

CREATE INDEX IF NOT EXISTS "oauth_states_expires_at_idx"
  ON "oauth_states"("expires_at");

ALTER TABLE "oauth_states"
  ADD CONSTRAINT "oauth_states_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "oauth_states"
  ADD CONSTRAINT "oauth_states_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "oauth_states"
  ADD CONSTRAINT "oauth_states_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "provider_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" "CommunicationProvider" NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "connector_id" UUID,
  "project_id" UUID,
  "event_type" TEXT NOT NULL,
  "raw_payload_hash" TEXT NOT NULL,
  "status" "WebhookEventStatus" NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_webhook_events_provider_event_id_key"
  ON "provider_webhook_events"("provider", "provider_event_id");

CREATE INDEX IF NOT EXISTS "provider_webhook_events_provider_received_at_idx"
  ON "provider_webhook_events"("provider", "received_at" DESC);

CREATE INDEX IF NOT EXISTS "provider_webhook_events_project_id_status_idx"
  ON "provider_webhook_events"("project_id", "status");

ALTER TABLE "provider_webhook_events"
  ADD CONSTRAINT "provider_webhook_events_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_webhook_events"
  ADD CONSTRAINT "provider_webhook_events_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "communication_threads"
  ADD COLUMN IF NOT EXISTS "connector_id" UUID,
  ADD COLUMN IF NOT EXISTS "provider" "CommunicationProvider" DEFAULT 'manual_import',
  ADD COLUMN IF NOT EXISTS "normalized_subject" TEXT,
  ADD COLUMN IF NOT EXISTS "thread_url" TEXT,
  ADD COLUMN IF NOT EXISTS "raw_metadata_json" JSONB;

ALTER TABLE "communication_messages"
  ADD COLUMN IF NOT EXISTS "connector_id" UUID,
  ADD COLUMN IF NOT EXISTS "provider" "CommunicationProvider" DEFAULT 'manual_import',
  ADD COLUMN IF NOT EXISTS "provider_permalink" TEXT,
  ADD COLUMN IF NOT EXISTS "sender_email" TEXT,
  ADD COLUMN IF NOT EXISTS "body_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "is_edited" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_deleted_by_provider" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "communication_message_chunks"
  ADD COLUMN IF NOT EXISTS "connector_id" UUID,
  ADD COLUMN IF NOT EXISTS "provider" "CommunicationProvider" DEFAULT 'manual_import';

INSERT INTO "communication_connectors" (
  "project_id",
  "provider",
  "account_label",
  "status",
  "created_by"
)
SELECT DISTINCT
  p.id,
  'manual_import'::"CommunicationProvider",
  'Legacy manual import',
  'connected'::"CommunicationConnectorStatus",
  p.created_by
FROM "projects" p
WHERE EXISTS (
  SELECT 1
  FROM "communication_threads" ct
  WHERE ct.project_id = p.id
)
OR EXISTS (
  SELECT 1
  FROM "communication_messages" cm
  WHERE cm.project_id = p.id
)
ON CONFLICT ("project_id", "provider") DO NOTHING;

UPDATE "communication_threads" ct
SET
  "connector_id" = cc.id,
  "provider" = COALESCE(ct."provider", 'manual_import'::"CommunicationProvider"),
  "normalized_subject" = COALESCE(ct."normalized_subject", lower(trim(ct."subject"))),
  "raw_metadata_json" = COALESCE(ct."raw_metadata_json", '{}'::jsonb)
FROM "communication_connectors" cc
WHERE cc."project_id" = ct."project_id"
  AND cc."provider" = 'manual_import'
  AND ct."connector_id" IS NULL;

UPDATE "communication_messages" cm
SET
  "connector_id" = COALESCE(cm."connector_id", ct."connector_id"),
  "provider" = COALESCE(cm."provider", ct."provider"),
  "body_hash" = COALESCE(
    cm."body_hash",
    encode(
      digest(
        COALESCE(cm."body_text", '') || '|' || COALESCE(cm."body_html", ''),
        'sha256'
      ),
      'hex'
    )
  )
FROM "communication_threads" ct
WHERE ct."id" = cm."thread_id"
  AND (cm."connector_id" IS NULL OR cm."body_hash" IS NULL);

UPDATE "communication_message_chunks" cmc
SET
  "connector_id" = COALESCE(cmc."connector_id", cm."connector_id"),
  "provider" = COALESCE(cmc."provider", cm."provider")
FROM "communication_messages" cm
WHERE cm."id" = cmc."message_id"
  AND cmc."connector_id" IS NULL;

ALTER TABLE "communication_threads"
  ALTER COLUMN "connector_id" SET NOT NULL,
  ALTER COLUMN "provider" SET NOT NULL;

ALTER TABLE "communication_messages"
  ALTER COLUMN "connector_id" SET NOT NULL,
  ALTER COLUMN "provider" SET NOT NULL,
  ALTER COLUMN "body_hash" SET NOT NULL;

ALTER TABLE "communication_message_chunks"
  ALTER COLUMN "connector_id" SET NOT NULL,
  ALTER COLUMN "provider" SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE "communication_threads"
    ADD CONSTRAINT "communication_threads_connector_id_fkey"
    FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "communication_messages"
    ADD CONSTRAINT "communication_messages_connector_id_fkey"
    FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "communication_message_chunks"
    ADD CONSTRAINT "communication_message_chunks_connector_id_fkey"
    FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS "communication_threads_project_id_provider_thread_id_key";
DROP INDEX IF EXISTS "communication_messages_thread_id_provider_message_id_key";
DROP INDEX IF EXISTS "communication_message_chunks_project_thread_idx";
DROP INDEX IF EXISTS "communication_messages_project_id_sent_at_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "communication_threads_connector_id_provider_thread_id_key"
  ON "communication_threads"("connector_id", "provider_thread_id");

CREATE INDEX IF NOT EXISTS "communication_threads_project_id_provider_last_message_at_idx"
  ON "communication_threads"("project_id", "provider", "last_message_at" DESC);

CREATE INDEX IF NOT EXISTS "communication_threads_connector_id_last_message_at_idx"
  ON "communication_threads"("connector_id", "last_message_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "communication_messages_connector_id_provider_message_id_key"
  ON "communication_messages"("connector_id", "provider_message_id");

CREATE INDEX IF NOT EXISTS "communication_messages_project_id_provider_sent_at_idx"
  ON "communication_messages"("project_id", "provider", "sent_at" DESC);

CREATE INDEX IF NOT EXISTS "communication_message_chunks_project_id_provider_thread_id_idx"
  ON "communication_message_chunks"("project_id", "provider", "thread_id");

CREATE INDEX IF NOT EXISTS "communication_message_chunks_embedding_idx"
  ON "communication_message_chunks" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS "communication_message_chunks_lexical_content_idx"
  ON "communication_message_chunks" USING GIN (to_tsvector('english', "lexical_content"));

CREATE TABLE IF NOT EXISTS "communication_message_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "provider" "CommunicationProvider" NOT NULL,
  "revision_index" INTEGER NOT NULL,
  "body_text" TEXT NOT NULL,
  "body_html" TEXT,
  "body_hash" TEXT NOT NULL,
  "raw_metadata_json" JSONB,
  "edited_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "communication_message_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "communication_message_revisions_message_id_revision_index_key"
  ON "communication_message_revisions"("message_id", "revision_index");

CREATE INDEX IF NOT EXISTS "communication_message_revisions_project_id_provider_created_at_idx"
  ON "communication_message_revisions"("project_id", "provider", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "communication_message_revisions_message_id_created_at_idx"
  ON "communication_message_revisions"("message_id", "created_at" DESC);

ALTER TABLE "communication_message_revisions"
  ADD CONSTRAINT "communication_message_revisions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "communication_message_revisions"
  ADD CONSTRAINT "communication_message_revisions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "communication_message_revisions"
  ADD CONSTRAINT "communication_message_revisions_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "communication_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "connector_id" UUID NOT NULL,
  "provider" "CommunicationProvider" NOT NULL,
  "provider_attachment_id" TEXT,
  "filename" TEXT,
  "mime_type" TEXT,
  "file_size" BIGINT,
  "provider_url" TEXT,
  "storage_status" "AttachmentStorageStatus" NOT NULL DEFAULT 'metadata_only',
  "file_key" TEXT,
  "extraction_text" TEXT,
  "raw_metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "communication_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "communication_attachments_message_id_provider_attachment_id_key"
  ON "communication_attachments"("message_id", "provider_attachment_id");

CREATE INDEX IF NOT EXISTS "communication_attachments_project_id_provider_created_at_idx"
  ON "communication_attachments"("project_id", "provider", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "communication_attachments_message_id_idx"
  ON "communication_attachments"("message_id");

ALTER TABLE "communication_attachments"
  ADD CONSTRAINT "communication_attachments_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "communication_attachments"
  ADD CONSTRAINT "communication_attachments_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "communication_attachments"
  ADD CONSTRAINT "communication_attachments_connector_id_fkey"
  FOREIGN KEY ("connector_id") REFERENCES "communication_connectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
