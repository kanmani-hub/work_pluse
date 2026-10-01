-- 0003_attendance_break_schema.sql

-- 1. ATTENDANCE TABLE
CREATE TABLE attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    shift_template_id UUID REFERENCES shift_templates(id) ON DELETE RESTRICT,
    shift_assignment_id UUID REFERENCES shift_assignments(id) ON DELETE RESTRICT,
    roster_assignment_id UUID REFERENCES roster_assignments(id) ON DELETE RESTRICT,
    attendance_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ,
    clock_out_at TIMESTAMPTZ,
    required_hours DECIMAL(5,2) NOT NULL CHECK (required_hours >= 0),
    worked_hours DECIMAL(5,2) CHECK (worked_hours IS NULL OR worked_hours >= 0),
    break_minutes INTEGER DEFAULT 0 CHECK (break_minutes >= 0),
    status VARCHAR(50) NOT NULL, -- PRESENT, ABSENT, LATE, HALF_DAY, ON_LEAVE, WFH, HOLIDAY, WEEKLY_OFF, EARLY_LOGOUT
    late_minutes INTEGER DEFAULT 0 CHECK (late_minutes >= 0),
    early_logout_minutes INTEGER DEFAULT 0 CHECK (early_logout_minutes >= 0),
    is_half_day BOOLEAN DEFAULT false,
    is_auto_logged_out BOOLEAN DEFAULT false,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_attendance_per_day UNIQUE (employee_id, attendance_date),
    CONSTRAINT valid_clock_times CHECK (clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at)
);

-- 2. ATTENDANCE BREAKS TABLE
CREATE TABLE attendance_breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    break_type VARCHAR(50) NOT NULL, -- REGULAR, LUNCH, PERSONAL, OTHER
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_break_times CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- 3. ATTENDANCE EVENTS TABLE (Immutable log)
CREATE TABLE attendance_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    event_type VARCHAR(50) NOT NULL, -- CLOCK_IN, CLOCK_OUT, BREAK_START, BREAK_END, AUTO_LOGOUT, ATTENDANCE_CORRECTION
    event_at TIMESTAMPTZ NOT NULL,
    source VARCHAR(50) NOT NULL, -- WEB, MOBILE, SYSTEM, ADMIN
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TIMESTAMPS TRIGGERS
CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_attendance_breaks_updated_at BEFORE UPDATE ON attendance_breaks FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- INDEXES
CREATE INDEX idx_attendance_employee ON attendance(employee_id);
CREATE INDEX idx_attendance_date ON attendance(attendance_date);
CREATE INDEX idx_attendance_status ON attendance(status);
CREATE INDEX idx_attendance_template ON attendance(shift_template_id);
CREATE INDEX idx_attendance_shift_assignment ON attendance(shift_assignment_id);

CREATE INDEX idx_attendance_breaks_attendance ON attendance_breaks(attendance_id);
CREATE INDEX idx_attendance_breaks_employee ON attendance_breaks(employee_id);
CREATE INDEX idx_attendance_breaks_started ON attendance_breaks(started_at);

CREATE INDEX idx_attendance_events_attendance ON attendance_events(attendance_id);
CREATE INDEX idx_attendance_events_employee ON attendance_events(employee_id);
CREATE INDEX idx_attendance_events_event_at ON attendance_events(event_at);
CREATE INDEX idx_attendance_events_type ON attendance_events(event_type);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read attendance" ON attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read attendance breaks" ON attendance_breaks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read attendance events" ON attendance_events FOR SELECT TO authenticated USING (true);

