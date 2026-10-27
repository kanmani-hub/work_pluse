-- Rollback of 20261022090200_notification_integrity.sql
-- WARNING: re-opens QA finding S-06b (any employee can write into anyone's inbox).
-- Roll back the app first only if the app version calling rpc('notify_admins') is also rolled back;
-- the RPC is harmless to keep, so this rollback leaves notify_admins() in place.
BEGIN;
DROP TRIGGER IF EXISTS notifications_update_guard ON public.notifications;
DROP FUNCTION IF EXISTS public.notifications_update_guard();
DROP POLICY IF EXISTS "Insert notifications" ON public.notifications;
CREATE POLICY "Insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);
COMMIT;
