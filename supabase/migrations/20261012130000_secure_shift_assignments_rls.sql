-- 20261012130000_secure_shift_assignments_rls.sql
-- Security hardening for shift_assignments table.
-- Ensures employees can ONLY SELECT their own permanent shift assignments.
-- Admins and HR retain full read and write capabilities.

ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users to read shift_assignments" ON shift_assignments;
DROP POLICY IF EXISTS "View shift_assignments" ON shift_assignments;

CREATE POLICY "View shift_assignments" ON shift_assignments
  FOR SELECT TO authenticated
  USING (
    public.get_auth_role() IN ('ADMIN', 'HR')
    OR auth.jwt()->>'email' = 'admin@gmail.com'
    OR employee_id = public.get_auth_employee_id()
  );

NOTIFY pgrst, 'reload schema';
