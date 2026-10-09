-- =====================================================================================
-- PROPOSED — NOT APPLIED. Do NOT run without approval.
-- WorkPulse HR: Employee Login & RBAC security fixes (Issue 8 + Issue 7)
--
-- Kept OUTSIDE supabase/migrations on purpose so it cannot be applied by accident.
-- Apply ONLY after the Edge Functions in docs/security/employee-login-security.md are
-- deployed and the client is switched over, otherwise Employee-ID login stops working.
-- =====================================================================================

BEGIN;

-- -------------------------------------------------------------------------------------
-- ISSUE 8 — Employee ID -> email lookup is callable by anyone (anon)
-- -------------------------------------------------------------------------------------
-- 0015_resolve_employee_email.sql created get_email_by_employee_code() as SECURITY
-- DEFINER with no REVOKE, so PostgreSQL's default "EXECUTE TO PUBLIC" applies and the
-- anon key (shipped in the browser bundle) can call it via /rest/v1/rpc and receive the
-- email of any employee code (EMP001, EMP002, ... are sequential).

-- 8a. Remove browser access. Only the server (service_role) may resolve codes.
REVOKE EXECUTE ON FUNCTION public.get_email_by_employee_code(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_email_by_employee_code(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_email_by_employee_code(TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_email_by_employee_code(TEXT) TO service_role;

-- 8b. Case-insensitive, trimmed lookup (EMP001 = emp001 = Emp001).
CREATE OR REPLACE FUNCTION public.get_email_by_employee_code(p_employee_code TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.email
  FROM employees e
  WHERE upper(e.employee_code) = upper(btrim(p_employee_code))
  LIMIT 1;
$$;
-- CREATE OR REPLACE keeps the grants above; re-assert to be explicit:
REVOKE EXECUTE ON FUNCTION public.get_email_by_employee_code(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_email_by_employee_code(TEXT) TO service_role;

-- Helps the upper() lookup (employee_code is already UNIQUE).
CREATE INDEX IF NOT EXISTS idx_employees_code_upper ON employees (upper(employee_code));

-- -------------------------------------------------------------------------------------
-- ISSUE 7 — "force password change" flag is user-editable
-- -------------------------------------------------------------------------------------
-- Today the flag lives in auth.users.raw_user_meta_data (user_metadata), which the user
-- can change with supabase.auth.updateUser({ data: { force_password_change: false } })
-- WITHOUT changing the password; the check is only in the React route guard.
-- Fix: move it to app_metadata (only service_role can write it) and enforce it in the
-- database helpers that every role/ownership RLS policy uses.

-- 7a. Copy existing pending flags to app_metadata (server-only).
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('force_password_change', true)
WHERE COALESCE((raw_user_meta_data ->> 'force_password_change')::boolean, false) = true;

-- 7b. True while the signed-in user still has to change the admin-issued password.
--     Reads the JWT, so it takes effect at the next token refresh (<= 1 hour) or login.
CREATE OR REPLACE FUNCTION public.password_change_pending()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'force_password_change')::boolean, false);
$$;

-- 7c. Deny data access while a password change is pending: role-based AND ownership-based
--     policies both go through these two helpers, so they return NULL (= no access).
--     (Bodies are the CURRENT definitions from 20260930163500_fix_get_auth_role.sql and
--     0009_security_hardening.sql, with only the pending-change condition added.)
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.password_change_pending() THEN NULL ELSE
    COALESCE(
      (
        SELECT r.name
        FROM profiles p
        JOIN roles r ON p.role_id = r.id
        WHERE p.auth_user_id = auth.uid()
          AND p.is_active = true
        LIMIT 1
      ),
      CASE
        WHEN auth.jwt()->>'email' = 'admin@gmail.com' THEN 'ADMIN'
        ELSE NULL
      END
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_employee_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.password_change_pending() THEN NULL ELSE
    (SELECT employee_id
     FROM profiles
     WHERE auth_user_id = auth.uid()
       AND is_active = true
     LIMIT 1)
  END;
$$;

COMMIT;

-- NOTE: policies that use auth.uid() directly (not the two helpers) are NOT covered by 7c.
-- Before applying, list them with:
--   SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies
--   WHERE (qual ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.uid()%')
--     AND qual NOT ILIKE '%get_auth_%';
--
-- ROLLBACK (if needed):
--   GRANT EXECUTE ON FUNCTION public.get_email_by_employee_code(TEXT) TO anon, authenticated;
--   re-run 20260930163500_fix_get_auth_role.sql and the get_auth_employee_id() block of 0009.
