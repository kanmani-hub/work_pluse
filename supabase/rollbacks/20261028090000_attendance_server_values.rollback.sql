-- Rollback of 20261028090000_attendance_server_values.sql
-- WARNING: re-opens the payroll-input forgery (employees can again write their own late minutes, clock-in /
-- clock-out times, worked hours, half day and status). No attendance data is changed by this rollback.
BEGIN;
DROP TRIGGER IF EXISTS trg_aa_attendance_server_values ON public.attendance;
DROP FUNCTION IF EXISTS public.guard_attendance_server_values();
DROP FUNCTION IF EXISTS public.att_clock_out_values(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.att_clock_in_values(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.att_assigned_shift(uuid, date);
DROP FUNCTION IF EXISTS public.att_may_compute_for(uuid);
COMMIT;
