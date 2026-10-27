-- =============================================================================================
-- 20261022090400_remove_email_admin_provisioning.sql
-- No account is ever given admin rights because of its e-mail address (QA finding S-12) + function hardening.
--
-- 20260930163000_restore_admin_profile.sql installed
--   trg_admin_auth_sync AFTER INSERT ON auth.users -> public.handle_admin_auth_sync()
-- which re-points the ADMIN-001 employee/profile to ANY newly created auth user whose e-mail is
-- admin@gmail.com. That is e-mail-based admin provisioning (removed everywhere else by
-- 20261014090000_admin_security_hardening.sql). Today it fails only by accident (it changes employees.id
-- while profiles still reference the old id -> foreign-key error), which also makes it impossible to
-- create an auth user with that address at all.
--
-- This migration removes the trigger and function. Existing administrators are NOT touched: no profile,
-- employee or auth user is changed or deleted. New administrators are provisioned explicitly by an
-- existing ADMIN (create-employee edge function, which checks the caller's ADMIN profile) or by the
-- project owner in SQL as postgres.
--
-- Also: trigger_push_notification_webhook() is SECURITY DEFINER without a fixed search_path
-- (QA finding S-11); pin it.
-- Rollback: supabase/rollbacks/20261022090400_remove_email_admin_provisioning.rollback.sql
-- =============================================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_admin_auth_sync ON auth.users;
DROP FUNCTION IF EXISTS public.handle_admin_auth_sync();

DO $$
BEGIN
  IF to_regprocedure('public.trigger_push_notification_webhook()') IS NOT NULL THEN
    ALTER FUNCTION public.trigger_push_notification_webhook() SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.trigger_push_notification_webhook() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

COMMIT;
