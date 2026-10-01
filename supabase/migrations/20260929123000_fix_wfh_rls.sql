-- 0010_fix_wfh_rls.sql
-- Fixes the WFH request policies to use direct and robust identity resolution
-- bypassing custom functions that may be causing 42501 evaluation failures.

BEGIN;

-- 1. Drop existing problematic WFH policies
DROP POLICY IF EXISTS "Insert own wfh_requests" ON wfh_requests;
DROP POLICY IF EXISTS "View wfh_requests" ON wfh_requests;
DROP POLICY IF EXISTS "Update wfh_requests" ON wfh_requests;
DROP POLICY IF EXISTS "Allow authenticated users to read wfh_requests" ON wfh_requests;

-- 2. Create the fixed INSERT policy
-- Uses a direct subquery to the profiles table to establish identity
CREATE POLICY "Insert own wfh_requests" ON wfh_requests 
FOR INSERT TO authenticated
WITH CHECK (
  employee_id = (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1)
);

-- 3. Create the fixed SELECT (View) policy
CREATE POLICY "View wfh_requests" ON wfh_requests 
FOR SELECT TO authenticated
USING (
  employee_id = (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1)
  OR 
  EXISTS (
    SELECT 1 
    FROM profiles p 
    JOIN roles r ON p.role_id = r.id 
    WHERE p.auth_user_id = auth.uid() AND r.name IN ('ADMIN', 'HR')
  )
);

-- 4. Create the fixed UPDATE policy
CREATE POLICY "Update wfh_requests" ON wfh_requests 
FOR UPDATE TO authenticated
USING (
  employee_id = (SELECT employee_id FROM profiles WHERE auth_user_id = auth.uid() LIMIT 1)
  OR 
  EXISTS (
    SELECT 1 
    FROM profiles p 
    JOIN roles r ON p.role_id = r.id 
    WHERE p.auth_user_id = auth.uid() AND r.name IN ('ADMIN', 'HR')
  )
);

COMMIT;
