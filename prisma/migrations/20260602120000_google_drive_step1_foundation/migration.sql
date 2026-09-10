CREATE TYPE "ProjectDriveConnectionStatus" AS ENUM ('pending_auth', 'connected', 'syncing', 'needs_reauth', 'disconnected', 'error');
CREATE TYPE "ProjectDriveAccessMode" AS ENUM ('full_drive', 'selected_files');
CREATE TYPE "ProjectDriveRootType" AS ENUM ('all_drive', 'my_drive', 'shared_drive', 'folder', 'selected_file');
CREATE TYPE "ProjectDriveFileIndexStatus" AS ENUM ('pending', 'indexed', 'failed', 'skipped', 'unsupported');
CREATE TYPE "ProjectDriveSyncType" AS ENUM ('full', 'incremental', 'webhook', 'manual');
CREATE TYPE "ProjectDriveSyncStatus" AS ENUM ('queued', 'running', 'completed', 'partial', 'failed');
CREATE TYPE "ProjectDriveWatchStatus" AS ENUM ('active', 'stopped', 'expired', 'error');

CREATE TABLE "project_drive_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "connected_by_user_id" UUID NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'google_drive',
  "google_account_email" TEXT,
  "google_account_sub" TEXT,
  "status" "ProjectDriveConnectionStatus" NOT NULL DEFAULT 'pending_auth',
  "credential_ref" TEXT,
  "granted_scopes_json" JSONB,
  "access_mode" "ProjectDriveAccessMode" NOT NULL DEFAULT 'full_drive',
  "connected_at" TIMESTAMPTZ(6),
  "disconnected_at" TIMESTAMPTZ(6),
  "last_synced_at" TIMESTAMPTZ(6),
  "last_error_code" TEXT,
  "last_error_message" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_drive_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_drive_sync_roots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "root_type" "ProjectDriveRootType" NOT NULL,
  "google_drive_id" TEXT,
  "google_file_id" TEXT,
  "name" TEXT NOT NULL,
  "selected" BOOLEAN NOT NULL DEFAULT true,
  "include_children" BOOLEAN NOT NULL DEFAULT true,
  "mime_type_allowlist" TEXT[] NOT NULL,
  "last_start_page_token" TEXT,
  "last_change_page_token" TEXT,
  "last_synced_at" TIMESTAMPTZ(6),
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_drive_sync_roots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_drive_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "drive_file_id" TEXT NOT NULL,
  "drive_id" TEXT,
  "name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "web_view_link" TEXT,
  "icon_link" TEXT,
  "owners_summary" TEXT,
  "last_modifying_user_summary" TEXT,
  "created_time" TIMESTAMPTZ(6),
  "modified_time" TIMESTAMPTZ(6),
  "version" TEXT,
  "md5_checksum" TEXT,
  "size" BIGINT,
  "trashed" BOOLEAN NOT NULL DEFAULT false,
  "shared_drive" BOOLEAN NOT NULL DEFAULT false,
  "parents_json" JSONB,
  "document_id" UUID,
  "document_version_id" UUID,
  "index_status" "ProjectDriveFileIndexStatus" NOT NULL DEFAULT 'pending',
  "last_indexed_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "content_hash" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_drive_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_drive_sync_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "started_by_user_id" UUID,
  "sync_type" "ProjectDriveSyncType" NOT NULL,
  "status" "ProjectDriveSyncStatus" NOT NULL DEFAULT 'queued',
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "files_scanned" INTEGER NOT NULL DEFAULT 0,
  "files_downloaded" INTEGER NOT NULL DEFAULT 0,
  "files_indexed" INTEGER NOT NULL DEFAULT 0,
  "files_skipped" INTEGER NOT NULL DEFAULT 0,
  "files_failed" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_drive_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_drive_watch_channels" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "channel_id" TEXT NOT NULL,
  "resource_id" TEXT,
  "resource_uri" TEXT,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6),
  "status" "ProjectDriveWatchStatus" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stopped_at" TIMESTAMPTZ(6),
  "last_notification_at" TIMESTAMPTZ(6),
  "metadata_json" JSONB,
  CONSTRAINT "project_drive_watch_channels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_drive_connections_org_project_status_idx" ON "project_drive_connections"("org_id", "project_id", "status");
CREATE INDEX "project_drive_connections_project_provider_updated_idx" ON "project_drive_connections"("project_id", "provider", "updated_at" DESC);
CREATE INDEX "project_drive_sync_roots_org_project_selected_idx" ON "project_drive_sync_roots"("org_id", "project_id", "selected");
CREATE INDEX "project_drive_sync_roots_connection_type_idx" ON "project_drive_sync_roots"("connection_id", "root_type");
CREATE UNIQUE INDEX "project_drive_files_project_file_key" ON "project_drive_files"("project_id", "drive_file_id");
CREATE INDEX "project_drive_files_connection_file_idx" ON "project_drive_files"("connection_id", "drive_file_id");
CREATE INDEX "project_drive_files_project_status_modified_idx" ON "project_drive_files"("project_id", "index_status", "modified_time");
CREATE INDEX "project_drive_files_document_idx" ON "project_drive_files"("document_id");
CREATE INDEX "project_drive_files_document_version_idx" ON "project_drive_files"("document_version_id");
CREATE INDEX "project_drive_sync_runs_org_project_status_created_idx" ON "project_drive_sync_runs"("org_id", "project_id", "status", "created_at");
CREATE INDEX "project_drive_sync_runs_connection_status_created_idx" ON "project_drive_sync_runs"("connection_id", "status", "created_at");
CREATE UNIQUE INDEX "project_drive_watch_channels_channel_key" ON "project_drive_watch_channels"("channel_id");
CREATE INDEX "project_drive_watch_channels_connection_status_idx" ON "project_drive_watch_channels"("connection_id", "status");
CREATE INDEX "project_drive_watch_channels_resource_idx" ON "project_drive_watch_channels"("resource_id");

ALTER TABLE "project_drive_connections" ADD CONSTRAINT "project_drive_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_drive_connections" ADD CONSTRAINT "project_drive_connections_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_drive_connections" ADD CONSTRAINT "project_drive_connections_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_drive_sync_roots" ADD CONSTRAINT "project_drive_sync_roots_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_drive_sync_roots" ADD CONSTRAINT "project_drive_sync_roots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_drive_sync_roots" ADD CONSTRAINT "project_drive_sync_roots_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "project_drive_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_drive_files" ADD CONSTRAINT "project_drive_files_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_drive_files" ADD CONSTRAINT "project_drive_files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_drive_files" ADD CONSTRAINT "project_drive_files_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "project_drive_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_drive_files" ADD CONSTRAINT "project_drive_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_drive_files" ADD CONSTRAINT "project_drive_files_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_drive_sync_runs" ADD CONSTRAINT "project_drive_sync_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_drive_sync_runs" ADD CONSTRAINT "project_drive_sync_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_drive_sync_runs" ADD CONSTRAINT "project_drive_sync_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "project_drive_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_drive_sync_runs" ADD CONSTRAINT "project_drive_sync_runs_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_drive_watch_channels" ADD CONSTRAINT "project_drive_watch_channels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_drive_watch_channels" ADD CONSTRAINT "project_drive_watch_channels_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_drive_watch_channels" ADD CONSTRAINT "project_drive_watch_channels_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "project_drive_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
