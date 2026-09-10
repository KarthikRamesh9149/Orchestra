-- Fix 9: durable refresh-token families for HttpOnly browser sessions.

ALTER TABLE "refresh_tokens"
  ADD COLUMN "session_id" UUID,
  ADD COLUMN "parent_token_id" UUID,
  ADD COLUMN "client_type" TEXT NOT NULL DEFAULT 'bearer',
  ADD COLUMN "replaced_at" TIMESTAMPTZ(6),
  ADD COLUMN "reuse_detected_at" TIMESTAMPTZ(6),
  ADD COLUMN "revoke_reason" TEXT;

-- Every pre-Fix-9 token becomes its own backward-compatible session family.
UPDATE "refresh_tokens"
SET "session_id" = "id"
WHERE "session_id" IS NULL;

ALTER TABLE "refresh_tokens"
  ALTER COLUMN "session_id" SET DEFAULT gen_random_uuid(),
  ALTER COLUMN "session_id" SET NOT NULL;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_client_type_check"
  CHECK ("client_type" IN ('browser', 'bearer'))
  NOT VALID;

ALTER TABLE "refresh_tokens"
  VALIDATE CONSTRAINT "refresh_tokens_client_type_check";

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_rotation_state_check"
  CHECK (
    ("replaced_at" IS NULL OR "revoked_at" IS NOT NULL)
    AND ("reuse_detected_at" IS NULL OR "revoked_at" IS NOT NULL)
  )
  NOT VALID;

ALTER TABLE "refresh_tokens"
  VALIDATE CONSTRAINT "refresh_tokens_rotation_state_check";

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_parent_token_id_fkey"
  FOREIGN KEY ("parent_token_id") REFERENCES "refresh_tokens"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "refresh_tokens_session_id_active_idx"
  ON "refresh_tokens"("session_id", "expires_at")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "refresh_tokens_parent_token_id_idx"
  ON "refresh_tokens"("parent_token_id");

CREATE INDEX "refresh_tokens_user_id_org_id_session_id_idx"
  ON "refresh_tokens"("user_id", "org_id", "session_id");

CREATE INDEX "refresh_tokens_org_id_idx"
  ON "refresh_tokens"("org_id");

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND NOT EXISTS (
       SELECT 1 FROM pg_policy
       WHERE polrelid = 'public.refresh_tokens'::regclass
         AND polname = 'backend_api_only_no_direct_client_access'
     ) THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "refresh_tokens"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

-- Reuse the backend role already approved by the membership hardening migrations.
DO $$
DECLARE
  backend_role_list text;
BEGIN
  SELECT string_agg(format('%I', roles.rolname), ', ' ORDER BY roles.rolname)
  INTO backend_role_list
  FROM pg_policy policies
  CROSS JOIN LATERAL unnest(policies.polroles) AS policy_role(role_oid)
  JOIN pg_roles roles ON roles.oid = policy_role.role_oid
  WHERE policies.polrelid = 'public.organization_memberships'::regclass
    AND policies.polname = 'backend_database_role_full_access'
    AND roles.rolname NOT IN ('anon', 'authenticated');

  IF backend_role_list IS NULL THEN
    RAISE EXCEPTION 'no approved Orchestra backend database role is available';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.refresh_tokens'::regclass
      AND polname = 'backend_database_role_full_access'
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON public.refresh_tokens AS PERMISSIVE FOR ALL TO %s USING (true) WITH CHECK (true)',
      'backend_database_role_full_access',
      backend_role_list
    );
  END IF;
END
$$;
