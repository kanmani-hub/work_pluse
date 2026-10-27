-- =============================================================================================
-- 20261022090000_request_approval_guards.sql
-- Leave / WFH / permission requests: approval is enforced by the database (QA finding S-01, P0).
--
-- Before: the UPDATE policies of 0009_security_hardening.sql / 20260929123000_fix_wfh_rls.sql let the
-- owner update ANY column of their own request, so an employee could approve their own leave, WFH or
-- permission straight through the REST API, insert a request that was already APPROVED, forge
-- reviewed_by, or move the dates of an approved request.
--
-- Rules enforced here (BEFORE INSERT OR UPDATE trigger on the three tables):
--   * Trusted database roles (postgres, service_role, supabase_admin: migrations, cron, SECURITY DEFINER
--     functions) are not restricted.
--   * Own request (any role, including ADMIN/HR): create only as PENDING with no review; while PENDING the
--     owner may edit it or cancel it (PENDING -> CANCELLED). Nobody approves or rejects their own request.
--   * ADMIN / HR on someone else's request:
--       insert on behalf of an employee as PENDING, or as APPROVED (recorded as reviewed by the caller);
--       status changes: PENDING -> APPROVED | REJECTED | CANCELLED, APPROVED -> CANCELLED (revoke).
--       REJECTED and CANCELLED are final. Approving twice or approve-then-reject races are refused.
--   * reviewed_by / reviewed_at are always set by the database from the signed-in reviewer and the
--     database clock; the values sent by the client are ignored. requested_at is the database time.
--   * employee_id (the owner) can never be changed.
-- The approval itself is the audit record: reviewed_by + reviewed_at cannot be forged.
--
-- Matches the app: employees create PENDING requests and cancel PENDING ones; admin screens approve,
-- reject and revoke (leaveService / wfhService / permissionService).
-- Rollback: supabase/rollbacks/20261022090000_request_approval_guards.rollback.sql
-- =============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_request_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER   -- must stay INVOKER: under DEFINER current_user would be the owner and every check would pass
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_me uuid;
  v_reviewer boolean;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  v_role := COALESCE(public.get_auth_role(), '');
  v_me := public.get_auth_employee_id();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'No active employee profile for this account' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_reviewer := v_role IN ('ADMIN', 'HR') AND NEW.employee_id IS DISTINCT FROM v_me;
    NEW.requested_at := now();
    NEW.reviewer_remarks := CASE WHEN v_reviewer THEN NEW.reviewer_remarks ELSE NULL END;
    IF v_reviewer AND NEW.status = 'APPROVED' THEN
      NEW.reviewed_by := v_me;
      NEW.reviewed_at := now();
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM 'PENDING' THEN
      RAISE EXCEPTION 'A new request must be PENDING' USING ERRCODE = '42501';
    END IF;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'The owner of a request cannot be changed' USING ERRCODE = '42501';
  END IF;
  NEW.requested_at := OLD.requested_at;
  v_reviewer := v_role IN ('ADMIN', 'HR') AND OLD.employee_id IS DISTINCT FROM v_me;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    -- no decision: the review stamp cannot be changed
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    IF NOT v_reviewer THEN
      IF OLD.status IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'Only a PENDING request can be changed by its owner' USING ERRCODE = '42501';
      END IF;
      NEW.reviewer_remarks := OLD.reviewer_remarks;
    END IF;
    RETURN NEW;
  END IF;

  -- a status change (a decision)
  IF v_reviewer THEN
    IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED'))
         OR (OLD.status = 'APPROVED' AND NEW.status = 'CANCELLED')) THEN
      RAISE EXCEPTION 'This request is already %; it cannot be changed to %', OLD.status, NEW.status
        USING ERRCODE = '55000';   -- object_not_in_prerequisite_state (stale screen / second reviewer)
    END IF;
    NEW.reviewed_by := v_me;
    NEW.reviewed_at := now();
    RETURN NEW;
  END IF;

  -- the owner (employee, or an admin/HR acting on their own request)
  IF NOT (OLD.status = 'PENDING' AND NEW.status = 'CANCELLED') THEN
    RAISE EXCEPTION 'You can only cancel your own PENDING request; approval is done by HR'
      USING ERRCODE = '42501';
  END IF;
  NEW.reviewed_by := OLD.reviewed_by;
  NEW.reviewed_at := OLD.reviewed_at;
  NEW.reviewer_remarks := OLD.reviewer_remarks;
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

-- Requests are never deleted through the API (there is no DELETE policy today; keep it that way).
COMMIT;
