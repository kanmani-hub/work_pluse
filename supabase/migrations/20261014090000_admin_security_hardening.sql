-- 20261014090000_admin_security_hardening.sql
-- PROPOSAL — review before applying. Rollback: supabase/rollbacks/20261014090000_admin_security_hardening.rollback.sql
--
-- C1  Remove authorization by hard-coded email (admin@gmail.com). Roles come from the caller's profile only,
--     and a deactivated employee (employees.status <> 'ACTIVE') no longer resolves to any role.
-- C2  Only an ADMIN can create, change or remove profiles, change anyone's role, or edit/delete an ADMIN's
--     employee record. Nobody can remove the last active ADMIN.
--
-- Service-role callers (edge functions) and the database owner (SQL editor) are exempt from the triggers;
-- RLS does not apply to them either.

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 0. Pre-flight: refuse to run if no properly provisioned, active ADMIN exists.
--    Without this check, removing the email fallback could lock every administrator out.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.roles r ON r.id = p.role_id
    LEFT JOIN public.employees e ON e.id = p.employee_id
    WHERE upper(r.name) = 'ADMIN'
      AND p.is_active = true
      AND (p.employee_id IS NULL OR upper(e.status) = 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'Aborted: no active ADMIN profile exists. Create one (profiles row with the ADMIN role, active employee) before applying this migration.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 1. C1: identity helpers — profile only, no email fallback, inactive employees resolve to nothing.
--    upper() keeps the value canonical ('ADMIN' / 'HR' / 'EMPLOYEE') for every existing policy.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT upper(r.name)
  FROM profiles p
  JOIN roles r ON r.id = p.role_id
  LEFT JOIN employees e ON e.id = p.employee_id
  WHERE p.auth_user_id = auth.uid()
    AND p.is_active = true
    AND (p.employee_id IS NULL OR upper(e.status) = 'ACTIVE')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_employee_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.employee_id
  FROM profiles p
  JOIN employees e ON e.id = p.employee_id
  WHERE p.auth_user_id = auth.uid()
    AND p.is_active = true
    AND upper(e.status) = 'ACTIVE'
  LIMIT 1;
$$;

-- True when the current request may bypass the C2 guards: the service role (edge functions)
-- or a direct database session that is not an API role (SQL editor, migrations).
CREATE OR REPLACE FUNCTION public.is_privileged_db_caller()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT current_user NOT IN ('authenticated', 'anon')
         OR coalesce(auth.jwt()->>'role', '') = 'service_role';
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. C1: roster / shift policies without the email clause.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "View rosters" ON rosters;
CREATE POLICY "View rosters" ON rosters
  FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR status = 'PUBLISHED');

DROP POLICY IF EXISTS "View roster_assignments" ON roster_assignments;
CREATE POLICY "View roster_assignments" ON roster_assignments
  FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Manage rosters" ON rosters;
CREATE POLICY "Manage rosters" ON rosters
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR'))
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

DROP POLICY IF EXISTS "Manage roster_assignments" ON roster_assignments;
CREATE POLICY "Manage roster_assignments" ON roster_assignments
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR'))
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

DROP POLICY IF EXISTS "View shift_assignments" ON shift_assignments;
CREATE POLICY "View shift_assignments" ON shift_assignments
  FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

-- ---------------------------------------------------------------------------------------------
-- 3. C2: profiles — ADMIN-only writes (HR keeps read access via "View profiles").
--    The web client never writes profiles; edge functions use the service role.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Manage profiles" ON profiles;

CREATE POLICY "Admins insert profiles" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.get_auth_role() = 'ADMIN');

CREATE POLICY "Admins update profiles" ON profiles
  FOR UPDATE TO authenticated
  USING (public.get_auth_role() = 'ADMIN')
  WITH CHECK (public.get_auth_role() = 'ADMIN');

CREATE POLICY "Admins delete profiles" ON profiles
  FOR DELETE TO authenticated
  USING (public.get_auth_role() = 'ADMIN');

-- Defense in depth: even if another permissive policy is added later, non-admin API callers
-- cannot touch the privileged columns, and nobody can remove the last active ADMIN.
-- SECURITY INVOKER on purpose: is_privileged_db_caller() must see the API role (authenticated),
-- not the function owner.
CREATE OR REPLACE FUNCTION public.guard_profile_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_admin_role UUID;
  v_remaining INTEGER;
BEGIN
  SELECT id INTO v_admin_role FROM roles WHERE upper(name) = 'ADMIN' LIMIT 1;

  IF NOT public.is_privileged_db_caller() AND coalesce(public.get_auth_role(), '') <> 'ADMIN' THEN
    IF TG_OP = 'INSERT' OR TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Only an administrator can create or remove user profiles.' USING ERRCODE = '42501';
    END IF;
    IF NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Only an administrator can change roles or account access.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Last-admin protection (applies to everyone, including admins and the service role).
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.role_id = v_admin_role AND OLD.is_active
     AND (TG_OP = 'DELETE' OR NEW.role_id IS DISTINCT FROM v_admin_role OR NOT NEW.is_active) THEN
    SELECT count(*) INTO v_remaining
    FROM profiles p
    WHERE p.role_id = v_admin_role AND p.is_active AND p.id <> OLD.id;
    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'Refused: this is the last active administrator.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_changes ON profiles;
CREATE TRIGGER guard_profile_changes
  BEFORE INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_changes();

-- ---------------------------------------------------------------------------------------------
-- 4. C2: employees — HR keeps day-to-day edits, but cannot change roles or touch an ADMIN's record.
-- ---------------------------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: is_privileged_db_caller() must see the API role (authenticated),
-- not the function owner.
CREATE OR REPLACE FUNCTION public.guard_employee_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_employee_role UUID;
  v_target_is_admin BOOLEAN := false;
  v_target UUID;
BEGIN
  IF public.is_privileged_db_caller() OR coalesce(public.get_auth_role(), '') = 'ADMIN' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT id INTO v_employee_role FROM roles WHERE upper(name) = 'EMPLOYEE' LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role_id IS NOT NULL AND NEW.role_id IS DISTINCT FROM v_employee_role THEN
      RAISE EXCEPTION 'Only an administrator can create HR or ADMIN employees.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_target := OLD.id;
  SELECT EXISTS (
    SELECT 1 FROM roles r
    WHERE upper(r.name) = 'ADMIN'
      AND (r.id = OLD.role_id
           OR r.id IN (SELECT p.role_id FROM profiles p WHERE p.employee_id = v_target))
  ) INTO v_target_is_admin;

  IF v_target_is_admin THEN
    RAISE EXCEPTION 'Only an administrator can change or remove an administrator''s record.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    RAISE EXCEPTION 'Only an administrator can change an employee''s role.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_employee_changes ON employees;
CREATE TRIGGER guard_employee_changes
  BEFORE INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_changes();


COMMIT;

NOTIFY pgrst, 'reload schema';
