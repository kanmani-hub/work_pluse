-- =============================================================================================
-- 20261028090200_auto_clock_out_and_settings_hardening.sql
-- Auto clock-out, missing clock-out settings and overtime settings: one set of rules, validated once.
--
-- Before (verified 2026-10-28):
--   * Settings were cast with ::NUMERIC / ::BOOLEAN. One non-numeric value saved through the API (e.g. a
--     grace of "four") made process_auto_clock_out() fail on EVERY 15-minute run, and made every missing
--     clock-out submit / review fail. Nothing validated these values on save (only in the browser input).
--   * mco_settings().grace_hours ignored app.autoClockOutMode: in "at shift end" mode the job flagged a day
--     at shift end, but the correction (submit_missing_clock_out_request) was refused for another 4 h.
--   * A deduction "enabled" with ₹0 recorded nothing while the setting said it was on.
--   * One failing attendance row (e.g. a break that could not be closed) aborted the whole run, so no other
--     day was flagged either, and the failure was only visible in pg_cron's own log.
--
-- After:
--   * wp_settings_numeric / wp_settings_bool: tolerant readers (invalid → NULL → documented default).
--   * mco_settings(): limit 0–24 h (else 3), amount ≥ 0 rounded to paise (else 0), deduction enabled only
--     with an amount > 0, grace = 0 in "at shift end" mode, else autoClockOutGraceHours (invalid → 4,
--     negative → 0). Same rules as missingClockOutRules.ts (normalizeLimitHours, missingClockOutGraceHours).
--   * process_auto_clock_out(): grace from mco_settings() (one rule for the job, the correction and the
--     app); each attendance row is processed in its own sub-transaction — a failure is recorded and the
--     other rows are still flagged; every run is recorded in auto_clock_out_runs (flagged, failed, errors,
--     visible to ADMIN / HR) and a failed row is retried by the next run. Still flag-only: no clock-out
--     time is written, no overtime, an existing clock-out is never touched, FOR UPDATE SKIP LOCKED.
--   * trg_validate_app_settings: refuses invalid missing clock-out, auto clock-out and overtime values on
--     save (any writer), with a message naming the field. Empty / null keeps the documented default.
-- docs/proposals/PROPOSED_missing_clock_out_workflow.sql defines mco_settings() with IDENTICAL code and no
-- longer redefines process_auto_clock_out(), so applying it after this migration changes neither.
-- Rollback: supabase/rollbacks/20261028090200_auto_clock_out_and_settings_hardening.rollback.sql
-- =============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------- tolerant readers
CREATE OR REPLACE FUNCTION public.wp_settings_numeric(p text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE v numeric;
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN NULL; END IF;
  BEGIN
    v := btrim(p)::numeric;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF v::text IN ('NaN', 'Infinity', '-Infinity') THEN RETURN NULL; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.wp_settings_bool(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN lower(btrim(p)) IN ('true', 't', '1', 'yes', 'y', 'on') THEN true
    WHEN lower(btrim(p)) IN ('false', 'f', '0', 'no', 'n', 'off') THEN false
    ELSE NULL END
$$;

-- ---------------------------------------------------------------------------- missing clock-out settings
-- IDENTICAL in docs/proposals/PROPOSED_missing_clock_out_workflow.sql
CREATE OR REPLACE FUNCTION public.mco_settings(OUT limit_hours NUMERIC, OUT deduction_enabled BOOLEAN, OUT deduction_amount NUMERIC, OUT grace_hours NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s JSONB;
BEGIN
  SELECT settings INTO s FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';
  limit_hours := public.wp_settings_numeric(s->'payroll'->>'missingClockOutMaxAdditionalHours');
  IF limit_hours IS NULL OR limit_hours < 0 OR limit_hours > 24 THEN limit_hours := 3; END IF;
  limit_hours := round(limit_hours, 2);
  deduction_amount := public.wp_settings_numeric(s->'payroll'->>'missingClockOutDeductionAmount');
  IF deduction_amount IS NULL OR deduction_amount < 0 THEN deduction_amount := 0; END IF;
  deduction_amount := round(deduction_amount, 2);
  deduction_enabled := COALESCE(public.wp_settings_bool(s->'payroll'->>'enableMissingClockOutDeduction'), false) AND deduction_amount > 0;
  IF lower(COALESCE(s->'app'->>'autoClockOutMode', '')) = 'at_shift_end' THEN
    grace_hours := 0;
  ELSE
    grace_hours := public.wp_settings_numeric(s->'app'->>'autoClockOutGraceHours');
    IF grace_hours IS NULL THEN grace_hours := 4; END IF;
    grace_hours := GREATEST(0, grace_hours);
  END IF;
END $$;

-- ---------------------------------------------------------------------------- run log (diagnostics)
CREATE TABLE IF NOT EXISTS public.auto_clock_out_runs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  grace_hours  NUMERIC,
  flagged      INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  skipped      TEXT,
  errors       JSONB NOT NULL DEFAULT '[]'::jsonb      -- [{attendance_id, sqlstate, error}] — no personal data
);
CREATE INDEX IF NOT EXISTS idx_auto_clock_out_runs_started ON public.auto_clock_out_runs (started_at DESC);
ALTER TABLE public.auto_clock_out_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View auto_clock_out_runs" ON public.auto_clock_out_runs;
CREATE POLICY "View auto_clock_out_runs" ON public.auto_clock_out_runs FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR'));
REVOKE ALL ON public.auto_clock_out_runs FROM anon, authenticated;
GRANT SELECT ON public.auto_clock_out_runs TO authenticated;

-- ---------------------------------------------------------------------------- the job (flag only)
CREATE OR REPLACE FUNCTION public.process_auto_clock_out()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app jsonb;
  cfg record;
  v_grace numeric;
  v_flag timestamptz;
  v_close timestamptz;
  v_now timestamptz := now();
  v_run bigint;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  rec attendance%ROWTYPE;
  b record;
  n integer := 0;
BEGIN
  INSERT INTO auto_clock_out_runs (started_at) VALUES (v_now) RETURNING id INTO v_run;
  DELETE FROM auto_clock_out_runs WHERE started_at < v_now - interval '90 days';

  SELECT COALESCE(s.settings->'app', '{}'::jsonb) INTO v_app
  FROM app_settings s WHERE s.id = '00000000-0000-0000-0000-000000000001';
  v_app := COALESCE(v_app, '{}'::jsonb);
  IF COALESCE(public.wp_settings_bool(v_app->>'autoClockOut'), true) = false THEN
    UPDATE auto_clock_out_runs SET finished_at = clock_timestamp(), skipped = 'Auto clock-out is switched off in Settings' WHERE id = v_run;
    RETURN 0;
  END IF;
  SELECT * INTO cfg FROM public.mco_settings();
  v_grace := cfg.grace_hours;

  FOR rec IN
    SELECT a.* FROM attendance a
    WHERE a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
      AND COALESCE(a.status, '') <> 'MISSING_CLOCK_OUT'
    ORDER BY a.clock_in_at
    FOR UPDATE SKIP LOCKED            -- a concurrent run (or a clock-out in progress) owns the row: skip it
  LOOP
    v_flag := public.mco_flag_at(rec, v_grace);
    CONTINUE WHEN v_flag IS NULL OR v_now < v_flag;

    BEGIN   -- one row = one sub-transaction: a failure here is recorded and does not stop the run
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

      -- clock_out_at is never written: the existing (NULL) value stays, a real clock-out is never touched
      UPDATE attendance SET status = 'MISSING_CLOCK_OUT', updated_at = v_now
       WHERE id = rec.id AND clock_out_at IS NULL AND COALESCE(status, '') <> 'MISSING_CLOCK_OUT';
      IF FOUND THEN
        INSERT INTO attendance_events (attendance_id, employee_id, event_type, event_at, source, metadata)
        VALUES (rec.id, rec.employee_id, 'MISSING_CLOCK_OUT', v_now, 'SYSTEM',
                jsonb_build_object('flag_at', v_flag, 'breaks_closed_at', v_close, 'grace_hours', v_grace, 'run_id', v_run));
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
      END IF;
    EXCEPTION WHEN others THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('attendance_id', rec.id, 'sqlstate', SQLSTATE, 'error', left(SQLERRM, 300)));
    END;
  END LOOP;

  UPDATE auto_clock_out_runs SET finished_at = clock_timestamp(), grace_hours = v_grace, flagged = n, failed = v_failed, errors = v_errors
   WHERE id = v_run;
  IF v_failed > 0 THEN
    RAISE WARNING 'process_auto_clock_out: % attendance row(s) could not be flagged (auto_clock_out_runs id %); they are retried by the next run', v_failed, v_run;
  END IF;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------- settings validation on save
CREATE OR REPLACE FUNCTION public.validate_app_settings_values()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  p jsonb := COALESCE(NEW.settings->'payroll', '{}'::jsonb);
  a jsonb := COALESCE(NEW.settings->'app', '{}'::jsonb);
  errs text[] := '{}';
  v numeric;
  -- a key that is absent, JSON null or '' keeps its documented default
  has_value boolean;
BEGIN
  IF jsonb_typeof(p) <> 'object' OR jsonb_typeof(a) <> 'object' THEN
    RETURN NEW;  -- legacy flat format: read with defaults by the app and the functions above
  END IF;

  has_value := COALESCE(p->>'missingClockOutMaxAdditionalHours', '') <> '';
  v := public.wp_settings_numeric(p->>'missingClockOutMaxAdditionalHours');
  IF has_value AND (v IS NULL OR v < 0 OR v > 24) THEN
    errs := errs || 'Maximum additional working time must be a number of hours from 0 to 24'::text;
  END IF;

  has_value := COALESCE(p->>'missingClockOutDeductionAmount', '') <> '';
  v := public.wp_settings_numeric(p->>'missingClockOutDeductionAmount');
  IF has_value AND (v IS NULL OR v < 0 OR v <> round(v, 2)) THEN
    errs := errs || 'Deduction per case must be an amount of ₹0 or more with at most 2 decimals'::text;
  END IF;

  IF COALESCE(p->>'enableMissingClockOutDeduction', '') <> '' AND public.wp_settings_bool(p->>'enableMissingClockOutDeduction') IS NULL THEN
    errs := errs || 'Deduct for a rejected missing clock-out must be on or off'::text;
  ELSIF public.wp_settings_bool(p->>'enableMissingClockOutDeduction') IS TRUE AND COALESCE(v, 0) <= 0 THEN
    errs := errs || 'Enter a deduction per case above ₹0, or switch the missing clock-out deduction off'::text;
  END IF;

  has_value := COALESCE(a->>'autoClockOutGraceHours', '') <> '';
  v := public.wp_settings_numeric(a->>'autoClockOutGraceHours');
  IF has_value AND (v IS NULL OR v < 0) THEN
    errs := errs || 'Auto clock-out grace must be 0 or more hours'::text;
  END IF;
  IF COALESCE(a->>'autoClockOutMode', '') NOT IN ('', 'after_grace_period', 'at_shift_end') THEN
    errs := errs || 'Auto clock-out mode must be "after_grace_period" or "at_shift_end"'::text;
  END IF;

  IF COALESCE(p->>'enableOvertimePay', '') <> '' AND public.wp_settings_bool(p->>'enableOvertimePay') IS NULL THEN
    errs := errs || 'Enable Overtime Pay must be on or off'::text;
  END IF;
  IF public.wp_settings_bool(p->>'enableOvertimePay') IS TRUE THEN
    IF COALESCE(p->>'overtimeRateType', 'multiplier') = 'multiplier' AND COALESCE(p->>'overtimeMultiplier', '') <> ''
       AND COALESCE(public.wp_settings_numeric(p->>'overtimeMultiplier'), 0) <= 0 THEN
      errs := errs || 'Overtime multiplier must be a number above 0'::text;
    ELSIF p->>'overtimeRateType' = 'fixed' AND COALESCE(p->>'overtimeFixedRate', '') <> ''
       AND COALESCE(public.wp_settings_numeric(p->>'overtimeFixedRate'), -1) < 0 THEN
      errs := errs || 'Overtime rate per hour must be ₹0 or more'::text;
    END IF;
  END IF;

  IF cardinality(errs) > 0 THEN
    RAISE EXCEPTION 'Settings not saved: %', array_to_string(errs, '; ') USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_app_settings ON public.app_settings;
CREATE TRIGGER trg_validate_app_settings BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_app_settings_values();

REVOKE ALL ON FUNCTION public.validate_app_settings_values() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mco_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_auto_clock_out() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_auto_clock_out() TO service_role;

COMMIT;
