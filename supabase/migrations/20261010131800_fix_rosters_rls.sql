-- Allow ADMIN and HR to manage (INSERT/UPDATE/DELETE) rosters
CREATE POLICY "Manage rosters" ON rosters
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR'))
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

-- Allow ADMIN and HR to manage (INSERT/UPDATE/DELETE) roster_assignments
CREATE POLICY "Manage roster_assignments" ON roster_assignments
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR'))
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));
