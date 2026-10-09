-- =====================================================================================
-- PROPOSED — NOT APPLIED. Do NOT run without approval.
-- WorkPulse HR Step 3: attendance integrity (employees editing their own attendance)
--
-- FINDING (from supabase/migrations 0009_security_hardening.sql):
--   "Insert own attendance" / "Update own attendance" allow an EMPLOYEE to INSERT or
--   UPDATE any column of their own attendance row through the REST API with the public
--   anon key + their own login token. The app computes clock_in_at, late_minutes,
--   worked_hours, status, is_half_day in the BROWSER, so an employee can e.g.:
--     PATCH /rest/v1/attendance?id=eq.<own id>  {"late_minutes":0,"clock_in_at":"...09:00"}
--   Payroll reads these columns (late deduction, half day, worked hours).
--   Other employees' rows ARE protected (employee_id = get_auth_employee_id()).
--
-- RECOMMENDED FIX (keeps the current app working, no policy loosening):
--   Database triggers that, for non-ADMIN/HR callers, take the trusted values from the
--   server instead of the browser. Admin/HR corrections stay possible.
--   Long-term: move clock-in/out into SECURITY DEFINER RPCs (server computes everything).
--
-- NOTE: QA fast-time mode (VITE_QA_FAST_MODE) sends simulated timestamps; with these
-- triggers QA must run as ADMIN/HR or with the triggers disabled in the QA database.
-- =====================================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_guard_employee_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN := public.get_auth_role() IN ('ADMIN', 'HR');
BEGIN
  -- service_role / cron (auth.uid() IS NULL) and admins are not restricted
  IF auth.uid() IS NULL OR v_is_admin THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Clock-in time is the server time; it cannot be back-dated from the browser.
    NEW.clock_in_at := now();
    NEW.clock_out_at := NULL;
    NEW.worked_hours := NULL;
    NEW.overtime_minutes := 0;
    -- late_minutes: recompute here from shift_templates.start_time + app grace setting
    -- (same rule as src/services/attendance/clockRules.ts) — TODO when approved.
    RETURN NEW;
  END IF;

  -- UPDATE by the employee: identity and clock-in facts are immutable
  IF NEW.employee_id      IS DISTINCT FROM OLD.employee_id
  OR NEW.attendance_date  IS DISTINCT FROM OLD.attendance_date
  OR NEW.clock_in_at      IS DISTINCT FROM OLD.clock_in_at
  OR NEW.late_minutes     IS DISTINCT FROM OLD.late_minutes
  OR NEW.shift_template_id IS DISTINCT FROM OLD.shift_template_id THEN
    RAISE EXCEPTION 'Attendance details can only be corrected by an administrator.' USING ERRCODE = '42501';
  END IF;

  -- A completed day cannot be reopened or edited by the employee
  IF OLD.clock_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'Attendance is already completed.' USING ERRCODE = '42501';
  END IF;

  -- Clocking out: server time, and worked hours recomputed on the server
  IF NEW.clock_out_at IS NOT NULL THEN
    NEW.clock_out_at := now();
    NEW.worked_hours := ROUND(GREATEST(0,
        EXTRACT(EPOCH FROM (NEW.clock_out_at - OLD.clock_in_at)) / 3600.0
        - COALESCE((SELECT SUM(duration_minutes) FROM attendance_breaks
                    WHERE attendance_id = OLD.id AND ended_at IS NOT NULL), 0) / 60.0)::numeric, 2);
    NEW.overtime_minutes := 0;  -- overtime only from an approved request
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_guard_employee_writes ON attendance;
CREATE TRIGGER attendance_guard_employee_writes
BEFORE INSERT OR UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION public.attendance_guard_employee_writes();

-- Same idea for breaks (employee must not shorten a break by editing started_at):
--   block employee UPDATEs of started_at / break_type, force ended_at = now() and
--   duration_minutes from the timestamps. Prepare together with the Automatic Break step.

-- -------------------------------------------------------------------------------------
-- ALSO REQUIRED (server-side auto clock-out writes automatic overtime):
--   0015_auto_clock_out.sql, process_auto_clock_out():  overtime_minutes = v_overtime
--   Change to overtime_minutes = 0 so pg_cron auto clock-outs do not create payable
--   overtime either (payrollService pays attendance.overtime_minutes as "Approved Overtime").
-- -------------------------------------------------------------------------------------

COMMIT;
