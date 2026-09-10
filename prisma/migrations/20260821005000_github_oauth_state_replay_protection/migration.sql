-- Fix 34: durable, single-use GitHub OAuth and App-installation state.
CREATE TABLE "github_oauth_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "purpose" TEXT NOT NULL,
  "nonce_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "github_oauth_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "github_oauth_states_nonce_hash_key" UNIQUE ("nonce_hash"),
  CONSTRAINT "github_oauth_states_purpose_check"
    CHECK ("purpose" IN ('installation', 'user_link'))
);

ALTER TABLE "github_oauth_states"
  ADD CONSTRAINT "github_oauth_states_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "github_oauth_states"
  ADD CONSTRAINT "github_oauth_states_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "github_oauth_states_expires_at_idx"
  ON "github_oauth_states"("expires_at");

CREATE INDEX "github_oauth_states_actor_user_id_idx"
  ON "github_oauth_states"("actor_user_id");

CREATE INDEX "github_oauth_states_org_id_actor_user_id_purpose_used_at_idx"
  ON "github_oauth_states"("org_id", "actor_user_id", "purpose", "used_at");

ALTER TABLE "github_oauth_states" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "github_oauth_states"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;

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

  EXECUTE format(
    'CREATE POLICY %I ON public.github_oauth_states AS PERMISSIVE FOR ALL TO %s USING (true) WITH CHECK (true)',
    'backend_database_role_full_access',
    backend_role_list
  );
END
$$;
