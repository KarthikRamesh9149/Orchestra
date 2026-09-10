-- Prepare environment-aware backend policies before the following migration
-- activates RLS, preventing a runtime-access gap between migrations.
DO $$
DECLARE
  table_record record;
  backend_roles text;
BEGIN
  SELECT string_agg(format('%I', role.rolname), ', ' ORDER BY role.rolname)
  INTO backend_roles
  FROM pg_roles role
  WHERE role.rolname = current_user
     OR role.rolname ~ '^orchestra_[a-z0-9_]+_runtime$';

  IF backend_roles IS NULL THEN
    RAISE EXCEPTION 'no Orchestra backend database role is available';
  END IF;

  FOR table_record IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.oid AS table_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polrelid = table_record.table_oid
        AND polname = 'backend_database_role_full_access'
    ) THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I TO %s USING (true) WITH CHECK (true)',
        'backend_database_role_full_access',
        table_record.schema_name,
        table_record.table_name,
        backend_roles
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR ALL TO %s USING (true) WITH CHECK (true)',
        'backend_database_role_full_access',
        table_record.schema_name,
        table_record.table_name,
        backend_roles
      );
    END IF;
  END LOOP;
END
$$;
