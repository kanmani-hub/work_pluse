-- =====================================================================================
-- READ-ONLY diagnosis: why the employee did not see the overtime notification.
-- Run in the Supabase SQL Editor. Changes nothing.
-- =====================================================================================

-- 1) Latest overtime reviews and the notification each one produced (if any).
--    notification_id empty → the INSERT failed (see the browser console: "[NOTIFY] … failed").
--    recipient_ok = false → sent to the wrong employee.
SELECT o.id                       AS overtime_id,
       e.first_name || ' ' || e.last_name AS employee,
       o.work_date, o.status, o.requested_overtime_hours, o.approved_overtime_hours, o.reviewed_at,
       n.id                       AS notification_id,
       n.title, n.message, n.is_read, n.created_at AS notified_at,
       (n.recipient_employee_id = o.employee_id) AS recipient_ok
FROM overtime_requests o
JOIN employees e ON e.id = o.employee_id
LEFT JOIN notifications n ON n.entity_type = 'overtime_requests' AND n.entity_id = o.id
WHERE o.status IN ('APPROVED', 'REJECTED')
ORDER BY o.reviewed_at DESC NULLS LAST
LIMIT 10;

-- 2) Is notifications in the Realtime publication? (false → no live event is ever sent;
--    the bell only updates on reload / focus / opening it)
SELECT EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications')
       AS notifications_realtime_enabled;

-- 3) Notification security rules currently in force
SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'notifications' ORDER BY cmd, policyname;

-- 4) Duplicates for one action (should return no rows)
SELECT recipient_employee_id, metadata->>'dedupe_key' AS dedupe_key, COUNT(*)
FROM notifications WHERE metadata ? 'dedupe_key'
GROUP BY 1, 2 HAVING COUNT(*) > 1;
