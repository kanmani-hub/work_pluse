-- 20261020150000_tracking_enforcement_policy.rollback.sql
-- Rollback for 20261020150000_tracking_enforcement_policy.sql

BEGIN;

DROP INDEX IF EXISTS public.idx_notifications_recipient_dedupe_key;
DROP INDEX IF EXISTS public.idx_attendance_events_tracking_incidents;
DROP INDEX IF EXISTS public.idx_attendance_breaks_incident_id;
ALTER TABLE public.attendance_breaks DROP COLUMN IF EXISTS incident_id;
DROP INDEX IF EXISTS public.idx_one_active_break_per_attendance;

COMMIT;
