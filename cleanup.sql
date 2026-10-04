DO $$
DECLARE
    v_admin_emp_id UUID;
    v_admin_auth_id UUID;
    v_admin_email TEXT := 'admin@gmail.com';
BEGIN
    -- 1. Find the admin auth ID
    SELECT id INTO v_admin_auth_id FROM auth.users WHERE email = v_admin_email;
    IF v_admin_auth_id IS NULL THEN
        RAISE EXCEPTION 'Admin user not found!';
    END IF;

    SELECT employee_id INTO v_admin_emp_id FROM profiles WHERE auth_user_id = v_admin_auth_id;
    IF v_admin_emp_id IS NULL THEN
        RAISE EXCEPTION 'Admin employee not found!';
    END IF;

    -- 2. Detach Admin from Department, Office
    UPDATE employees 
    SET department_id = NULL, office_id = NULL
    WHERE id = v_admin_emp_id;

    -- Also detach manager_id from departments if it exists
    -- (We will skip manager_id update since we just drop the table later)

    -- 3. Delete ALL operational data (all current data is QA data)
    DELETE FROM location_verification_events;
    DELETE FROM face_verification_events;
    
    DELETE FROM employee_live_locations;
    DELETE FROM employee_location_history;
    DELETE FROM geofence_events;
    
    DELETE FROM attendance_events;
    DELETE FROM attendance_breaks;
    DELETE FROM attendance;

    DELETE FROM leave_requests;
    DELETE FROM permission_requests;
    DELETE FROM wfh_requests;

    DELETE FROM payslips;
    DELETE FROM payroll;
    DELETE FROM salary_structures;

    DELETE FROM roster_assignments;
    DELETE FROM rosters;
    DELETE FROM shift_assignments;

    DELETE FROM face_registrations;
    DELETE FROM notifications;
    DELETE FROM audit_logs;

    -- 4. Delete other profiles and employees
    DELETE FROM profiles WHERE employee_id != v_admin_emp_id;
    DELETE FROM employees WHERE id != v_admin_emp_id;
    
    -- 5. Delete departments and offices (now they have no dependencies from employees)
    DELETE FROM departments;
    DELETE FROM offices;

    -- 6. Delete other auth.users
    DELETE FROM auth.users WHERE id != v_admin_auth_id;

END $$;
