-- Rollback of 20261022090400_remove_email_admin_provisioning.sql
-- NOT RECOMMENDED: the removed trigger linked the ADMIN profile to any new auth user named admin@gmail.com.
-- To restore it, re-run the trigger/function section of
--   supabase/migrations/20260930163000_restore_admin_profile.sql
-- The search_path pin on trigger_push_notification_webhook() is harmless and is not reverted.
SELECT 'see comments: restore from 20260930163000_restore_admin_profile.sql if really required' AS note;
