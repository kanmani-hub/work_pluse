-- 20261021120000_automatic_break_tracking.sql
-- WorkPulse HR — Automatic breaks on location / network loss (server-authoritative)
--
-- WHAT THIS DOES
--  1. attendance_breaks gets source (EMPLOYEE / SYSTEM / ADMIN), reason and ended_reason.
--  2. employee_tracking_state: one row per employee, written ONLY by the server functions below
--     (last fresh location received, last device contact, current tracking problem, open automatic break).
--  3. Guard triggers: employees can no longer forge, relabel, re-time, close or delete system breaks,
--     and cannot change attendance break totals. Their own manual breaks still work, with server time.
--  4. Attendance break totals (break_minutes, break_overrun_minutes, ON_BREAK status) are recalculated
--     by the database whenever a break changes (same formula as the app: completed, non-cancelled breaks).
--  5. Server functions (database time, Asia/Kolkata company date, overnight shifts, row locks):
--       report_tracking_event(...)          device-observed events (permission denied, GPS unavailable,
--                                           timeout, network reconnected)
--       geofence_auto_break(...)            office exit / return break (AUTO_GPS), moved from the browser
--       close_auto_break_for_clock_out(...) closes an open system break at clock-out
--       process_stale_tracking()            scheduled: stale-location breaks, grace periods, shift-end cleanup
--     plus a trigger on employee_live_locations that ends a tracking break when a FRESH location arrives.
--  6. pg_cron job 'auto-break-stale-tracking' every minute (only if pg_cron is installed; idempotent).
--  7. Realtime publication for attendance_breaks and employee_tracking_state.
--
-- POLICY (Admin → Settings, stored in app_settings.settings.app; defaults = confirmed business policy)
--   autoBreakEnabled true · autoBreakOnPermissionDenied true · autoBreakOnGpsUnavailable true
--   autoBreakOnStale true · autoBreakStaleMinutes 15 (2–120; independent of the display-only trackingStaleMinutes)
--   autoBreakGraceMinutes 0 · autoBreakAutoResume true · autoBreakWfhStale true · autoBreakWfhGpsLoss false
--
-- SAFETY
--   * Refuses to run (changes nothing) if an attendance already has more than one open break; the
--     offending rows are listed in the error so HR can correct them first. Nothing is deleted.
--   * Existing AUTO_GPS / AUTO_TRACKING rows are back-filled as source SYSTEM.
--   * Never run against production without testing on staging first.
-- Rollback: supabase/rollbacks/20261021120000_automatic_break_tracking.rollback.sql

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 0. Pre-check: more than one open break on one attendance would break the unique index below.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE v_list text;
BEGIN
  SELECT string_agg(attendance_id::text || ' (' || n || ' open)', ', ') INTO v_list
  FROM (SELECT attendance_id, count(*) n FROM public.attendance_breaks
        WHERE ended_at IS NULL AND break_type <> 'CANCELLED' GROUP BY attendance_id HAVING count(*) > 1) d;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Automatic-break migration stopped: attendance rows with more than one open break: %. Close or cancel the extra breaks (Admin → Break Management) and run the migration again. Nothing was changed.', v_list;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_break_per_attendance
  ON public.attendance_breaks (attendance_id)
  WHERE ended_at IS NULL AND break_type <> 'CANCELLED';

-- ---------------------------------------------------------------------------------------------
-- 1. Break source / reason
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.attendance_breaks ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE public.attendance_breaks ADD COLUMN IF NOT EXISTS reason VARCHAR(50);
ALTER TABLE public.attendance_breaks ADD COLUMN IF NOT EXISTS ended_reason VARCHAR(50);
ALTER TABLE public.attendance_breaks ADD COLUMN IF NOT EXISTS incident_id VARCHAR(100);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_breaks_source_check') THEN
    ALTER TABLE public.attendance_breaks ADD CONSTRAINT attendance_breaks_source_check
      CHECK (source IN ('EMPLOYEE', 'SYSTEM', 'ADMIN'));
  END IF;
END $$;

