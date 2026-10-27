-- Rollback of 20261022090300_audit_log_integrity.sql
-- WARNING: re-opens QA finding S-06a (forged audit entries).
BEGIN;
DROP TRIGGER IF EXISTS trg_guard_audit_log_insert ON public.audit_logs;
DROP FUNCTION IF EXISTS public.guard_audit_log_insert();
DROP POLICY IF EXISTS "Insert own audit logs" ON public.audit_logs;
CREATE POLICY "Insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (actor_employee_id IN (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid()) OR get_auth_role() = 'Admin');
-- UPDATE / DELETE / TRUNCATE are not re-granted (there was never a policy allowing them).
COMMIT;
