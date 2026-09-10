-- Feature 13 Part 1: read-first GitHub integration foundation.
-- Additive only: stores GitHub engineering evidence and integration metadata without tokens or secrets.

DO $$ BEGIN
  CREATE TYPE "GitHubIntegrationStatus" AS ENUM ('pending', 'active', 'archived', 'suspended', 'revoked', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GitHubUserLinkStatus" AS ENUM ('active', 'revoked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GitHubWebhookEventStatus" AS ENUM ('received', 'ignored', 'queued', 'processed', 'failed', 'duplicate', 'unauthorized', 'invalid_signature');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GitHubSyncRunStatus" AS ENUM ('queued', 'running', 'completed', 'completed_with_warnings', 'failed', 'canceled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GitHubEvidenceType" AS ENUM ('github_repository', 'github_branch', 'github_pull_request', 'github_pull_request_file', 'github_commit', 'github_commit_file', 'github_review', 'github_review_comment', 'github_issue_comment', 'github_check_run', 'github_deployment', 'github_deployment_status', 'github_workflow_run');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GitHubEvidenceStatus" AS ENUM ('active', 'archived', 'deleted', 'unknown');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "github_installations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "github_installation_id" text NOT NULL,
  "github_account_id" text,
  "github_account_login" text,
  "github_account_type" text,
  "repository_selection" text,
  "permissions_json" jsonb NOT NULL DEFAULT '{}',
  "events_json" jsonb NOT NULL DEFAULT '[]',
  "status" "GitHubIntegrationStatus" NOT NULL DEFAULT 'pending',
  "installed_at" timestamptz(6),
  "suspended_at" timestamptz(6),
  "archived_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "github_installations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "github_repositories" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "installation_id" uuid NOT NULL,
  "github_repository_id" text NOT NULL,
  "owner" text NOT NULL,
  "name" text NOT NULL,
  "full_name" text NOT NULL,
  "default_branch" text,
  "private" boolean NOT NULL DEFAULT false,
  "fork" boolean NOT NULL DEFAULT false,
  "html_url" text,
  "status" "GitHubIntegrationStatus" NOT NULL DEFAULT 'active',
  "last_synced_at" timestamptz(6),
  "archived_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "github_repositories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "github_repository_project_links" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "installation_id" uuid NOT NULL,
  "repository_id" uuid NOT NULL,
  "linked_by_user_id" uuid,
  "status" "GitHubIntegrationStatus" NOT NULL DEFAULT 'active',
  "sync_cursor_json" jsonb NOT NULL DEFAULT '{}',
  "last_synced_at" timestamptz(6),
  "archived_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "github_repository_project_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "github_user_links" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "github_user_id" text NOT NULL,
  "github_login" text NOT NULL,
  "github_avatar_url" text,
  "github_email_hash" text,
  "status" "GitHubUserLinkStatus" NOT NULL DEFAULT 'active',
  "linked_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" timestamptz(6),
  "last_seen_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "github_user_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "github_webhook_events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid,
  "installation_id" uuid,
  "repository_id" uuid,
  "repository_link_id" uuid,
  "github_delivery_id" text NOT NULL,
  "event_type" text NOT NULL,
  "action" text,
  "status" "GitHubWebhookEventStatus" NOT NULL DEFAULT 'received',
  "payload_json" jsonb NOT NULL DEFAULT '{}',
  "error_message" text,
  "received_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "github_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "github_sync_runs" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "project_id" uuid,
  "installation_id" uuid,
  "repository_link_id" uuid,
  "mode" text NOT NULL DEFAULT 'backfill',
  "status" "GitHubSyncRunStatus" NOT NULL DEFAULT 'queued',
  "started_by_user_id" uuid,
  "started_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" timestamptz(6),
  "cursor_json" jsonb NOT NULL DEFAULT '{}',
  "counts_json" jsonb NOT NULL DEFAULT '{}',
  "warnings_json" jsonb NOT NULL DEFAULT '[]',
  "errors_json" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "github_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "github_engineering_evidence" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "installation_id" uuid NOT NULL,
  "repository_id" uuid NOT NULL,
  "repository_link_id" uuid NOT NULL,
  "github_repository_id" text NOT NULL,
  "repository_owner" text NOT NULL,
  "repository_name" text NOT NULL,
  "evidence_type" "GitHubEvidenceType" NOT NULL,
  "provider_id" text NOT NULL,
  "title" text,
  "summary" text,
  "branch" text,
  "sha" text,
  "pull_request_number" integer,
  "path" text,
  "status" text,
  "actor_github_user_id" text,
  "actor_github_login" text,
  "mapped_user_id" uuid,
  "source_url" text,
  "occurred_at" timestamptz(6),
  "payload_json" jsonb NOT NULL DEFAULT '{}',
  "citation_json" jsonb NOT NULL DEFAULT '{}',
  "open_target_json" jsonb NOT NULL DEFAULT '{}',
  "evidence_status" "GitHubEvidenceStatus" NOT NULL DEFAULT 'active',
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "github_engineering_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "github_installations_org_installation_key"
  ON "github_installations"("org_id", "github_installation_id");
CREATE INDEX IF NOT EXISTS "github_installations_org_status_updated_idx"
  ON "github_installations"("org_id", "status", "updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "github_repositories_installation_repo_key"
  ON "github_repositories"("installation_id", "github_repository_id");
CREATE INDEX IF NOT EXISTS "github_repositories_org_owner_name_idx"
  ON "github_repositories"("org_id", "owner", "name");
CREATE INDEX IF NOT EXISTS "github_repositories_org_status_updated_idx"
  ON "github_repositories"("org_id", "status", "updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "github_repository_project_links_project_repo_key"
  ON "github_repository_project_links"("project_id", "repository_id");
CREATE INDEX IF NOT EXISTS "github_repository_project_links_org_project_status_idx"
  ON "github_repository_project_links"("org_id", "project_id", "status");
CREATE INDEX IF NOT EXISTS "github_repository_project_links_install_repo_status_idx"
  ON "github_repository_project_links"("installation_id", "repository_id", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "github_user_links_org_user_github_key"
  ON "github_user_links"("org_id", "user_id", "github_user_id");
CREATE INDEX IF NOT EXISTS "github_user_links_org_login_status_idx"
  ON "github_user_links"("org_id", "github_login", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "github_webhook_events_delivery_event_install_key"
  ON "github_webhook_events"("github_delivery_id", "event_type", "installation_id");
CREATE INDEX IF NOT EXISTS "github_webhook_events_org_status_received_idx"
  ON "github_webhook_events"("org_id", "status", "received_at");
CREATE INDEX IF NOT EXISTS "github_webhook_events_link_event_received_idx"
  ON "github_webhook_events"("repository_link_id", "event_type", "received_at");

CREATE INDEX IF NOT EXISTS "github_sync_runs_org_project_status_created_idx"
  ON "github_sync_runs"("org_id", "project_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "github_sync_runs_link_status_created_idx"
  ON "github_sync_runs"("repository_link_id", "status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "github_engineering_evidence_link_type_provider_key"
  ON "github_engineering_evidence"("repository_link_id", "evidence_type", "provider_id");
CREATE INDEX IF NOT EXISTS "github_engineering_evidence_org_project_type_time_idx"
  ON "github_engineering_evidence"("org_id", "project_id", "evidence_type", "occurred_at");
CREATE INDEX IF NOT EXISTS "github_engineering_evidence_link_branch_time_idx"
  ON "github_engineering_evidence"("repository_link_id", "branch", "occurred_at");
CREATE INDEX IF NOT EXISTS "github_engineering_evidence_link_pr_type_idx"
  ON "github_engineering_evidence"("repository_link_id", "pull_request_number", "evidence_type");

ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_installation_id_fkey"
  FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "github_repository_project_links" ADD CONSTRAINT "github_repository_project_links_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "github_repository_project_links" ADD CONSTRAINT "github_repository_project_links_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_repository_project_links" ADD CONSTRAINT "github_repository_project_links_installation_id_fkey"
  FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_repository_project_links" ADD CONSTRAINT "github_repository_project_links_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "github_repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_repository_project_links" ADD CONSTRAINT "github_repository_project_links_linked_by_user_id_fkey"
  FOREIGN KEY ("linked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "github_user_links" ADD CONSTRAINT "github_user_links_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "github_user_links" ADD CONSTRAINT "github_user_links_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "github_webhook_events" ADD CONSTRAINT "github_webhook_events_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "github_webhook_events" ADD CONSTRAINT "github_webhook_events_installation_id_fkey"
  FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "github_webhook_events" ADD CONSTRAINT "github_webhook_events_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "github_repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "github_webhook_events" ADD CONSTRAINT "github_webhook_events_repository_link_id_fkey"
  FOREIGN KEY ("repository_link_id") REFERENCES "github_repository_project_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "github_sync_runs" ADD CONSTRAINT "github_sync_runs_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "github_sync_runs" ADD CONSTRAINT "github_sync_runs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_sync_runs" ADD CONSTRAINT "github_sync_runs_installation_id_fkey"
  FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "github_sync_runs" ADD CONSTRAINT "github_sync_runs_repository_link_id_fkey"
  FOREIGN KEY ("repository_link_id") REFERENCES "github_repository_project_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "github_sync_runs" ADD CONSTRAINT "github_sync_runs_started_by_user_id_fkey"
  FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "github_engineering_evidence" ADD CONSTRAINT "github_engineering_evidence_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "github_engineering_evidence" ADD CONSTRAINT "github_engineering_evidence_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_engineering_evidence" ADD CONSTRAINT "github_engineering_evidence_installation_id_fkey"
  FOREIGN KEY ("installation_id") REFERENCES "github_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_engineering_evidence" ADD CONSTRAINT "github_engineering_evidence_repository_id_fkey"
  FOREIGN KEY ("repository_id") REFERENCES "github_repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_engineering_evidence" ADD CONSTRAINT "github_engineering_evidence_repository_link_id_fkey"
  FOREIGN KEY ("repository_link_id") REFERENCES "github_repository_project_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "github_engineering_evidence" ADD CONSTRAINT "github_engineering_evidence_mapped_user_id_fkey"
  FOREIGN KEY ("mapped_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
