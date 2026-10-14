-- =============================================================================================
-- PROPOSED (NOT APPLIED) — attendance_breaks integrity guards
-- =============================================================================================
-- Why: today's RLS lets an employee INSERT / UPDATE any column of the break rows of their own
-- attendance (policies "Insert own attendance_breaks" / "Update own attendance_breaks"). The app
-- itself never does anything harmful, but the database does not stop a direct API call (or a buggy
-- client) from:
--   * moving the end time of a break that has already ended            (overwrites a completed break)
--   * writing a duration that does not match the timestamps             (payroll reads stored values)
--   * back-dating / future-dating a break start or end                  (shortens or lengthens breaks)
--   * attaching a break to its own attendance but another employee_id
--   * an end time before the start time
-- Admin / HR and server roles (service_role, postgres) are not restricted by the guard.
--
-- What it does NOT solve: geofence decisions are made on the employee's own device, so an employee
-- can still end their own AUTOMATIC break by calling the API while outside (the app never offers it).
-- Only server-side location evaluation can close that gap (see docs/BACKGROUND_LOCATION.md).
--
-- Order: apply PROPOSED_one_open_break_per_attendance.sql first (one open break per attendance).
-- Time tolerance: 15 minutes, the same reading-time window the app uses (READING_TIME_TOLERANCE_MS).
--
-- ---------------------------------------------------------------------------------------------
-- STEP 0 (read-only) — each query must return 0 rows before STEP 1, otherwise VALIDATE fails.
-- Correct the listed rows with HR first (never automatically).
--   SELECT id, attendance_id, started_at, ended_at FROM attendance_breaks
--    WHERE ended_at IS NOT NULL AND ended_at < started_at;
--   SELECT b.id, b.employee_id, a.employee_id AS attendance_employee FROM attendance_breaks b
--     JOIN attendance a ON a.id = b.attendance_id WHERE b.employee_id IS DISTINCT FROM a.employee_id;
-- ---------------------------------------------------------------------------------------------

BEGIN;

-- STEP 1: end time never before start (added NOT VALID, then VALIDATE checks existing rows).
-- (A non-negative duration is already enforced by the existing attendance_breaks_duration_minutes_check.)
ALTER TABLE public.attendance_breaks
  ADD CONSTRAINT attendance_breaks_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at) NOT VALID;
ALTER TABLE public.attendance_breaks VALIDATE CONSTRAINT attendance_breaks_end_after_start;

-- STEP 2: guard for non-privileged writers (employees). SECURITY INVOKER: it must see the caller.
CREATE OR REPLACE FUNCTION public.guard_attendance_break_employee_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tolerance constant interval := interval '15 minutes';
  v_att record;
BEGIN
  -- Admin / HR corrections and server-side jobs are not restricted here
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR coalesce(public.get_auth_role(), '') IN ('ADMIN', 'HR') THEN
    RETURN NEW;
  END IF;

  SELECT id, employee_id, clock_in_at, clock_out_at INTO v_att FROM attendance WHERE id = NEW.attendance_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance not found for this break' USING ERRCODE = '23503'; END IF;
  IF NEW.employee_id IS DISTINCT FROM v_att.employee_id THEN
    RAISE EXCEPTION 'A break must belong to the employee of its attendance' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_att.clock_in_at IS NULL OR v_att.clock_out_at IS NOT NULL THEN
      RAISE EXCEPTION 'Breaks can only start while clocked in' USING ERRCODE = '42501';
    END IF;
    IF NEW.ended_at IS NOT NULL OR NEW.duration_minutes IS NOT NULL THEN
      RAISE EXCEPTION 'A new break must start open' USING ERRCODE = '42501';
    END IF;
    IF NEW.started_at < v_att.clock_in_at OR abs(extract(epoch FROM (now() - NEW.started_at))) > extract(epoch FROM v_tolerance) THEN
      RAISE EXCEPTION 'Break start time is outside the accepted window' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: the only change an employee may make is closing their own open break, once.
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'A completed break cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.attendance_id IS DISTINCT FROM OLD.attendance_id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.break_type IS DISTINCT FROM OLD.break_type THEN
    RAISE EXCEPTION 'Only the end of an open break can be recorded' USING ERRCODE = '42501';
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    IF abs(extract(epoch FROM (now() - NEW.ended_at))) > extract(epoch FROM v_tolerance) THEN
      RAISE EXCEPTION 'Break end time is outside the accepted window' USING ERRCODE = '42501';
    END IF;
    -- same rule as the app: whole minutes, floor((end - start) / 60 s)
    IF NEW.duration_minutes IS DISTINCT FROM floor(extract(epoch FROM (NEW.ended_at - NEW.started_at)) / 60)::int THEN
      RAISE EXCEPTION 'Break duration does not match its start and end time' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_attendance_break_employee_write ON public.attendance_breaks;
CREATE TRIGGER guard_attendance_break_employee_write
  BEFORE INSERT OR UPDATE ON public.attendance_breaks
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_break_employee_write();

COMMIT;

-- ---------------------------------------------------------------------------------------------
-- ROLLBACK (restores today's behaviour; no data is changed by this proposal):
--   BEGIN;
--   DROP TRIGGER IF EXISTS guard_attendance_break_employee_write ON public.attendance_breaks;
--   DROP FUNCTION IF EXISTS public.guard_attendance_break_employee_write();
--   ALTER TABLE public.attendance_breaks DROP CONSTRAINT IF EXISTS attendance_breaks_end_after_start;
--   COMMIT;
--
-- Security notes: SECURITY INVOKER with a fixed search_path; it reads attendance through the caller's
-- own RLS, so it cannot reveal other employees' rows. Clock-out (which closes an automatic break at
-- the clock-out time) and Auto Break END both write ended_at = now-ish with the floor() duration, so
-- they pass. The admin "custom end time" path is ADMIN/HR only and is not restricted.
-- Tested locally on a disposable PostgreSQL 16 copy of this project's migrations (not Supabase).
