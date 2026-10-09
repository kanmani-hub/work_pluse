-- =====================================================================================
-- PROPOSED — NOT APPLIED. Do NOT run without approval.
-- WorkPulse HR: Employee data-isolation gaps found during Step 2 (Employee Dashboard).
-- Source of truth used: supabase/migrations (0001, 0009, ...). Verify against the live
-- database first:  SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--                  WHERE schemaname = 'public' ORDER BY tablename;
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- R1 (HIGH) employees: every signed-in user can read EVERY employee row
--   0001: CREATE POLICY "Allow authenticated users to read employees" ... USING (true)
--   It was never dropped. Employee A can read B's email, phone, date_of_birth, etc.
--   Dashboard/Profile only read the employee's own row, but the REST API allows all.
--
--   BLOCKER before applying: notificationService reads ADMIN/HR employee ids from the
--   browser to send them notifications (notificationService.ts ~L152 and ~L217). That
--   must first move to the SECURITY DEFINER helper below, or admin notifications stop.
-- -------------------------------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_notification_recipient_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id
  FROM employees e
  JOIN roles r ON r.id = e.role_id
  WHERE r.name IN ('ADMIN', 'HR') AND e.status = 'ACTIVE';
$$;
REVOKE EXECUTE ON FUNCTION public.get_admin_notification_recipient_ids() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_admin_notification_recipient_ids() TO authenticated;

DROP POLICY IF EXISTS "Allow authenticated users to read employees" ON employees;
CREATE POLICY "View employees" ON employees FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR id = public.get_auth_employee_id());

-- -------------------------------------------------------------------------------------
-- R2 (HIGH) attendance: employees can UPDATE their own attendance row directly
--   0009: "Update own attendance" ... USING/WITH CHECK (... OR employee_id = get_auth_employee_id())
--   An employee can PATCH clock_in_at, late_minutes, worked_hours, status, is_half_day
--   through the REST API (anon key + own token). Payroll uses these values.
--   Fix direction (needs Attendance step, NOT a policy-only change): move clock-in,
--   clock-out and break transitions into SECURITY DEFINER RPCs that compute times on
--   the server (now()), then remove the employee UPDATE path:
--
-- DROP POLICY IF EXISTS "Update own attendance" ON attendance;
-- CREATE POLICY "Update attendance (admin)" ON attendance FOR UPDATE TO authenticated
-- USING (public.get_auth_role() IN ('ADMIN', 'HR'))
-- WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));
--   (left commented: applying it today would break clock-out and breaks in the app)

-- -------------------------------------------------------------------------------------
-- R3 (MEDIUM) notifications: any signed-in user can INSERT a notification for anyone
--   0009: "Insert notifications" ... WITH CHECK (true)
--   Employee A can create fake notifications in Employee B's or an admin's inbox
--   (spoofed "payroll"/"leave approved" messages). Fix: insert through a SECURITY
--   DEFINER function / DB triggers, then:
-- DROP POLICY IF EXISTS "Insert notifications" ON notifications;
-- CREATE POLICY "Insert notifications" ON notifications FOR INSERT TO authenticated
-- WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));
--   (left commented: employee actions currently create admin notifications from the browser)

-- -------------------------------------------------------------------------------------
-- R4 (MEDIUM, by design today) employee_live_locations: employee can write own row
--   "Manage employee_live_locations" FOR ALL ... employee_id = get_auth_employee_id()
--   An employee can set location_status = 'INSIDE_GEOFENCE' directly. Any browser GPS
--   value is client-reported anyway; real protection needs server-side verification
--   (Android/native step). Not changed here.
-- -------------------------------------------------------------------------------------

COMMIT;
