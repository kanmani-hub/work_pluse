SELECT 'departments' AS table_name, COUNT(*) AS cnt FROM public.departments
UNION ALL SELECT 'offices', COUNT(*) FROM public.offices
UNION ALL SELECT 'non_admin_employees', COUNT(*) FROM public.employees WHERE id != 'c6e4028a-d6be-4278-a460-ce50a91c6bbc'
UNION ALL SELECT 'shift_templates', COUNT(*) FROM public.shift_templates
UNION ALL SELECT 'shift_assignments', COUNT(*) FROM public.shift_assignments
UNION ALL SELECT 'rosters', COUNT(*) FROM public.rosters
UNION ALL SELECT 'roster_assignments', COUNT(*) FROM public.roster_assignments
UNION ALL SELECT 'attendance', COUNT(*) FROM public.attendance
UNION ALL SELECT 'attendance_breaks', COUNT(*) FROM public.attendance_breaks
UNION ALL SELECT 'attendance_events', COUNT(*) FROM public.attendance_events
UNION ALL SELECT 'wfh_requests', COUNT(*) FROM public.wfh_requests
UNION ALL SELECT 'leave_requests', COUNT(*) FROM public.leave_requests
UNION ALL SELECT 'leave_balances', COUNT(*) FROM public.leave_balances
UNION ALL SELECT 'permission_requests', COUNT(*) FROM public.permission_requests
UNION ALL SELECT 'salary_structures', COUNT(*) FROM public.salary_structures
UNION ALL SELECT 'payroll', COUNT(*) FROM public.payroll
UNION ALL SELECT 'payroll_items', COUNT(*) FROM public.payroll_items
UNION ALL SELECT 'payroll_payments', COUNT(*) FROM public.payroll_payments
UNION ALL SELECT 'payslips', COUNT(*) FROM public.payslips
UNION ALL SELECT 'face_registrations', COUNT(*) FROM public.face_registrations
UNION ALL SELECT 'face_verification_events', COUNT(*) FROM public.face_verification_events
UNION ALL SELECT 'employee_live_locations', COUNT(*) FROM public.employee_live_locations
UNION ALL SELECT 'employee_location_history', COUNT(*) FROM public.employee_location_history
UNION ALL SELECT 'geofence_events', COUNT(*) FROM public.geofence_events
UNION ALL SELECT 'location_verification_events', COUNT(*) FROM public.location_verification_events
UNION ALL SELECT 'notifications', COUNT(*) FROM public.notifications
UNION ALL SELECT 'audit_logs', COUNT(*) FROM public.audit_logs;
