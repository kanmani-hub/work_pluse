-- 20261002062000_create_app_settings.sql

CREATE TABLE IF NOT EXISTS public.app_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all authenticated users" 
ON public.app_settings FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Enable update for admins only" 
ON public.app_settings FOR UPDATE 
TO authenticated 
USING (get_auth_role() = 'ADMIN')
WITH CHECK (get_auth_role() = 'ADMIN');

CREATE POLICY "Enable insert for admins only" 
ON public.app_settings FOR INSERT 
TO authenticated 
WITH CHECK (get_auth_role() = 'ADMIN');

-- Insert default row if not exists
INSERT INTO public.app_settings (id, settings)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '{
      "appName": "WorkPulse HR",
      "timezone": "Asia/Kolkata (IST)",
      "dateFormat": "DD/MM/YYYY",
      "timeFormat": "12 Hour",
      "currency": "INR (₹)",
      "weekStartsOn": "Monday",
      "theme": "Light",
      "companyName": "Acme Corp",
      "companyEmail": "hr@acme.com",
      "companyPhone": "1800-123-4567",
      "companyAddress": "123 Tech Park, City",
      "website": "www.acme.com",
      "workStartTime": "09:00 AM",
      "workEndTime": "06:00 PM",
      "workingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "weeklyOff": ["Saturday", "Sunday"],
      "requireFaceVerification": true,
      "requireGeolocation": true,
      "lateLoginDetection": true,
      "earlyLogoutDetection": true,
      "gracePeriodMins": 0,
      "autoClockOut": true,
      "allowCorrection": true,
      "breakEnabled": true,
      "breakDurationMins": 60,
      "maxBreakDurationMins": 90,
      "defaultShift": "General Shift",
      "shiftGracePeriodMins": 0,
      "leaveApprovalRequired": true,
      "allowPastDateLeave": false,
      "allowNegativeBalance": false,
      "wfhEnabled": true,
      "wfhMaxDaysPerMonth": 4,
      "wfhApprovalRequired": true,
      "permissionEnabled": true,
      "permissionMaxHours": 2,
      "permissionApprovalRequired": true,
      "geofenceEnabled": true,
      "defaultRadiusMeters": 200,
      "locationAccuracy": "High",
      "allowOutsideClockIn": false
    }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_app_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_app_settings_updated_at_trigger ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at_trigger
BEFORE UPDATE ON public.app_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_app_settings_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE app_settings;
