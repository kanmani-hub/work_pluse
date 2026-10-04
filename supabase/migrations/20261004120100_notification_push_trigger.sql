-- Migration: Create Webhook trigger for Push Notifications
-- This securely bridges the public.notifications table (SINGLE SOURCE OF TRUTH) 
-- to the send-push-notification Edge Function asynchronously.

-- NOTE: This migration requires pg_net to be enabled.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION trigger_push_notification_webhook()
RETURNS TRIGGER AS $$
DECLARE
  edge_function_url TEXT;
  service_role_key TEXT;
  payload JSONB;
BEGIN
  -- We fetch these dynamically from the database config or vault if available.
  -- Alternatively, rely on the Supabase Dashboard Webhooks UI to manage this without code.
  
  -- Hardcoding localhost for local dev or project ref for prod is discouraged in raw SQL without knowing the environment.
  -- The instruction requires us to document if manual config is required.
  -- MANUAL ACTION REQUIRED: The user must configure the Edge Function URL if using pg_net directly.
  
  -- We construct the JSON payload
  payload := jsonb_build_object(
    'type', 'INSERT',
    'table', 'notifications',
    'record', row_to_json(NEW)
  );

  -- We attempt to read settings, otherwise fallback to empty (will fail silently in net.http_post).
  edge_function_url := current_setting('app.settings.edge_function_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);

  IF edge_function_url IS NOT NULL AND service_role_key IS NOT NULL THEN
    PERFORM net.http_post(
        url := edge_function_url || '/send-push-notification',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || service_role_key
        ),
        body := payload
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notifications_push
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION trigger_push_notification_webhook();
