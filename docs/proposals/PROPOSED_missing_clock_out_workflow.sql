-- =============================================================================================
-- PROPOSED (NOT APPLIED) — Missing clock-out, 3-hour additional time limit, payroll adjustments
-- =============================================================================================
-- Requires docs/proposals/PROPOSED_overtime_requests.sql to be applied first (overtime_requests).
-- Company policy (2026-10-14):
--   * Missing clock-out = clock-in, no clock-out, after shift end + autoClockOutGraceHours
--     (24 h after clock-in when no shift). No clock-out time is invented, no overtime is created.
--   * The employee submits ONE correction (claimed clock-out + reason, optional overtime) through
--     submit_missing_clock_out_request(). It stays unverified until an admin decides.
--   * Additional time for this workflow ≤ payroll setting missingClockOutMaxAdditionalHours (default 3).
--     Claimed time beyond the limit is stored as excess_hours for admin review (never dropped).
--   * APPROVE (verified clock-out) → attendance closed at the verified time; any recorded deduction for
--     the case is cancelled (not yet settled) or reversed ONCE (already settled in an approved payroll);
--     approved overtime of an already-locked month becomes a DEFERRED_OVERTIME adjustment.
--   * REJECT (reason required) → fixed deduction per case (missingClockOutDeductionAmount) if enabled.
--   * Pending at payroll time → nothing deducted (deferred); adjustments are settled by the first
--     payroll approved after the decision (approve_payroll_with_adjustments).
--   * Every write that changes money or attendance is in one function = one transaction, with row
--     locks; references are UNIQUE so retries / double clicks cannot duplicate a deduction or reversal.
-- process_auto_clock_out() is replaced: it only FLAGS records (status MISSING_CLOCK_OUT) and no
-- longer invents a clock-out time or writes overtime minutes (this also fixes the v_status error).
--
-- STEP 0 (read-only) — must return 0 before applying (reviewer = requester on existing requests):
--   SELECT count(*) FROM overtime_requests WHERE reviewed_by IS NOT NULL AND reviewed_by = employee_id;
-- =============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------- 1. overtime_requests
ALTER TABLE public.overtime_requests
  ADD COLUMN IF NOT EXISTS request_type VARCHAR(30) NOT NULL DEFAULT 'OVERTIME',
  ADD COLUMN IF NOT EXISTS claimed_clock_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_clock_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_additional_hours NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS additional_limit_hours NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS excess_hours NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE public.overtime_requests DROP CONSTRAINT IF EXISTS ot_request_type;
ALTER TABLE public.overtime_requests ADD CONSTRAINT ot_request_type CHECK (request_type IN ('OVERTIME', 'MISSING_CLOCK_OUT'));
-- A correction may claim 0 overtime (it is still needed to verify the clock-out)
ALTER TABLE public.overtime_requests DROP CONSTRAINT IF EXISTS overtime_requests_requested_overtime_hours_check;
ALTER TABLE public.overtime_requests DROP CONSTRAINT IF EXISTS ot_requested_hours;
ALTER TABLE public.overtime_requests ADD CONSTRAINT ot_requested_hours CHECK (
  requested_overtime_hours > 0 OR (request_type = 'MISSING_CLOCK_OUT' AND requested_overtime_hours >= 0));
ALTER TABLE public.overtime_requests DROP CONSTRAINT IF EXISTS ot_approved_rules;
ALTER TABLE public.overtime_requests ADD CONSTRAINT ot_approved_rules CHECK (
  (status = 'APPROVED' AND reviewed_at IS NOT NULL
     AND approved_overtime_hours <= requested_overtime_hours
     AND approved_overtime_hours <= eligible_overtime_hours
     AND (approved_overtime_hours > 0
          OR (request_type = 'MISSING_CLOCK_OUT' AND approved_overtime_hours >= 0)))
  OR (status = 'REJECTED' AND COALESCE(approved_overtime_hours, 0) = 0 AND reviewed_at IS NOT NULL)
  OR (status IN ('PENDING', 'CANCELLED') AND approved_overtime_hours IS NULL));
ALTER TABLE public.overtime_requests DROP CONSTRAINT IF EXISTS ot_missing_clock_out_fields;
ALTER TABLE public.overtime_requests ADD CONSTRAINT ot_missing_clock_out_fields CHECK (
  request_type <> 'MISSING_CLOCK_OUT'
  OR (claimed_clock_out_at IS NOT NULL AND claimed_additional_hours IS NOT NULL AND additional_limit_hours IS NOT NULL
      AND excess_hours >= 0 AND (status <> 'APPROVED' OR verified_clock_out_at IS NOT NULL)));
