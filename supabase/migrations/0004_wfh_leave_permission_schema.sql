-- 0004_wfh_leave_permission_schema.sql

-- 1. WFH REQUESTS
CREATE TABLE wfh_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    request_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, CANCELLED
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reviewer_remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_wfh_per_day UNIQUE (employee_id, request_date)
);

-- 2. LEAVE TYPES
CREATE TABLE leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    annual_allocation DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (annual_allocation >= 0),
    carry_forward_allowed BOOLEAN NOT NULL DEFAULT false,
    max_carry_forward_days DECIMAL(5,2) CHECK (max_carry_forward_days IS NULL OR max_carry_forward_days >= 0),
    requires_document BOOLEAN NOT NULL DEFAULT false,
    is_paid BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. LEAVE BALANCES
CREATE TABLE leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
    year INTEGER NOT NULL,
    allocated_days DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (allocated_days >= 0),
    used_days DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
    pending_days DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (pending_days >= 0),
    remaining_days DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (remaining_days >= 0),
    carry_forward_days DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (carry_forward_days >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_leave_balance UNIQUE (employee_id, leave_type_id, year)
);

-- 4. LEAVE REQUESTS
CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days DECIMAL(5,2) NOT NULL CHECK (total_days >= 0),
    is_half_day BOOLEAN NOT NULL DEFAULT false,
    half_day_type VARCHAR(50), -- FIRST_HALF, SECOND_HALF
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, CANCELLED
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reviewer_remarks TEXT,
    attachment_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_leave_dates CHECK (end_date >= start_date),
    CONSTRAINT valid_half_day CHECK (
        (is_half_day = false AND half_day_type IS NULL) OR 
        (is_half_day = true AND half_day_type IN ('FIRST_HALF', 'SECOND_HALF'))
    )
);

-- 5. PERMISSION REQUESTS
CREATE TABLE permission_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    permission_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
    reason TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, CANCELLED
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    reviewer_remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_permission_times CHECK (end_time > start_time)
);

-- TIMESTAMPS TRIGGERS
CREATE TRIGGER update_wfh_requests_updated_at BEFORE UPDATE ON wfh_requests FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_leave_types_updated_at BEFORE UPDATE ON leave_types FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_leave_balances_updated_at BEFORE UPDATE ON leave_balances FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_leave_requests_updated_at BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_permission_requests_updated_at BEFORE UPDATE ON permission_requests FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- INDEXES
CREATE INDEX idx_wfh_requests_employee ON wfh_requests(employee_id);
CREATE INDEX idx_wfh_requests_date ON wfh_requests(request_date);
CREATE INDEX idx_wfh_requests_status ON wfh_requests(status);

CREATE INDEX idx_leave_balances_employee ON leave_balances(employee_id);
CREATE INDEX idx_leave_balances_type ON leave_balances(leave_type_id);
CREATE INDEX idx_leave_balances_year ON leave_balances(year);

CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_type ON leave_requests(leave_type_id);
CREATE INDEX idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);

CREATE INDEX idx_permission_requests_employee ON permission_requests(employee_id);
CREATE INDEX idx_permission_requests_date ON permission_requests(permission_date);
CREATE INDEX idx_permission_requests_status ON permission_requests(status);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE wfh_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read wfh_requests" ON wfh_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read leave_types" ON leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read leave_balances" ON leave_balances FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read leave_requests" ON leave_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read permission_requests" ON permission_requests FOR SELECT TO authenticated USING (true);

-- SEED DATA
INSERT INTO leave_types (name, code, description, annual_allocation, carry_forward_allowed, max_carry_forward_days, requires_document, is_paid) VALUES
('Casual Leave', 'CL', 'Standard casual leave', 12.00, false, NULL, false, true),
('Sick Leave', 'SL', 'Medical and sick leave', 12.00, false, NULL, true, true),
('Earned Leave', 'EL', 'Accrued annual earned leave', 15.00, true, 30.00, false, true),
('Loss of Pay', 'LOP', 'Unpaid leave', 0.00, false, NULL, false, false);

