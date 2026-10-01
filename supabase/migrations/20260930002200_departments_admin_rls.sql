-- Add RLS policies for departments for Admin
CREATE POLICY "Admin can insert departments" 
ON public.departments 
FOR INSERT 
TO authenticated 
WITH CHECK (public.get_auth_role() = 'ADMIN');

CREATE POLICY "Admin can update departments" 
ON public.departments 
FOR UPDATE 
TO authenticated 
USING (public.get_auth_role() = 'ADMIN')
WITH CHECK (public.get_auth_role() = 'ADMIN');

CREATE POLICY "Admin can delete departments" 
ON public.departments 
FOR DELETE 
TO authenticated 
USING (public.get_auth_role() = 'ADMIN');
