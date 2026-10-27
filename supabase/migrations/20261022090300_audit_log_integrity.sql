-- =============================================================================================
-- 20261022090300_audit_log_integrity.sql
-- Audit entries written from the browser are always attributed to the signed-in user (QA finding S-06a).
--
-- Before: "Insert audit logs" (0009) is WITH CHECK (true). Permissive policies are OR-ed, so the stricter
-- policy added by 20261002094500_fix_payroll_rls.sql (which also compared with 'Admin' instead of
-- 'ADMIN') had no effect: any employee could write e.g. "PAYROLL_APPROVED by <HR employee>".
--
-- After:
--   * One INSERT policy: actor_employee_id must be the caller's own employee id.
--   * A BEFORE INSERT trigger sets created_at from the database clock and refuses source = 'SYSTEM' from
--     a browser session (SYSTEM entries come only from server-side code).
--   * There is still no UPDATE or DELETE policy: audit entries cannot be changed or removed through the
--     API by anyone. Reading stays ADMIN/HR (plus an employee's own payroll entries, 20261002094500).
--   * Server-side writers (SECURITY DEFINER functions, triggers, service_role) are not affected.
-- Rollback: supabase/rollbacks/20261022090300_audit_log_integrity.rollback.sql
-- =============================================================================================

BEGIN;

DROP POLICY IF EXISTS "Insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Insert own audit logs" ON public.audit_logs;
CREATE POLICY "Insert own audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_employee_id IS NOT NULL AND actor_employee_id = public.get_auth_employee_id());

CREATE OR REPLACE FUNCTION public.guard_audit_log_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  NEW.created_at := now();
  IF upper(COALESCE(NEW.source, '')) = 'SYSTEM' THEN
    RAISE EXCEPTION 'SYSTEM audit entries are written by the server only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_audit_log_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_audit_log_insert ON public.audit_logs;
CREATE TRIGGER trg_guard_audit_log_insert BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_audit_log_insert();

REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated;

COMMIT;
