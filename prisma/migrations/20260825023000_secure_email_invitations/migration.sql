ALTER TABLE "project_join_codes"
  ADD COLUMN IF NOT EXISTS "link_token_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "link_token_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "email_delivery_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "email_delivery_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "email_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "email_delivery_error" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "project_join_codes_link_token_hash_key"
  ON "project_join_codes"("link_token_hash");

CREATE TABLE IF NOT EXISTS "user_email_verification_tokens" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_email_verification_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_verification_tokens_token_hash_key"
  ON "user_email_verification_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "user_email_verification_tokens_user_id_consumed_at_expires_at_idx"
  ON "user_email_verification_tokens"("user_id", "consumed_at", "expires_at");

-- Verification tokens are backend-only security credentials. Browser-facing
-- Supabase roles must never read their hashes or mutate token state directly.
ALTER TABLE "user_email_verification_tokens" ENABLE ROW LEVEL SECURITY;

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

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "user_email_verification_tokens"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  EXECUTE format(
    'CREATE POLICY %I ON public.user_email_verification_tokens AS PERMISSIVE FOR ALL TO %s USING (true) WITH CHECK (true)',
    'backend_database_role_full_access', backend_role_list
  );
END
$$;
