-- =============================================================================================
-- PROPOSED (NOT APPLIED) — stop employees approving their own leave / WFH / permission requests
-- =============================================================================================
-- Found during QA (2026-10-22), finding S-01 (severity P0: affects leave balances, attendance
-- exemptions and payroll deductions).
--
-- Defect
--   0009_security_hardening.sql (and 20260929123000_fix_wfh_rls.sql for WFH) give employees
--     FOR UPDATE USING (... OR employee_id = get_auth_employee_id())     -- no WITH CHECK, no column limits
--     FOR INSERT WITH CHECK (... OR employee_id = get_auth_employee_id()) -- status not checked
--   so a signed-in employee can, straight through the Supabase REST API (the UI is not involved):
--     * UPDATE leave_requests / wfh_requests / permission_requests SET status = 'APPROVED' on their own row,
--     * INSERT a request that is already 'APPROVED' with reviewed_by set to any HR employee,
--     * change the dates of a request that HR already approved.
--   Reproduced on a throwaway database built from all repository migrations (QA probe S-01a/b/c).
--
-- Fix (database-enforced, does not rely on the client)
--   A BEFORE INSERT OR UPDATE trigger on the three tables. ADMIN / HR and the database roles postgres,
--   service_role and supabase_admin are not restricted. Everyone else:
--     INSERT  status must be PENDING and reviewed_by / reviewed_at / reviewer_remarks must be empty;
--     UPDATE  only while the stored row is PENDING; the new status may only be PENDING or CANCELLED;
--             employee_id, requested_at and the reviewer fields cannot change.
--   This matches what the app already does (employees create PENDING requests and cancel PENDING ones,
--   leaveService / wfhService / permissionService cancel*()), so no client change is needed.
--
-- Read-only checks first (on the target, after confirming it is STAGING):
--   SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--    WHERE tablename IN ('leave_requests','wfh_requests','permission_requests') ORDER BY 1,2;
--   SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname LIKE 'trg_request_approval_guard%';
--   -- rows an employee approved for themselves (approver = requester), for HR to review:
--   SELECT 'leave' t, id, employee_id, status, reviewed_at FROM leave_requests WHERE reviewed_by = employee_id
--   UNION ALL SELECT 'wfh', id, employee_id, status, reviewed_at FROM wfh_requests WHERE reviewed_by = employee_id
--   UNION ALL SELECT 'permission', id, employee_id, status, reviewed_at FROM permission_requests WHERE reviewed_by = employee_id;
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.leave_requests;
--   DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.wfh_requests;
--   DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.permission_requests;
--   DROP FUNCTION IF EXISTS public.guard_request_approval();
-- =============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_request_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER   -- must stay INVOKER: under DEFINER, current_user would be the owner (postgres) and every check would pass
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR COALESCE(public.get_auth_role(), '') IN ('ADMIN', 'HR') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'PENDING'
       OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reviewer_remarks IS NOT NULL THEN
      RAISE EXCEPTION 'New requests must be PENDING and cannot carry a review' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Only PENDING requests can be changed by the employee' USING ERRCODE = '42501';
  END IF;
  IF NEW.status NOT IN ('PENDING', 'CANCELLED') THEN
    RAISE EXCEPTION 'Employees can only cancel their own requests' USING ERRCODE = '42501';
  END IF;
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.reviewer_remarks IS DISTINCT FROM OLD.reviewer_remarks THEN
    RAISE EXCEPTION 'Review fields are set by HR only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_request_approval() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.leave_requests;
CREATE TRIGGER trg_request_approval_guard BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_request_approval();

DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.wfh_requests;
CREATE TRIGGER trg_request_approval_guard BEFORE INSERT OR UPDATE ON public.wfh_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_request_approval();

DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.permission_requests;
CREATE TRIGGER trg_request_approval_guard BEFORE INSERT OR UPDATE ON public.permission_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_request_approval();

COMMIT;
