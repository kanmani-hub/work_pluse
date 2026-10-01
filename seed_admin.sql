DO $$ 
DECLARE
  v_user_id UUID := gen_random_uuid();
  v_admin_role_id UUID;
  v_dept_id UUID;
  v_office_id UUID;
  v_emp_id UUID := gen_random_uuid();
BEGIN
  -- Enable pgcrypto if not already
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- Insert into auth.users
  INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    recovery_sent_at,
    last_sign_in_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin@gmail.com',
    crypt('admin@123', gen_salt('bf')),
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  );

  -- Insert auth.identities
  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    format('{"sub":"%s","email":"%s"}', v_user_id::text, 'admin@gmail.com')::jsonb,
    'email',
    NOW(),
    NOW(),
    NOW()
  );

  -- Get Admin Role ID
  SELECT id INTO v_admin_role_id FROM public.roles WHERE name = 'ADMIN' LIMIT 1;
  
  -- Get any department
  SELECT id INTO v_dept_id FROM public.departments LIMIT 1;
  
  -- Get any office
  SELECT id INTO v_office_id FROM public.offices LIMIT 1;

  -- Create employee record
  INSERT INTO public.employees (
    id,
    employee_code,
    first_name,
    last_name,
    email,
    joining_date,
    department_id,
    office_id,
    role_id,
    status
  ) VALUES (
    v_emp_id,
    'ADMIN-001',
    'System',
    'Admin',
    'admin@gmail.com',
    CURRENT_DATE,
    v_dept_id,
    v_office_id,
    v_admin_role_id,
    'ACTIVE'
  );

  -- Create profile linking auth to employee
  INSERT INTO public.profiles (
    auth_user_id,
    employee_id,
    role_id,
    is_active
  ) VALUES (
    v_user_id,
    v_emp_id,
    v_admin_role_id,
    true
  );

END $$;
