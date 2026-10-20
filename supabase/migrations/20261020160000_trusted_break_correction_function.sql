-- 20261020160000_trusted_break_correction_function.sql
-- WorkPulse HR — Trusted Break Correction Authorization & RLS Hardening
--
-- PURPOSE:
-- 1. Provides a trusted SECURITY DEFINER function `correct_tracking_enforcement_break`
--    that enforces ADMIN/HR authorization, non-empty correction reasons, scope validation,
--    and break-type guards at the database level.
-- 2. Restricts the generic UPDATE policy on `attendance_breaks` so employees cannot
--    directly set break_type = 'CANCELLED' or manipulate AUTO_TRACKING breaks.
--
-- Rollback: supabase/rollbacks/20261020160000_trusted_break_correction_function.rollback.sql

BEGIN;

-- 1. Trusted database function for break correction
CREATE OR REPLACE FUNCTION public.correct_tracking_enforcement_break(
  p_break_id UUID,
  p_attendance_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_break RECORD;
  v_trimmed_reason TEXT;
BEGIN
  -- 1. Check authenticated role
  v_role := public.get_auth_role();
  IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'HR') THEN
    RAISE EXCEPTION 'Access denied: Admin or HR authorization required' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate non-empty reason
  v_trimmed_reason := trim(p_reason);
  IF v_trimmed_reason IS NULL OR length(v_trimmed_reason) = 0 THEN
    RAISE EXCEPTION 'A non-empty correction reason is required' USING ERRCODE = '22023';
  END IF;

  -- 3. Verify break existence, scope (attendance_id match), and break_type
  SELECT * INTO v_break
  FROM public.attendance_breaks
  WHERE id = p_break_id AND attendance_id = p_attendance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Break record not found for the specified attendance' USING ERRCODE = 'P0002';
  END IF;

  IF v_break.break_type NOT IN ('AUTO_TRACKING', 'AUTO_GPS') THEN
    RAISE EXCEPTION 'Only automatic tracking breaks can be corrected (found %)', v_break.break_type USING ERRCODE = '22023';
  END IF;

  -- 4. Perform correction: cancel break, set duration 0, end at started_at
  UPDATE public.attendance_breaks
  SET break_type = 'CANCELLED',
      duration_minutes = 0,
      ended_at = v_break.started_at,
      updated_at = now()
  WHERE id = p_break_id;

  -- 5. Audit log and attendance event
  INSERT INTO public.attendance_events (
    attendance_id,
    employee_id,
    event_type,
    event_at,
    source,
    metadata
  ) VALUES (
    p_attendance_id,
    v_break.employee_id,
    'BREAK_CORRECTION',
    now(),
    'ADMIN',
    jsonb_build_object(
      'break_id', p_break_id,
      'correction_reason', v_trimmed_reason,
      'original_break_type', v_break.break_type,
      'corrected_by_role', v_role
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'break_id', p_break_id,
    'attendance_id', p_attendance_id,
    'employee_id', v_break.employee_id,
    'previous_break_type', v_break.break_type
  );
END;
$$;

-- Revoke execute from public and grant to authenticated role
REVOKE ALL ON FUNCTION public.correct_tracking_enforcement_break(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_tracking_enforcement_break(UUID, UUID, TEXT) TO authenticated;

-- 2. Tighten UPDATE policy on attendance_breaks
-- Prevent employees from directly updating a break to 'CANCELLED' or updating an 'AUTO_TRACKING' break
DROP POLICY IF EXISTS "Update own attendance_breaks" ON attendance_breaks;
CREATE POLICY "Update own attendance_breaks" ON attendance_breaks FOR UPDATE TO authenticated
USING (
  public.get_auth_role() IN ('ADMIN', 'HR') 
  OR attendance_id IN (SELECT id FROM attendance WHERE employee_id = public.get_auth_employee_id())
)
WITH CHECK (
  public.get_auth_role() IN ('ADMIN', 'HR') 
  OR (
    attendance_id IN (SELECT id FROM attendance WHERE employee_id = public.get_auth_employee_id())
    AND break_type NOT IN ('CANCELLED', 'AUTO_TRACKING')
  )
);

COMMIT;
