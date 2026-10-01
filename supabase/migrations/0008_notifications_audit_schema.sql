-- 0008_notifications_audit_schema.sql

-- 1. NOTIFICATIONS
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL, -- ATTENDANCE, LATE_LOGIN, LEAVE, etc.
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(50) NOT NULL DEFAULT 'NORMAL', -- LOW, NORMAL, HIGH, URGENT
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    action_url TEXT,
    entity_type VARCHAR(100),
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    CONSTRAINT valid_read_state CHECK (
        (is_read = false AND read_at IS NULL) OR 
        (is_read = true AND read_at IS NOT NULL)
    ),
    CONSTRAINT not_empty_title CHECK (trim(title) <> ''),
    CONSTRAINT not_empty_message CHECK (trim(message) <> '')
);

-- 2. AUDIT LOGS
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL, -- CREATE, UPDATE, DELETE, etc.
    module VARCHAR(100) NOT NULL, -- AUTH, EMPLOYEE, ATTENDANCE, etc.
    entity_type VARCHAR(100),
    entity_id UUID,
    description TEXT,
    old_values JSONB,
    new_values JSONB,
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    source VARCHAR(50) NOT NULL DEFAULT 'SYSTEM', -- WEB, MOBILE, ADMIN, SYSTEM, API
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT not_empty_action CHECK (trim(action) <> ''),
    CONSTRAINT not_empty_module CHECK (trim(module) <> '')
);

-- INDEXES
CREATE INDEX idx_notifications_recipient ON notifications(recipient_employee_id);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_priority ON notifications(priority);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
CREATE INDEX idx_notifications_expires_at ON notifications(expires_at);
CREATE INDEX idx_notifications_entity ON notifications(entity_type, entity_id);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_employee_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_module ON audit_logs(module);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_source ON audit_logs(source);
CREATE INDEX idx_audit_logs_entity_history ON audit_logs(entity_type, entity_id, created_at);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Baseline: Employees can read their own notifications
CREATE POLICY "Employees can view own notifications" ON notifications 
FOR SELECT TO authenticated USING (
  recipient_employee_id IN (
    SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid()
  )
);

-- Baseline: Admins can read audit logs. No universal read access.
CREATE POLICY "Admins can view audit logs" ON audit_logs 
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM profiles
    JOIN roles ON profiles.role_id = roles.id
    WHERE profiles.auth_user_id = auth.uid() AND roles.name = 'Admin'
  )
);

