-- Supabase advisor hardening for backend-only MVP access.
-- This migration keeps the backend API/worker as the data boundary:
-- anon/authenticated Data API roles remain unable to read or write public tables.

CREATE SCHEMA IF NOT EXISTS "extensions";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT USAGE ON SCHEMA "extensions" TO "anon";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA "extensions" TO "authenticated";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA "extensions" TO "service_role";
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER EXTENSION "vector" SET SCHEMA "extensions";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    ALTER EXTENSION "pg_trgm" SET SCHEMA "extensions";
  END IF;
END
$$;

DO $$
DECLARE
  table_oid oid;
  table_name text;
BEGIN
  FOR table_oid, table_name IN
    SELECT c.oid, c.oid::regclass::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy
      WHERE polrelid = table_oid
        AND polname = 'backend_api_only_no_direct_client_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %s AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        'backend_api_only_no_direct_client_access',
        table_name
      );
    END IF;
  END LOOP;
END
$$;

DROP INDEX IF EXISTS "dashboard_snapshots_project_idx";
DROP INDEX IF EXISTS "socrates_citations_project_ref_idx";
