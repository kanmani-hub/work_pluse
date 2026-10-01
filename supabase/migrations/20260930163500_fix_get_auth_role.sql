-- 20260930163500_fix_get_auth_role.sql
-- Fix get_auth_role() to fallback to 'ADMIN' if the user's email is admin@gmail.com.
-- This breaks the circular dependency where the Admin cannot insert their own profile because they don't have a profile.

CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT r.name 
      FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.auth_user_id = auth.uid() 
        AND p.is_active = true 
      LIMIT 1
    ),
    CASE 
      WHEN auth.jwt()->>'email' = 'admin@gmail.com' THEN 'ADMIN'
      ELSE NULL
    END
  );
$$;