-- Upgrade path: existing automatic breaks were created by the system
UPDATE public.attendance_breaks SET source = 'SYSTEM' WHERE break_type IN ('AUTO_GPS', 'AUTO_TRACKING') AND source <> 'SYSTEM';
UPDATE public.attendance_breaks SET reason = 'GEOFENCE_EXIT' WHERE break_type = 'AUTO_GPS' AND reason IS NULL;
UPDATE public.attendance_breaks SET reason = 'TRACKING_LOST' WHERE break_type = 'AUTO_TRACKING' AND reason IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 2. Server-maintained tracking state
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_tracking_state (
  employee_id        UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
  attendance_id      UUID REFERENCES public.attendance(id) ON DELETE SET NULL,
  -- TRACKING_OK, TRACKING_RESTORED, PERMISSION_DENIED, GPS_UNAVAILABLE, GPS_TIMEOUT, LOCATION_ERROR,
  -- WAITING_FOR_FIX (network back, no fresh location yet), STALE (nothing reached the server)
  state              VARCHAR(40) NOT NULL DEFAULT 'TRACKING_OK',
  state_since        TIMESTAMPTZ NOT NULL DEFAULT now(),
  work_mode          VARCHAR(10),
  last_fresh_fix_at  TIMESTAMPTZ,          -- server time a fresh, usable location was received
  last_contact_at    TIMESTAMPTZ,          -- server time of any report from the device
  last_problem       VARCHAR(40),
  last_problem_at    TIMESTAMPTZ,
  last_problem_message TEXT,
  last_reconnect_at  TIMESTAMPTZ,
  reported_offline_seconds INTEGER,
  open_auto_break_id UUID REFERENCES public.attendance_breaks(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.employee_tracking_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View tracking state" ON public.employee_tracking_state;
CREATE POLICY "View tracking state" ON public.employee_tracking_state FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
-- No INSERT / UPDATE / DELETE policies: only the SECURITY DEFINER functions below write this table.
REVOKE ALL ON public.employee_tracking_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.employee_tracking_state TO authenticated;
GRANT ALL ON public.employee_tracking_state TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Internal helpers (not callable through the API)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ab_company_date(p_at timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE AS $$ SELECT (p_at AT TIME ZONE 'Asia/Kolkata')::date $$;

-- true for database roles that run trusted server code (migrations, cron, SECURITY DEFINER bodies)
CREATE OR REPLACE FUNCTION public.ab_is_privileged_db_role()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_user IN ('postgres', 'service_role', 'supabase_admin')
$$;

CREATE OR REPLACE FUNCTION public.ab_bool(p_val text, p_default boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(p_val) IN ('true', 't', '1') THEN true WHEN lower(p_val) IN ('false', 'f', '0') THEN false ELSE p_default END
$$;

CREATE OR REPLACE FUNCTION public.ab_int(p_val text, p_default integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_val ~ '^\s*-?\d+(\.\d+)?\s*$' THEN round(p_val::numeric)::integer ELSE p_default END
$$;

-- Effective policy (settings.app first, legacy flat settings second, then the confirmed defaults)
CREATE OR REPLACE FUNCTION public.ab_policy()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb; a jsonb;
BEGIN
  SELECT settings INTO s FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  s := COALESCE(s, '{}'::jsonb);
  a := COALESCE(s->'app', '{}'::jsonb);
  RETURN jsonb_build_object(
    'enabled',            ab_bool(COALESCE(a->>'autoBreakEnabled', s->>'autoBreakEnabled'), true),
    'onPermissionDenied', ab_bool(COALESCE(a->>'autoBreakOnPermissionDenied', s->>'autoBreakOnPermissionDenied'), true),
    'onGpsUnavailable',   ab_bool(COALESCE(a->>'autoBreakOnGpsUnavailable', s->>'autoBreakOnGpsUnavailable'), true),
    'onStale',            ab_bool(COALESCE(a->>'autoBreakOnStale', s->>'autoBreakOnStale'), true),
    -- (trackingStaleMinutes is the admin DISPLAY threshold and is deliberately not used here)
    'staleMinutes',       LEAST(120, GREATEST(2, ab_int(COALESCE(a->>'autoBreakStaleMinutes', s->>'autoBreakStaleMinutes'), 15))),
    'graceMinutes',       LEAST(120, GREATEST(0, ab_int(COALESCE(a->>'autoBreakGraceMinutes', s->>'autoBreakGraceMinutes'), 0))),
    'autoResume',         ab_bool(COALESCE(a->>'autoBreakAutoResume', s->>'autoBreakAutoResume'), true),
    'wfhStale',           ab_bool(COALESCE(a->>'autoBreakWfhStale', s->>'autoBreakWfhStale'), true),
    'wfhGpsLoss',         ab_bool(COALESCE(a->>'autoBreakWfhGpsLoss', s->>'autoBreakWfhGpsLoss'), false),
    -- a location counts as "fresh" when the device measured it at most this long before it arrived
    'freshFixMinutes',    5
  );
END $$;

-- The employee's open attendance right now: today's (company date), or last night's overnight shift.
-- p_lock: lock the attendance row (serialises concurrent automatic-break decisions for one employee).
CREATE OR REPLACE FUNCTION public.ab_open_attendance(p_employee uuid, p_lock boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date := ab_company_date(now()); v_id uuid;
BEGIN
  IF p_lock THEN
    SELECT a.id INTO v_id FROM attendance a LEFT JOIN shift_templates st ON st.id = a.shift_template_id
    WHERE a.employee_id = p_employee AND a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
      AND (a.attendance_date = v_today OR (a.attendance_date = v_today - 1 AND COALESCE(st.crosses_midnight, false)))
    ORDER BY a.attendance_date DESC LIMIT 1 FOR UPDATE OF a;
  ELSE
    SELECT a.id INTO v_id FROM attendance a LEFT JOIN shift_templates st ON st.id = a.shift_template_id
    WHERE a.employee_id = p_employee AND a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
      AND (a.attendance_date = v_today OR (a.attendance_date = v_today - 1 AND COALESCE(st.crosses_midnight, false)))
    ORDER BY a.attendance_date DESC LIMIT 1;
  END IF;
  RETURN v_id;
END $$;

-- Shift end of an attendance in company time (NULL when the attendance has no shift template)
CREATE OR REPLACE FUNCTION public.ab_shift_end(p_attendance uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ((a.attendance_date + st.end_time)
          + CASE WHEN COALESCE(st.crosses_midnight, false) THEN interval '1 day' ELSE interval '0' END)
         AT TIME ZONE 'Asia/Kolkata'
  FROM attendance a JOIN shift_templates st ON st.id = a.shift_template_id
  WHERE a.id = p_attendance
$$;

-- WFH day: an approved WFH request, or a roster entry with work mode WFH (column read dynamically so
-- this also works on databases where the roster work_mode column has not been added yet).
CREATE OR REPLACE FUNCTION public.ab_is_wfh(p_employee uuid, p_date date)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM wfh_requests w WHERE w.employee_id = p_employee AND w.request_date = p_date AND w.status = 'APPROVED')
      OR EXISTS (SELECT 1 FROM roster_assignments ra WHERE ra.employee_id = p_employee AND ra.assignment_date = p_date
                 AND upper(COALESCE(to_jsonb(ra)->>'work_mode', '')) = 'WFH');
END $$;

-- Break totals exactly as the app computes them (breakRules.completedBreakMinutes / computeBreakOverrun):
-- completed, non-cancelled breaks; stored duration when present, otherwise whole minutes from timestamps.
-- Allowed = shift break_duration_minutes, else Settings breakDurationMins (app default 60).
-- Overrun only when payroll.enableBreakOverrunDetection is true (app default false).
CREATE OR REPLACE FUNCTION public.ab_break_totals(p_attendance uuid, OUT actual integer, OUT allowed integer, OUT overrun integer, OUT has_open boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb; v_shift_mins integer; v_detect boolean;
BEGIN
  -- Called by the employee guard trigger with the employee's rights: only their own attendance
  IF auth.uid() IS NOT NULL AND COALESCE(get_auth_role(), '') NOT IN ('ADMIN', 'HR')
     AND NOT EXISTS (SELECT 1 FROM attendance x WHERE x.id = p_attendance AND x.employee_id = get_auth_employee_id()) THEN
    RAISE EXCEPTION 'Not your attendance' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(sum(COALESCE(b.duration_minutes, floor(extract(epoch FROM (b.ended_at - b.started_at)) / 60)::integer)), 0)::integer
    INTO actual
  FROM attendance_breaks b WHERE b.attendance_id = p_attendance AND b.ended_at IS NOT NULL AND b.break_type <> 'CANCELLED';
  SELECT EXISTS (SELECT 1 FROM attendance_breaks b WHERE b.attendance_id = p_attendance AND b.ended_at IS NULL AND b.break_type <> 'CANCELLED')
    INTO has_open;
  SELECT settings INTO s FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  s := COALESCE(s, '{}'::jsonb);
  SELECT st.break_duration_minutes INTO v_shift_mins FROM attendance a JOIN shift_templates st ON st.id = a.shift_template_id WHERE a.id = p_attendance;
  allowed := COALESCE(v_shift_mins, ab_int(COALESCE(s->'app'->>'breakDurationMins', s->>'breakDurationMins'), 60));
  v_detect := ab_bool(s->'payroll'->>'enableBreakOverrunDetection', false);
  overrun := CASE WHEN v_detect AND allowed IS NOT NULL THEN GREATEST(0, actual - allowed) ELSE 0 END;
END $$;

-- Write the totals (and the ON_BREAK status while clocked in) to the attendance row; no-op when unchanged.
CREATE OR REPLACE FUNCTION public.ab_recalc_attendance(p_attendance uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; a record; v_status text;
BEGIN
  SELECT id, status, late_minutes, clock_out_at, break_minutes, break_overrun_minutes INTO a FROM attendance WHERE id = p_attendance;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO t FROM ab_break_totals(p_attendance);
  v_status := a.status;
  IF a.clock_out_at IS NULL THEN
    IF t.has_open THEN v_status := 'ON_BREAK';
    ELSIF a.status = 'ON_BREAK' THEN v_status := CASE WHEN COALESCE(a.late_minutes, 0) > 0 THEN 'LATE' ELSE 'WORKING' END;
    END IF;
  END IF;
  IF a.break_minutes IS DISTINCT FROM t.actual OR COALESCE(a.break_overrun_minutes, 0) IS DISTINCT FROM t.overrun OR a.status IS DISTINCT FROM v_status THEN
    UPDATE attendance SET break_minutes = t.actual, break_overrun_minutes = t.overrun, status = v_status WHERE id = p_attendance;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Guard triggers (employees; ADMIN/HR and trusted server code are not restricted here)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ab_guard_attendance_breaks()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_emp uuid; v_att record; v_end timestamptz;
BEGIN
  -- Lock order for EVERY writer (employee, admin, server functions): attendance row first, then the
  -- break. The server functions lock the attendance row before inserting / ending a break; without this,
  -- a manual insert (index entry first, attendance later in the totals trigger) could deadlock with them.
  -- (Re-locking a row the transaction already holds is a no-op.)
  PERFORM 1 FROM attendance WHERE id = COALESCE(NEW.attendance_id, OLD.attendance_id) FOR UPDATE;
  IF ab_is_privileged_db_role() OR COALESCE(get_auth_role(), '') IN ('ADMIN', 'HR') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_emp := get_auth_employee_id();

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Breaks cannot be deleted by employees' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.break_type IN ('AUTO_GPS', 'AUTO_TRACKING', 'CANCELLED') THEN
      RAISE EXCEPTION 'Automatic breaks are created by the system only' USING ERRCODE = '42501';
    END IF;
    SELECT id, employee_id, clock_in_at, clock_out_at INTO v_att FROM attendance WHERE id = NEW.attendance_id;
    IF NOT FOUND OR v_emp IS NULL OR v_att.employee_id <> v_emp OR NEW.employee_id IS DISTINCT FROM v_emp THEN
      RAISE EXCEPTION 'A break can only be added to your own attendance' USING ERRCODE = '42501';
    END IF;
    IF v_att.clock_in_at IS NULL OR v_att.clock_out_at IS NOT NULL THEN
      RAISE EXCEPTION 'Breaks can only start while clocked in' USING ERRCODE = '42501';
    END IF;
    -- the database is the clock: a manual break starts now, open, without system metadata
    NEW.started_at := now();
    NEW.ended_at := NULL;
    NEW.duration_minutes := NULL;
    NEW.source := 'EMPLOYEE';
    NEW.reason := NULL;
    NEW.ended_reason := NULL;
    NEW.incident_id := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: the only employee change allowed is closing their own open manual break, once.
  IF OLD.source <> 'EMPLOYEE' OR OLD.break_type IN ('AUTO_GPS', 'AUTO_TRACKING', 'CANCELLED') THEN
    RAISE EXCEPTION 'System-created breaks cannot be changed by employees' USING ERRCODE = '42501';
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'A completed break cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF v_emp IS NULL OR OLD.employee_id <> v_emp THEN
    RAISE EXCEPTION 'Not your break' USING ERRCODE = '42501';
  END IF;
  IF NEW.attendance_id IS DISTINCT FROM OLD.attendance_id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.break_type IS DISTINCT FROM OLD.break_type
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.incident_id IS DISTINCT FROM OLD.incident_id THEN
    RAISE EXCEPTION 'Only the end of an open break can be recorded' USING ERRCODE = '42501';
  END IF;
  IF NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'Only the end of an open break can be recorded' USING ERRCODE = '42501';
  END IF;
  v_end := GREATEST(now(), OLD.started_at);
  NEW.ended_at := v_end;
  NEW.duration_minutes := floor(extract(epoch FROM (v_end - OLD.started_at)) / 60)::integer;
  NEW.ended_reason := 'EMPLOYEE';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ab_guard_attendance_breaks ON public.attendance_breaks;
CREATE TRIGGER trg_ab_guard_attendance_breaks
  BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_breaks
  FOR EACH ROW EXECUTE FUNCTION public.ab_guard_attendance_breaks();

-- Totals follow the breaks (any writer: employee, admin, server functions, auto clock-out)
CREATE OR REPLACE FUNCTION public.ab_after_break_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM ab_recalc_attendance(COALESCE(NEW.attendance_id, OLD.attendance_id));
  IF TG_OP = 'UPDATE' AND NEW.attendance_id IS DISTINCT FROM OLD.attendance_id THEN
    PERFORM ab_recalc_attendance(OLD.attendance_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_ab_after_break_change ON public.attendance_breaks;
CREATE TRIGGER trg_ab_after_break_change
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance_breaks
  FOR EACH ROW EXECUTE FUNCTION public.ab_after_break_change();

-- Employees cannot set break totals or the ON_BREAK status themselves: the database derives them.
CREATE OR REPLACE FUNCTION public.ab_guard_attendance_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE t record;
BEGIN
  IF ab_is_privileged_db_role() OR COALESCE(get_auth_role(), '') IN ('ADMIN', 'HR') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.break_minutes := 0;
    NEW.break_overrun_minutes := 0;
    IF NEW.status = 'ON_BREAK' THEN NEW.status := CASE WHEN COALESCE(NEW.late_minutes, 0) > 0 THEN 'LATE' ELSE 'WORKING' END; END IF;
    RETURN NEW;
  END IF;
  -- The automatic-break rules depend on these fields (which attendance is "open today", shift end, the
  -- stale-location start). The app never changes them after clock-in; an employee API call must not
  -- either (e.g. moving attendance_date to escape the checks, or switching to an ended shift so an open
  -- tracking break is closed at 0 minutes). ADMIN / HR corrections are not restricted (see above).
  IF NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.attendance_date IS DISTINCT FROM OLD.attendance_date
     OR NEW.shift_template_id IS DISTINCT FROM OLD.shift_template_id
     OR NEW.shift_assignment_id IS DISTINCT FROM OLD.shift_assignment_id
     OR NEW.roster_assignment_id IS DISTINCT FROM OLD.roster_assignment_id
     OR (OLD.clock_in_at IS NOT NULL AND NEW.clock_in_at IS DISTINCT FROM OLD.clock_in_at)
     OR (OLD.clock_out_at IS NOT NULL AND NEW.clock_out_at IS DISTINCT FROM OLD.clock_out_at) THEN
    RAISE EXCEPTION 'Attendance date, shift, clock-in and a recorded clock-out can only be changed by an administrator' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM ab_break_totals(NEW.id);
  IF OLD.clock_out_at IS NULL AND NEW.clock_out_at IS NOT NULL AND t.has_open THEN
    RAISE EXCEPTION 'A break is still open: end it before clocking out' USING ERRCODE = '42501';
  END IF;
  NEW.break_minutes := t.actual;
  NEW.break_overrun_minutes := t.overrun;
  IF NEW.clock_out_at IS NULL THEN
    IF t.has_open THEN NEW.status := 'ON_BREAK';
    ELSIF NEW.status = 'ON_BREAK' THEN NEW.status := CASE WHEN COALESCE(NEW.late_minutes, 0) > 0 THEN 'LATE' ELSE 'WORKING' END;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ab_guard_attendance_totals ON public.attendance;
CREATE TRIGGER trg_ab_guard_attendance_totals
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.ab_guard_attendance_totals();

-- ---------------------------------------------------------------------------------------------
-- 5. Automatic break start / end (internal)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ab_reason_message(p_reason text, p_stale_minutes integer DEFAULT NULL)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_reason
    WHEN 'LOCATION_PERMISSION_DENIED' THEN 'Location permission was turned off while you were clocked in, so an automatic break started. Turn location access for WorkPulse back on: work resumes automatically as soon as a fresh location is received.'
    WHEN 'GPS_UNAVAILABLE' THEN 'Your device could not provide a location while you were clocked in, so an automatic break started. Turn on location services / GPS: work resumes automatically as soon as a fresh location is received.'
    WHEN 'TRACKING_STALE' THEN 'No location reached WorkPulse for ' || COALESCE(p_stale_minutes::text, 'several') || ' minutes (app closed, device asleep, or no internet), so an automatic break started. Open WorkPulse with location and internet on: work resumes automatically as soon as a fresh location is received.'
    WHEN 'NETWORK_DISCONNECTED' THEN 'Your device was offline while you were clocked in, so an automatic break started. Work resumes automatically as soon as a fresh location is received.'
    WHEN 'GEOFENCE_EXIT' THEN 'You have left the office geofence. Your working timer is paused.'
    ELSE 'An automatic break started.'
  END
$$;

CREATE OR REPLACE FUNCTION public.ab_notify(p_employee uuid, p_title text, p_message text, p_break uuid, p_dedupe text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO notifications (recipient_employee_id, notification_type, title, message, priority, action_url, entity_type, entity_id, metadata)
    VALUES (p_employee, 'AUTOMATIC_BREAK', p_title, p_message, 'NORMAL', '/employee/dashboard', 'attendance_breaks', p_break,
            jsonb_build_object('dedupe_key', p_dedupe) || COALESCE(p_extra, '{}'::jsonb));
  EXCEPTION
    WHEN unique_violation THEN NULL;  -- already notified (dedupe index)
    WHEN OTHERS THEN                  -- a notification problem (e.g. push webhook) never blocks a break decision
      RAISE WARNING 'automatic-break notification not delivered: %', SQLERRM;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.ab_start_auto_break(p_attendance uuid, p_type text, p_reason text, p_at timestamptz, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; v_open uuid; v_last_end timestamptz; v_at timestamptz; v_id uuid; v_policy jsonb := ab_policy();
BEGIN
  SELECT id, employee_id, clock_in_at, clock_out_at INTO a FROM attendance WHERE id = p_attendance;
  IF NOT FOUND OR a.clock_in_at IS NULL OR a.clock_out_at IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'NOT_CLOCKED_IN');
  END IF;
  SELECT id INTO v_open FROM attendance_breaks WHERE attendance_id = p_attendance AND ended_at IS NULL AND break_type <> 'CANCELLED' LIMIT 1;
  IF v_open IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'BREAK_ALREADY_ACTIVE', 'break_id', v_open);
  END IF;
  SELECT max(ended_at) INTO v_last_end FROM attendance_breaks WHERE attendance_id = p_attendance AND break_type <> 'CANCELLED';
  -- never before clock-in, never overlapping an earlier break, never in the future
  v_at := LEAST(now(), GREATEST(COALESCE(p_at, now()), a.clock_in_at, COALESCE(v_last_end, a.clock_in_at)));
  BEGIN
    INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, source, reason)
    VALUES (p_attendance, a.employee_id, p_type, v_at, 'SYSTEM', p_reason) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'BREAK_ALREADY_ACTIVE');
  END;
  INSERT INTO attendance_events (attendance_id, employee_id, event_type, event_at, source, metadata)
  VALUES (p_attendance, a.employee_id, 'BREAK_START', v_at, 'SYSTEM',
          jsonb_build_object('trigger', CASE WHEN p_type = 'AUTO_GPS' THEN 'GPS_GEOFENCE' ELSE 'TRACKING' END,
                             'break_type', p_type, 'break_id', v_id, 'reason', p_reason) || COALESCE(p_meta, '{}'::jsonb));
  INSERT INTO audit_logs (actor_employee_id, action, module, entity_type, entity_id, description, new_values, source)
  VALUES (NULL, 'AUTOMATIC_BREAK_STARTED', 'ATTENDANCE', 'attendance_breaks', v_id,
          'Automatic break started (' || p_reason || ') at ' || to_char(v_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') || ' IST.',
          jsonb_build_object('attendance_id', p_attendance, 'employee_id', a.employee_id, 'break_type', p_type, 'reason', p_reason, 'started_at', v_at), 'SYSTEM');
  PERFORM ab_notify(a.employee_id, 'Automatic Break Started', ab_reason_message(p_reason, (v_policy->>'staleMinutes')::int), v_id,
                    'break:' || v_id || ':START', jsonb_build_object('reason', p_reason));
  UPDATE employee_tracking_state SET open_auto_break_id = v_id, updated_at = now() WHERE employee_id = a.employee_id;
  RETURN jsonb_build_object('action', 'STARTED', 'break_id', v_id, 'started_at', v_at, 'break_type', p_type, 'reason', p_reason);
END $$;

CREATE OR REPLACE FUNCTION public.ab_end_auto_break(p_break uuid, p_at timestamptz, p_ended_reason text, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record; v_end timestamptz; v_mins integer; t record; v_msg text;
BEGIN
  -- SKIP LOCKED: if another transaction (e.g. an admin "End Break") is changing this break right now, do
  -- not wait on it (that would invert the lock order and could deadlock): that transaction ends it.
  SELECT * INTO b FROM attendance_breaks WHERE id = p_break FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason',
      CASE WHEN EXISTS (SELECT 1 FROM attendance_breaks WHERE id = p_break) THEN 'BREAK_BEING_CHANGED' ELSE 'BREAK_ALREADY_ENDED' END);
  END IF;
  IF b.ended_at IS NOT NULL OR b.break_type = 'CANCELLED' THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'BREAK_ALREADY_ENDED');
  END IF;
  v_end := GREATEST(LEAST(COALESCE(p_at, now()), now()), b.started_at);
  v_mins := floor(extract(epoch FROM (v_end - b.started_at)) / 60)::integer;
  UPDATE attendance_breaks SET ended_at = v_end, duration_minutes = v_mins, ended_reason = p_ended_reason
  WHERE id = p_break AND ended_at IS NULL;
  INSERT INTO attendance_events (attendance_id, employee_id, event_type, event_at, source, metadata)
  VALUES (b.attendance_id, b.employee_id, 'BREAK_END', v_end, 'SYSTEM',
          jsonb_build_object('trigger', p_ended_reason, 'break_type', b.break_type, 'break_id', b.id, 'duration_minutes', v_mins, 'reason', b.reason)
          || COALESCE(p_meta, '{}'::jsonb));
  INSERT INTO audit_logs (actor_employee_id, action, module, entity_type, entity_id, description, new_values, source)
  VALUES (NULL, 'AUTOMATIC_BREAK_ENDED', 'ATTENDANCE', 'attendance_breaks', b.id,
          'Automatic break ended (' || p_ended_reason || '). Duration: ' || v_mins || ' min.',
          jsonb_build_object('ended_at', v_end, 'duration_minutes', v_mins, 'ended_reason', p_ended_reason), 'SYSTEM');
  v_msg := CASE p_ended_reason
    WHEN 'TRACKING_RESTORED' THEN 'Location tracking is working again. Your working timer has resumed.'
    WHEN 'GEOFENCE_RETURN' THEN 'You have returned to the office. Your working timer has resumed.'
    WHEN 'CLOCK_OUT' THEN 'Your automatic break was closed when you clocked out.'
    WHEN 'SHIFT_END' THEN 'Your automatic break was closed at the end of your shift.'
    ELSE 'Your automatic break has ended.' END || ' Break duration: ' || v_mins || ' min.';
  PERFORM ab_notify(b.employee_id, 'Automatic Break Ended', v_msg, b.id, 'break:' || b.id || ':END', jsonb_build_object('ended_reason', p_ended_reason));
  UPDATE employee_tracking_state SET open_auto_break_id = NULL, updated_at = now() WHERE employee_id = b.employee_id AND open_auto_break_id = b.id;
  SELECT * INTO t FROM ab_break_totals(b.attendance_id);
  RETURN jsonb_build_object('action', 'ENDED', 'break_id', b.id, 'break_type', b.break_type, 'ended_at', v_end, 'duration_minutes', v_mins,
                            'actual', t.actual, 'allowed', t.allowed, 'overrun', t.overrun);
END $$;

-- Upsert the tracking state row (internal)
CREATE OR REPLACE FUNCTION public.ab_set_state(p_employee uuid, p_attendance uuid, p_state text, p_work_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO employee_tracking_state AS s (employee_id, attendance_id, state, state_since, work_mode, last_contact_at, updated_at)
  VALUES (p_employee, p_attendance, p_state, now(), p_work_mode, now(), now())
  ON CONFLICT (employee_id) DO UPDATE SET
    attendance_id = EXCLUDED.attendance_id,
    state_since = CASE WHEN s.state = EXCLUDED.state AND s.attendance_id IS NOT DISTINCT FROM EXCLUDED.attendance_id THEN s.state_since ELSE now() END,
    state = EXCLUDED.state,
    work_mode = EXCLUDED.work_mode,
    last_contact_at = now(),
    updated_at = now();
END $$;

-- ---------------------------------------------------------------------------------------------
-- 6. API: events observed by the employee's device
-- ---------------------------------------------------------------------------------------------
-- p_event: LOCATION_DENIED | LOCATION_UNAVAILABLE | TIMEOUT | UNKNOWN_ERROR | NETWORK_RECONNECTED
-- Only the event is taken from the device; time, attendance, work mode and policy are decided here.
CREATE OR REPLACE FUNCTION public.report_tracking_event(p_event text, p_message text DEFAULT NULL, p_offline_seconds integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp uuid := get_auth_employee_id();
  v_att uuid; v_date date; v_wfh boolean; v_policy jsonb := ab_policy(); v_state text; v_reason text; v_applies boolean;
  v_shift_end timestamptz; v_open record;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Not signed in as an employee' USING ERRCODE = '42501'; END IF;
  IF p_event NOT IN ('LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'TIMEOUT', 'UNKNOWN_ERROR', 'NETWORK_RECONNECTED') THEN
    RAISE EXCEPTION 'Unknown tracking event %', p_event USING ERRCODE = '22023';
  END IF;

  v_att := ab_open_attendance(v_emp, true);
  IF v_att IS NULL THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'NOT_CLOCKED_IN');  -- no off-duty tracking state
  END IF;
  SELECT attendance_date INTO v_date FROM attendance WHERE id = v_att;
  v_wfh := ab_is_wfh(v_emp, v_date);

  v_state := CASE p_event WHEN 'LOCATION_DENIED' THEN 'PERMISSION_DENIED' WHEN 'LOCATION_UNAVAILABLE' THEN 'GPS_UNAVAILABLE'
                          WHEN 'TIMEOUT' THEN 'GPS_TIMEOUT' WHEN 'UNKNOWN_ERROR' THEN 'LOCATION_ERROR' ELSE 'WAITING_FOR_FIX' END;
  PERFORM ab_set_state(v_emp, v_att, v_state, CASE WHEN v_wfh THEN 'WFH' ELSE 'OFFICE' END);
  UPDATE employee_tracking_state SET
    last_problem = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN last_problem ELSE v_state END,
    last_problem_at = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN last_problem_at ELSE now() END,
    last_problem_message = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN last_problem_message ELSE left(p_message, 500) END,
    last_reconnect_at = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN now() ELSE last_reconnect_at END,
    reported_offline_seconds = CASE WHEN p_event = 'NETWORK_RECONNECTED' THEN GREATEST(0, LEAST(p_offline_seconds, 86400)) ELSE reported_offline_seconds END
  WHERE employee_id = v_emp;

  SELECT id, break_type, reason INTO v_open FROM attendance_breaks WHERE attendance_id = v_att AND ended_at IS NULL AND break_type <> 'CANCELLED' LIMIT 1;

  IF p_event = 'NETWORK_RECONNECTED' THEN
    -- the device says it was offline: a stale-location break gets the more specific reason (time unchanged)
    IF v_open.id IS NOT NULL AND v_open.break_type = 'AUTO_TRACKING' AND v_open.reason = 'TRACKING_STALE' AND COALESCE(p_offline_seconds, 0) > 0 THEN
      UPDATE attendance_breaks SET reason = 'NETWORK_DISCONNECTED' WHERE id = v_open.id;
    END IF;
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'WAITING_FOR_FRESH_LOCATION', 'state', v_state);
  END IF;

  IF p_event IN ('TIMEOUT', 'UNKNOWN_ERROR') THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'NOT_PROOF_OF_TRACKING_LOSS', 'state', v_state);
  END IF;

  v_reason := CASE p_event WHEN 'LOCATION_DENIED' THEN 'LOCATION_PERMISSION_DENIED' ELSE 'GPS_UNAVAILABLE' END;
  v_applies := (v_policy->>'enabled')::boolean
    AND CASE p_event WHEN 'LOCATION_DENIED' THEN (v_policy->>'onPermissionDenied')::boolean ELSE (v_policy->>'onGpsUnavailable')::boolean END
    AND (NOT v_wfh OR (v_policy->>'wfhGpsLoss')::boolean);
  IF NOT v_applies THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', CASE WHEN v_wfh THEN 'WFH_EXEMPT' ELSE 'POLICY_DISABLED' END, 'state', v_state);
  END IF;
  IF v_open.id IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'BREAK_ALREADY_ACTIVE', 'break_id', v_open.id, 'state', v_state);
  END IF;
  v_shift_end := ab_shift_end(v_att);
  IF v_shift_end IS NOT NULL AND now() >= v_shift_end THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'AFTER_SHIFT_END', 'state', v_state);
  END IF;
  IF (v_policy->>'graceMinutes')::int > 0 THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'GRACE_PERIOD', 'state', v_state);  -- process_stale_tracking starts it later
  END IF;
  RETURN ab_start_auto_break(v_att, 'AUTO_TRACKING', v_reason, now(), jsonb_build_object('device_message', left(p_message, 300)))
         || jsonb_build_object('state', v_state);
END $$;

-- ---------------------------------------------------------------------------------------------
-- 7. API: geofence exit / return (AUTO_GPS), formerly written directly by the browser
-- ---------------------------------------------------------------------------------------------
-- The inside/outside decision is still made on the device (debounced) and stored in
-- employee_live_locations; the break itself is created / closed here with database time.
CREATE OR REPLACE FUNCTION public.geofence_auto_break(p_transition text, p_tracking_gap_last_seen timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp uuid := get_auth_employee_id(); v_att uuid; v_date date; v_live text; v_open record; v_shift_end timestamptz; v_res jsonb;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Not signed in as an employee' USING ERRCODE = '42501'; END IF;
  IF p_transition NOT IN ('START', 'END') THEN RAISE EXCEPTION 'Unknown transition %', p_transition USING ERRCODE = '22023'; END IF;

  v_att := ab_open_attendance(v_emp, true);
  IF v_att IS NULL THEN
    IF EXISTS (SELECT 1 FROM attendance WHERE employee_id = v_emp AND clock_in_at IS NOT NULL AND clock_out_at IS NULL) THEN
      RETURN jsonb_build_object('action', 'NONE', 'reason', 'STALE_OPEN_ATTENDANCE');
    END IF;
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'NOT_CLOCKED_IN');
  END IF;
  SELECT attendance_date INTO v_date FROM attendance WHERE id = v_att;
  SELECT location_status INTO v_live FROM employee_live_locations WHERE employee_id = v_emp;
  SELECT id, break_type INTO v_open FROM attendance_breaks WHERE attendance_id = v_att AND ended_at IS NULL AND break_type <> 'CANCELLED' LIMIT 1;

  IF p_transition = 'START' THEN
    IF v_open.id IS NOT NULL THEN RETURN jsonb_build_object('action', 'NONE', 'reason', 'BREAK_ALREADY_ACTIVE', 'break_id', v_open.id); END IF;
    IF ab_is_wfh(v_emp, v_date) THEN RETURN jsonb_build_object('action', 'NONE', 'reason', 'WFH'); END IF;
    IF v_live IS DISTINCT FROM 'OUTSIDE_GEOFENCE' THEN RETURN jsonb_build_object('action', 'NONE', 'reason', 'NOT_OUTSIDE'); END IF;
    v_shift_end := ab_shift_end(v_att);
    IF v_shift_end IS NOT NULL AND now() >= v_shift_end THEN RETURN jsonb_build_object('action', 'NONE', 'reason', 'AFTER_SHIFT_END'); END IF;
    RETURN ab_start_auto_break(v_att, 'AUTO_GPS', 'GEOFENCE_EXIT', now());
  END IF;

  -- END: only an open AUTO_GPS break is closed by returning inside
  IF v_open.id IS NULL OR v_open.break_type <> 'AUTO_GPS' THEN
    RETURN jsonb_build_object('action', 'NONE', 'reason', 'NO_ACTIVE_AUTO_BREAK');
  END IF;
  IF v_live IS DISTINCT FROM 'INSIDE_GEOFENCE' THEN RETURN jsonb_build_object('action', 'NONE', 'reason', 'NOT_INSIDE'); END IF;
  v_res := ab_end_auto_break(v_open.id, now(), 'GEOFENCE_RETURN',
             CASE WHEN p_tracking_gap_last_seen IS NOT NULL
                  THEN jsonb_build_object('tracking_gap', true, 'last_seen_before_return', p_tracking_gap_last_seen) ELSE '{}'::jsonb END);
  RETURN v_res || CASE WHEN p_tracking_gap_last_seen IS NOT NULL THEN jsonb_build_object('tracking_gap', true) ELSE '{}'::jsonb END;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 8. API: clock-out closes an open SYSTEM break at database time (manual breaks: employee ends them)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_auto_break_for_clock_out(p_attendance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := get_auth_employee_id(); a record; v_open record;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Not signed in as an employee' USING ERRCODE = '42501'; END IF;
  SELECT id, employee_id, clock_in_at, clock_out_at INTO a FROM attendance WHERE id = p_attendance_id FOR UPDATE;
  IF NOT FOUND OR a.employee_id <> v_emp THEN RAISE EXCEPTION 'Attendance not found' USING ERRCODE = '42501'; END IF;
  IF a.clock_out_at IS NOT NULL THEN RETURN jsonb_build_object('action', 'NONE', 'reason', 'ALREADY_CLOCKED_OUT'); END IF;
  SELECT id, source, break_type INTO v_open FROM attendance_breaks WHERE attendance_id = p_attendance_id AND ended_at IS NULL AND break_type <> 'CANCELLED' LIMIT 1;
  IF v_open.id IS NULL THEN RETURN jsonb_build_object('action', 'NONE', 'reason', 'NO_OPEN_BREAK'); END IF;
  IF v_open.source = 'EMPLOYEE' THEN RETURN jsonb_build_object('action', 'NONE', 'reason', 'MANUAL_BREAK_ACTIVE', 'break_id', v_open.id); END IF;
  RETURN ab_end_auto_break(v_open.id, now(), 'CLOCK_OUT');
END $$;

-- ---------------------------------------------------------------------------------------------
-- 9. Fresh location received → tracking restored (automatic resume)
-- ---------------------------------------------------------------------------------------------
-- A location is FRESH when the device measured it at most freshFixMinutes before it reached the server
-- (and not in the future). A reading replayed from the offline queue is not fresh, so a reconnect alone
-- never ends a break and never overwrites newer tracking state.
CREATE OR REPLACE FUNCTION public.ab_on_live_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy jsonb; v_att uuid; v_date date; v_wfh boolean; s record; v_open record; v_prev text; v_new text; v_shift_end timestamptz;
BEGIN
  IF NEW.location_status NOT IN ('INSIDE_GEOFENCE', 'OUTSIDE_GEOFENCE', 'WFH') THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.last_seen_at IS NOT DISTINCT FROM OLD.last_seen_at AND NEW.location_status IS NOT DISTINCT FROM OLD.location_status THEN
    RETURN NULL;
  END IF;
  v_policy := ab_policy();
  IF NEW.last_seen_at IS NULL OR NEW.last_seen_at < now() - make_interval(mins => (v_policy->>'freshFixMinutes')::int)
     OR NEW.last_seen_at > now() + interval '2 minutes' THEN
    RETURN NULL;   -- not a fresh location
  END IF;
  v_att := ab_open_attendance(NEW.employee_id, true);
  IF v_att IS NULL THEN RETURN NULL; END IF;   -- not clocked in: no tracking state
  SELECT attendance_date INTO v_date FROM attendance WHERE id = v_att;
  v_wfh := ab_is_wfh(NEW.employee_id, v_date);

  SELECT * INTO s FROM employee_tracking_state WHERE employee_id = NEW.employee_id;
  v_prev := CASE WHEN s.attendance_id IS DISTINCT FROM v_att THEN NULL ELSE s.state END;
  v_new := CASE WHEN v_prev IS NULL OR v_prev = 'TRACKING_OK' THEN 'TRACKING_OK'
                WHEN v_prev = 'TRACKING_RESTORED' AND s.state_since > now() - interval '10 minutes' THEN 'TRACKING_RESTORED'
                WHEN v_prev = 'TRACKING_RESTORED' THEN 'TRACKING_OK'
                ELSE 'TRACKING_RESTORED' END;
  -- cheap path: nothing changed except time (throttle state writes to every 30 s)
  IF s.employee_id IS NOT NULL AND v_prev = v_new AND s.open_auto_break_id IS NULL AND s.last_fresh_fix_at > now() - interval '30 seconds' THEN
    RETURN NULL;
  END IF;
  PERFORM ab_set_state(NEW.employee_id, v_att, v_new, CASE WHEN v_wfh THEN 'WFH' ELSE 'OFFICE' END);
  UPDATE employee_tracking_state SET last_fresh_fix_at = now() WHERE employee_id = NEW.employee_id;

  SELECT id, break_type INTO v_open FROM attendance_breaks WHERE attendance_id = v_att AND ended_at IS NULL AND break_type <> 'CANCELLED' LIMIT 1;
  IF v_open.id IS NOT NULL AND v_open.break_type = 'AUTO_TRACKING' AND (v_policy->>'autoResume')::boolean THEN
    BEGIN
      PERFORM ab_end_auto_break(v_open.id, now(), 'TRACKING_RESTORED', jsonb_build_object('location_status', NEW.location_status));
      -- tracking is back but the (confirmed) location is outside the office: it is still a geofence break
      v_shift_end := ab_shift_end(v_att);
      IF NOT v_wfh AND NEW.location_status = 'OUTSIDE_GEOFENCE' AND (v_shift_end IS NULL OR now() < v_shift_end) THEN
        PERFORM ab_start_auto_break(v_att, 'AUTO_GPS', 'GEOFENCE_EXIT', now(), jsonb_build_object('after_tracking_restored', true));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- never lose the location itself; the break stays open and the next fresh location retries
      RAISE WARNING 'automatic resume not applied for employee %: %', NEW.employee_id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_ab_on_live_location ON public.employee_live_locations;
CREATE TRIGGER trg_ab_on_live_location
  AFTER INSERT OR UPDATE ON public.employee_live_locations
  FOR EACH ROW EXECUTE FUNCTION public.ab_on_live_location();

-- ---------------------------------------------------------------------------------------------
-- 10. Scheduled evaluation: stale locations, grace periods, shift end (idempotent, safe to retry)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_stale_tracking()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_policy jsonb := ab_policy(); v_stale int; v_grace int; v_today date := ab_company_date(now());
  r record; s record; v_open record; v_shift_end timestamptz; v_wfh boolean; v_since timestamptz; v_res jsonb;
  v_started int := 0; v_closed int := 0; v_checked int := 0; v_gps_policy boolean;
BEGIN
  -- API callers must be ADMIN/HR (fallback when pg_cron is not available); cron / service role have no auth.uid()
  IF auth.uid() IS NOT NULL AND COALESCE(get_auth_role(), '') NOT IN ('ADMIN', 'HR') THEN
    RAISE EXCEPTION 'Only administrators can run tracking evaluation' USING ERRCODE = '42501';
  END IF;
  v_stale := (v_policy->>'staleMinutes')::int;
  v_grace := (v_policy->>'graceMinutes')::int;

  FOR r IN
    SELECT a.id, a.employee_id, a.attendance_date, a.clock_in_at
    FROM attendance a LEFT JOIN shift_templates st ON st.id = a.shift_template_id
    WHERE a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
      AND (a.attendance_date = v_today OR (a.attendance_date = v_today - 1 AND COALESCE(st.crosses_midnight, false)))
    FOR UPDATE OF a SKIP LOCKED   -- another run (or a device request) is handling this attendance
  LOOP
    v_checked := v_checked + 1;
    SELECT id, break_type, started_at INTO v_open FROM attendance_breaks WHERE attendance_id = r.id AND ended_at IS NULL AND break_type <> 'CANCELLED' LIMIT 1;
    v_shift_end := ab_shift_end(r.id);

    -- Shift end: close an open tracking break at the shift end; no new automatic breaks afterwards
    IF v_shift_end IS NOT NULL AND now() >= v_shift_end THEN
      IF v_open.id IS NOT NULL AND v_open.break_type = 'AUTO_TRACKING' THEN
        PERFORM ab_end_auto_break(v_open.id, GREATEST(v_shift_end, v_open.started_at), 'SHIFT_END');
        v_closed := v_closed + 1;
      END IF;
      CONTINUE;
    END IF;
    IF NOT (v_policy->>'enabled')::boolean OR v_open.id IS NOT NULL THEN CONTINUE; END IF;

    v_wfh := ab_is_wfh(r.employee_id, r.attendance_date);
    SELECT * INTO s FROM employee_tracking_state WHERE employee_id = r.employee_id AND attendance_id = r.id;

    -- (a) a GPS problem reported by the device that has outlasted a configured grace period
    IF v_grace > 0 AND s.employee_id IS NOT NULL AND s.state IN ('PERMISSION_DENIED', 'GPS_UNAVAILABLE')
       AND (NOT v_wfh OR (v_policy->>'wfhGpsLoss')::boolean)
       AND (CASE s.state WHEN 'PERMISSION_DENIED' THEN (v_policy->>'onPermissionDenied')::boolean ELSE (v_policy->>'onGpsUnavailable')::boolean END)
       AND now() >= s.state_since + make_interval(mins => v_grace) THEN
      v_res := ab_start_auto_break(r.id, 'AUTO_TRACKING',
                 CASE s.state WHEN 'PERMISSION_DENIED' THEN 'LOCATION_PERMISSION_DENIED' ELSE 'GPS_UNAVAILABLE' END,
                 s.state_since + make_interval(mins => v_grace));
      IF v_res->>'action' = 'STARTED' THEN v_started := v_started + 1; END IF;
      CONTINUE;
    END IF;

    -- (b) no fresh location reached the server for the stale interval
    IF NOT (v_policy->>'onStale')::boolean OR (v_wfh AND NOT (v_policy->>'wfhStale')::boolean) THEN CONTINUE; END IF;
    v_since := GREATEST(COALESCE(s.last_fresh_fix_at, r.clock_in_at), r.clock_in_at);
    IF now() < v_since + make_interval(mins => v_stale + v_grace) THEN CONTINUE; END IF;
    -- The device is still in contact and is reporting a GPS problem whose policy says "no break"
    -- (WFH GPS loss, or that rule switched off): GPS loss is not turned into a stale break.
    IF s.employee_id IS NOT NULL AND s.state IN ('PERMISSION_DENIED', 'GPS_UNAVAILABLE')
       AND s.last_contact_at > now() - make_interval(mins => v_stale) THEN
      v_gps_policy := CASE s.state WHEN 'PERMISSION_DENIED' THEN (v_policy->>'onPermissionDenied')::boolean ELSE (v_policy->>'onGpsUnavailable')::boolean END
                      AND (NOT v_wfh OR (v_policy->>'wfhGpsLoss')::boolean);
      IF NOT v_gps_policy THEN CONTINUE; END IF;
    END IF;
    PERFORM ab_set_state(r.employee_id, r.id, 'STALE', CASE WHEN v_wfh THEN 'WFH' ELSE 'OFFICE' END);
    -- last_contact_at was not a device contact: restore it
    UPDATE employee_tracking_state SET last_contact_at = s.last_contact_at WHERE employee_id = r.employee_id;
    v_res := ab_start_auto_break(r.id, 'AUTO_TRACKING', 'TRACKING_STALE', v_since + make_interval(mins => v_grace),
                                 jsonb_build_object('last_fresh_location_at', s.last_fresh_fix_at, 'stale_minutes', v_stale));
    IF v_res->>'action' = 'STARTED' THEN v_started := v_started + 1; END IF;
  END LOOP;

  RETURN jsonb_build_object('checked', v_checked, 'started', v_started, 'closed_at_shift_end', v_closed, 'ran_at', now());
END $$;

-- ---------------------------------------------------------------------------------------------
-- 11. Permissions: API functions for signed-in users only; helpers not callable through the API
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.report_tracking_event(text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.geofence_auto_break(text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_auto_break_for_clock_out(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_stale_tracking() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_tracking_event(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.geofence_auto_break(text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_auto_break_for_clock_out(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_stale_tracking() TO authenticated, service_role;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.ab_policy()', 'public.ab_open_attendance(uuid, boolean)', 'public.ab_shift_end(uuid)', 'public.ab_is_wfh(uuid, date)',
    'public.ab_recalc_attendance(uuid)', 'public.ab_after_break_change()',
    'public.ab_notify(uuid, text, text, uuid, text, jsonb)', 'public.ab_start_auto_break(uuid, text, text, timestamptz, jsonb)',
    'public.ab_end_auto_break(uuid, timestamptz, text, jsonb)', 'public.ab_set_state(uuid, uuid, text, text)',
    'public.ab_on_live_location()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
-- needed by the employee guard trigger (runs with the caller's rights); it checks ownership itself
REVOKE ALL ON FUNCTION public.ab_break_totals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ab_break_totals(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 12. Realtime (Admin Break Management / employee screens) and schedule
-- ---------------------------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance_breaks') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_breaks;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'employee_tracking_state') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_tracking_state;
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-break-stale-tracking') THEN
      PERFORM cron.unschedule('auto-break-stale-tracking');
    END IF;
    PERFORM cron.schedule('auto-break-stale-tracking', '* * * * *', 'SELECT public.process_stale_tracking()');
  ELSE
    RAISE NOTICE 'pg_cron is not installed: schedule SELECT public.process_stale_tracking() every minute another way (see docs/AUTOMATIC_BREAKS.md).';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attendance_open_by_date ON public.attendance (attendance_date) WHERE clock_out_at IS NULL AND clock_in_at IS NOT NULL;

COMMIT;
