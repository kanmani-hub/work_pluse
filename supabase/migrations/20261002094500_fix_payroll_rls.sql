-- 20261002094500_fix_payroll_rls.sql

-- Drop existing generic SELECT policies
DROP POLICY IF EXISTS "Allow authenticated users to read payroll" ON payroll;
DROP POLICY IF EXISTS "Allow authenticated users to read payroll_items" ON payroll_items;
DROP POLICY IF EXISTS "Allow authenticated users to read payroll_payments" ON payroll_payments;
DROP POLICY IF EXISTS "Allow authenticated users to read payslips" ON payslips;

-- Create stricter policies for payroll
CREATE POLICY "Employee can view own payroll or Admin can view all" ON payroll 
FOR SELECT TO authenticated USING (
    employee_id IN (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid())
    OR get_auth_role() = 'Admin'
);

CREATE POLICY "Employee can view own payroll items or Admin can view all" ON payroll_items 
FOR SELECT TO authenticated USING (
    payroll_id IN (
        SELECT id FROM payroll WHERE employee_id IN (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid())
    )
    OR get_auth_role() = 'Admin'
);

CREATE POLICY "Employee can view own payroll payments or Admin can view all" ON payroll_payments 
FOR SELECT TO authenticated USING (
    payroll_id IN (
        SELECT id FROM payroll WHERE employee_id IN (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid())
    )
    OR get_auth_role() = 'Admin'
);

CREATE POLICY "Employee can view own payslips or Admin can view all" ON payslips 
FOR SELECT TO authenticated USING (
    employee_id IN (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid())
    OR get_auth_role() = 'Admin'
);

-- Allow employees to read audit_logs related to their own payroll
CREATE POLICY "Employees can view own payroll audit logs" ON audit_logs 
FOR SELECT TO authenticated USING (
    module = 'PAYROLL' AND 
    entity_type = 'payroll' AND 
    entity_id IN (
        SELECT id FROM payroll WHERE employee_id IN (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid())
    )
);

-- Insert policies for audit_logs (so backend can write to it as service role or admin, but let's allow authenticated to insert for now, constrained to PAYROLL module is usually handled by service layer, but let's just make it secure if needed)
-- Actually, inserting audit_logs is typically done with service_role or from Postgres triggers.
-- Let's allow authenticated users to insert if they are admins, or if it's their own action.
CREATE POLICY "Authenticated users can insert audit logs" ON audit_logs 
FOR INSERT TO authenticated WITH CHECK (
    actor_employee_id IN (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid())
    OR get_auth_role() = 'Admin'
);

-- We also need a payroll_adjustments concept, but wait, `payroll_items` handles earnings and deductions.
-- "If Admin adds a payroll adjustment: The audit record must store: adjustment_type, amount, description..."
-- We can just store this in `payroll_items` and add an audit_log!
