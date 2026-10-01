-- 0006_face_security_schema.sql

-- 1. FACE REGISTRATIONS
CREATE TABLE face_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    registration_status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, REGISTERED, REVOKED, FAILED
    registered_at TIMESTAMPTZ,
    registered_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    provider VARCHAR(255),
    provider_reference VARCHAR(255),
    consent_recorded_at TIMESTAMPTZ,
    consent_version VARCHAR(50),
    last_verified_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique index to ensure only one active registration per employee
CREATE UNIQUE INDEX unique_active_face_registration ON face_registrations (employee_id) WHERE is_active = true;

-- 2. FACE VERIFICATION EVENTS
CREATE TABLE face_verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    face_registration_id UUID REFERENCES face_registrations(id) ON DELETE SET NULL,
    attendance_id UUID REFERENCES attendance(id) ON DELETE SET NULL,
    verification_type VARCHAR(50) NOT NULL, -- CLOCK_IN, CLOCK_OUT, REGISTRATION, RE_REGISTRATION
    result VARCHAR(50) NOT NULL, -- SUCCESS, FAILED, REJECTED, ERROR
    verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confidence_score DECIMAL(10,4) CHECK (confidence_score IS NULL OR confidence_score >= 0),
    provider VARCHAR(255),
    provider_reference VARCHAR(255),
    failure_reason TEXT,
    source VARCHAR(50) NOT NULL, -- WEB, MOBILE, ADMIN, SYSTEM
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TIMESTAMPS TRIGGERS
CREATE TRIGGER update_face_registrations_updated_at BEFORE UPDATE ON face_registrations FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- INDEXES
CREATE INDEX idx_face_registrations_employee ON face_registrations(employee_id);
CREATE INDEX idx_face_registrations_status ON face_registrations(registration_status);
CREATE INDEX idx_face_registrations_active ON face_registrations(is_active);

CREATE INDEX idx_face_verification_events_employee ON face_verification_events(employee_id);
CREATE INDEX idx_face_verification_events_registration ON face_verification_events(face_registration_id);
CREATE INDEX idx_face_verification_events_attendance ON face_verification_events(attendance_id);
CREATE INDEX idx_face_verification_events_type ON face_verification_events(verification_type);
CREATE INDEX idx_face_verification_events_result ON face_verification_events(result);
CREATE INDEX idx_face_verification_events_verified_at ON face_verification_events(verified_at);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE face_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_verification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read face_registrations" ON face_registrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read face_verification_events" ON face_verification_events FOR SELECT TO authenticated USING (true);

