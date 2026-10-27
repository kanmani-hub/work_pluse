-- =============================================================================================
-- PROPOSED (NOT APPLIED) — remove the admin@gmail.com auth-sync trigger
-- =============================================================================================
-- Found during QA (2026-10-22). Migration 20260930163000_restore_admin_profile.sql installs
--   trg_admin_auth_sync AFTER INSERT ON auth.users  →  public.handle_admin_auth_sync()
-- which, whenever ANY new auth user with the e-mail admin@gmail.com is created, re-points the ADMIN-001
-- employee and profile to that new auth user.
--
-- Why it is a defect
--   * Security: it is e-mail-based admin provisioning — the pattern removed elsewhere by
--     20261014090000_admin_security_hardening.sql (C1). If the admin account were ever deleted and the
--     address re-registered (or e-mail confirmation were off), the new account would receive the ADMIN
--     profile. Today this does NOT succeed only by accident: the function changes employees.id while
--     profiles.employee_id still references the old id, so the INSERT into auth.users fails with
--     "violates foreign key constraint profiles_employee_id_fkey".
--   * Function: because of that error, an admin@gmail.com auth user can never be (re)created — on a fresh
--     STAGING project the bootstrap admin cannot sign up with that address at all.
--
-- Read-only check (run first, on the target):
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_admin_auth_sync';
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'handle_admin_auth_sync';
--   SELECT e.employee_code, p.auth_user_id, p.is_active FROM employees e JOIN profiles p ON p.employee_id = e.id
--    WHERE e.employee_code = 'ADMIN-001';
--
-- After applying: admins are provisioned explicitly (create the auth user, then insert / update the
-- profile row as ADMIN via SQL as postgres or the create-employee edge function). Nothing links accounts
-- by e-mail.
-- Rollback: re-run the trigger section of 20260930163000_restore_admin_profile.sql (not recommended).

BEGIN;
DROP TRIGGER IF EXISTS trg_admin_auth_sync ON auth.users;
DROP FUNCTION IF EXISTS public.handle_admin_auth_sync();
COMMIT;
