-- ============================================================================================
-- WorkPulse HR — Admin → Break Management cross-check for ONE date.          READ-ONLY (SELECT)
-- Nothing here inserts, updates or deletes. Employee codes only — no names, phones or emails.
-- Run in the Supabase SQL editor. Change the date on the first line of each query if needed.
-- Run QUERY 1 on its own (select it, then Run); then QUERY 2 on its own.
-- ============================================================================================

-- QUERY 1 — one row per active employee: does the database hold what the page shows?
WITH p AS (SELECT date '2026-10-14' AS d),
att AS (
  SELECT a.* FROM attendance a, p WHERE a.attendance_date = p.d
),
brk AS (
  SELECT b.attendance_id,
         count(*)                                                            AS break_rows,
         count(*) FILTER (WHERE b.ended_at IS NULL
                          AND coalesce(b.break_type,'') <> 'CANCELLED')      AS open_breaks,
         count(*) FILTER (WHERE b.break_type = 'CANCELLED')                  AS cancelled_breaks,
         string_agg(DISTINCT coalesce(b.break_type,'(null)'), ',')           AS break_types,
         -- what the page computes: completed = end-start, open = now-start (CANCELLED excluded)
         coalesce(sum(floor(extract(epoch FROM (coalesce(b.ended_at, now()) - b.started_at)) / 60))
                  FILTER (WHERE coalesce(b.break_type,'') <> 'CANCELLED'), 0)::int AS page_total_min_now,
         coalesce(sum(b.duration_minutes)
                  FILTER (WHERE b.ended_at IS NOT NULL
                          AND coalesce(b.break_type,'') <> 'CANCELLED'), 0)  AS stored_row_duration_sum,
         min(b.started_at)                                                   AS first_break_start,
         max(b.ended_at)                                                     AS last_break_end,
         max(b.started_at) FILTER (WHERE b.ended_at IS NULL)                 AS open_break_since,
         count(*) FILTER (WHERE b.employee_id IS DISTINCT FROM a.employee_id) AS rows_with_other_employee_id
  FROM attendance_breaks b JOIN att a ON a.id = b.attendance_id
  GROUP BY b.attendance_id
),
gps AS (
  SELECT h.employee_id, count(*) AS gps_readings,
         min(h.recorded_at) AS first_reading, max(h.recorded_at) AS last_reading,
         count(*) FILTER (WHERE h.location_status = 'OUTSIDE_GEOFENCE') AS readings_outside
  FROM employee_location_history h, p
  WHERE (h.recorded_at AT TIME ZONE 'Asia/Kolkata')::date = p.d
  GROUP BY h.employee_id
),
gf AS (
  SELECT g.employee_id,
         count(*) FILTER (WHERE g.event_type = 'EXITED')  AS exits,
         count(*) FILTER (WHERE g.event_type = 'ENTERED') AS entries,
         max(g.occurred_at)                               AS last_event
  FROM geofence_events g, p
  WHERE (g.occurred_at AT TIME ZONE 'Asia/Kolkata')::date = p.d
  GROUP BY g.employee_id
),
stray AS (  -- breaks that STARTED on this date but hang off a different attendance row / no attendance row
  SELECT b.employee_id, count(*) AS breaks_on_other_attendance
  FROM attendance_breaks b, p
  WHERE (b.started_at AT TIME ZONE 'Asia/Kolkata')::date = p.d
    AND NOT EXISTS (SELECT 1 FROM att a WHERE a.id = b.attendance_id)
  GROUP BY b.employee_id
),
setting AS (
  SELECT nullif(coalesce(s.settings->'app'->>'breakDurationMins', s.settings->>'breakDurationMins'), '')::int AS setting_allowance
  FROM app_settings s ORDER BY s.updated_at DESC NULLS LAST LIMIT 1
)
SELECT e.employee_code,
       e.status                                                        AS employee_status,
       (e.office_id IS NOT NULL)                                       AS has_office,
       o.geofence_radius                                               AS office_radius_m,
       EXISTS (SELECT 1 FROM wfh_requests w, p WHERE w.employee_id = e.id
               AND w.request_date = p.d AND w.status = 'APPROVED')    AS approved_wfh,
       (SELECT count(*) FROM att x WHERE x.employee_id = e.id)         AS attendance_rows,   -- 0 = not on the page; 2+ = duplicate rows
       to_char(a.clock_in_at  AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')  AS clock_in_ist,
       to_char(a.clock_out_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')  AS clock_out_ist,
       a.status                                                        AS attendance_status,
       coalesce(brk.break_rows, 0)                                     AS break_rows,
       coalesce(brk.open_breaks, 0)                                    AS open_breaks,
       coalesce(brk.cancelled_breaks, 0)                               AS cancelled_breaks,
       brk.break_types,
       to_char(brk.first_break_start AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS first_break_start_ist,
       to_char(brk.last_break_end    AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS last_break_end_ist,
       to_char(brk.open_break_since  AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS open_break_since_ist,
       coalesce(brk.page_total_min_now, 0)                             AS page_total_min_now,
       coalesce(brk.stored_row_duration_sum, 0)                        AS stored_row_duration_sum,
       a.break_minutes                                                 AS stored_attendance_break_minutes,  -- what payroll reads
       a.break_overrun_minutes                                         AS stored_overrun_minutes,
       coalesce(brk.rows_with_other_employee_id, 0)                    AS break_rows_other_employee_id,
       coalesce(stray.breaks_on_other_attendance, 0)                   AS breaks_started_today_on_other_attendance,
       st.break_duration_minutes                                       AS shift_allowance,
       setting.setting_allowance,
       coalesce(gps.gps_readings, 0)                                   AS gps_readings_today,
       to_char(gps.first_reading AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS first_gps_ist,
       to_char(gps.last_reading  AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS last_gps_ist,
       coalesce(gps.readings_outside, 0)                               AS gps_readings_outside,
       coalesce(gf.exits, 0)                                           AS geofence_exits,
       coalesce(gf.entries, 0)                                         AS geofence_entries,
       ll.location_status                                              AS live_status_now,
       ll.is_tracking                                                  AS live_is_tracking,
       to_char(ll.last_seen_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM HH24:MI') AS live_last_seen_ist
FROM employees e
CROSS JOIN setting
LEFT JOIN offices o           ON o.id = e.office_id
LEFT JOIN att a               ON a.employee_id = e.id
LEFT JOIN brk                 ON brk.attendance_id = a.id
LEFT JOIN shift_templates st  ON st.id = a.shift_template_id
LEFT JOIN gps                 ON gps.employee_id = e.id
LEFT JOIN gf                  ON gf.employee_id = e.id
LEFT JOIN stray               ON stray.employee_id = e.id
LEFT JOIN LATERAL (SELECT l.* FROM employee_live_locations l WHERE l.employee_id = e.id
                   ORDER BY l.last_seen_at DESC NULLS LAST LIMIT 1) ll ON true
WHERE coalesce(e.status, 'ACTIVE') NOT IN ('INACTIVE', 'TERMINATED', 'EXITED')
   OR a.id IS NOT NULL
ORDER BY (a.id IS NULL), coalesce(brk.page_total_min_now, 0) DESC, e.employee_code;


-- QUERY 2 — every break row that touches the date (codes only), to see exactly what the page sums.
WITH p AS (SELECT date '2026-10-14' AS d)
SELECT e.employee_code,
       a.attendance_date,
       (a.attendance_date = p.d)                                        AS shown_on_this_date,
       b.break_type,
       to_char(b.started_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM HH24:MI') AS started_ist,
       to_char(b.ended_at   AT TIME ZONE 'Asia/Kolkata', 'DD-MM HH24:MI') AS ended_ist,
       b.duration_minutes                                               AS stored_minutes,
       floor(extract(epoch FROM (coalesce(b.ended_at, now()) - b.started_at)) / 60)::int AS minutes_until_end_or_now,
       (b.ended_at IS NULL)                                             AS still_open,
       (b.employee_id IS DISTINCT FROM a.employee_id)                   AS employee_id_mismatch,
       to_char(b.created_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM HH24:MI') AS row_created_ist,
       to_char(b.updated_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM HH24:MI') AS row_updated_ist
FROM attendance_breaks b
CROSS JOIN p
LEFT JOIN attendance a ON a.id = b.attendance_id
LEFT JOIN employees e  ON e.id = coalesce(a.employee_id, b.employee_id)
WHERE a.attendance_date = p.d
   OR (b.started_at AT TIME ZONE 'Asia/Kolkata')::date = p.d
ORDER BY e.employee_code, b.started_at;
