-- Activate the backend-only policy contract on every remaining public table.
-- The API and worker connect through the migration role; Supabase browser roles
-- are explicitly denied even if grants are added later.
DO $$
DECLARE
  table_record record;
  backend_role name := current_user;
BEGIN
  IF backend_role IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'backend-only RLS completion cannot run as a browser role';
  END IF;

  FOR table_record IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.oid AS table_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      table_record.schema_name,
      table_record.table_name
    );

    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polrelid = table_record.table_oid
        AND polname = 'backend_api_only_no_direct_client_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        'backend_api_only_no_direct_client_access',
        table_record.schema_name,
        table_record.table_name
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polrelid = table_record.table_oid
        AND polname = 'backend_database_role_full_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)',
        'backend_database_role_full_access',
        table_record.schema_name,
        table_record.table_name,
        backend_role
      );
    END IF;
  END LOOP;
END
$$;

ALTER FUNCTION public.sync_user_global_identity()
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.sync_legacy_user_organization_membership()
  SET search_path = pg_catalog, public;
