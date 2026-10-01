-- 0005_salary_payroll_payslip_schema.sql

-- 1. SALARY STRUCTURES
CREATE TABLE salary_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    effective_from DATE NOT NULL,
    effective_to DATE,
    basic_salary DECIMAL(12,2) NOT NULL CHECK (basic_salary >= 0),
    hra DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (hra >= 0),
    transport_allowance DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (transport_allowance >= 0),
    medical_allowance DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (medical_allowance >= 0),
    special_allowance DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (special_allowance >= 0),
    other_allowances DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
    standard_deduction DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (standard_deduction >= 0),
    overtime_rate_per_hour DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (overtime_rate_per_hour >= 0),
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- 2. PAYROLL
CREATE TABLE payroll (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    payroll_year INTEGER NOT NULL CHECK (payroll_year > 0),
    payroll_month INTEGER NOT NULL CHECK (payroll_month >= 1 AND payroll_month <= 12),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    basic_salary DECIMAL(12,2) NOT NULL CHECK (basic_salary >= 0),
    gross_salary DECIMAL(12,2) NOT NULL CHECK (gross_salary >= 0),
    total_allowances DECIMAL(12,2) NOT NULL CHECK (total_allowances >= 0),
    total_deductions DECIMAL(12,2) NOT NULL CHECK (total_deductions >= 0),
    lop_deduction DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (lop_deduction >= 0),
    overtime_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (overtime_amount >= 0),
    net_salary DECIMAL(12,2) NOT NULL CHECK (net_salary >= 0),
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- DRAFT, CALCULATED, UNDER_REVIEW, APPROVED, PAYMENT_PENDING, PAID, CLOSED
    calculated_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    locked_at TIMESTAMPTZ,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_payroll_period CHECK (period_end >= period_start),
    CONSTRAINT unique_payroll_month UNIQUE (employee_id, payroll_year, payroll_month)
);

-- 3. PAYROLL ITEMS
CREATE TABLE payroll_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_id UUID NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
    item_type VARCHAR(50) NOT NULL, -- EARNING, DEDUCTION
    item_name VARCHAR(255) NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    calculation_basis TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. PAYROLL PAYMENTS
CREATE TABLE payroll_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_id UUID NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
    paid_at TIMESTAMPTZ NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    payment_method VARCHAR(50) NOT NULL, -- BANK_TRANSFER, UPI, CASH, CHEQUE, OTHER
    transaction_reference VARCHAR(255),
    remarks TEXT,
    paid_by UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. PAYSLIPS
CREATE TABLE payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_id UUID NOT NULL REFERENCES payroll(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    payslip_number VARCHAR(255) UNIQUE NOT NULL,
    payslip_period VARCHAR(255) NOT NULL,
    file_url TEXT,
    generated_at TIMESTAMPTZ,
    generated_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TIMESTAMPS TRIGGERS
CREATE TRIGGER update_salary_structures_updated_at BEFORE UPDATE ON salary_structures FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_payroll_updated_at BEFORE UPDATE ON payroll FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_payroll_items_updated_at BEFORE UPDATE ON payroll_items FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_payroll_payments_updated_at BEFORE UPDATE ON payroll_payments FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_payslips_updated_at BEFORE UPDATE ON payslips FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- INDEXES
CREATE INDEX idx_salary_structures_employee ON salary_structures(employee_id);
CREATE INDEX idx_salary_structures_effective_from ON salary_structures(effective_from);
CREATE INDEX idx_salary_structures_active ON salary_structures(is_active);

CREATE INDEX idx_payroll_employee ON payroll(employee_id);
CREATE INDEX idx_payroll_year ON payroll(payroll_year);
CREATE INDEX idx_payroll_month ON payroll(payroll_month);
CREATE INDEX idx_payroll_status ON payroll(status);

CREATE INDEX idx_payroll_items_payroll ON payroll_items(payroll_id);
CREATE INDEX idx_payroll_items_type ON payroll_items(item_type);

CREATE INDEX idx_payroll_payments_payroll ON payroll_payments(payroll_id);
CREATE INDEX idx_payroll_payments_paid_at ON payroll_payments(paid_at);
CREATE INDEX idx_payroll_payments_reference ON payroll_payments(transaction_reference);

CREATE INDEX idx_payslips_payroll ON payslips(payroll_id);
CREATE INDEX idx_payslips_employee ON payslips(employee_id);
CREATE INDEX idx_payslips_number ON payslips(payslip_number);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read salary_structures" ON salary_structures FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read payroll" ON payroll FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read payroll_items" ON payroll_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read payroll_payments" ON payroll_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to read payslips" ON payslips FOR SELECT TO authenticated USING (true);

