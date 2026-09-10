CREATE TYPE "ProjectEventType" AS ENUM (
  'standup',
  'review',
  'client',
  'meeting',
  'milestone',
  'demo',
  'other'
);

CREATE TYPE "ProjectEventSource" AS ENUM (
  'manual',
  'imported',
  'generated'
);

CREATE TYPE "DeadlineStatus" AS ENUM (
  'on_track',
  'at_risk',
  'critical',
  'completed'
);

CREATE TYPE "BillingType" AS ENUM (
  'monthly',
  'annual',
  'per_transaction',
  'one_time',
  'usage_based'
);

CREATE TYPE "SubscriptionStatus" AS ENUM (
  'active',
  'paused',
  'cancelled'
);

CREATE TABLE "project_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "event_type" "ProjectEventType" NOT NULL,
  "source" "ProjectEventSource" NOT NULL DEFAULT 'manual',
  "starts_at" TIMESTAMPTZ(6) NOT NULL,
  "ends_at" TIMESTAMPTZ(6),
  "timezone" TEXT,
  "created_by" UUID NOT NULL,
  "linked_ref_type" TEXT,
  "linked_ref_id" TEXT,
  "is_all_day" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_deadlines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "due_at" TIMESTAMPTZ(6) NOT NULL,
  "status" "DeadlineStatus" NOT NULL,
  "linked_ref_type" TEXT,
  "linked_ref_id" TEXT,
  "created_by" UUID NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_deadlines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_financial_summaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "budget_amount" DECIMAL(12,2),
  "spent_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "updated_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_financial_summaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "cost" DECIMAL(12,2) NOT NULL,
  "billing_type" "BillingType" NOT NULL,
  "status" "SubscriptionStatus" NOT NULL,
  "provider" TEXT,
  "external_ref" TEXT,
  "renews_at" TIMESTAMPTZ(6),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_financial_summaries_project_id_key"
  ON "project_financial_summaries"("project_id");

CREATE INDEX "project_events_project_id_starts_at_idx"
  ON "project_events"("project_id", "starts_at" ASC);

CREATE INDEX "project_events_org_id_starts_at_idx"
  ON "project_events"("org_id", "starts_at" ASC);

CREATE INDEX "project_events_project_id_event_type_starts_at_idx"
  ON "project_events"("project_id", "event_type", "starts_at" ASC);

CREATE INDEX "project_deadlines_project_id_due_at_idx"
  ON "project_deadlines"("project_id", "due_at" ASC);

CREATE INDEX "project_deadlines_org_id_due_at_idx"
  ON "project_deadlines"("org_id", "due_at" ASC);

CREATE INDEX "project_deadlines_project_id_status_due_at_idx"
  ON "project_deadlines"("project_id", "status", "due_at" ASC);

CREATE INDEX "project_financial_summaries_org_id_project_id_idx"
  ON "project_financial_summaries"("org_id", "project_id");

CREATE INDEX "project_subscriptions_project_id_status_idx"
  ON "project_subscriptions"("project_id", "status");

CREATE INDEX "project_subscriptions_project_id_billing_type_idx"
  ON "project_subscriptions"("project_id", "billing_type");

CREATE INDEX "project_subscriptions_project_id_name_idx"
  ON "project_subscriptions"("project_id", "name");

ALTER TABLE "project_events"
  ADD CONSTRAINT "project_events_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_events"
  ADD CONSTRAINT "project_events_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_events"
  ADD CONSTRAINT "project_events_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_deadlines"
  ADD CONSTRAINT "project_deadlines_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_deadlines"
  ADD CONSTRAINT "project_deadlines_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_deadlines"
  ADD CONSTRAINT "project_deadlines_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_financial_summaries"
  ADD CONSTRAINT "project_financial_summaries_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_financial_summaries"
  ADD CONSTRAINT "project_financial_summaries_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_financial_summaries"
  ADD CONSTRAINT "project_financial_summaries_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_subscriptions"
  ADD CONSTRAINT "project_subscriptions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_subscriptions"
  ADD CONSTRAINT "project_subscriptions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_subscriptions"
  ADD CONSTRAINT "project_subscriptions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
