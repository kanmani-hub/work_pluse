-- =============================================================================================
-- 20261022090200_notification_integrity.sql
-- Notifications cannot be forged into another person's inbox (QA finding S-06b) — based on
-- docs/security/PROPOSED_notifications.sql (N4, N5).
--
-- Before: "Insert notifications" (0009) is WITH CHECK (true): any signed-in employee could put a fake
-- "Leave approved" / "Salary paid" / "Reset your password" message into any employee's or admin's inbox.
-- Employees could also rewrite the text of their own notifications.
--
-- After:
--   * Direct INSERT: ADMIN / HR for anyone; everyone else only for themselves.
--   * Employee -> admin alerts (new leave / WFH / permission / overtime request, geofence alerts) go through
--     public.notify_admins(): it can only target active ADMIN/HR accounts, only with the request/alert
--     notification types, and it stamps the sender (metadata.from_employee_id) from the session.
--     The same entity (e.g. one geofence event or one request) is announced only once.
--   * Employees may change only the read state of their own notifications.
-- Requires the matching app change: notificationService.notifyAdmins / notifyGeofenceEvent call
-- supabase.rpc('notify_admins', ...) instead of inserting rows for other people.
-- Rollback: supabase/rollbacks/20261022090200_notification_integrity.rollback.sql
-- =============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_admins(
  p_type TEXT, p_title TEXT, p_message TEXT, p_priority TEXT DEFAULT 'NORMAL',
  p_action_url TEXT DEFAULT NULL, p_entity_type TEXT DEFAULT NULL, p_entity_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me uuid := public.get_auth_employee_id();
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('LEAVE', 'WFH', 'PERMISSION', 'OVERTIME', 'GEOFENCE', 'ATTENDANCE') THEN
    RAISE EXCEPTION 'Notification type % cannot be sent to administrators', p_type USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(p_title, '')) = 0 OR length(p_title) > 200 OR length(COALESCE(p_message, '')) = 0 OR length(p_message) > 2000 THEN
    RAISE EXCEPTION 'Title and message are required (title <= 200, message <= 2000 characters)' USING ERRCODE = '22023';
  END IF;
  -- the same event (same entity) is announced once: a retry or a second browser tab sends nothing new
  IF p_entity_id IS NOT NULL AND EXISTS (SELECT 1 FROM notifications n WHERE n.entity_id = p_entity_id
       AND n.notification_type = p_type AND n.metadata->>'from_employee_id' = v_me::text) THEN
    RETURN 0;
  END IF;
  INSERT INTO notifications (recipient_employee_id, notification_type, title, message, priority, action_url, entity_type, entity_id, metadata)
  SELECT e.id, p_type, p_title, p_message,
         CASE WHEN p_priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT') THEN p_priority ELSE 'NORMAL' END,
         p_action_url, p_entity_type, p_entity_id,
         COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('from_employee_id', v_me)
  FROM employees e
  JOIN profiles p ON p.employee_id = e.id AND p.is_active = true
  JOIN roles r ON r.id = p.role_id
  WHERE r.name IN ('ADMIN', 'HR') AND upper(e.status) = 'ACTIVE' AND e.id <> v_me;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) TO authenticated;

DROP POLICY IF EXISTS "Insert notifications" ON public.notifications;
CREATE POLICY "Insert notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR recipient_employee_id = public.get_auth_employee_id());

CREATE OR REPLACE FUNCTION public.notifications_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin')
     OR COALESCE(public.get_auth_role(), '') IN ('ADMIN', 'HR') THEN
    RETURN NEW;
  END IF;
  IF NEW.recipient_employee_id IS DISTINCT FROM OLD.recipient_employee_id
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.notification_type IS DISTINCT FROM OLD.notification_type OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Only the read state of a notification can be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notifications_update_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notifications_update_guard ON public.notifications;
CREATE TRIGGER notifications_update_guard BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_update_guard();

COMMIT;
