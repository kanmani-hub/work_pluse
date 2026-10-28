-- Rollback of 20261028090200_auto_clock_out_and_settings_hardening.sql
-- Restores mco_settings() and process_auto_clock_out() exactly as in 20261022100000_fix_auto_clock_out.sql
-- (flag-only job, no per-row isolation, no run log) and removes the settings validation trigger.
-- WARNING: an invalid saved setting will again stop every auto clock-out run. The run log
-- (auto_clock_out_runs, diagnostics only) is dropped. No attendance, payroll or settings data is changed.
-- If docs/proposals/PROPOSED_missing_clock_out_workflow.sql was applied after the migration, its
-- functions keep working with the restored mco_settings() (same signature).
BEGIN;
DROP TRIGGER IF EXISTS trg_validate_app_settings ON public.app_settings;
DROP FUNCTION IF EXISTS public.validate_app_settings_values();

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

REVOKE ALL ON FUNCTION public.mco_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_auto_clock_out() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_auto_clock_out() TO service_role;

DROP TABLE IF EXISTS public.auto_clock_out_runs;
DROP FUNCTION IF EXISTS public.wp_settings_bool(text);
DROP FUNCTION IF EXISTS public.wp_settings_numeric(text);
COMMIT;
