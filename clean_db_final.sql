-- Comprehensive Data Cleanup for Fresh QA Test
-- Preserving ONLY: admin@gmail.com, roles, app_settings, leave_types, auth structure, and DB schema.

BEGIN;

-- 1. Notifications and Audit Logs
DELETE FROM public.notifications;
DELETE FROM public.audit_logs;

-- 2. Payroll Data
DELETE FROM public.payroll_items;
DELETE FROM public.payroll_payments;
DELETE FROM public.payslips;
DELETE FROM public.payroll;
DELETE FROM public.salary_structures;

-- 3. Attendance and Leave Data
DELETE FROM public.attendance_events;
DELETE FROM public.attendance_breaks;
DELETE FROM public.attendance;
DELETE FROM public.leave_requests;
DELETE FROM public.leave_balances;
DELETE FROM public.wfh_requests;
DELETE FROM public.permission_requests;

-- 4. Geolocation and Face Verifications
DELETE FROM public.employee_location_history;
DELETE FROM public.employee_live_locations;
DELETE FROM public.geofence_events;
DELETE FROM public.location_verification_events;
DELETE FROM public.face_verification_events;
DELETE FROM public.face_registrations;

-- 5. Shifts and Rosters
DELETE FROM public.shift_assignments;
DELETE FROM public.roster_assignments;
DELETE FROM public.rosters;
DELETE FROM public.shift_templates;

-- 6. Detach Admin from Office and Department before deleting them
UPDATE public.employees SET department_id = NULL, office_id = NULL WHERE email = 'admin@gmail.com';

-- 7. Auth Users (ONLY test users, preserve admin)
DELETE FROM auth.users WHERE email != 'admin@gmail.com';

-- 8. Profiles (ONLY test users, preserve admin)
DELETE FROM public.profiles WHERE employee_id IN (
  SELECT id FROM public.employees WHERE email != 'admin@gmail.com'
);

-- 9. Employees (ONLY test users, preserve admin)
DELETE FROM public.employees WHERE email != 'admin@gmail.com';

-- 10. Clean up Departments and Offices
DELETE FROM public.departments;
DELETE FROM public.offices;

COMMIT;
