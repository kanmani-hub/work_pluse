-- Unassign Admin from any department or office to prevent FK constraint issues
UPDATE public.employees
SET department_id = NULL, office_id = NULL
WHERE id = 'c6e4028a-d6be-4278-a460-ce50a91c6bbc';

-- 1. notifications
DELETE FROM public.notifications;

-- 2. audit_logs
DELETE FROM public.audit_logs;

-- 3-7. Payroll
DELETE FROM public.payroll_items;
DELETE FROM public.payroll_payments;
DELETE FROM public.payslips;
DELETE FROM public.payroll;
DELETE FROM public.salary_structures;

-- 8-10. Attendance
DELETE FROM public.attendance_events;
DELETE FROM public.attendance_breaks;
DELETE FROM public.attendance;

-- 11-14. Location
DELETE FROM public.location_verification_events;
DELETE FROM public.geofence_events;
DELETE FROM public.employee_location_history;
DELETE FROM public.employee_live_locations;

-- 15-16. Face Data
DELETE FROM public.face_verification_events;
DELETE FROM public.face_registrations;

-- 17-20. Requests
DELETE FROM public.leave_requests;
DELETE FROM public.leave_balances;
DELETE FROM public.wfh_requests;
DELETE FROM public.permission_requests;

-- 21-24. Shifts
DELETE FROM public.shift_assignments;
DELETE FROM public.roster_assignments;
DELETE FROM public.rosters;
DELETE FROM public.shift_templates;

-- 25. Profiles (non-admin)
DELETE FROM public.profiles
WHERE id != 'c6e4028a-d6be-4278-a460-ce50a91c6bbc';

-- 26. Employees (non-admin)
DELETE FROM public.employees
WHERE id != 'c6e4028a-d6be-4278-a460-ce50a91c6bbc';

-- 26b. auth.users (non-admin)
DELETE FROM auth.users
WHERE id != 'c6e4028a-d6be-4278-a460-ce50a91c6bbc';

-- 27-28. Departments and Offices
DELETE FROM public.departments;
DELETE FROM public.offices;
