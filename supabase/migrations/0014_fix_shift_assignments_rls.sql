-- Fix missing INSERT/UPDATE/DELETE RLS policies for shift_assignments.
-- The table had RLS enabled with only a SELECT policy.
-- ADMIN and HR users need to manage shift assignments.

-- Allow ADMIN and HR to manage (INSERT/UPDATE/DELETE) shift_assignments
CREATE POLICY "Manage shift_assignments" ON shift_assignments
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR'))
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

-- Employees should be able to see their own shift assignments
-- (the existing SELECT policy already allows all authenticated users to read)
