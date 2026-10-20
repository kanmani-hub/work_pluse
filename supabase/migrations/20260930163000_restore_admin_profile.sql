-- 20260930163000_restore_admin_profile.sql
-- This migration restores the Admin employee and profile records.
-- On production, it links to existing admin@gmail.com in auth.users.
-- On a fresh local database where auth.users is empty, it initializes a local bootstrap profile
-- so subsequent migrations with preflight checks (e.g. 20261014090000_admin_security_hardening.sql) pass safely,
-- and attaches a trigger to link the profile as soon as admin@gmail.com is created in local auth.

DO $$
DECLARE
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  -- 1. Get the Auth User ID for admin@gmail.com if already present
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@gmail.com' LIMIT 1;
  
  -- Fallback for local development or fresh installations without pre-seeded auth.users
  IF v_user_id IS NULL THEN
    v_user_id := '00000000-0000-0000-0000-000000000001'::uuid;
    RAISE NOTICE 'Admin user not yet in auth.users. Initializing local bootstrap profile for ADMIN-001.';
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

-- 5. Trigger to automatically link local admin when admin@gmail.com is registered in auth.users
CREATE OR REPLACE FUNCTION public.handle_admin_auth_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email = 'admin@gmail.com' THEN
    UPDATE public.employees 
    SET id = NEW.id 
    WHERE employee_code = 'ADMIN-001' AND id <> NEW.id;

    UPDATE public.profiles 
    SET id = NEW.id, auth_user_id = NEW.id, employee_id = NEW.id 
    WHERE (employee_id = '00000000-0000-0000-0000-000000000001'::uuid OR id = '00000000-0000-0000-0000-000000000001'::uuid)
      AND auth_user_id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_auth_sync ON auth.users;
CREATE TRIGGER trg_admin_auth_sync
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_admin_auth_sync();

