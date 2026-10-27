-- Rollback of 20261022090100_employee_data_isolation.sql
-- WARNING: re-opens QA finding S-05 (every employee can read every employee's personal data).
BEGIN;
DROP TRIGGER IF EXISTS trg_guard_employee_role_change ON public.employees;
DROP FUNCTION IF EXISTS public.guard_employee_role_change();
DROP POLICY IF EXISTS "View employees" ON public.employees;
CREATE POLICY "Allow authenticated users to read employees" ON public.employees FOR SELECT TO authenticated USING (true);
-- (anon SELECT is not re-granted: anon never needed it)
COMMIT;
