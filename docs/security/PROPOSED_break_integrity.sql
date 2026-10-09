-- =====================================================================================
-- PROPOSED — NOT APPLIED. Do NOT run without approval.
-- WorkPulse HR Step 5: Automatic Break — database protection
-- Schema: supabase/migrations/0003_attendance_break_schema.sql (attendance_breaks)
-- =====================================================================================

-- STEP 0 (read-only) — must return 0 rows before STEP 1, otherwise the index cannot be
-- created. Any rows returned are real duplicate open breaks that an admin must close first.
SELECT employee_id, COUNT(*) AS open_breaks, array_agg(id ORDER BY started_at) AS break_ids
FROM attendance_breaks
WHERE ended_at IS NULL
GROUP BY employee_id
HAVING COUNT(*) > 1;

BEGIN;

-- STEP 1 — B1: one employee can never have more than one active break.
-- A second simultaneous INSERT fails with 23505; the app already treats that as
-- "break already active" and keeps using the existing one (breakService.isUniqueViolation).
-- Non-destructive: adds an index only.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_one_active_break_per_employee
  ON attendance_breaks (employee_id)
  WHERE ended_at IS NULL;

-- STEP 2 — B2 (security): employees writing their own break rows.
-- 0009 policies check only attendance_id (own attendance). Today an employee can, via the
-- REST API:
--   * INSERT a break with employee_id of ANOTHER employee (attendance_id still their own);
--   * UPDATE started_at / ended_at / duration_minutes of their own breaks (shorten a break),
--     or change break_type (turn a manual break into AUTO_GPS) or move it to another
--     attendance of their own.
-- They CANNOT read or write breaks on another employee's attendance (verified).
CREATE OR REPLACE FUNCTION public.attendance_breaks_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_auth_role() IN ('ADMIN', 'HR') THEN
    RETURN NEW;  -- server jobs (auto clock-out) and admin corrections
  END IF;

  -- employee_id must match the attendance owner and the caller
  IF NEW.employee_id IS DISTINCT FROM public.get_auth_employee_id()
     OR NOT EXISTS (SELECT 1 FROM attendance a WHERE a.id = NEW.attendance_id AND a.employee_id = NEW.employee_id) THEN
    RAISE EXCEPTION 'Invalid break owner.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.ended_at := NULL;
    NEW.duration_minutes := NULL;
    -- started_at: manual breaks start now; AUTO_GPS breaks may start at the confirmed
    -- transition time (up to a few minutes earlier) but never in the future or before clock-in
    IF NEW.started_at > now() + interval '1 minute' OR NEW.started_at < now() - interval '15 minutes' THEN
      NEW.started_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only closing an open break is allowed
  IF NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.break_type IS DISTINCT FROM OLD.break_type
     OR NEW.attendance_id IS DISTINCT FROM OLD.attendance_id
     OR OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Breaks can only be corrected by an administrator.' USING ERRCODE = '42501';
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    -- end no later than now; duration always derived from the stored timestamps
    IF NEW.ended_at > now() + interval '1 minute' THEN NEW.ended_at := now(); END IF;
    NEW.duration_minutes := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NEW.ended_at - OLD.started_at)) / 60))::int;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attendance_breaks_guard ON attendance_breaks;
CREATE TRIGGER attendance_breaks_guard BEFORE INSERT OR UPDATE ON attendance_breaks
FOR EACH ROW EXECUTE FUNCTION public.attendance_breaks_guard();

-- No DELETE policy exists for employees (verified) → they cannot delete breaks.

COMMIT;

-- ROLLBACK if needed:
--   DROP TRIGGER IF EXISTS attendance_breaks_guard ON attendance_breaks;
--   DROP INDEX IF EXISTS uniq_one_active_break_per_employee;
