-- Migration: Create notification_devices table for Push Notifications

CREATE TABLE IF NOT EXISTS public.notification_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT NOT NULL,
    app_version TEXT,
    device_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_notification_devices_employee_id ON public.notification_devices(employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_devices_token_unique ON public.notification_devices(token);

-- Row Level Security (RLS)
ALTER TABLE public.notification_devices ENABLE ROW LEVEL SECURITY;

-- Employees can read their own devices
CREATE POLICY "Employees can read their own devices"
    ON public.notification_devices
    FOR SELECT
    USING (auth.uid() = employee_id);

-- Employees can insert their own devices
CREATE POLICY "Employees can insert their own devices"
    ON public.notification_devices
    FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- Employees can update their own devices
CREATE POLICY "Employees can update their own devices"
    ON public.notification_devices
    FOR UPDATE
    USING (auth.uid() = employee_id)
    WITH CHECK (auth.uid() = employee_id);

-- Employees can delete their own devices
CREATE POLICY "Employees can delete their own devices"
    ON public.notification_devices
    FOR DELETE
    USING (auth.uid() = employee_id);

-- Admin/HR access policies
CREATE POLICY "Admins and HR can read all devices"
    ON public.notification_devices
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            JOIN public.roles r ON p.role_id = r.id
            WHERE p.id = auth.uid() 
            AND r.name IN ('ADMIN', 'HR', 'HR/Staff')
            AND p.is_active = true
        )
    );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_notification_devices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notification_devices_updated_at
BEFORE UPDATE ON public.notification_devices
FOR EACH ROW
EXECUTE FUNCTION update_notification_devices_updated_at();

-- Grant privileges to service_role so Edge Functions can read/write freely
GRANT ALL ON TABLE public.notification_devices TO service_role;
