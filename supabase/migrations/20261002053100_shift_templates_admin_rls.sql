-- 20261002053100_shift_templates_admin_rls.sql

-- Add INSERT, UPDATE, DELETE policies for shift_templates allowing ADMINs to manage shifts.
-- Employees can still read shifts based on the existing SELECT policy.

CREATE POLICY "Allow ADMIN to insert shift_templates" 
ON shift_templates 
FOR INSERT 
TO authenticated 
WITH CHECK (get_auth_role() = 'ADMIN');

CREATE POLICY "Allow ADMIN to update shift_templates" 
ON shift_templates 
FOR UPDATE 
TO authenticated 
USING (get_auth_role() = 'ADMIN');

CREATE POLICY "Allow ADMIN to delete shift_templates" 
ON shift_templates 
FOR DELETE 
TO authenticated 
USING (get_auth_role() = 'ADMIN');
