CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER DATABASE orchestra_shared SET search_path = public, extensions;
