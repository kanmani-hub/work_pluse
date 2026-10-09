-- =====================================================================================
-- PROPOSED — NOT APPLIED. Do NOT run without approval.
-- WorkPulse HR: Employee real-time notifications — database changes
-- Source: 0008_notifications_audit_schema.sql, 0009_security_hardening.sql,
--         20261003115000_enable_realtime_location.sql
-- Verify the live database first:
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--   SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'notifications';
-- =====================================================================================

-- N1 (BLOCKER for "real time") — notifications is NOT in the supabase_realtime publication
--   (only app_settings, employee_live_locations, attendance, … were added). Without this,
--   no INSERT/UPDATE event is ever sent: the bell only updates on page load, tab focus or
--   reconnect (the app now refetches then), never instantly. Non-destructive.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
-- Realtime postgres_changes respects RLS ("View notifications"): employee A never receives B's rows.

BEGIN;

-- N2 (BUG) — no DELETE policy: "Clear read" in the bell/Notifications page deletes nothing
--   (RLS silently matches 0 rows). Allow deleting only your own READ notifications.
DROP POLICY IF EXISTS "Delete own read notifications" ON notifications;
CREATE POLICY "Delete own read notifications" ON notifications FOR DELETE TO authenticated
USING (recipient_employee_id = public.get_auth_employee_id() AND is_read = true);

-- N3 (DUPLICATES, race-safe) — one notification per (recipient, dedupe_key).
--   The app already checks before inserting and treats 23505 as "already sent"; this index
--   makes two simultaneous inserts (two admin tabs) impossible. Pre-check (must return 0 rows):
--   SELECT recipient_employee_id, metadata->>'dedupe_key', COUNT(*) FROM notifications
--   WHERE metadata ? 'dedupe_key' GROUP BY 1, 2 HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_dedupe
  ON notifications (recipient_employee_id, (metadata->>'dedupe_key'))
  WHERE metadata ? 'dedupe_key';

-- N4 (SECURITY) — "Insert notifications" is WITH CHECK (true): any signed-in employee can
--   create a notification in ANY other employee's (or admin's) inbox, e.g. a fake
--   "Leave Approved" / "Salary Paid". Fix: employees may only insert for themselves
--   (automatic break, password change); admin/HR for anyone; employee→admin alerts
--   (new leave/WFH/permission request, geofence alerts) go through a SECURITY DEFINER
--   function that only targets ADMIN/HR recipients.
CREATE OR REPLACE FUNCTION public.notify_admins(
  p_type TEXT, p_title TEXT, p_message TEXT, p_priority TEXT DEFAULT 'NORMAL',
  p_action_url TEXT DEFAULT NULL, p_entity_type TEXT DEFAULT NULL, p_entity_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  INSERT INTO notifications (recipient_employee_id, notification_type, title, message, priority, action_url, entity_type, entity_id, metadata)
  SELECT e.id, p_type, p_title, p_message, COALESCE(p_priority, 'NORMAL'), p_action_url, p_entity_type, p_entity_id,
         COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('from_employee_id', public.get_auth_employee_id())
  FROM employees e JOIN roles r ON r.id = e.role_id
  WHERE r.name IN ('ADMIN', 'HR') AND e.status = 'ACTIVE' AND e.id IS DISTINCT FROM public.get_auth_employee_id();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) TO authenticated;

-- Apply the policy below ONLY after notificationService.notifyAdmins / notifyGeofenceEvent
-- call supabase.rpc('notify_admins', …) instead of inserting directly (code change pending
-- approval), otherwise employee → admin alerts stop.
-- DROP POLICY IF EXISTS "Insert notifications" ON notifications;
-- CREATE POLICY "Insert notifications" ON notifications FOR INSERT TO authenticated
-- WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR recipient_employee_id = public.get_auth_employee_id());

-- N5 (HARDENING) — employees may only flip read state on their own rows (not edit text/recipient)
CREATE OR REPLACE FUNCTION public.notifications_update_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_auth_role() IN ('ADMIN', 'HR') THEN RETURN NEW; END IF;
  IF NEW.recipient_employee_id IS DISTINCT FROM OLD.recipient_employee_id
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.notification_type IS DISTINCT FROM OLD.notification_type OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'Only the read state of a notification can be changed.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notifications_update_guard ON notifications;
CREATE TRIGGER notifications_update_guard BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION public.notifications_update_guard();

COMMIT;

-- VERIFIED OK (no change needed):
--   SELECT: ADMIN/HR or recipient_employee_id = get_auth_employee_id() → A cannot read B's.
--   UPDATE: USING recipient = own; WITH CHECK defaults to the same → A cannot update B's
--           rows or move a notification to another recipient.