-- Nobody reviews their own request (HR / admins are employees too)
ALTER TABLE public.overtime_requests DROP CONSTRAINT IF EXISTS ot_reviewer_not_requester;
ALTER TABLE public.overtime_requests ADD CONSTRAINT ot_reviewer_not_requester CHECK (reviewed_by IS NULL OR reviewed_by <> employee_id);
-- One correction per attendance, also after a decision (no resubmission after a rejection)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mco_request_per_attendance
  ON public.overtime_requests (attendance_id)
  WHERE request_type = 'MISSING_CLOCK_OUT' AND status IN ('PENDING', 'APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------------- 2. payroll_adjustments
CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference            TEXT NOT NULL UNIQUE,      -- MCO-DED:<attendance> / MCO-REV:<attendance> / MCO-OT:<request>
  kind                 VARCHAR(40) NOT NULL CHECK (kind IN ('MISSING_CLOCK_OUT_DEDUCTION', 'MISSING_CLOCK_OUT_REVERSAL', 'DEFERRED_OVERTIME')),
  status               VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SETTLED', 'CANCELLED')),
  employee_id          UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_id        UUID REFERENCES attendance(id) ON DELETE SET NULL,
  overtime_request_id  UUID REFERENCES overtime_requests(id) ON DELETE SET NULL,
  work_date            DATE NOT NULL,
  amount               NUMERIC(12,2) CHECK (amount IS NULL OR amount >= 0),
  hours                NUMERIC(5,2) CHECK (hours IS NULL OR hours >= 0),
  reason               TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_by           UUID REFERENCES employees(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_payroll_id   UUID,
  settled_year         INTEGER,
  settled_month        INTEGER,
  settled_at           TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  CONSTRAINT adj_value CHECK ((kind = 'DEFERRED_OVERTIME' AND hours > 0) OR (kind <> 'DEFERRED_OVERTIME' AND amount > 0)),
  CONSTRAINT adj_settled CHECK ((status = 'SETTLED') = (settled_payroll_id IS NOT NULL AND settled_year IS NOT NULL AND settled_month IS NOT NULL AND settled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_employee ON public.payroll_adjustments (employee_id, status, work_date);
ALTER TABLE public.payroll_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View payroll_adjustments" ON public.payroll_adjustments;
CREATE POLICY "View payroll_adjustments" ON public.payroll_adjustments FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
-- No INSERT / UPDATE / DELETE policies: rows change only through the functions below.
GRANT SELECT ON public.payroll_adjustments TO authenticated;

-- ---------------------------------------------------------------------------- 3. shared helpers
CREATE OR REPLACE FUNCTION public.mco_settings(OUT limit_hours NUMERIC, OUT deduction_enabled BOOLEAN, OUT deduction_amount NUMERIC, OUT grace_hours NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s JSONB;
BEGIN
  SELECT settings INTO s FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  limit_hours       := COALESCE(NULLIF(s->'payroll'->>'missingClockOutMaxAdditionalHours', '')::NUMERIC, 3);
  deduction_enabled := COALESCE((s->'payroll'->>'enableMissingClockOutDeduction')::BOOLEAN, false);
  deduction_amount  := COALESCE(NULLIF(s->'payroll'->>'missingClockOutDeductionAmount', '')::NUMERIC, 0);
  grace_hours       := GREATEST(0, COALESCE(NULLIF(s->'app'->>'autoClockOutGraceHours', '')::NUMERIC, 4));
  IF limit_hours < 0 THEN limit_hours := 3; END IF;
END $$;

-- When does this open attendance count as a missing clock-out? (NULL = it never will: already closed)
CREATE OR REPLACE FUNCTION public.mco_flag_at(p_att attendance, p_grace NUMERIC)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s shift_templates%ROWTYPE; v_end TIMESTAMPTZ;
BEGIN
  IF p_att.clock_in_at IS NULL OR p_att.clock_out_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM shift_templates WHERE id = p_att.shift_template_id;
  IF s.id IS NULL OR s.start_time IS NULL OR s.end_time IS NULL THEN RETURN p_att.clock_in_at + interval '24 hours'; END IF;
  v_end := (p_att.attendance_date + s.end_time) AT TIME ZONE 'Asia/Kolkata';
  IF s.crosses_midnight OR s.end_time <= s.start_time THEN v_end := v_end + interval '1 day'; END IF;
  RETURN v_end + make_interval(secs => p_grace * 3600);
END $$;

-- Same rule as src/services/attendance/missingClockOutRules.ts (evaluateClockOutClaim)
CREATE OR REPLACE FUNCTION public.mco_evaluate(p_att attendance, p_out TIMESTAMPTZ, p_limit NUMERIC,
  OUT ok BOOLEAN, OUT error TEXT, OUT worked_min NUMERIC, OUT scheduled_min NUMERIC, OUT additional_min NUMERIC,
  OUT eligible_hours NUMERIC, OUT excess_hours NUMERIC, OUT claimed_additional_hours NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s shift_templates%ROWTYPE; v_break NUMERIC; v_last_break TIMESTAMPTZ; v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
        v_late NUMERIC; v_leave BOOLEAN; v_half BOOLEAN; v_limit_min NUMERIC := ROUND(p_limit * 60);
BEGIN
  ok := false; worked_min := 0; scheduled_min := NULL; additional_min := 0; eligible_hours := 0; excess_hours := 0; claimed_additional_hours := 0;
  IF p_att.clock_in_at IS NULL THEN error := 'This attendance has no clock-in.'; RETURN; END IF;
  IF p_att.clock_out_at IS NOT NULL THEN error := 'This attendance already has a clock-out.'; RETURN; END IF;
  IF p_out IS NULL THEN error := 'Enter a valid clock-out date and time.'; RETURN; END IF;
  IF p_out <= p_att.clock_in_at THEN error := 'The clock-out time must be after the clock-in time.'; RETURN; END IF;
  IF p_out > now() THEN error := 'The clock-out time cannot be in the future.'; RETURN; END IF;
  IF p_out - p_att.clock_in_at > interval '24 hours' THEN error := 'The clock-out time must be within 24 hours of the clock-in.'; RETURN; END IF;
  SELECT max(ended_at) INTO v_last_break FROM attendance_breaks
   WHERE attendance_id = p_att.id AND ended_at IS NOT NULL AND COALESCE(break_type, '') <> 'CANCELLED';
  IF v_last_break IS NOT NULL AND p_out < v_last_break THEN error := 'The clock-out time cannot be before the end of the last break.'; RETURN; END IF;
  -- an open break is closed at the clock-out time, so it cannot have started after it
  IF EXISTS (SELECT 1 FROM attendance_breaks WHERE attendance_id = p_att.id AND ended_at IS NULL
             AND COALESCE(break_type, '') <> 'CANCELLED' AND started_at > p_out) THEN
    error := 'The clock-out time cannot be before the start of a break that is still open.'; RETURN;
  END IF;
  SELECT * INTO s FROM shift_templates WHERE id = p_att.shift_template_id;
  IF s.id IS NULL OR s.start_time IS NULL OR s.end_time IS NULL THEN
    error := 'No shift was assigned for this day, so the additional time cannot be calculated. Please contact HR.'; RETURN;
  END IF;
  SELECT COALESCE(SUM(COALESCE(duration_minutes, FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60))), 0) INTO v_break
    FROM attendance_breaks WHERE attendance_id = p_att.id AND ended_at IS NOT NULL AND COALESCE(break_type, '') <> 'CANCELLED';
  worked_min := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_out - p_att.clock_in_at)) / 60) - v_break);
  v_start := (p_att.attendance_date + s.start_time) AT TIME ZONE 'Asia/Kolkata';
  v_end   := (p_att.attendance_date + s.end_time)   AT TIME ZONE 'Asia/Kolkata';
  IF s.crosses_midnight OR s.end_time <= s.start_time THEN v_end := v_end + interval '1 day'; END IF;
  scheduled_min := ROUND(COALESCE(NULLIF(p_att.required_hours, 0), NULLIF(s.required_hours, 0), EXTRACT(EPOCH FROM (v_end - v_start)) / 3600) * 60);
  v_late := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_att.clock_in_at - v_start)) / 60));
  SELECT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = p_att.employee_id AND l.status = 'APPROVED'
                 AND p_att.attendance_date BETWEEN l.start_date AND l.end_date AND NOT COALESCE(l.is_half_day, false)) INTO v_leave;
  SELECT (COALESCE(p_att.is_half_day, false) OR p_att.status = 'HALF_DAY' OR EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = p_att.employee_id
          AND l.status = 'APPROVED' AND p_att.attendance_date BETWEEN l.start_date AND l.end_date AND COALESCE(l.is_half_day, false))) INTO v_half;
  additional_min := CASE WHEN v_leave OR v_half THEN 0 ELSE GREATEST(0, worked_min - scheduled_min - v_late) END;
  claimed_additional_hours := ROUND(FLOOR(additional_min / 60.0 * 100) / 100, 2);
  eligible_hours := ROUND(FLOOR(LEAST(additional_min, v_limit_min) / 60.0 * 100) / 100, 2);
  excess_hours := ROUND(FLOOR(GREATEST(0, additional_min - v_limit_min) / 60.0 * 100) / 100, 2);
  ok := true;
