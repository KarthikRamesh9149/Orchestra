-- Compatibility prerequisites for the immutable hosted migration history.
-- These names confer no login and no client access on plain PostgreSQL.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER DATABASE orchestra_desktop SET search_path = public, extensions;
-- This Compose superuser is migration/test-only. Consumer provisioning must
-- create a separate non-superuser runtime role and never expose migrator access.
