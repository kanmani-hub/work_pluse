-- Fix missing privileges for service_role on all public tables.
-- The service_role PostgreSQL role was missing SELECT, INSERT, UPDATE, DELETE
-- on public schema tables, which prevented Edge Functions using the
-- service-role key from performing database operations.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

-- Ensure future tables also get these grants automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