END $$;

-- ---------------------------------------------------------------------------- 4. overtime_requests guard
-- Same as PROPOSED_overtime_requests.sql for OVERTIME, plus: MISSING_CLOCK_OUT rows are created and
-- reviewed only by the functions below, and nobody may review their own request.
CREATE OR REPLACE FUNCTION public.overtime_requests_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin BOOLEAN := public.get_auth_role() IN ('ADMIN', 'HR');
  v_rpc BOOLEAN := COALESCE(current_setting('workpulse.mco_rpc', true), '') = 'on';
  a attendance%ROWTYPE; s shift_templates%ROWTYPE;
  v_break_min NUMERIC; v_worked_min NUMERIC; v_req_min NUMERIC;
  v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_late NUMERIC; v_after NUMERIC; v_pot NUMERIC;
  v_half BOOLEAN; v_leave BOOLEAN;
BEGIN
  NEW.updated_at := now();
  IF COALESCE(NEW.request_type, 'OVERTIME') = 'MISSING_CLOCK_OUT' OR (TG_OP = 'UPDATE' AND OLD.request_type = 'MISSING_CLOCK_OUT') THEN
    IF NOT v_rpc THEN
      -- the only direct change allowed: the employee cancels their own pending correction
      -- (only the status may change: every other column must stay as submitted)
      IF TG_OP = 'UPDATE' AND NOT v_admin AND OLD.status = 'PENDING' AND NEW.status = 'CANCELLED'
         AND OLD.employee_id = public.get_auth_employee_id()
         AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at') THEN
        INSERT INTO audit_logs (actor_employee_id, action, module, entity_type, entity_id, description, old_values, new_values, source)
        VALUES (public.get_auth_employee_id(), 'MISSING_CLOCK_OUT_CANCELLED', 'ATTENDANCE', 'overtime_requests', OLD.id,
                format('Missing clock-out correction for %s cancelled by the employee.', OLD.work_date),
                jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'CANCELLED'), 'WEB');
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Missing clock-out corrections are submitted and reviewed through the dedicated workflow.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO a FROM attendance WHERE id = NEW.attendance_id;
    IF a.id IS NULL THEN RAISE EXCEPTION 'Attendance not found.' USING ERRCODE = '23503'; END IF;
    IF NOT v_admin AND a.employee_id IS DISTINCT FROM public.get_auth_employee_id() THEN
      RAISE EXCEPTION 'You can only request overtime for your own attendance.' USING ERRCODE = '42501';
    END IF;
    IF a.clock_in_at IS NULL OR a.clock_out_at IS NULL THEN
      RAISE EXCEPTION 'Overtime can be requested after clock-out.' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO s FROM shift_templates WHERE id = a.shift_template_id;
    IF s.id IS NULL THEN RAISE EXCEPTION 'No shift was assigned for this day.' USING ERRCODE = '23514'; END IF;
    SELECT COALESCE(SUM(COALESCE(duration_minutes, FLOOR(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60))), 0)
      INTO v_break_min FROM attendance_breaks WHERE attendance_id = a.id AND ended_at IS NOT NULL AND COALESCE(break_type, '') <> 'CANCELLED';
    v_worked_min := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (a.clock_out_at - a.clock_in_at)) / 60) - v_break_min);
    v_start := (a.attendance_date + s.start_time) AT TIME ZONE 'Asia/Kolkata';
    v_end   := (a.attendance_date + s.end_time)   AT TIME ZONE 'Asia/Kolkata';
    IF s.crosses_midnight OR s.end_time <= s.start_time THEN v_end := v_end + interval '1 day'; END IF;
    v_req_min := ROUND(COALESCE(NULLIF(a.required_hours, 0), NULLIF(s.required_hours, 0), EXTRACT(EPOCH FROM (v_end - v_start)) / 3600) * 60);
    v_late  := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (a.clock_in_at - v_start)) / 60));
    v_after := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (a.clock_out_at - v_end)) / 60));
    SELECT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = a.employee_id AND l.status = 'APPROVED'
                   AND a.attendance_date BETWEEN l.start_date AND l.end_date AND NOT l.is_half_day) INTO v_leave;
    SELECT (a.is_half_day OR a.status = 'HALF_DAY' OR EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_id = a.employee_id
            AND l.status = 'APPROVED' AND a.attendance_date BETWEEN l.start_date AND l.end_date AND l.is_half_day)) INTO v_half;
    v_pot := CASE WHEN v_leave OR v_half THEN 0 ELSE GREATEST(0, v_worked_min - v_req_min - v_late) END;
    NEW.request_type := 'OVERTIME';
    NEW.employee_id := a.employee_id;
    NEW.work_date := a.attendance_date;
    NEW.shift_id := a.shift_template_id;
    NEW.scheduled_hours := ROUND(v_req_min / 60.0, 2);
    NEW.actual_working_hours := FLOOR(v_worked_min / 60.0 * 100) / 100;
    NEW.eligible_overtime_hours := FLOOR(v_pot / 60.0 * 100) / 100;
    IF NOT v_admin THEN
      NEW.status := 'PENDING'; NEW.approved_overtime_hours := NULL;
      NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.admin_remarks := NULL;
    END IF;
    IF NEW.eligible_overtime_hours <= 0 THEN
      RAISE EXCEPTION 'There is no overtime available for this day.' USING ERRCODE = '23514';
    END IF;
    IF NEW.requested_overtime_hours > NEW.eligible_overtime_hours THEN
      RAISE EXCEPTION 'You can request at most % hours for this day.', NEW.eligible_overtime_hours USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE (OVERTIME)
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.attendance_id IS DISTINCT FROM OLD.attendance_id
     OR NEW.work_date IS DISTINCT FROM OLD.work_date OR NEW.eligible_overtime_hours IS DISTINCT FROM OLD.eligible_overtime_hours
     OR NEW.scheduled_hours IS DISTINCT FROM OLD.scheduled_hours OR NEW.actual_working_hours IS DISTINCT FROM OLD.actual_working_hours
     OR NEW.request_type IS DISTINCT FROM OLD.request_type THEN
    RAISE EXCEPTION 'Overtime request details cannot be changed.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This overtime request has already been reviewed.' USING ERRCODE = '23514';
  END IF;
  IF v_admin THEN
    IF NEW.status IN ('APPROVED', 'REJECTED') THEN
      IF OLD.employee_id = public.get_auth_employee_id() THEN
        RAISE EXCEPTION 'You cannot review your own request.' USING ERRCODE = '42501';
      END IF;
      NEW.reviewed_by := public.get_auth_employee_id();
      NEW.reviewed_at := now();
      IF NEW.status = 'REJECTED' THEN NEW.approved_overtime_hours := 0; END IF;
    END IF;
  ELSE
    IF NEW.status NOT IN ('PENDING', 'CANCELLED') OR NEW.approved_overtime_hours IS NOT NULL
       OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.admin_remarks IS DISTINCT FROM OLD.admin_remarks THEN
      RAISE EXCEPTION 'Only an administrator can review overtime.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------- 5. employee: submit correction
