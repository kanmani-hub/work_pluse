-- =============================================================================================
-- 20261022100100_permission_overlap_guard.sql
-- Permission requests of one employee may not overlap in time on the same day (QA finding B-11).
--
-- Before: nothing stopped two permissions at the same time (e.g. 10:00–11:00 and 10:30–12:00), so the
-- permission hours were counted twice (attendance exemptions, payroll permission deduction).
--
-- After: a BEFORE INSERT / UPDATE trigger refuses a PENDING or APPROVED permission whose time overlaps
-- another PENDING or APPROVED permission of the same employee on the same date. Touching intervals
-- (10:00–11:00 and 11:00–12:00) are allowed; REJECTED / CANCELLED requests free the time again.
-- A transaction-level advisory lock per employee + date makes two simultaneous inserts safe.
-- Existing rows are not changed or re-checked (only new writes are validated); the read-only check below
-- lists existing overlaps for HR to review.
--   SELECT a.employee_id, a.permission_date, a.id, b.id FROM permission_requests a JOIN permission_requests b
--     ON a.employee_id = b.employee_id AND a.permission_date = b.permission_date AND a.id < b.id
--    AND a.status IN ('PENDING','APPROVED') AND b.status IN ('PENDING','APPROVED')
--    AND a.start_time < b.end_time AND b.start_time < a.end_time;
-- Same rule in the app: src/services/permission/permissionOverlapRules.ts.
-- Rollback: supabase/rollbacks/20261022100100_permission_overlap_guard.rollback.sql
-- =============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_permission_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER            -- must see every request of the employee, whatever the caller's RLS view
SET search_path = public, pg_temp
AS $$
DECLARE v_clash record;
BEGIN
  IF NEW.status NOT IN ('PENDING', 'APPROVED') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.permission_date = OLD.permission_date
     AND NEW.start_time = OLD.start_time AND NEW.end_time = OLD.end_time AND NEW.employee_id = OLD.employee_id THEN
    RETURN NEW;   -- nothing that matters for overlaps changed
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.employee_id::text || ':' || NEW.permission_date::text, 0));
  SELECT id, start_time, end_time, status INTO v_clash
  FROM permission_requests p
  WHERE p.employee_id = NEW.employee_id AND p.permission_date = NEW.permission_date
    AND p.id IS DISTINCT FROM NEW.id
    AND p.status IN ('PENDING', 'APPROVED')
    AND p.start_time < NEW.end_time AND NEW.start_time < p.end_time
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This overlaps an existing % permission (%–%) on the same day',
      lower(v_clash.status), to_char(v_clash.start_time, 'HH24:MI'), to_char(v_clash.end_time, 'HH24:MI')
      USING ERRCODE = '23P01';   -- exclusion_violation
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_permission_overlap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_permission_overlap ON public.permission_requests;
CREATE TRIGGER trg_guard_permission_overlap BEFORE INSERT OR UPDATE ON public.permission_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_permission_overlap();

COMMIT;
