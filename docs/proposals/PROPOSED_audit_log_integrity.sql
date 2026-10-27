-- =============================================================================================
-- PROPOSED (NOT APPLIED) — audit logs: a user can only write entries for their own actions
-- =============================================================================================
-- Found during QA (2026-10-22), finding S-06a (P1: audit-trail integrity).
--
-- Defect
--   0009_security_hardening.sql:   CREATE POLICY "Insert audit logs" ON audit_logs FOR INSERT TO authenticated
--                                  WITH CHECK (true);
--   20261002094500_fix_payroll_rls.sql later added a stricter policy ("actor = me OR role = 'Admin'"), but
--   permissive policies are OR-ed, so the WITH CHECK (true) policy still lets ANY signed-in employee insert
--   an audit entry with any actor_employee_id, action, module and source — e.g. a fake
--   "PAYROLL_APPROVED by <HR employee>" entry. Reproduced on a throwaway database (QA probe S-06a).
--   (The stricter policy also compares with 'Admin', but roles are stored upper-case: 'ADMIN'.)
--
-- Fix
--   Drop the WITH CHECK (true) policy and keep exactly one INSERT policy: actor_employee_id must be the
--   caller's own employee id. Server-side writers (SECURITY DEFINER functions such as the automatic-break
--   functions, triggers, service_role) are not affected — they are not subject to these policies.
--   auditService.recordAuditLog() already sets actor_employee_id to the signed-in employee, so the app's
--   own audit writes keep working. (Entries whose actor could not be resolved — actorId null — are refused;
--   that is intended: an anonymous audit entry from a browser is not trustworthy.)
--
-- Read-only checks first (on the target, after confirming it is STAGING):
--   SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE tablename = 'audit_logs' ORDER BY 1;
--   -- entries whose actor differs from... cannot be detected after the fact; review recent PAYROLL / AUTH entries:
--   SELECT created_at, actor_employee_id, action, module, source FROM audit_logs ORDER BY created_at DESC LIMIT 50;
--
-- Rollback:
--   CREATE POLICY "Insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);   -- (re-opens S-06a)
-- =============================================================================================

BEGIN;

DROP POLICY IF EXISTS "Insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_logs;

CREATE POLICY "Insert own audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_employee_id IS NOT NULL AND actor_employee_id = public.get_auth_employee_id());

COMMIT;
