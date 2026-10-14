-- Rollback for 20261014090000_admin_security_hardening.sql
-- Restores the exact definitions in force before that migration (including the insecure
-- admin@gmail.com fallback). Use only to recover from a problem, then fix forward.
-- Kept outside supabase/migrations so the Supabase CLI never applies it automatically.

BEGIN;

DROP TRIGGER IF EXISTS guard_employee_changes ON employees;
DROP TRIGGER IF EXISTS guard_profile_changes ON profiles;
DROP FUNCTION IF EXISTS public.guard_employee_changes();
DROP FUNCTION IF EXISTS public.guard_profile_changes();

DROP POLICY IF EXISTS "Admins insert profiles" ON profiles;
DROP POLICY IF EXISTS "Admins update profiles" ON profiles;
DROP POLICY IF EXISTS "Admins delete profiles" ON profiles;
DROP POLICY IF EXISTS "Manage profiles" ON profiles;
CREATE POLICY "Manage profiles" ON profiles FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

-- From 20260930163500_fix_get_auth_role.sql
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT r.name
      FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.auth_user_id = auth.uid()
        AND p.is_active = true
      LIMIT 1
    ),
    CASE
      WHEN auth.jwt()->>'email' = 'admin@gmail.com' THEN 'ADMIN'
      ELSE NULL
    END
  );
$$;

-- From 0009_security_hardening.sql
CREATE OR REPLACE FUNCTION public.get_auth_employee_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT employee_id
  FROM profiles
  WHERE auth_user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

-- From 20261012120000_employee_roster_rls.sql
DROP POLICY IF EXISTS "View rosters" ON rosters;
CREATE POLICY "View rosters" ON rosters
  FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR status = 'PUBLISHED' OR auth.jwt()->>'email' = 'admin@gmail.com');

DROP POLICY IF EXISTS "View roster_assignments" ON roster_assignments;
CREATE POLICY "View roster_assignments" ON roster_assignments
  FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com' OR employee_id = public.get_auth_employee_id());

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

-- From 20261012130000_secure_shift_assignments_rls.sql
DROP POLICY IF EXISTS "View shift_assignments" ON shift_assignments;
CREATE POLICY "View shift_assignments" ON shift_assignments
  FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com' OR employee_id = public.get_auth_employee_id());

DROP FUNCTION IF EXISTS public.is_privileged_db_caller();

COMMIT;

NOTIFY pgrst, 'reload schema';
