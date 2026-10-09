-- =====================================================================================
-- Reviewed against supabase/migrations (0001–0015, 2026093x/2026100x). Re-runnable.
-- Apply in the Supabase SQL Editor (one run). Then run docs/proposals/VERIFY_overtime_requests.sql
-- WorkPulse HR Step 6: Employee Overtime requests
--
-- Nothing suitable exists today: attendance.overtime_minutes is an automatic value
-- (Step 3 stopped writing it from clock-out; the auto clock-out job still writes it — see
-- docs/security/PROPOSED_attendance_integrity.sql). This adds ONE new table.
-- Payroll must later read ONLY overtime_requests.approved_overtime_hours (status APPROVED).
-- =====================================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.overtime_requests (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id               UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_id             UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  shift_id                  UUID REFERENCES shift_templates(id),
  work_date                 DATE NOT NULL,
  scheduled_hours           NUMERIC(5,2) NOT NULL CHECK (scheduled_hours >= 0),
  actual_working_hours      NUMERIC(5,2) NOT NULL CHECK (actual_working_hours >= 0),
  eligible_overtime_hours   NUMERIC(5,2) NOT NULL CHECK (eligible_overtime_hours >= 0),
  requested_overtime_hours  NUMERIC(5,2) NOT NULL CHECK (requested_overtime_hours > 0),
  approved_overtime_hours   NUMERIC(5,2) CHECK (approved_overtime_hours >= 0),
  status                    VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  employee_reason           TEXT NOT NULL CHECK (length(trim(employee_reason)) >= 3),
  admin_remarks             TEXT,
  reviewed_by               UUID REFERENCES employees(id),
  reviewed_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ot_requested_le_eligible CHECK (requested_overtime_hours <= eligible_overtime_hours),
  CONSTRAINT ot_approved_rules CHECK (
    (status = 'APPROVED' AND approved_overtime_hours > 0
       AND approved_overtime_hours <= requested_overtime_hours
       AND approved_overtime_hours <= eligible_overtime_hours
       AND reviewed_at IS NOT NULL)
    OR (status = 'REJECTED' AND COALESCE(approved_overtime_hours, 0) = 0 AND reviewed_at IS NOT NULL)
    OR (status IN ('PENDING', 'CANCELLED') AND approved_overtime_hours IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_ot_employee_date ON overtime_requests (employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_ot_status ON overtime_requests (status);
-- One active (PENDING/APPROVED) request per attendance: double click, refresh, second tab, retry
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ot_active_per_attendance
  ON overtime_requests (attendance_id) WHERE status IN ('PENDING', 'APPROVED');

-- -------------------------------------------------------------------------------------
-- Server-side rules (the browser cannot choose eligibility, approval, reviewer or dates)
-- Same formula as src/services/overtime/overtimeRules.ts:
--   potential = worked − required − minutes late, ≥ 0
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.overtime_requests_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin BOOLEAN := public.get_auth_role() IN ('ADMIN', 'HR');
  a attendance%ROWTYPE; s shift_templates%ROWTYPE;
  v_break_min NUMERIC; v_worked_min NUMERIC; v_req_min NUMERIC;
  v_start TIMESTAMPTZ; v_end TIMESTAMPTZ; v_late NUMERIC; v_after NUMERIC; v_pot NUMERIC;
  v_half BOOLEAN; v_leave BOOLEAN;
BEGIN
  NEW.updated_at := now();

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
      INTO v_break_min FROM attendance_breaks WHERE attendance_id = a.id AND ended_at IS NOT NULL;
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

    -- trusted values, whatever the browser sent
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
    RETURN NEW;  -- requested ≤ eligible enforced by CHECK ot_requested_le_eligible
  END IF;

  -- UPDATE
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.attendance_id IS DISTINCT FROM OLD.attendance_id
     OR NEW.work_date IS DISTINCT FROM OLD.work_date OR NEW.eligible_overtime_hours IS DISTINCT FROM OLD.eligible_overtime_hours
     OR NEW.scheduled_hours IS DISTINCT FROM OLD.scheduled_hours OR NEW.actual_working_hours IS DISTINCT FROM OLD.actual_working_hours THEN
    RAISE EXCEPTION 'Overtime request details cannot be changed.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This overtime request has already been reviewed.' USING ERRCODE = '23514';
  END IF;

  IF v_admin THEN
    IF NEW.status IN ('APPROVED', 'REJECTED') THEN
      NEW.reviewed_by := public.get_auth_employee_id();
      NEW.reviewed_at := now();
      IF NEW.status = 'REJECTED' THEN NEW.approved_overtime_hours := 0; END IF;
    END IF;
  ELSE
    -- employee: may only cancel, or edit hours/reason, of their own PENDING request
    IF NEW.status NOT IN ('PENDING', 'CANCELLED') OR NEW.approved_overtime_hours IS NOT NULL
       OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.admin_remarks IS DISTINCT FROM OLD.admin_remarks THEN
      RAISE EXCEPTION 'Only an administrator can review overtime.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS overtime_requests_guard ON overtime_requests;
CREATE TRIGGER overtime_requests_guard BEFORE INSERT OR UPDATE ON overtime_requests
FOR EACH ROW EXECUTE FUNCTION public.overtime_requests_guard();

-- -------------------------------------------------------------------------------------
-- RLS: employee = own rows only; ADMIN/HR = all (same helpers as every other table)
-- -------------------------------------------------------------------------------------
ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View overtime_requests" ON overtime_requests;
CREATE POLICY "View overtime_requests" ON overtime_requests FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Insert own overtime_requests" ON overtime_requests;
CREATE POLICY "Insert own overtime_requests" ON overtime_requests FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Update overtime_requests" ON overtime_requests;
CREATE POLICY "Update overtime_requests" ON overtime_requests FOR UPDATE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR (employee_id = public.get_auth_employee_id() AND status = 'PENDING'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
-- No DELETE policy: requests are kept (cancel instead).

GRANT SELECT, INSERT, UPDATE ON overtime_requests TO authenticated;

-- Live updates for the admin/employee overtime pages (non-destructive)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'overtime_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.overtime_requests;
  END IF;
END $$;

COMMIT;
