-- =============================================================================================
-- WorkPulse HR — Automatic-break STAGING pre-checks (READ ONLY)
-- For: supabase/migrations/20261021120000_automatic_break_tracking.sql   (see docs/AUTOMATIC_BREAKS.md)
--
-- RUN ONLY ON STAGING. Before running, the operator confirms in the Supabase dashboard that the project
-- reference in the browser URL (https://supabase.com/dashboard/project/<ref>/sql) is the STAGING project
-- and NOT the production project used by the live app.
--
-- Everything below runs inside a READ ONLY transaction and ends with ROLLBACK: PostgreSQL refuses any
-- write in it ("cannot execute ... in a read-only transaction"). Run as one script in the SQL editor
-- (role postgres) and copy every result grid into the staging report.
-- =============================================================================================

BEGIN TRANSACTION READ ONLY;

-- 0. Target identification (record these in the report next to the project ref you confirmed)
SELECT current_database() AS database, current_user AS run_as, now() AS checked_at,
       current_setting('server_version') AS pg_version,
       (SELECT count(*) FROM attendance) AS attendance_rows,
       (SELECT count(*) FROM employees) AS employee_rows;

-- 1. Migration history actually applied (files in the repo are not proof)
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 15;
-- Expected before deploying: 20261021120000 NOT present. Note whether 20261020150000 and 20261020160000 are.

-- 2. MUST return 0 rows: an attendance with more than one open break stops the migration
SELECT attendance_id, count(*) AS open_breaks, min(started_at) AS first_start
FROM attendance_breaks
WHERE ended_at IS NULL AND break_type <> 'CANCELLED'
GROUP BY 1 HAVING count(*) > 1;

-- 3. Extensions (pg_cron decides whether the every-minute schedule is created)
SELECT extname, extversion, extnamespace::regnamespace AS schema
FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net', 'uuid-ossp');
SELECT to_regclass('cron.job') IS NOT NULL AS cron_job_table_exists;

-- 4. Existing (non-internal) triggers on the three tables the migration adds triggers to
SELECT tgrelid::regclass AS table_name, tgname, tgenabled
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgrelid IN ('public.attendance'::regclass, 'public.attendance_breaks'::regclass, 'public.employee_live_locations'::regclass)
ORDER BY 1, 2;
-- Expected: only the updated_at triggers (and nothing named trg_ab_* or guard_attendance_break_employee_write).

-- 5. Functions the migration relies on, and the settings row
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer, p.proowner::regrole AS owner
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_auth_role', 'get_auth_employee_id', 'update_updated_at_column', 'correct_tracking_enforcement_break',
                    'process_auto_clock_out', 'report_tracking_event', 'process_stale_tracking', 'geofence_auto_break')
ORDER BY 1;
-- Expected: the last three NOT present yet.
SELECT id, settings ? 'app' AS has_app_section, settings ? 'payroll' AS has_payroll_section,
       settings->'payroll'->>'enableBreakOverrunDetection' AS overrun_detection,
       settings->'app'->>'breakDurationMins' AS break_duration_mins,
       settings->'app'->>'trackingStaleMinutes' AS tracking_stale_minutes
FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';

-- 6. Realtime publication
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;

-- 7. Open automatic breaks right now (each needs the UPDATED app to clock out)
SELECT break_type, count(*) AS open_now, min(started_at) AS oldest
FROM attendance_breaks
WHERE ended_at IS NULL AND break_type IN ('AUTO_GPS', 'AUTO_TRACKING')
GROUP BY 1;

-- 8. Role that will own the new functions (the guards trust postgres / service_role / supabase_admin)
SELECT current_user AS migration_role,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls;

-- 9. Table owners and forced RLS (SECURITY DEFINER functions owned by postgres must not be blocked by RLS)
SELECT c.relname, c.relowner::regrole AS owner, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('attendance', 'attendance_breaks', 'attendance_events', 'employee_live_locations', 'notifications', 'audit_logs', 'app_settings', 'wfh_requests', 'roster_assignments', 'shift_templates')
ORDER BY 1;
-- Expected: owner postgres, rls_forced false.

-- 10. Current policies on attendance_breaks / attendance (compare with the migration files)
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('attendance_breaks', 'attendance') ORDER BY 1, 2;

-- 11. Optional: roster work_mode column (WFH by roster; the migration also works without it)
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'roster_assignments' AND column_name IN ('work_mode', 'day_type');

ROLLBACK;

-- 12. ONLY if check 3 showed pg_cron installed (run separately; read only):
-- SELECT jobid, jobname, schedule, command, username, active FROM cron.job ORDER BY jobname;
