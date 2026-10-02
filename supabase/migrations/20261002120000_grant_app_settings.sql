-- Fix database permissions (42501 permission denied) for app_settings
-- The table was created but explicit grants to authenticated/anon roles were missing.

-- Grant SELECT, INSERT, UPDATE to authenticated users.
-- We do NOT grant DELETE, as the application never deletes the global settings row.
-- RLS policies will enforce that only ADMINs can actually INSERT/UPDATE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_settings TO authenticated;

-- Grant to service_role to ensure backend functions have full access.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_settings TO service_role;

-- Grant to anon for SELECT if any unauthenticated edge cases require reading config
-- (Though typically the frontend only loads this after auth, it is safe to read global settings).
GRANT SELECT ON TABLE public.app_settings TO anon;
