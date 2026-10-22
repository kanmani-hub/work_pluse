-- 20261021120000_automatic_break_tracking.rollback.sql
-- Rollback for 20261021120000_automatic_break_tracking.sql
--
-- Removes the automatic-break triggers, functions, schedule and tracking-state table.
-- The break rows themselves are KEPT (including system-created ones). The source / reason /
-- ended_reason columns are dropped, so that information is lost: export it first if needed:
--   SELECT id, attendance_id, break_type, source, reason, ended_reason FROM attendance_breaks WHERE source <> 'EMPLOYEE';
-- The one-open-break index and incident_id column belong to 20261020150000 and are not touched.
-- NOTE: after rollback the app version from before this change must be deployed as well; the new
-- client calls the functions removed here.

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-break-stale-tracking') THEN
      PERFORM cron.unschedule('auto-break-stale-tracking');
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'employee_tracking_state') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.employee_tracking_state;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance_breaks') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.attendance_breaks;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_ab_on_live_location ON public.employee_live_locations;
DROP TRIGGER IF EXISTS trg_ab_guard_attendance_totals ON public.attendance;
DROP TRIGGER IF EXISTS trg_ab_after_break_change ON public.attendance_breaks;
DROP TRIGGER IF EXISTS trg_ab_guard_attendance_breaks ON public.attendance_breaks;

DROP FUNCTION IF EXISTS public.process_stale_tracking();
DROP FUNCTION IF EXISTS public.close_auto_break_for_clock_out(uuid);
DROP FUNCTION IF EXISTS public.geofence_auto_break(text, timestamptz);
DROP FUNCTION IF EXISTS public.report_tracking_event(text, text, integer);
DROP FUNCTION IF EXISTS public.ab_on_live_location();
DROP FUNCTION IF EXISTS public.ab_set_state(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.ab_end_auto_break(uuid, timestamptz, text, jsonb);
DROP FUNCTION IF EXISTS public.ab_start_auto_break(uuid, text, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.ab_notify(uuid, text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.ab_reason_message(text, integer);
DROP FUNCTION IF EXISTS public.ab_guard_attendance_totals();
DROP FUNCTION IF EXISTS public.ab_after_break_change();
DROP FUNCTION IF EXISTS public.ab_guard_attendance_breaks();
DROP FUNCTION IF EXISTS public.ab_recalc_attendance(uuid);
DROP FUNCTION IF EXISTS public.ab_break_totals(uuid);
DROP FUNCTION IF EXISTS public.ab_is_wfh(uuid, date);
DROP FUNCTION IF EXISTS public.ab_shift_end(uuid);
DROP FUNCTION IF EXISTS public.ab_open_attendance(uuid, boolean);
DROP FUNCTION IF EXISTS public.ab_policy();
DROP FUNCTION IF EXISTS public.ab_int(text, integer);
DROP FUNCTION IF EXISTS public.ab_bool(text, boolean);
DROP FUNCTION IF EXISTS public.ab_is_privileged_db_role();
DROP FUNCTION IF EXISTS public.ab_company_date(timestamptz);

DROP INDEX IF EXISTS public.idx_attendance_open_by_date;
DROP TABLE IF EXISTS public.employee_tracking_state;

ALTER TABLE public.attendance_breaks DROP CONSTRAINT IF EXISTS attendance_breaks_source_check;
ALTER TABLE public.attendance_breaks DROP COLUMN IF EXISTS ended_reason;
ALTER TABLE public.attendance_breaks DROP COLUMN IF EXISTS reason;
ALTER TABLE public.attendance_breaks DROP COLUMN IF EXISTS source;

COMMIT;
