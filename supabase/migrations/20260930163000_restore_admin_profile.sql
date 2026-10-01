-- 20260930163000_restore_admin_profile.sql
-- This migration restores the Admin employee and profile records that were deleted during the final cleanup.
-- Because RLS prevents an admin without a profile from creating their own profile, this must be run by a superuser (e.g. Supabase SQL Editor).

DO $$
DECLARE
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  -- 1. Get the Auth User ID for admin@gmail.com
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@gmail.com' LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Admin user not found in auth.users. Please ensure admin@gmail.com exists.';
    RETURN;
  END IF;

  -- 2. Get the ADMIN role ID
  SELECT id INTO v_role_id FROM public.roles WHERE name = 'ADMIN' LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE NOTICE 'ADMIN role not found in public.roles.';
    RETURN;
  END IF;

  -- Delete old employee with same employee_code if id is different
  DELETE FROM public.employees WHERE employee_code = 'ADMIN-001' AND id != v_user_id;

  -- 3. Restore Employee Record
  INSERT INTO public.employees (
    id, employee_code, first_name, last_name, email, phone, designation, status, role_id, joining_date
  ) VALUES (
    v_user_id, 'ADMIN-001', 'System', 'Admin', 'admin@gmail.com', '0000000000', 'System Administrator', 'ACTIVE', v_role_id, CURRENT_DATE
  )
  ON CONFLICT (id) DO UPDATE SET 
    role_id = EXCLUDED.role_id,
    status = EXCLUDED.status;

  -- 4. Restore Profile Record
  INSERT INTO public.profiles (
    id, auth_user_id, employee_id, role_id, is_active
  ) VALUES (
    v_user_id, v_user_id, v_user_id, v_role_id, true
  )
  ON CONFLICT (id) DO UPDATE SET 
    role_id = EXCLUDED.role_id,
    is_active = EXCLUDED.is_active;

END $$;
