-- 1. Helper Functions to resolve identity
CREATE OR REPLACE FUNCTION public.get_auth_employee_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT employee_id 
  FROM profiles 
  WHERE auth_user_id = auth.uid() 
    AND is_active = true 
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.name 
  FROM profiles p
  JOIN roles r ON p.role_id = r.id
  WHERE p.auth_user_id = auth.uid() 
    AND p.is_active = true 
  LIMIT 1;
$$;

-- 2. Clean up Generic Policies & Re-apply Strict Policies

-- SALARY / PAYROLL
DROP POLICY IF EXISTS "Allow authenticated users to read salary_structures" ON salary_structures;
CREATE POLICY "View salary_structures" ON salary_structures FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Manage salary_structures" ON salary_structures FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

DROP POLICY IF EXISTS "Allow authenticated users to read payroll" ON payroll;
CREATE POLICY "View payroll" ON payroll FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Manage payroll" ON payroll FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

DROP POLICY IF EXISTS "Allow authenticated users to read payroll_items" ON payroll_items;
CREATE POLICY "View payroll_items" ON payroll_items FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR payroll_id IN (SELECT id FROM payroll WHERE employee_id = public.get_auth_employee_id()));
CREATE POLICY "Manage payroll_items" ON payroll_items FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

DROP POLICY IF EXISTS "Allow authenticated users to read payroll_payments" ON payroll_payments;
CREATE POLICY "View payroll_payments" ON payroll_payments FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR payroll_id IN (SELECT id FROM payroll WHERE employee_id = public.get_auth_employee_id()));
CREATE POLICY "Manage payroll_payments" ON payroll_payments FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

DROP POLICY IF EXISTS "Allow authenticated users to read payslips" ON payslips;
CREATE POLICY "View payslips" ON payslips FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Manage payslips" ON payslips FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

-- FACE SECURITY
DROP POLICY IF EXISTS "Allow authenticated users to read face_registrations" ON face_registrations;
CREATE POLICY "View face_registrations" ON face_registrations FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Manage face_registrations" ON face_registrations FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

DROP POLICY IF EXISTS "Allow authenticated users to read face_verification_events" ON face_verification_events;
CREATE POLICY "View face_verification_events" ON face_verification_events FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert own face_verification_events" ON face_verification_events FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

-- LOCATION & GEOFENCE
DROP POLICY IF EXISTS "Allow authenticated users to read location_verification_events" ON location_verification_events;
CREATE POLICY "View location_verification_events" ON location_verification_events FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert own location_verification_events" ON location_verification_events FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Allow authenticated users to read employee_live_locations" ON employee_live_locations;
CREATE POLICY "View employee_live_locations" ON employee_live_locations FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Manage employee_live_locations" ON employee_live_locations FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id())
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Allow authenticated users to read employee_location_history" ON employee_location_history;
CREATE POLICY "View employee_location_history" ON employee_location_history FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert own employee_location_history" ON employee_location_history FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Allow authenticated users to read geofence_events" ON geofence_events;
CREATE POLICY "View geofence_events" ON geofence_events FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert own geofence_events" ON geofence_events FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

-- ATTENDANCE
DROP POLICY IF EXISTS "Allow authenticated users to read attendance" ON attendance;
CREATE POLICY "View attendance" ON attendance FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert own attendance" ON attendance FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Update own attendance" ON attendance FOR UPDATE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id())
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Allow authenticated users to read attendance breaks" ON attendance_breaks;
CREATE POLICY "View attendance_breaks" ON attendance_breaks FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR attendance_id IN (SELECT id FROM attendance WHERE employee_id = public.get_auth_employee_id()));
CREATE POLICY "Insert own attendance_breaks" ON attendance_breaks FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR attendance_id IN (SELECT id FROM attendance WHERE employee_id = public.get_auth_employee_id()));
CREATE POLICY "Update own attendance_breaks" ON attendance_breaks FOR UPDATE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR attendance_id IN (SELECT id FROM attendance WHERE employee_id = public.get_auth_employee_id()));

DROP POLICY IF EXISTS "Allow authenticated users to read attendance events" ON attendance_events;
CREATE POLICY "View attendance_events" ON attendance_events FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR attendance_id IN (SELECT id FROM attendance WHERE employee_id = public.get_auth_employee_id()));
CREATE POLICY "Insert own attendance_events" ON attendance_events FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR attendance_id IN (SELECT id FROM attendance WHERE employee_id = public.get_auth_employee_id()));

-- LEAVE / WFH / PERMISSION
DROP POLICY IF EXISTS "Allow authenticated users to read wfh_requests" ON wfh_requests;
CREATE POLICY "View wfh_requests" ON wfh_requests FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert own wfh_requests" ON wfh_requests FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Update wfh_requests" ON wfh_requests FOR UPDATE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Allow authenticated users to read leave_requests" ON leave_requests;
CREATE POLICY "View leave_requests" ON leave_requests FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert own leave_requests" ON leave_requests FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Update leave_requests" ON leave_requests FOR UPDATE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Allow authenticated users to read permission_requests" ON permission_requests;
CREATE POLICY "View permission_requests" ON permission_requests FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert own permission_requests" ON permission_requests FOR INSERT TO authenticated
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Update permission_requests" ON permission_requests FOR UPDATE TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Allow authenticated users to read leave_balances" ON leave_balances;
CREATE POLICY "View leave_balances" ON leave_balances FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR employee_id = public.get_auth_employee_id());
CREATE POLICY "Manage leave_balances" ON leave_balances FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

-- EMPLOYEES & PROFILES (Manage access)
CREATE POLICY "Manage employees" ON employees FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

DROP POLICY IF EXISTS "Allow users to read their own profile" ON profiles;
CREATE POLICY "View profiles" ON profiles FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR auth_user_id = auth.uid());
CREATE POLICY "Manage profiles" ON profiles FOR ALL TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'))
WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));

-- NOTIFICATIONS & AUDIT
DROP POLICY IF EXISTS "Employees can view own notifications" ON notifications;
CREATE POLICY "View notifications" ON notifications FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR') OR recipient_employee_id = public.get_auth_employee_id());
CREATE POLICY "Insert notifications" ON notifications FOR INSERT TO authenticated
WITH CHECK (true); -- Allow system/actions to create notifications
CREATE POLICY "Update own notifications" ON notifications FOR UPDATE TO authenticated
USING (recipient_employee_id = public.get_auth_employee_id());

DROP POLICY IF EXISTS "Admins can view audit logs" ON audit_logs;
CREATE POLICY "View audit logs" ON audit_logs FOR SELECT TO authenticated
USING (public.get_auth_role() IN ('ADMIN', 'HR'));
CREATE POLICY "Insert audit logs" ON audit_logs FOR INSERT TO authenticated
WITH CHECK (true); -- Allow actions to record logs

