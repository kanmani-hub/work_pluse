-- 0010_fix_offices_insert_rls.sql
-- Allow Admin to manage offices

CREATE POLICY "Admin can insert offices" 
ON public.offices 
FOR INSERT 
TO authenticated 
WITH CHECK (public.get_auth_role() = 'Admin');

CREATE POLICY "Admin can update offices" 
ON public.offices 
FOR UPDATE 
TO authenticated 
USING (public.get_auth_role() = 'Admin')
WITH CHECK (public.get_auth_role() = 'Admin');

CREATE POLICY "Admin can delete offices" 
ON public.offices 
FOR DELETE 
TO authenticated 
USING (public.get_auth_role() = 'Admin');