CREATE OR REPLACE FUNCTION public.submit_missing_clock_out_request(
  p_attendance_id UUID, p_claimed_clock_out TIMESTAMPTZ, p_requested_hours NUMERIC, p_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := public.get_auth_employee_id();
  a attendance%ROWTYPE; cfg RECORD; ev RECORD; v_flag TIMESTAMPTZ; v_id UUID;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Your session has expired. Please sign in again.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM attendance WHERE id = p_attendance_id FOR UPDATE;   -- serialises double submits
  IF a.id IS NULL OR a.employee_id <> v_me THEN RAISE EXCEPTION 'Attendance record not found.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cfg FROM public.mco_settings();
  v_flag := public.mco_flag_at(a, cfg.grace_hours);
  IF v_flag IS NULL THEN RAISE EXCEPTION 'This attendance is not a missing clock-out.' USING ERRCODE = '23514'; END IF;
  IF now() < v_flag THEN RAISE EXCEPTION 'Your shift is still in progress: please clock out normally.' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM overtime_requests WHERE attendance_id = a.id AND (status IN ('PENDING', 'APPROVED')
             OR (request_type = 'MISSING_CLOCK_OUT' AND status = 'REJECTED'))) THEN
    RAISE EXCEPTION 'A request already exists for this day.' USING ERRCODE = '23505';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Please describe the work or project (at least 10 characters).' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO ev FROM public.mco_evaluate(a, p_claimed_clock_out, cfg.limit_hours);
  IF NOT ev.ok THEN RAISE EXCEPTION '%', ev.error USING ERRCODE = '23514'; END IF;
  IF p_requested_hours IS NULL OR p_requested_hours < 0 OR p_requested_hours <> ROUND(p_requested_hours, 2) THEN
    RAISE EXCEPTION 'Requested overtime must be 0 or more, with at most 2 decimal places.' USING ERRCODE = '23514';
  END IF;
  IF p_requested_hours > ev.eligible_hours THEN
    RAISE EXCEPTION 'You can request at most % hours (limit % h for a missing clock-out).', ev.eligible_hours, cfg.limit_hours USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('workpulse.mco_rpc', 'on', true);
  INSERT INTO overtime_requests (employee_id, attendance_id, shift_id, work_date, scheduled_hours, actual_working_hours,
    eligible_overtime_hours, requested_overtime_hours, employee_reason, status, request_type, claimed_clock_out_at,
    claimed_additional_hours, additional_limit_hours, excess_hours)
  VALUES (a.employee_id, a.id, a.shift_template_id, a.attendance_date, ROUND(ev.scheduled_min / 60.0, 2), FLOOR(ev.worked_min / 60.0 * 100) / 100,
    ev.eligible_hours, p_requested_hours, trim(p_reason), 'PENDING', 'MISSING_CLOCK_OUT', p_claimed_clock_out,
    ev.claimed_additional_hours, cfg.limit_hours, ev.excess_hours)
  RETURNING id INTO v_id;
  PERFORM set_config('workpulse.mco_rpc', 'off', true);

  INSERT INTO audit_logs (actor_employee_id, action, module, entity_type, entity_id, description, new_values, source)
  VALUES (v_me, 'MISSING_CLOCK_OUT_SUBMITTED', 'ATTENDANCE', 'overtime_requests', v_id,
    format('Missing clock-out correction for %s: claimed clock-out %s, %s h overtime requested (claimed additional %s h, limit %s h, excess %s h). Unverified.',
           a.attendance_date, p_claimed_clock_out, p_requested_hours, ev.claimed_additional_hours, cfg.limit_hours, ev.excess_hours),
    jsonb_build_object('attendance_id', a.id, 'claimed_clock_out_at', p_claimed_clock_out, 'requested_hours', p_requested_hours, 'excess_hours', ev.excess_hours), 'WEB');
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------- 6. admin: approve / reject
CREATE OR REPLACE FUNCTION public.review_missing_clock_out_request(
  p_request_id UUID, p_decision TEXT, p_verified_clock_out TIMESTAMPTZ, p_approved_hours NUMERIC, p_remarks TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me UUID := public.get_auth_employee_id();
  r overtime_requests%ROWTYPE; a attendance%ROWTYPE; cfg RECORD; ev RECORD;
  v_ded payroll_adjustments%ROWTYPE; v_locked BOOLEAN; v_break NUMERIC; v_worked NUMERIC; v_req NUMERIC;
  v_out JSONB := '{}'::jsonb;
BEGIN
  IF public.get_auth_role() NOT IN ('ADMIN', 'HR') OR v_me IS NULL THEN
    RAISE EXCEPTION 'Only an administrator can review missing clock-out requests.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM overtime_requests WHERE id = p_request_id FOR UPDATE;   -- second click waits, then sees the decision
  IF r.id IS NULL OR r.request_type <> 'MISSING_CLOCK_OUT' THEN RAISE EXCEPTION 'Request not found.' USING ERRCODE = '23503'; END IF;
  IF r.employee_id = v_me THEN RAISE EXCEPTION 'You cannot review your own request.' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'This request has already been %.', lower(r.status) USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM attendance WHERE id = r.attendance_id FOR UPDATE;
  SELECT * INTO cfg FROM public.mco_settings();
  SELECT * INTO v_ded FROM payroll_adjustments WHERE reference = 'MCO-DED:' || r.attendance_id FOR UPDATE;
  PERFORM set_config('workpulse.mco_rpc', 'on', true);

  IF p_decision = 'REJECTED' THEN
    IF p_remarks IS NULL OR trim(p_remarks) = '' THEN RAISE EXCEPTION 'Please give a reason for rejecting.' USING ERRCODE = '23514'; END IF;
    UPDATE overtime_requests SET status = 'REJECTED', approved_overtime_hours = 0, admin_remarks = trim(p_remarks),
           reviewed_by = v_me, reviewed_at = now() WHERE id = r.id;
    -- No deduction if the employee has meanwhile recorded a real clock-out (the clock-out is no longer missing)
    IF cfg.deduction_enabled AND cfg.deduction_amount > 0 AND v_ded.id IS NULL AND a.clock_out_at IS NULL THEN
      INSERT INTO payroll_adjustments (reference, kind, employee_id, attendance_id, overtime_request_id, work_date, amount, reason, created_by)
      VALUES ('MCO-DED:' || r.attendance_id, 'MISSING_CLOCK_OUT_DEDUCTION', r.employee_id, r.attendance_id, r.id, r.work_date,
              cfg.deduction_amount, 'Missing clock-out correction rejected: ' || trim(p_remarks), v_me)
      ON CONFLICT (reference) DO NOTHING;
      v_out := v_out || jsonb_build_object('deduction', cfg.deduction_amount);
    END IF;
    INSERT INTO audit_logs (actor_employee_id, action, module, entity_type, entity_id, description, old_values, new_values, source)
    VALUES (v_me, 'MISSING_CLOCK_OUT_REJECTED', 'ATTENDANCE', 'overtime_requests', r.id,
      format('Missing clock-out correction for %s rejected. Deduction: %s.', r.work_date,
             CASE WHEN a.clock_out_at IS NOT NULL THEN 'none (clock-out recorded since)'
                  WHEN v_ded.id IS NOT NULL THEN 'already recorded'
                  WHEN cfg.deduction_enabled AND cfg.deduction_amount > 0 THEN cfg.deduction_amount::TEXT ELSE 'none configured' END),
      jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'REJECTED', 'remarks', trim(p_remarks)), 'WEB');
    PERFORM set_config('workpulse.mco_rpc', 'off', true);
    RETURN v_out || jsonb_build_object('status', 'REJECTED');
  END IF;

  IF p_decision <> 'APPROVED' THEN RAISE EXCEPTION 'Choose approve or reject.' USING ERRCODE = '23514'; END IF;
  SELECT * INTO ev FROM public.mco_evaluate(a, p_verified_clock_out, cfg.limit_hours);
  IF NOT ev.ok THEN RAISE EXCEPTION '%', ev.error USING ERRCODE = '23514'; END IF;
  IF p_approved_hours IS NULL OR p_approved_hours < 0 OR p_approved_hours <> ROUND(p_approved_hours, 2) THEN
    RAISE EXCEPTION 'Approved overtime must be 0 or more, with at most 2 decimal places.' USING ERRCODE = '23514';
  END IF;
  IF p_approved_hours > r.requested_overtime_hours THEN
    RAISE EXCEPTION 'Cannot approve more than the requested % hours.', r.requested_overtime_hours USING ERRCODE = '23514';
  END IF;
  IF p_approved_hours > ev.eligible_hours THEN
    RAISE EXCEPTION 'Cannot approve more than % hours for the verified clock-out time (limit % h).', ev.eligible_hours, cfg.limit_hours USING ERRCODE = '23514';
  END IF;

  -- Close the attendance at the VERIFIED time (open breaks end at that time, as at a clock-out)
  UPDATE attendance_breaks SET ended_at = p_verified_clock_out,
         duration_minutes = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_verified_clock_out - started_at)) / 60))
   WHERE attendance_id = a.id AND ended_at IS NULL AND COALESCE(break_type, '') <> 'CANCELLED';
  SELECT COALESCE(SUM(duration_minutes), 0) INTO v_break FROM attendance_breaks
   WHERE attendance_id = a.id AND ended_at IS NOT NULL AND COALESCE(break_type, '') <> 'CANCELLED';
  v_worked := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_verified_clock_out - a.clock_in_at)) / 60) - v_break);
  v_req := ROUND(COALESCE(a.required_hours, 0) * 60);
  UPDATE attendance SET clock_out_at = p_verified_clock_out, clock_out_source = 'CORRECTION', is_auto_logged_out = false,
         worked_hours = ROUND(v_worked / 60.0, 2), break_minutes = v_break,
         early_logout_minutes = GREATEST(0, v_req - v_worked), overtime_minutes = 0,
         is_half_day = (v_req > 0 AND v_worked < v_req * 0.5),
         status = CASE WHEN v_req > 0 AND v_worked < v_req * 0.5 THEN 'HALF_DAY' ELSE 'COMPLETED' END,
         updated_at = now()
   WHERE id = a.id;
  INSERT INTO attendance_events (attendance_id, employee_id, event_type, event_at, source, metadata)
  VALUES (a.id, a.employee_id, 'CLOCK_OUT_CORRECTED', p_verified_clock_out, 'ADMIN',
          jsonb_build_object('request_id', r.id, 'claimed_clock_out_at', r.claimed_clock_out_at, 'verified_by', v_me));

  UPDATE overtime_requests SET status = 'APPROVED', approved_overtime_hours = p_approved_hours, verified_clock_out_at = p_verified_clock_out,
         admin_remarks = NULLIF(trim(COALESCE(p_remarks, '')), ''), reviewed_by = v_me, reviewed_at = now()
   WHERE id = r.id;

  -- A deduction already recorded for this case: cancel if unsettled, reverse ONCE if already paid out
  IF v_ded.id IS NOT NULL AND v_ded.status = 'PENDING' THEN
    UPDATE payroll_adjustments SET status = 'CANCELLED', cancelled_at = now() WHERE id = v_ded.id;
    v_out := v_out || jsonb_build_object('deduction_cancelled', v_ded.amount);
  ELSIF v_ded.id IS NOT NULL AND v_ded.status = 'SETTLED' THEN
    INSERT INTO payroll_adjustments (reference, kind, employee_id, attendance_id, overtime_request_id, work_date, amount, reason, created_by)
    VALUES ('MCO-REV:' || r.attendance_id, 'MISSING_CLOCK_OUT_REVERSAL', r.employee_id, r.attendance_id, r.id, r.work_date,
            v_ded.amount, 'Missing clock-out approved after the deduction was applied', v_me)
    ON CONFLICT (reference) DO NOTHING;
    v_out := v_out || jsonb_build_object('deduction_reversed', v_ded.amount);
  END IF;

  -- Overtime of a month whose payroll is already locked is paid as an adjustment in a later payroll
  SELECT EXISTS (SELECT 1 FROM payroll p WHERE p.employee_id = r.employee_id
                 AND p.payroll_year = EXTRACT(YEAR FROM r.work_date) AND p.payroll_month = EXTRACT(MONTH FROM r.work_date)
                 AND p.status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED')) INTO v_locked;
  IF p_approved_hours > 0 AND v_locked THEN
    INSERT INTO payroll_adjustments (reference, kind, employee_id, attendance_id, overtime_request_id, work_date, hours, reason, created_by)
    VALUES ('MCO-OT:' || r.id, 'DEFERRED_OVERTIME', r.employee_id, r.attendance_id, r.id, r.work_date,
            p_approved_hours, 'Approved after the payroll for that month was locked', v_me)
    ON CONFLICT (reference) DO NOTHING;
    v_out := v_out || jsonb_build_object('deferred_overtime_hours', p_approved_hours);
  END IF;

  INSERT INTO audit_logs (actor_employee_id, action, module, entity_type, entity_id, description, old_values, new_values, source)
  VALUES (v_me, 'MISSING_CLOCK_OUT_APPROVED', 'ATTENDANCE', 'overtime_requests', r.id,
    format('Missing clock-out for %s approved: verified clock-out %s (claimed %s), %s h overtime approved of %s requested.',
           r.work_date, p_verified_clock_out, r.claimed_clock_out_at, p_approved_hours, r.requested_overtime_hours),
    jsonb_build_object('status', 'PENDING', 'clock_out_at', NULL),
    jsonb_build_object('status', 'APPROVED', 'clock_out_at', p_verified_clock_out, 'approved_hours', p_approved_hours) || v_out, 'WEB');
  PERFORM set_config('workpulse.mco_rpc', 'off', true);
  RETURN v_out || jsonb_build_object('status', 'APPROVED');
END $$;

-- ---------------------------------------------------------------------------- 7. admin: deduct without a request
-- For a flagged missing clock-out with no pending / approved correction (e.g. the employee never
-- responded). Explicit admin decision with a reason; nothing is deducted automatically.
CREATE OR REPLACE FUNCTION public.apply_missing_clock_out_deduction(p_attendance_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me UUID := public.get_auth_employee_id(); a attendance%ROWTYPE; cfg RECORD; v_flag TIMESTAMPTZ; v_id UUID;
BEGIN
  IF public.get_auth_role() NOT IN ('ADMIN', 'HR') OR v_me IS NULL THEN
    RAISE EXCEPTION 'Only an administrator can apply this deduction.' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Please give a reason.' USING ERRCODE = '23514'; END IF;
  SELECT * INTO a FROM attendance WHERE id = p_attendance_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Attendance not found.' USING ERRCODE = '23503'; END IF;
  IF a.employee_id = v_me THEN RAISE EXCEPTION 'You cannot decide on your own attendance.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cfg FROM public.mco_settings();
  v_flag := public.mco_flag_at(a, cfg.grace_hours);
  IF v_flag IS NULL OR now() < v_flag THEN RAISE EXCEPTION 'This attendance is not a missing clock-out.' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM overtime_requests WHERE attendance_id = a.id AND request_type = 'MISSING_CLOCK_OUT' AND status IN ('PENDING', 'APPROVED')) THEN
    RAISE EXCEPTION 'A correction for this day is pending or approved: review it instead.' USING ERRCODE = '23514';
  END IF;
  IF NOT cfg.deduction_enabled OR cfg.deduction_amount <= 0 THEN
    RAISE EXCEPTION 'No missing clock-out deduction is configured (Payroll Settings).' USING ERRCODE = '23514';
  END IF;
  INSERT INTO payroll_adjustments (reference, kind, employee_id, attendance_id, work_date, amount, reason, created_by)
  VALUES ('MCO-DED:' || a.id, 'MISSING_CLOCK_OUT_DEDUCTION', a.employee_id, a.id, a.attendance_date, cfg.deduction_amount, trim(p_reason), v_me)
  ON CONFLICT (reference) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('created', false); END IF;   -- already recorded: nothing new
  INSERT INTO audit_logs (actor_employee_id, action, module, entity_type, entity_id, description, new_values, source)
  VALUES (v_me, 'MISSING_CLOCK_OUT_DEDUCTION_APPLIED', 'PAYROLL', 'payroll_adjustments', v_id,
    format('Missing clock-out deduction %s for %s (no correction): %s', cfg.deduction_amount, a.attendance_date, trim(p_reason)),
    jsonb_build_object('attendance_id', a.id, 'amount', cfg.deduction_amount), 'WEB');
  RETURN jsonb_build_object('created', true, 'amount', cfg.deduction_amount);
END $$;

-- ---------------------------------------------------------------------------- 8. payroll approval + settlement (atomic)
-- Approves an UNDER_REVIEW payroll and marks the adjustments its calculation included as SETTLED,
-- in one transaction. If any of them changed since the calculation (cancelled, settled by another
-- payroll), nothing is approved: recalculate first. Unresolved review flags still block approval.
CREATE OR REPLACE FUNCTION public.approve_payroll_with_adjustments(p_payroll_id UUID, p_adjustment_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me UUID := public.get_auth_employee_id(); p payroll%ROWTYPE; v_flags INTEGER := 0; v_n INTEGER := 0;
BEGIN
  IF public.get_auth_role() NOT IN ('ADMIN', 'HR') OR v_me IS NULL THEN
    RAISE EXCEPTION 'Only an administrator can approve payroll.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM payroll WHERE id = p_payroll_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'Payroll not found.' USING ERRCODE = '23503'; END IF;
  IF p.status <> 'UNDER_REVIEW' THEN RAISE EXCEPTION 'Cannot change payroll status from % to APPROVED.', p.status USING ERRCODE = '23514'; END IF;
  BEGIN
    v_flags := COALESCE(jsonb_array_length((p.remarks::jsonb)->'attendance'->'reviewItems'), 0);
  EXCEPTION WHEN others THEN v_flags := 0;
  END;
  IF v_flags > 0 THEN RAISE EXCEPTION 'Cannot approve: % attendance review flag(s) are unresolved.', v_flags USING ERRCODE = '23514'; END IF;
  -- A correction of this period approved after the calculation changed attendance and overtime: recalculate first
  IF EXISTS (SELECT 1 FROM overtime_requests o WHERE o.employee_id = p.employee_id AND o.request_type = 'MISSING_CLOCK_OUT'
             AND o.status = 'APPROVED' AND o.work_date BETWEEN p.period_start AND p.period_end
             AND (p.calculated_at IS NULL OR o.reviewed_at > p.calculated_at)) THEN
    RAISE EXCEPTION 'A missing clock-out correction for this period was approved after the payroll was calculated. Recalculate the payroll, then approve.' USING ERRCODE = '40001';
  END IF;
  IF COALESCE(cardinality(p_adjustment_ids), 0) > 0 THEN
    UPDATE payroll_adjustments SET status = 'SETTLED', settled_payroll_id = p.id, settled_year = p.payroll_year,
           settled_month = p.payroll_month, settled_at = now()
     WHERE id = ANY (p_adjustment_ids) AND status = 'PENDING' AND employee_id = p.employee_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(p_adjustment_ids) THEN
      RAISE EXCEPTION 'Payroll adjustments changed since this payroll was calculated. Recalculate it, then approve.' USING ERRCODE = '40001';
    END IF;
  END IF;
  UPDATE payroll SET status = 'APPROVED', approved_at = now(), approved_by = v_me WHERE id = p.id;
  INSERT INTO audit_logs (actor_employee_id, action, module, entity_type, entity_id, description, new_values, source)
  VALUES (v_me, 'PAYROLL_APPROVED', 'PAYROLL', 'payroll', p.id,
          format('Payroll approved; %s adjustment(s) settled.', v_n), jsonb_build_object('status', 'APPROVED', 'settled_adjustments', p_adjustment_ids), 'WEB');
  RETURN v_n;
END $$;

-- ---------------------------------------------------------------------------- 9. auto clock-out → flag only
CREATE OR REPLACE FUNCTION public.process_auto_clock_out()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg RECORD; rec attendance%ROWTYPE; v_flag TIMESTAMPTZ; n INTEGER := 0;
BEGIN
  SELECT * INTO cfg FROM public.mco_settings();
  FOR rec IN SELECT * FROM attendance WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL
             AND COALESCE(status, '') <> 'MISSING_CLOCK_OUT' LOOP
    v_flag := public.mco_flag_at(rec, cfg.grace_hours);
    IF v_flag IS NOT NULL AND now() >= v_flag THEN
      -- No clock-out time is invented, no break is closed, no worked or overtime minutes are written.
      UPDATE attendance SET status = 'MISSING_CLOCK_OUT', updated_at = now() WHERE id = rec.id AND clock_out_at IS NULL;
      INSERT INTO attendance_events (attendance_id, employee_id, event_type, event_at, source, metadata)
      VALUES (rec.id, rec.employee_id, 'MISSING_CLOCK_OUT', now(), 'SYSTEM', jsonb_build_object('flag_at', v_flag));
      INSERT INTO notifications (recipient_employee_id, notification_type, title, message, action_url, is_read)
      VALUES (rec.employee_id, 'ATTENDANCE', 'Clock-out missing',
              'You did not clock out on ' || to_char(rec.attendance_date, 'DD Mon YYYY') || '. Please submit your clock-out time and reason under Overtime.',
              '/employee/overtime', false);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------- 9b. locked-month overtime rule
-- If PROPOSED_payroll_payment_safety.sql (part 5) is applied, approving overtime for a month whose
-- payroll is locked is refused. Company decision 2026-10-14 ("defer to next month"): a MISSING CLOCK-OUT
-- correction approved after its month was locked is still approved, and its overtime is paid later as a
-- DEFERRED_OVERTIME adjustment (see review_missing_clock_out_request). Ordinary overtime keeps the rule.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'guard_overtime_approval_locked_month' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.guard_overtime_approval_locked_month()
      RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $body$
      DECLARE v_status text;
      BEGIN
        IF COALESCE(NEW.request_type, 'OVERTIME') = 'MISSING_CLOCK_OUT' THEN RETURN NEW; END IF;
        IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPROVED') THEN
          SELECT status INTO v_status FROM public.payroll
          WHERE employee_id = NEW.employee_id
            AND payroll_year = EXTRACT(YEAR FROM NEW.work_date)
            AND payroll_month = EXTRACT(MONTH FROM NEW.work_date);
          IF v_status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED') THEN
            RAISE EXCEPTION 'Payroll for % is already %; overtime for that month can no longer be approved.',
              to_char(NEW.work_date, 'MM/YYYY'), v_status USING ERRCODE = 'check_violation';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $body$;
    $fn$;
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------- 10. permissions
-- Internal helpers (SECURITY DEFINER, read any attendance / breaks / leave): only the functions below call them.
-- Supabase grants EXECUTE on new public functions to authenticated by default, so revoke it explicitly.
REVOKE ALL ON FUNCTION public.mco_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mco_flag_at(attendance, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mco_evaluate(attendance, TIMESTAMPTZ, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_missing_clock_out_request(UUID, TIMESTAMPTZ, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_missing_clock_out_request(UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_missing_clock_out_deduction(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_payroll_with_adjustments(UUID, UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_auto_clock_out() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_missing_clock_out_request(UUID, TIMESTAMPTZ, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_missing_clock_out_request(UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_missing_clock_out_deduction(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payroll_with_adjustments(UUID, UUID[]) TO authenticated;

COMMIT;

-- ROLLBACK — review before running; staging first. It keeps all data and history.
--   0. Decide every PENDING correction first (or cancel it): after rollback the ordinary overtime rules
--      would apply to those rows. Check: SELECT count(*) FROM overtime_requests
--        WHERE request_type = 'MISSING_CLOCK_OUT' AND status = 'PENDING';            -- must be 0
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.approve_payroll_with_adjustments(UUID, UUID[]);
--   DROP FUNCTION IF EXISTS public.apply_missing_clock_out_deduction(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.review_missing_clock_out_request(UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT);
--   DROP FUNCTION IF EXISTS public.submit_missing_clock_out_request(UUID, TIMESTAMPTZ, NUMERIC, TEXT);
--   -- Keep public.payroll_adjustments (settled rows are payroll history); just stop new writes:
--   REVOKE ALL ON public.payroll_adjustments FROM authenticated, anon;
--   -- Keep the new columns and rows of overtime_requests (history). Restore the original guard by
--   -- re-running ONLY the "CREATE OR REPLACE FUNCTION public.overtime_requests_guard" block of
--   -- docs/proposals/PROPOSED_overtime_requests.sql, and, if PROPOSED_payroll_payment_safety.sql is applied,
--   -- its guard_overtime_approval_locked_month block. Do NOT re-add CHECK (requested_overtime_hours > 0):
--   -- existing corrections may hold 0 and would make it fail; keep ot_requested_hours / ot_approved_rules.
--   -- process_auto_clock_out(): keep this flag-only version. supabase/migrations/0015_auto_clock_out.sql
--   -- invents clock-out times and does not compile, so it must not be restored as is.
--   -- The helpers mco_settings / mco_flag_at / mco_evaluate may stay (not callable by users) or be dropped
--   -- once nothing else references them.
--   COMMIT;
