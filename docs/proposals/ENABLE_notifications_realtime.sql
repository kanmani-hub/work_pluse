-- =====================================================================================
-- N1 from docs/security/PROPOSED_notifications.sql — enable live notification events.
-- Non-destructive: only adds the table to Supabase's Realtime publication.
-- Employees still receive ONLY their own rows (RLS "View notifications" applies to
-- Realtime, and the app subscribes with recipient_employee_id=eq.<own employee id>).
-- =====================================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

SELECT EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications')
       AS notifications_realtime_enabled;  -- expect: true
