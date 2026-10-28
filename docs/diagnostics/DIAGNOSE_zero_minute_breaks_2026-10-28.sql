-- =============================================================================================
-- READ-ONLY diagnosis: Break Management shows 0 min live / 0 completed / 0 stored / "No Breaks Recorded"
-- although tracking was off. Every statement below is a SELECT; nothing is changed.
-- Run in the Supabase SQL editor of the project you are checking (staging first). Replace the date in
-- the first CTE of queries 5–8 with the day you looked at (company date, Asia/Kolkata).
--
-- Reading the dashboard: a row with attendance shows 0 / 0 / 0 and "No Breaks Recorded" ONLY when the
-- database returned the attendance row with an EMPTY list of break rows. "—" / "Not loaded" means the
-- data could not be read. So 0 / 0 / 0 means no break row exists — the cause is upstream. These queries
-- find which step did not happen.
-- =============================================================================================

-- 1. Is the automatic-break migration applied? (no rows → report_tracking_event does not exist: the app
--    logs "tracking event … not delivered" and NO automatic break is ever created)
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('report_tracking_event', 'process_stale_tracking', 'ab_start_auto_break', 'ab_on_live_location');
SELECT version FROM supabase_migrations.schema_migrations
WHERE version >= '20261021120000' ORDER BY version;

-- 2. Policy actually stored (null = default: enabled, permission-denied on, unavailable on, stale on,
--    stale 15 min, grace 0, auto-resume on, WFH GPS loss OFF)
SELECT settings->'app'->>'autoBreakEnabled'             AS enabled,
       settings->'app'->>'autoBreakOnPermissionDenied'  AS on_permission_denied,
       settings->'app'->>'autoBreakOnGpsUnavailable'    AS on_gps_unavailable,
       settings->'app'->>'autoBreakOnStale'             AS on_stale,
       settings->'app'->>'autoBreakStaleMinutes'        AS stale_minutes,
       settings->'app'->>'autoBreakGraceMinutes'        AS grace_minutes,
       settings->'app'->>'autoBreakAutoResume'          AS auto_resume,
       settings->'app'->>'autoBreakWfhGpsLoss'          AS wfh_gps_loss
FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';

-- 3. Is the every-minute server check scheduled? (no row / no pg_cron → "no location reaching the server"
--    breaks are only evaluated while an admin has Break Management open)
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
SELECT jobname, schedule, command, active FROM cron.job WHERE command ILIKE '%process_stale_tracking%';   -- only if pg_cron exists
SELECT status, start_time, return_message FROM cron.job_run_details
WHERE command ILIKE '%process_stale_tracking%' ORDER BY start_time DESC LIMIT 5;                           -- only if pg_cron exists

-- 4. What the server knows about each clocked-in employee's tracking right now
--    state PERMISSION_DENIED / GPS_UNAVAILABLE with no open_auto_break_id → the policy said "no break"
--    (switch off, WFH exemption, grace, after shift end); GPS_TIMEOUT → never a break by policy
SELECT e.employee_code, s.state, s.state_since, s.work_mode, s.last_problem, s.last_problem_at,
       s.last_fresh_fix_at, s.last_contact_at, s.open_auto_break_id
FROM employee_tracking_state s JOIN employees e ON e.id = s.employee_id
ORDER BY s.updated_at DESC LIMIT 50;

-- 5. The dashboard's own data for the day: attendance rows and their break rows (all types)
WITH p AS (SELECT DATE '2026-10-28' AS d)
SELECT e.employee_code, a.id AS attendance_id, a.clock_in_at, a.clock_out_at, a.status,
       a.break_minutes AS stored_break_minutes, a.break_overrun_minutes,
       count(b.id) AS break_rows,
       count(b.id) FILTER (WHERE b.break_type IN ('AUTO_GPS', 'AUTO_TRACKING')) AS automatic_rows,
       count(b.id) FILTER (WHERE b.break_type = 'CANCELLED') AS cancelled_rows
FROM attendance a JOIN employees e ON e.id = a.employee_id
LEFT JOIN attendance_breaks b ON b.attendance_id = a.id
WHERE a.attendance_date = (SELECT d FROM p)
GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY e.employee_code;

-- 6. Did any device report reach the server that day? (location problems recorded by the app)
WITH p AS (SELECT DATE '2026-10-28' AS d)
SELECT e.employee_code, v.verification_type, v.result, v.verified_at, v.failure_reason
FROM location_verification_events v JOIN employees e ON e.id = v.employee_id
WHERE v.verified_at >= ((SELECT d FROM p)::timestamp AT TIME ZONE 'Asia/Kolkata')
  AND v.verified_at <  (((SELECT d FROM p) + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
  AND v.result IN ('LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'LOW_ACCURACY', 'ERROR')   -- same filter as the page
ORDER BY v.verified_at DESC LIMIT 100;

-- 7. Server decisions that day (breaks started / ended, with reason)
WITH p AS (SELECT DATE '2026-10-28' AS d)
SELECT action, description, created_at FROM audit_logs
WHERE action IN ('AUTOMATIC_BREAK_STARTED', 'AUTOMATIC_BREAK_ENDED')
  AND created_at >= ((SELECT d FROM p)::timestamp AT TIME ZONE 'Asia/Kolkata')
ORDER BY created_at DESC LIMIT 100;

-- 8. WFH on that day exempts GPS-loss breaks by default (wfh_gps_loss = false)
WITH p AS (SELECT DATE '2026-10-28' AS d)
SELECT e.employee_code, w.status FROM wfh_requests w JOIN employees e ON e.id = w.employee_id
WHERE w.request_date = (SELECT d FROM p) AND w.status = 'APPROVED';

-- How to read the results
--  * 1 returns nothing                         → migration 20261021120000 not applied: no automatic breaks exist.
--  * 4 shows GPS_TIMEOUT                       → the device only timed out (common when OS location is off in a
--                                                browser): by policy no immediate break; only the stale rule
--                                                applies after autoBreakStaleMinutes, and only if 3 shows the job.
--  * 4 shows PERMISSION_DENIED, no break       → check 2 (switch off / grace before 20261028090300), 8 (WFH), shift end.
--  * 5 shows break_rows > 0 but the page shows 0 → report it (page / RLS issue); otherwise the page is correct.
--  * 6 and 4 empty for the employee            → the device never reported (app closed, offline, old app version,
--                                                or tracking never started because the employee was not clocked in).
