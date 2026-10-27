-- =============================================================================================
-- 20261022100000_fix_auto_clock_out.sql
-- Repairs the scheduled automatic clock-out job (QA finding D-ACO, P1) and makes it follow the
-- company missing-clock-out policy (2026-10-14, docs/proposals/PROPOSED_missing_clock_out_workflow.sql).
--
-- Before: process_auto_clock_out() from 0015_auto_clock_out.sql failed on EVERY run with
--   ERROR: column reference "settings" is ambiguous
-- (a PL/pgSQL variable named like the app_settings column), so pg_cron's 'auto-clock-out' job
-- (every 15 minutes) never did anything. Its logic also built shift times without a time zone (B-05),
-- invented a clock-out time, wrote overtime_minutes, left open breaks open, and anon could call it.
--
-- After (policy: no clock-out time is invented; the employee submits a correction, HR verifies it):
--   * An open attendance (clock-in, no clock-out) is FLAGGED status = 'MISSING_CLOCK_OUT' once
--     shift end + grace has passed (shift end in company time, Asia/Kolkata, overnight shifts end the next
--     day). Without a shift: 24 hours after clock-in. Same rule as missingClockOutRules.ts / mco_flag_at().
--   * Settings: app.autoClockOut = false -> the job flags nothing; app.autoClockOutMode = 'at_shift_end'
--     -> no grace; otherwise app.autoClockOutGraceHours (default 4).
--   * Any break still open on that attendance is closed at the shift end (never before it started, never
--     in the future): automatic breaks through ab_end_auto_break (event + notification, ended_reason
--     SHIFT_END), manual breaks directly (ended_reason SHIFT_END). Totals are recalculated by the existing
--     break triggers, so payroll break minutes stay consistent.
--   * clock_out_at is NOT written: the correction (submit/review_missing_clock_out_request, or an admin
--     attendance correction) records the verified time. Nothing is written to overtime.
--   * Idempotent and safe to run concurrently: rows are locked with FOR UPDATE SKIP LOCKED, re-checked,
--     and a flagged row is never processed again (one event, one notification per attendance).
--   * Only the scheduler (postgres) and service_role can run it; anon / authenticated cannot.
--   * An employee cannot clear the flag or clock out on a flagged day (trigger guard_missing_clock_out_row);
--     HR / admin and the correction functions can.
-- mco_settings() and mco_flag_at() are created exactly as in PROPOSED_missing_clock_out_workflow.sql, so
-- applying that proposal later replaces them with identical code.
-- Rollback: supabase/rollbacks/20261022100000_fix_auto_clock_out.rollback.sql
-- =============================================================================================

BEGIN;

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

CREATE OR REPLACE FUNCTION public.process_auto_clock_out()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app jsonb;
  v_grace numeric;
  v_flag timestamptz;
  v_close timestamptz;
  v_now timestamptz := now();
  rec attendance%ROWTYPE;
  b record;
  n integer := 0;
BEGIN
  SELECT COALESCE(s.settings->'app', '{}'::jsonb) INTO v_app
  FROM app_settings s WHERE s.id = '00000000-0000-0000-0000-000000000001';
  v_app := COALESCE(v_app, '{}'::jsonb);
  IF lower(COALESCE(v_app->>'autoClockOut', 'true')) IN ('false', 'f', '0', 'no', 'off') THEN
    RETURN 0;
  END IF;
  v_grace := CASE WHEN v_app->>'autoClockOutMode' = 'at_shift_end' THEN 0
                  ELSE GREATEST(0, COALESCE(NULLIF(v_app->>'autoClockOutGraceHours', '')::numeric, 4)) END;

  FOR rec IN
    SELECT a.* FROM attendance a
    WHERE a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
      AND COALESCE(a.status, '') <> 'MISSING_CLOCK_OUT'
    ORDER BY a.clock_in_at
    FOR UPDATE SKIP LOCKED            -- a concurrent run (or a clock-out in progress) owns the row: skip it
  LOOP
    v_flag := public.mco_flag_at(rec, v_grace);
    CONTINUE WHEN v_flag IS NULL OR v_now < v_flag;

    -- close open breaks at the shift end (no shift: at the flag time), never before the break started
    v_close := LEAST(v_now, CASE WHEN rec.shift_template_id IS NULL THEN v_flag
                                 ELSE v_flag - make_interval(secs => v_grace * 3600) END);
    FOR b IN
      SELECT id, break_type, started_at FROM attendance_breaks
      WHERE attendance_id = rec.id AND ended_at IS NULL AND COALESCE(break_type, '') <> 'CANCELLED'
    LOOP
      IF b.break_type IN ('AUTO_GPS', 'AUTO_TRACKING') THEN
        PERFORM public.ab_end_auto_break(b.id, GREATEST(v_close, b.started_at), 'SHIFT_END',
                                         jsonb_build_object('closed_by', 'process_auto_clock_out'));
      ELSE
        UPDATE attendance_breaks
           SET ended_at = GREATEST(v_close, started_at),
               duration_minutes = GREATEST(0, floor(extract(epoch FROM (GREATEST(v_close, started_at) - started_at)) / 60))::int,
               ended_reason = 'SHIFT_END'
         WHERE id = b.id AND ended_at IS NULL;
      END IF;
    END LOOP;

    UPDATE attendance SET status = 'MISSING_CLOCK_OUT', updated_at = v_now
     WHERE id = rec.id AND clock_out_at IS NULL AND COALESCE(status, '') <> 'MISSING_CLOCK_OUT';
    CONTINUE WHEN NOT FOUND;

    INSERT INTO attendance_events (attendance_id, employee_id, event_type, event_at, source, metadata)
    VALUES (rec.id, rec.employee_id, 'MISSING_CLOCK_OUT', v_now, 'SYSTEM',
            jsonb_build_object('flag_at', v_flag, 'breaks_closed_at', v_close, 'grace_hours', v_grace));
    BEGIN
      INSERT INTO notifications (recipient_employee_id, notification_type, title, message, action_url, is_read, metadata)
      VALUES (rec.employee_id, 'ATTENDANCE', 'Clock-out missing',
              'You did not clock out on ' || to_char(rec.attendance_date, 'DD Mon YYYY')
                || '. Please submit your clock-out time and reason under Overtime.',
              '/employee/overtime', false, jsonb_build_object('dedupe_key', 'mco:' || rec.id));
    EXCEPTION WHEN unique_violation THEN
      NULL;   -- already told about this day (e.g. HR re-opened and the day was flagged again)
    END;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- A flagged day is settled only by the correction workflow or HR: the employee cannot clear the flag,
-- clock out days later, or otherwise edit the row (the browser clock-out would invent a time).
CREATE OR REPLACE FUNCTION public.guard_missing_clock_out_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR COALESCE(public.get_auth_role(), '') IN ('ADMIN', 'HR') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'MISSING_CLOCK_OUT' THEN
    RAISE EXCEPTION 'This day is flagged as a missing clock-out; submit a correction request instead'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'MISSING_CLOCK_OUT' THEN
    RAISE EXCEPTION 'Only the system can flag a missing clock-out' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_missing_clock_out_row() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_missing_clock_out_row ON public.attendance;
CREATE TRIGGER trg_guard_missing_clock_out_row BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.guard_missing_clock_out_row();

REVOKE ALL ON FUNCTION public.mco_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mco_flag_at(attendance, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_auto_clock_out() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_auto_clock_out() TO service_role;

COMMIT;
