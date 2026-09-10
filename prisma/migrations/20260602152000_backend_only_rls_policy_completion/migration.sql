-- Complete backend-only direct-client denial for beta public tables.
-- Additive and idempotent: no data changes, no destructive DDL.

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'project_drive_connections',
    'project_drive_files',
    'project_drive_sync_roots',
    'project_drive_sync_runs',
    'project_drive_watch_channels',
    'project_join_codes',
    'project_suggestion_actions',
    'user_notification_preferences'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy
      WHERE polrelid = format('public.%I', table_name)::regclass
        AND polname = 'backend_api_only_no_direct_client_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        'backend_api_only_no_direct_client_access',
        table_name
      );
    END IF;
  END LOOP;
END
$$;
