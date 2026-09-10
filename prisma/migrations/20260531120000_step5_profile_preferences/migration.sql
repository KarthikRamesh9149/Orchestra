ALTER TABLE "users"
  ADD COLUMN "avatar_url" TEXT,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "locale" TEXT;

CREATE TABLE "user_notification_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "org_id" UUID NOT NULL,
  "product_updates" BOOLEAN NOT NULL DEFAULT false,
  "project_activity" BOOLEAN NOT NULL DEFAULT true,
  "approval_requests" BOOLEAN NOT NULL DEFAULT true,
  "slack_sync_alerts" BOOLEAN NOT NULL DEFAULT true,
  "calendar_reminders" BOOLEAN NOT NULL DEFAULT true,
  "socrates_digests" BOOLEAN NOT NULL DEFAULT false,
  "security_alerts" BOOLEAN NOT NULL DEFAULT true,
  "email_enabled" BOOLEAN NOT NULL DEFAULT true,
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_notification_preferences_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_notification_preferences_user_id_key"
  ON "user_notification_preferences"("user_id");

CREATE INDEX "user_notification_preferences_org_id_idx"
  ON "user_notification_preferences"("org_id");
