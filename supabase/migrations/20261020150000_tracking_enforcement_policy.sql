-- 20261020150000_tracking_enforcement_policy.sql
-- WorkPulse HR — Warning and Automatic Break Policy Migration
--
-- PURPOSE:
-- 1. Enforces at most one active break per attendance session at the database level.
-- 2. Enforces idempotent notification delivery per recipient and deduplication key.
-- 3. Optimizes tracking incident queries in attendance_events.
-- 4. Adds optional incident_id to attendance_breaks for tracking enforcement traceability.
--
-- Rollback: supabase/rollbacks/20261020150000_tracking_enforcement_policy.rollback.sql

BEGIN;

-- 1. Enforce at most one active break per attendance session (excluding CANCELLED breaks)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_break_per_attendance
ON public.attendance_breaks (attendance_id)
WHERE ended_at IS NULL AND break_type <> 'CANCELLED';

-- 2. Optional: Add incident_id column to attendance_breaks for direct incident correlation
ALTER TABLE public.attendance_breaks
ADD COLUMN IF NOT EXISTS incident_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_attendance_breaks_incident_id
ON public.attendance_breaks (incident_id)
WHERE incident_id IS NOT NULL;

-- 3. Index tracking incident events in attendance_events metadata for fast audit & lookup
CREATE INDEX IF NOT EXISTS idx_attendance_events_tracking_incidents
ON public.attendance_events (attendance_id, (metadata->>'incident_id'))
WHERE metadata->>'incident_id' IS NOT NULL;

-- 4. Prevent duplicate notification delivery via partial unique index on dedupe_key
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_recipient_dedupe_key
ON public.notifications (recipient_employee_id, (metadata->>'dedupe_key'))
WHERE metadata->>'dedupe_key' IS NOT NULL;

COMMIT;
