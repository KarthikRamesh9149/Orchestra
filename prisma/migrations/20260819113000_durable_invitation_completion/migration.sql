-- Fix 8: durable, email-bound, replay-safe invitation completion.

-- Legacy unbound codes cannot be redeemed after this migration.
UPDATE "project_join_codes"
SET
  "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "invited_email" IS NULL OR "max_uses" <> 1;

UPDATE "project_join_codes"
SET
  "invited_email" = LOWER(BTRIM("invited_email")),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "invited_email" IS NOT NULL;

ALTER TABLE "project_join_codes"
  ADD CONSTRAINT "project_join_codes_email_bound_or_revoked_check"
  CHECK ("invited_email" IS NOT NULL OR "revoked_at" IS NOT NULL)
  NOT VALID;

ALTER TABLE "project_join_codes"
  VALIDATE CONSTRAINT "project_join_codes_email_bound_or_revoked_check";

ALTER TABLE "project_join_codes"
  ADD CONSTRAINT "project_join_codes_normalized_email_check"
  CHECK ("invited_email" IS NULL OR "invited_email" = LOWER(BTRIM("invited_email")))
  NOT VALID;

ALTER TABLE "project_join_codes"
  VALIDATE CONSTRAINT "project_join_codes_normalized_email_check";

ALTER TABLE "project_join_codes"
  ADD CONSTRAINT "project_join_codes_single_use_or_revoked_check"
  CHECK ("max_uses" = 1 OR "revoked_at" IS NOT NULL)
  NOT VALID;

ALTER TABLE "project_join_codes"
  VALIDATE CONSTRAINT "project_join_codes_single_use_or_revoked_check";

ALTER TABLE "project_join_codes"
  ADD CONSTRAINT "project_join_codes_usage_bounds_check"
  CHECK ("max_uses" >= 1 AND "use_count" >= 0 AND "use_count" <= "max_uses")
  NOT VALID;

ALTER TABLE "project_join_codes"
  VALIDATE CONSTRAINT "project_join_codes_usage_bounds_check";

CREATE TABLE "project_join_code_redemptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "join_code_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "redeemed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_join_code_redemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_join_code_redemptions_join_code_id_key" UNIQUE ("join_code_id"),
  CONSTRAINT "project_join_code_redemptions_project_id_user_id_key" UNIQUE ("project_id", "user_id")
);

ALTER TABLE "project_join_code_redemptions"
  ADD CONSTRAINT "project_join_code_redemptions_join_code_id_fkey"
  FOREIGN KEY ("join_code_id") REFERENCES "project_join_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_join_code_redemptions"
  ADD CONSTRAINT "project_join_code_redemptions_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_join_code_redemptions"
  ADD CONSTRAINT "project_join_code_redemptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "project_join_code_redemptions_user_id_redeemed_at_idx"
  ON "project_join_code_redemptions"("user_id", "redeemed_at");

ALTER TABLE "project_join_code_redemptions" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "project_join_code_redemptions"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;
