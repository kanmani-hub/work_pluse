-- 0002_shift_roster_schema.sql

-- 1. SHIFT TEMPLATES
CREATE TABLE shift_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    shift_type VARCHAR(50) NOT NULL, -- MORNING, GENERAL, EVENING, NIGHT, SPECIAL
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    crosses_midnight BOOLEAN DEFAULT false,
    required_hours DECIMAL(5,2) NOT NULL CHECK (required_hours >= 0),
    break_duration_minutes INTEGER DEFAULT 60 CHECK (break_duration_minutes >= 0),
    grace_period_minutes INTEGER DEFAULT 15 CHECK (grace_period_minutes >= 0),
    late_threshold_minutes INTEGER DEFAULT 15 CHECK (late_threshold_minutes >= 0),
    early_logout_threshold_minutes INTEGER DEFAULT 15 CHECK (early_logout_threshold_minutes >= 0),
    auto_logout_enabled BOOLEAN DEFAULT false,
    auto_logout_after_minutes INTEGER CHECK (auto_logout_after_minutes IS NULL OR auto_logout_after_minutes >= 0),
    is_wfh_allowed BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. SHIFT ASSIGNMENTS
CREATE TABLE shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    shift_template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE RESTRICT,
    effective_date DATE NOT NULL,
    end_date DATE,
    assignment_type VARCHAR(50) NOT NULL, -- PERMANENT, TEMPORARY, ROSTER
    notes TEXT,
    assigned_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_date_range CHECK (end_date IS NULL OR end_date >= effective_date)
);

-- 3. ROSTERS
CREATE TABLE rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'DRAFT', -- DRAFT, PUBLISHED, ARCHIVED
    created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_roster_date_range CHECK (end_date >= start_date)
);

-- 4. ROSTER ASSIGNMENTS
CREATE TABLE roster_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roster_id UUID NOT NULL REFERENCES rosters(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    shift_template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE RESTRICT,
    assignment_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TIMESTAMPS TRIGGERS
CREATE TRIGGER update_shift_templates_updated_at BEFORE UPDATE ON shift_templates FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_shift_assignments_updated_at BEFORE UPDATE ON shift_assignments FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_rosters_updated_at BEFORE UPDATE ON rosters FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_roster_assignments_updated_at BEFORE UPDATE ON roster_assignments FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- INDEXES
CREATE INDEX idx_shift_templates_code ON shift_templates(code);
CREATE INDEX idx_shift_templates_type ON shift_templates(shift_type);
CREATE INDEX idx_shift_templates_active ON shift_templates(is_active);

CREATE INDEX idx_shift_assignments_employee ON shift_assignments(employee_id);
CREATE INDEX idx_shift_assignments_dates ON shift_assignments(effective_date, end_date);
CREATE INDEX idx_shift_assignments_template ON shift_assignments(shift_template_id);

CREATE INDEX idx_roster_assignments_roster ON roster_assignments(roster_id);
CREATE INDEX idx_roster_assignments_employee ON roster_assignments(employee_id);
CREATE INDEX idx_roster_assignments_date ON roster_assignments(assignment_date);
CREATE INDEX idx_roster_assignments_template ON roster_assignments(shift_template_id);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read shift_templates" ON shift_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read shift_assignments" ON shift_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read rosters" ON rosters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read roster_assignments" ON roster_assignments FOR SELECT TO authenticated USING (true);

-- SEED DATA
INSERT INTO shift_templates (
    name, code, shift_type, start_time, end_time, crosses_midnight, 
    required_hours, break_duration_minutes, grace_period_minutes
) VALUES 
(
    'General Shift', 'GEN', 'GENERAL', '09:00:00', '18:00:00', false, 
    8.00, 60, 15
),
(
    'Morning Shift', 'MORN', 'MORNING', '08:00:00', '17:00:00', false, 
    8.00, 60, 15
),
(
    'Evening Shift', 'EVE', 'EVENING', '14:00:00', '23:00:00', false, 
    8.00, 60, 15
),
(
    'Night Shift', 'NIGHT', 'NIGHT', '22:00:00', '07:00:00', true, 
    8.00, 60, 15
);

