-- Feature 8: Project Ops Automation + Integrations
-- Adds: recurring event series, calendar connections, cost-entry ledger

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "EventRecurrenceFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'yearly');
CREATE TYPE "EventRecurrenceStatus"    AS ENUM ('active', 'paused', 'ended');
CREATE TYPE "ProjectCalendarProvider"  AS ENUM ('google_calendar', 'outlook_calendar');
CREATE TYPE "CalendarConnectionStatus" AS ENUM ('pending_auth', 'connected', 'syncing', 'error', 'revoked');
CREATE TYPE "CalendarSyncType"         AS ENUM ('manual', 'backfill', 'incremental');
CREATE TYPE "CalendarSyncStatus"       AS ENUM ('queued', 'running', 'completed', 'partial', 'failed');
CREATE TYPE "CostEntryCategory"        AS ENUM (
  'infrastructure', 'software', 'contractor', 'tools',
  'cloud', 'communication', 'design', 'misc'
);

-- ─── Extend project_events ───────────────────────────────────────────────────

ALTER TABLE "project_events"
  ADD COLUMN "series_id"                UUID,
  ADD COLUMN "is_generated_occurrence"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "external_calendar_ref"    TEXT,
  ADD COLUMN "provider_calendar_id"     TEXT;

CREATE INDEX "project_events_series_id_idx"
  ON "project_events"("series_id")
  WHERE "series_id" IS NOT NULL;

-- ─── ProjectEventSeries ──────────────────────────────────────────────────────

CREATE TABLE "project_event_series" (
  "id"               UUID        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"           UUID        NOT NULL,
  "project_id"       UUID        NOT NULL,
  "title"            TEXT        NOT NULL,
  "description"      TEXT,
  "event_type"       "ProjectEventType" NOT NULL,
  "timezone"         TEXT        NOT NULL,
  "is_all_day"       BOOLEAN     NOT NULL DEFAULT false,
  "frequency"        "EventRecurrenceFrequency" NOT NULL,
  "interval"         INTEGER     NOT NULL DEFAULT 1,
  "by_weekday_json"  JSONB,
  "day_of_month"     INTEGER,
  "start_date"       TIMESTAMPTZ NOT NULL,
  "end_date"         TIMESTAMPTZ,
  "max_occurrences"  INTEGER,
  "status"           "EventRecurrenceStatus" NOT NULL DEFAULT 'active',
  "source"           "ProjectEventSource" NOT NULL DEFAULT 'manual',
  "created_by"       UUID        NOT NULL,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "project_event_series_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_event_series_project_status_idx"
  ON "project_event_series"("project_id", "status");
CREATE INDEX "project_event_series_project_start_idx"
  ON "project_event_series"("project_id", "start_date" ASC);
CREATE INDEX "project_event_series_org_start_idx"
  ON "project_event_series"("org_id", "start_date" ASC);

ALTER TABLE "project_event_series"
  ADD CONSTRAINT "project_event_series_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_event_series_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_event_series_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_events"
  ADD CONSTRAINT "project_events_series_id_fkey"
    FOREIGN KEY ("series_id") REFERENCES "project_event_series"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── ProjectCalendarConnection ───────────────────────────────────────────────

CREATE TABLE "project_calendar_connections" (
  "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
  "org_id"               UUID        NOT NULL,
  "project_id"           UUID        NOT NULL,
  "provider"             "ProjectCalendarProvider" NOT NULL,
  "account_label"        TEXT        NOT NULL,
  "status"               "CalendarConnectionStatus" NOT NULL DEFAULT 'pending_auth',
  "credentials_ref"      TEXT,
  "config_json"          JSONB,
  "provider_cursor_json" JSONB,
  "last_synced_at"       TIMESTAMPTZ,
  "last_error"           TEXT,
  "created_by"           UUID        NOT NULL,
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "project_calendar_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_calendar_connections_project_provider_idx"
  ON "project_calendar_connections"("project_id", "provider");
CREATE INDEX "project_calendar_connections_project_status_idx"
  ON "project_calendar_connections"("project_id", "status");

ALTER TABLE "project_calendar_connections"
  ADD CONSTRAINT "project_calendar_connections_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_calendar_connections_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_calendar_connections_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ProjectCalendarSyncRun ──────────────────────────────────────────────────

CREATE TABLE "project_calendar_sync_runs" (
  "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  "connection_id"       UUID        NOT NULL,
  "org_id"              UUID        NOT NULL,
  "project_id"          UUID        NOT NULL,
  "provider"            "ProjectCalendarProvider" NOT NULL,
  "sync_type"           "CalendarSyncType"         NOT NULL,
  "status"              "CalendarSyncStatus"        NOT NULL DEFAULT 'queued',
  "cursor_before_json"  JSONB,
  "cursor_after_json"   JSONB,
  "summary_json"        JSONB,
  "error_message"       TEXT,
  "started_at"          TIMESTAMPTZ,
  "finished_at"         TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "project_calendar_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_calendar_sync_runs_connection_created_idx"
  ON "project_calendar_sync_runs"("connection_id", "created_at" DESC);
CREATE INDEX "project_calendar_sync_runs_project_status_idx"
  ON "project_calendar_sync_runs"("project_id", "status");

ALTER TABLE "project_calendar_sync_runs"
  ADD CONSTRAINT "project_calendar_sync_runs_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "project_calendar_connections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_calendar_sync_runs_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_calendar_sync_runs_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── ProjectCostEntry ────────────────────────────────────────────────────────

CREATE TABLE "project_cost_entries" (
  "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
  "org_id"      UUID           NOT NULL,
  "project_id"  UUID           NOT NULL,
  "category"    "CostEntryCategory" NOT NULL,
  "title"       TEXT           NOT NULL,
  "description" TEXT,
  "amount"      DECIMAL(12, 2) NOT NULL,
  "currency"    TEXT           NOT NULL DEFAULT 'USD',
  "occurred_at" TIMESTAMPTZ    NOT NULL,
  "source"      TEXT           NOT NULL DEFAULT 'manual',
  "created_by"  UUID           NOT NULL,
  "created_at"  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT "project_cost_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_cost_entries_amount_positive" CHECK ("amount" >= 0)
);

CREATE INDEX "project_cost_entries_project_occurred_idx"
  ON "project_cost_entries"("project_id", "occurred_at" DESC);
CREATE INDEX "project_cost_entries_project_category_occurred_idx"
  ON "project_cost_entries"("project_id", "category", "occurred_at" DESC);
CREATE INDEX "project_cost_entries_org_occurred_idx"
  ON "project_cost_entries"("org_id", "occurred_at" DESC);

ALTER TABLE "project_cost_entries"
  ADD CONSTRAINT "project_cost_entries_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_cost_entries_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "project_cost_entries_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
