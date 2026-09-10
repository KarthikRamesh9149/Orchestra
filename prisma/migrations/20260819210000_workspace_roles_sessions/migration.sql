-- Fix 10: authoritative workspace context, honest identity state, and session activity metadata.

ALTER TABLE "users"
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_login_at" TIMESTAMPTZ(6);

ALTER TABLE "refresh_tokens"
  ADD COLUMN "active_project_id" UUID,
  ADD COLUMN "device_label" TEXT,
  ADD COLUMN "device_type" TEXT,
  ADD COLUMN "user_agent_hash" TEXT,
  ADD COLUMN "ip_address_hash" TEXT,
  ADD COLUMN "ip_label" TEXT,
  ADD COLUMN "last_used_at" TIMESTAMPTZ(6);

UPDATE "refresh_tokens"
SET "last_used_at" = "created_at"
WHERE "last_used_at" IS NULL;

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "last_used_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "last_used_at" SET NOT NULL,
  ADD CONSTRAINT "refresh_tokens_active_project_id_fkey"
    FOREIGN KEY ("active_project_id") REFERENCES "projects"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "refresh_tokens_device_type_check"
    CHECK ("device_type" IS NULL OR "device_type" IN ('browser', 'laptop', 'phone', 'tablet', 'api', 'unknown'));

CREATE INDEX "refresh_tokens_active_project_id_idx"
  ON "refresh_tokens"("active_project_id");

CREATE INDEX "refresh_tokens_user_active_last_used_idx"
  ON "refresh_tokens"("user_id", "revoked_at", "expires_at", "last_used_at");

CREATE OR REPLACE FUNCTION "enforce_refresh_token_active_project"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW."active_project_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "projects" p
    JOIN "project_members" pm
      ON pm."project_id" = p."id"
     AND pm."user_id" = NEW."user_id"
     AND pm."is_active" = TRUE
    JOIN "organization_memberships" om
      ON om."organization_id" = p."org_id"
     AND om."user_id" = NEW."user_id"
     AND om."is_active" = TRUE
    WHERE p."id" = NEW."active_project_id"
      AND p."org_id" = NEW."org_id"
      AND p."status" = 'active'::"ProjectStatus"
  ) THEN
    RAISE EXCEPTION 'refresh token active project must be an active same-organization membership'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "refresh_tokens_active_project_guard"
BEFORE INSERT OR UPDATE OF "active_project_id", "org_id", "user_id"
ON "refresh_tokens"
FOR EACH ROW EXECUTE FUNCTION "enforce_refresh_token_active_project"();

-- refresh_tokens remains backend-only under the RLS policy introduced by Fix 9.
