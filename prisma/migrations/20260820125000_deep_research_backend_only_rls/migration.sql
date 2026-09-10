-- Deep Research is served only through Orchestra's authorized API and worker.
-- Browser-facing Supabase roles must never read or mutate these runs directly.
ALTER TABLE "deep_research_runs" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  backend_role name := current_user;
BEGIN
  IF backend_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'deep research RLS migration cannot run as a browser role';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid = 'public.deep_research_runs'::regclass
      AND polname = 'backend_api_only_no_direct_client_access'
  ) THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "deep_research_runs"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid = 'public.deep_research_runs'::regclass
      AND polname = 'backend_database_role_full_access'
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON public.deep_research_runs AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)',
      'backend_database_role_full_access',
      backend_role
    );
  END IF;
END
$$;
