-- =============================================================================================
-- 20261022090100_employee_data_isolation.sql
-- Employees can read only their own employee record (QA finding S-05, P0).
--
-- Before: "Allow authenticated users to read employees" (0001/0002) is FOR SELECT USING (true), so every
-- signed-in employee could list all employees with phone numbers, dates of birth, addresses, salary
-- references, etc. (also through realtime, which applies the same SELECT policy).
--
-- After:
--   * ADMIN / HR read all employee records (unchanged).
--   * Everyone else reads only the row linked to their own active profile.
--   * Employee -> admin alerts no longer need to list admins from the browser: they go through
--     public.notify_admins() (migration 20261022090200), which runs on the server.
--   * Only ADMIN may set or change employees.role_id (HR keeps managing everything else). The effective
--     permission still comes from profiles.role_id, which only ADMIN can change (0009 / 20261014090000);
--     this keeps the employee record from showing a role nobody granted.
-- Rollback: supabase/rollbacks/20261022090100_employee_data_isolation.rollback.sql
-- =============================================================================================

BEGIN;

DROP POLICY IF EXISTS "Allow authenticated users to read employees" ON public.employees;
DROP POLICY IF EXISTS "View employees" ON public.employees;
CREATE POLICY "View employees" ON public.employees
  FOR SELECT TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR id = public.get_auth_employee_id());

-- anon never reads employees (login uses the rate-limited get_email_by_employee_code function)
REVOKE SELECT ON public.employees FROM anon;

CREATE OR REPLACE FUNCTION public.guard_employee_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND COALESCE(public.get_auth_role(), '') <> 'ADMIN'
     AND NOT (TG_OP = 'INSERT' AND NEW.role_id = (SELECT id FROM public.roles WHERE name = 'EMPLOYEE')) THEN
    RAISE EXCEPTION 'Only an administrator can assign roles' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_employee_role_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_employee_role_change ON public.employees;
CREATE TRIGGER trg_guard_employee_role_change BEFORE INSERT OR UPDATE OF role_id ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_role_change();

COMMIT;
