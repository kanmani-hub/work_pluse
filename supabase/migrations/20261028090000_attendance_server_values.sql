-- =============================================================================================
-- 20261028090000_attendance_server_values.sql
-- Clock-in / clock-out values that payroll uses are computed by the database, not the browser
-- (payroll audit 2026-10-27, P0 "payroll inputs can be forged by the employee").
--
-- Before: attendanceService computed clock_in_at, late_minutes, required_hours, attendance_date (clock-in)
-- and clock_out_at, worked_hours, early_logout_minutes, is_half_day, status (clock-out) in the browser, and
-- the "own attendance" policies (0009) let the employee write every column. Reproduced on a throwaway
-- database: an employee could insert a back-dated clock-in with late_minutes 0, and set own late_minutes,
-- status, is_half_day, worked_hours, required_hours, overtime_minutes and any clock_out_at.
-- Payroll reads these columns (late deduction, half-day deduction, LOP via clock-in, worked hours).
--
-- After, for callers that are not ADMIN / HR and not a trusted database role (postgres, service_role,
-- supabase_admin — migrations, cron, SECURITY DEFINER functions):
--   INSERT (clock-in): clock_in_at = database time; the shift is the employee's assignment for the company
--     date (published roster entry first, then the permanent shift assignment — same order as
--     attendanceService.getShiftForDate); attendance_date and late_minutes follow
--     clockRules.resolveClockInSession (Asia/Kolkata, grace = Settings → gracePeriodMins, an overnight shift
--     clocked into after midnight belongs to yesterday); required_hours from the shift (8 when unset);
--     status LATE / WORKING; everything else starts empty / zero. A row without a clock-in, a week off,
--     no assigned shift, or a shift other than the assigned one is refused.
--   UPDATE: clock_in_at, late_minutes, required_hours, overtime_minutes, is_auto_logged_out, absence_minutes
--     and clock_out_source keep their stored values. Clock-out (clock_out_at set for the first time):
--     clock_out_at = database time; worked_hours, early_logout_minutes, is_half_day and status are computed
--     from the stored completed breaks exactly as clockRules.computeClockOutTotals does. A completed day
--     keeps all its values. While open, status is LATE / WORKING (ON_BREAK is decided by the
--     automatic-break guard, which runs after this trigger).
--   ADMIN / HR corrections are not restricted. Overtime is never written here (only approved requests pay).
-- The rules are exposed as att_clock_in_values(employee, at) / att_clock_out_values(attendance, at) so they can
-- be tested with fixed clocks; the trigger calls them with now().
-- Note: QA "fast time" mode (VITE_QA_FAST_MODE) simulates timestamps in the browser; with this trigger an
-- employee's times are always the database time.
-- Rollback: supabase/rollbacks/20261028090000_attendance_server_values.rollback.sql
-- =============================================================================================

BEGIN;

