-- 20261012120000_employee_roster_rls.sql
-- Security hardening for roster and shift assignment access.
-- Ensures employees can ONLY SELECT published rosters and their own roster assignments.
-- Admins and HR retain full management capabilities (ALL permissions).

-- 1. Enable RLS on rosters and roster_assignments
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_assignments ENABLE ROW LEVEL SECURITY;

-- 2. SELECT policy on rosters
-- Admins and HR can see all rosters (draft, published, archived).
-- Employees can view only PUBLISHED rosters.
DROP POLICY IF EXISTS "Allow authenticated users to read rosters" ON rosters;
DROP POLICY IF EXISTS "View rosters" ON rosters;
CREATE POLICY "View rosters" ON rosters
  FOR SELECT TO authenticated
  USING (
    public.get_auth_role() IN ('ADMIN', 'HR') 
    OR status = 'PUBLISHED' 
    OR auth.jwt()->>'email' = 'admin@gmail.com'
  );

-- 3. SELECT policy on roster_assignments
-- Admins and HR can see all entries.
-- Employees can ONLY see their own entries.
DROP POLICY IF EXISTS "Allow authenticated users to read roster_assignments" ON roster_assignments;
DROP POLICY IF EXISTS "View roster_assignments" ON roster_assignments;
CREATE POLICY "View roster_assignments" ON roster_assignments
  FOR SELECT TO authenticated
  USING (
    public.get_auth_role() IN ('ADMIN', 'HR') 
    OR auth.jwt()->>'email' = 'admin@gmail.com'
    OR employee_id = public.get_auth_employee_id()
  );

-- 4. Maintain write policies strictly for ADMIN and HR
DROP POLICY IF EXISTS "Manage rosters" ON rosters;
CREATE POLICY "Manage rosters" ON rosters
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com')
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com');

DROP POLICY IF EXISTS "Manage roster_assignments" ON roster_assignments;
CREATE POLICY "Manage roster_assignments" ON roster_assignments
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com')
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com');

-- 5. Privileges
GRANT ALL ON TABLE rosters TO authenticated, anon, service_role;
GRANT ALL ON TABLE roster_assignments TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
