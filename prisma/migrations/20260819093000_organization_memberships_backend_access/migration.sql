-- Permit only the database role that runs Orchestra's canonical migrations.
-- Supabase browser roles remain governed by the restrictive deny policy.
DO $$
DECLARE
  backend_role name := current_user;
BEGIN
  IF backend_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'organization membership migration cannot run as a browser role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid = 'public.organization_memberships'::regclass
      AND polname = 'backend_database_role_full_access'
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON public.organization_memberships AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)',
      'backend_database_role_full_access',
      backend_role
    );
  END IF;
END
$$;