-- Assigned shift for a company date: published roster entry first, then the permanent assignment.
CREATE OR REPLACE FUNCTION public.att_assigned_shift(p_employee uuid, p_date date,
  OUT shift_template_id uuid, OUT roster_assignment_id uuid, OUT shift_assignment_id uuid, OUT week_off boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record;
BEGIN
  week_off := false;
  SELECT ra.id, ra.shift_template_id, upper(COALESCE(to_jsonb(ra)->>'day_type', 'WORK')) AS day_type
    INTO r
  FROM roster_assignments ra JOIN rosters ro ON ro.id = ra.roster_id
  WHERE ra.employee_id = p_employee AND ra.assignment_date = p_date AND upper(COALESCE(ro.status, '')) = 'PUBLISHED'
  ORDER BY (upper(COALESCE(to_jsonb(ra)->>'day_type', 'WORK')) = 'WEEK_OFF'), ra.created_at
  LIMIT 1;
  IF FOUND THEN
    roster_assignment_id := r.id;
    IF r.day_type = 'WEEK_OFF' THEN week_off := true; RETURN; END IF;
    IF r.shift_template_id IS NOT NULL THEN shift_template_id := r.shift_template_id; RETURN; END IF;
  END IF;
  SELECT sa.id, sa.shift_template_id INTO shift_assignment_id, shift_template_id
  FROM shift_assignments sa
  WHERE sa.employee_id = p_employee AND sa.effective_date <= p_date AND (sa.end_date IS NULL OR sa.end_date >= p_date)
  ORDER BY sa.effective_date DESC
  LIMIT 1;
END $$;

-- Who may compute clock values for an employee: that employee, ADMIN / HR, or trusted server code (no
-- signed-in user: postgres / service_role / cron; anon has no EXECUTE). Needed because the attendance
-- guard runs as the calling user and calls the two functions below.
CREATE OR REPLACE FUNCTION public.att_may_compute_for(p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NULL
      OR COALESCE(public.get_auth_role(), '') IN ('ADMIN', 'HR')
      OR p_employee = public.get_auth_employee_id()
$$;

-- Clock-in values at instant p_at (same rule as clockRules.resolveClockInSession).
CREATE OR REPLACE FUNCTION public.att_clock_in_values(p_employee uuid, p_at timestamptz,
  OUT attendance_date date, OUT late_minutes integer, OUT required_hours numeric,
  OUT shift_template_id uuid, OUT roster_assignment_id uuid, OUT shift_assignment_id uuid, OUT error text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_local timestamp := p_at AT TIME ZONE 'Asia/Kolkata';
  v_today date := v_local::date;
  v_now_sec numeric := extract(epoch FROM v_local::time);
  a record; s record;
  v_grace numeric;
  v_start_sec numeric; v_end_sec numeric; v_since numeric;
BEGIN
  IF NOT public.att_may_compute_for(p_employee) THEN
    RAISE EXCEPTION 'Not allowed to compute attendance values for this employee' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.att_assigned_shift(p_employee, v_today);
  IF a.week_off THEN error := 'Today is scheduled as a Week Off in the published roster.'; RETURN; END IF;
  IF a.shift_template_id IS NULL THEN error := 'No shift assigned for today.'; RETURN; END IF;
  SELECT * INTO s FROM shift_templates WHERE id = a.shift_template_id;
  SELECT GREATEST(0, COALESCE(NULLIF(settings->'app'->>'gracePeriodMins', '')::numeric, 0)) INTO v_grace
  FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  v_grace := COALESCE(v_grace, 0);

  shift_template_id := a.shift_template_id;
  roster_assignment_id := a.roster_assignment_id;
  shift_assignment_id := a.shift_assignment_id;
  required_hours := COALESCE(s.required_hours, 8);
  v_start_sec := extract(epoch FROM COALESCE(s.start_time, time '00:00'));
  v_end_sec := CASE WHEN s.end_time IS NULL THEN NULL ELSE extract(epoch FROM s.end_time) END;

  attendance_date := v_today;
  v_since := v_now_sec - v_start_sec;
  IF COALESCE(s.crosses_midnight, false) AND v_end_sec IS NOT NULL AND v_now_sec < v_end_sec THEN
    attendance_date := v_today - 1;
    v_since := v_now_sec + 86400 - v_start_sec;
  END IF;
  late_minutes := CASE WHEN v_since > v_grace * 60 THEN floor(v_since / 60)::integer ELSE 0 END;
END $$;

-- Clock-out values for an open attendance at instant p_at (same rule as clockRules.computeClockOutTotals).
CREATE OR REPLACE FUNCTION public.att_clock_out_values(p_attendance uuid, p_at timestamptz,
  OUT worked_hours numeric, OUT worked_minutes integer, OUT early_logout_minutes integer,
  OUT is_half_day boolean, OUT status text, OUT break_minutes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a record; v_hours numeric; v_required integer;
BEGIN
  SELECT * INTO a FROM attendance WHERE id = p_attendance;
  IF NOT FOUND OR NOT public.att_may_compute_for(a.employee_id) THEN
    RAISE EXCEPTION 'Not allowed to compute attendance values for this attendance' USING ERRCODE = '42501';
  END IF;
  -- completed, non-cancelled breaks: stored duration, else whole minutes from the timestamps
  SELECT COALESCE(SUM(COALESCE(b.duration_minutes, floor(extract(epoch FROM (b.ended_at - b.started_at)) / 60)::integer)), 0)::integer
    INTO break_minutes
  FROM attendance_breaks b
  WHERE b.attendance_id = p_attendance AND b.ended_at IS NOT NULL AND COALESCE(b.break_type, '') <> 'CANCELLED';
  v_hours := GREATEST(0, GREATEST(0, extract(epoch FROM (p_at - a.clock_in_at))) / 3600.0 - break_minutes / 60.0);
  worked_hours := round(v_hours, 2);
  worked_minutes := floor(v_hours * 60)::integer;
  v_required := floor(COALESCE(a.required_hours, 8) * 60)::integer;
  early_logout_minutes := GREATEST(0, v_required - worked_minutes);
  is_half_day := worked_minutes < v_required * 0.5;
  status := CASE WHEN is_half_day THEN 'HALF_DAY' ELSE 'COMPLETED' END;
END $$;

CREATE OR REPLACE FUNCTION public.guard_attendance_server_values()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER          -- current_user must be the caller (see the role check below)
SET search_path = public, pg_temp
AS $$
DECLARE ci record; co record;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR COALESCE(public.get_auth_role(), '') IN ('ADMIN', 'HR') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.clock_in_at IS NULL THEN
      RAISE EXCEPTION 'Attendance without a clock-in can only be recorded by an administrator' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO ci FROM public.att_clock_in_values(NEW.employee_id, now());
    IF ci.error IS NOT NULL THEN RAISE EXCEPTION '%', ci.error USING ERRCODE = '42501'; END IF;
    IF NEW.shift_template_id IS NOT NULL AND NEW.shift_template_id IS DISTINCT FROM ci.shift_template_id THEN
      RAISE EXCEPTION 'The shift does not match your assignment for today. Please reload and try again.' USING ERRCODE = '42501';
    END IF;
    NEW.clock_in_at := now();
    NEW.attendance_date := ci.attendance_date;
    NEW.shift_template_id := ci.shift_template_id;
    NEW.roster_assignment_id := ci.roster_assignment_id;
    NEW.shift_assignment_id := ci.shift_assignment_id;
    NEW.late_minutes := ci.late_minutes;
    NEW.required_hours := ci.required_hours;
    NEW.status := CASE WHEN ci.late_minutes > 0 THEN 'LATE' ELSE 'WORKING' END;
    NEW.clock_out_at := NULL;
    NEW.worked_hours := NULL;
    NEW.early_logout_minutes := 0;
    NEW.overtime_minutes := 0;
    NEW.is_half_day := false;
    NEW.is_auto_logged_out := false;
    NEW.absence_minutes := 0;
    RETURN NEW;
  END IF;

  -- UPDATE by the employee: stored clock-in facts and payroll inputs are kept
  NEW.clock_in_at := OLD.clock_in_at;
  NEW.late_minutes := OLD.late_minutes;
  NEW.required_hours := OLD.required_hours;
  NEW.overtime_minutes := OLD.overtime_minutes;
  NEW.is_auto_logged_out := OLD.is_auto_logged_out;
  NEW.absence_minutes := OLD.absence_minutes;
  NEW.clock_out_source := OLD.clock_out_source;

  IF OLD.clock_out_at IS NOT NULL THEN
    -- a completed day keeps its values (a changed clock_out_at is refused by the automatic-break guard)
    NEW.worked_hours := OLD.worked_hours;
    NEW.early_logout_minutes := OLD.early_logout_minutes;
    NEW.is_half_day := OLD.is_half_day;
    NEW.status := OLD.status;
    RETURN NEW;
  END IF;

  IF NEW.clock_out_at IS NOT NULL THEN
    -- clock-out: database time and values from the stored breaks
    NEW.clock_out_at := now();
    SELECT * INTO co FROM public.att_clock_out_values(OLD.id, now());
    NEW.worked_hours := co.worked_hours;
    NEW.early_logout_minutes := co.early_logout_minutes;
    NEW.is_half_day := co.is_half_day;
    NEW.status := co.status;
    NEW.overtime_minutes := 0;
    RETURN NEW;
  END IF;

  -- still open
  NEW.worked_hours := OLD.worked_hours;
  NEW.early_logout_minutes := OLD.early_logout_minutes;
  NEW.is_half_day := OLD.is_half_day;
  IF NEW.status IS DISTINCT FROM 'ON_BREAK' THEN
    NEW.status := CASE WHEN COALESCE(OLD.late_minutes, 0) > 0 THEN 'LATE' ELSE 'WORKING' END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_attendance_server_values() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.att_assigned_shift(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.att_may_compute_for(uuid) FROM PUBLIC, anon, authenticated;
-- The guard runs as the signed-in user, so these two must be executable by authenticated; each checks
-- att_may_compute_for (own employee, ADMIN / HR) and returns only values for that employee.
REVOKE ALL ON FUNCTION public.att_clock_in_values(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.att_clock_out_values(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.att_clock_in_values(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.att_clock_out_values(uuid, timestamptz) TO authenticated;

-- "trg_aa_" so it runs BEFORE trg_ab_guard_attendance_totals (BEFORE triggers fire in name order): the
-- automatic-break guard then sees the server late_minutes when it decides LATE / WORKING / ON_BREAK.
DROP TRIGGER IF EXISTS trg_aa_attendance_server_values ON public.attendance;
CREATE TRIGGER trg_aa_attendance_server_values BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_server_values();

COMMIT;
