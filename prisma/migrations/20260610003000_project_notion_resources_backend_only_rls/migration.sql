-- Enforce backend-only direct-client denial for selected Notion resource metadata.
-- Additive and idempotent: no data changes, no destructive DDL.

ALTER TABLE "project_notion_resources" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid = 'public.project_notion_resources'::regclass
      AND polname = 'backend_api_only_no_direct_client_access'
  ) THEN
    CREATE POLICY "backend_api_only_no_direct_client_access"
      ON "project_notion_resources"
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END
$$;
