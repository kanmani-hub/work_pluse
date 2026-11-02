-- =============================================================================================
-- READ-ONLY pre-check before applying the pending migrations (2026-11-02).
-- Every statement is a SELECT. Run it in the Supabase SQL editor of the project (staging first,
-- then production) and keep the output: it decides which files of the update pack still need to run.
-- =============================================================================================

-- 1. Migration history recorded by the Supabase CLI (empty or missing table = migrations were pasted
--    into the SQL editor by hand; then rely on query 2)
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version >= '20261001000000' ORDER BY version;

-- 2. Objects each migration creates (true = present). One row per migration of the pack.
SELECT m.migration, m.object, m.present FROM (VALUES
  ('20261004120000_notification_devices',          'table notification_devices',                 to_regclass('public.notification_devices') IS NOT NULL),
  ('20261020150000_tracking_enforcement_policy',   'column attendance_breaks.incident_id',        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='attendance_breaks' AND column_name='incident_id')),
  ('20261020160000_trusted_break_correction',      'function correct_tracking_enforcement_break', EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='correct_tracking_enforcement_break')),
  ('20261020170000_resolve_employee_email',        'table auth_lookup_rate_limits',               to_regclass('public.auth_lookup_rate_limits') IS NOT NULL),
  ('20261021120000_automatic_break_tracking',      'table employee_tracking_state',               to_regclass('public.employee_tracking_state') IS NOT NULL),
  ('20261022090000_request_approval_guards',       'function guard_request_approval',             EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guard_request_approval')),
  ('20261022090100_employee_data_isolation',       'function guard_employee_role_change',         EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guard_employee_role_change')),
  ('20261022090200_notification_integrity',        'function notifications_update_guard',         EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='notifications_update_guard')),
  ('20261022090300_audit_log_integrity',           'function guard_audit_log_insert',             EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guard_audit_log_insert')),
  ('20261022100000_fix_auto_clock_out',            'function mco_settings',                       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='mco_settings')),
  ('20261022100100_permission_overlap_guard',      'function guard_permission_overlap',           EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guard_permission_overlap')),
  ('20261028090000_attendance_server_values',      'function att_clock_in_values',                EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='att_clock_in_values')),
  ('20261028090100_payroll_lock_and_replace',      'function replace_payroll_calculation',        EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='replace_payroll_calculation')),
  ('20261028090200_auto_clock_out_hardening',      'table auto_clock_out_runs',                   to_regclass('public.auto_clock_out_runs') IS NOT NULL),
  ('20261028090300_auto_break_tracking_off',       'report_tracking_event skips grace for denied', EXISTS (SELECT 1 FROM pg_proc WHERE proname='report_tracking_event' AND prosrc LIKE '%LOCATION_DENIED%graceMinutes%')),
  ('PROPOSED_overtime_requests',                   'table overtime_requests',                     to_regclass('public.overtime_requests') IS NOT NULL),
  ('PROPOSED_payroll_payment_safety',              'function record_payroll_payment',             EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='record_payroll_payment')),
  ('PROPOSED_missing_clock_out_workflow',          'table payroll_adjustments',                   to_regclass('public.payroll_adjustments') IS NOT NULL)
) AS m(migration, object, present) ORDER BY 1;

-- 3. Scheduler: is pg_cron installed and which jobs exist? (auto clock-out every 15 min, automatic
--    breaks every minute). If pg_cron is missing, the cron.* queries below fail — that is the answer.
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobname;
SELECT j.jobname, d.status, d.start_time, left(d.return_message, 200) AS message
FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
ORDER BY d.start_time DESC LIMIT 20;

-- 4. What the auto clock-out job will touch once it works: open past days, per month.
--    Each one becomes MISSING_CLOCK_OUT and the employee gets ONE notification per day.
SELECT to_char(attendance_date, 'YYYY-MM') AS month, count(*) AS open_past_days, count(DISTINCT employee_id) AS employees
FROM attendance
WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL AND attendance_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
GROUP BY 1 ORDER BY 1;

-- 5. Automatic breaks that were never closed (closed at shift end by 20261022100000 when it runs)
SELECT b.id, b.attendance_id, b.break_type, b.started_at, a.attendance_date, a.status
FROM attendance_breaks b JOIN attendance a ON a.id = b.attendance_id
WHERE b.ended_at IS NULL ORDER BY b.started_at;

-- 6. Payrolls that are locked (approved or later) — the payroll lock migration protects exactly these
SELECT payroll_year, payroll_month, status, count(*) FROM payroll
WHERE status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED')
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- 7. Required by PROPOSED_missing_clock_out_workflow STEP 0: must return 0
SELECT count(*) AS self_reviewed_requests FROM overtime_requests WHERE reviewed_by IS NOT NULL AND reviewed_by = employee_id;

-- 8. Missing clock-out days already decided in a payroll (app 2026-11-02, while the workflow was not set up).
--    After the workflow is applied, HR must NOT reject these same days with a deduction again.
SELECT p.payroll_year, p.payroll_month, e.employee_code, r->>'date' AS work_date, r->>'decision' AS decision
FROM (SELECT * FROM payroll WHERE remarks LIKE '{%') p JOIN employees e ON e.id = p.employee_id,
     jsonb_array_elements(COALESCE((p.remarks::jsonb)->'reviewResolutions', '[]'::jsonb)) r
WHERE r->>'type' = 'MISSING_CLOCK_OUT'
ORDER BY 1, 2, 3, 4;
