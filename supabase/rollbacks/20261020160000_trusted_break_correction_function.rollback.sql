-- 20261020160000_trusted_break_correction_function.rollback.sql
-- Rollback for 20261020160000_trusted_break_correction_function.sql

BEGIN;

DROP FUNCTION IF EXISTS public.correct_tracking_enforcement_break(UUID, UUID, TEXT);

-- Restore previous UPDATE policy on attendance_breaks
DROP POLICY IF EXISTS "Update own attendance_breaks" ON attendance_breaks;
CREATE POLICY "Update own attendance_breaks" ON attendance_breaks FOR UPDATE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR attendance_id IN (SELECT id FROM attendance WHERE employee_id = public.get_auth_employee_id()));

COMMIT;
