-- 0012_remove_hr_offices_insert_rls.sql
-- Remove HR from offices insert policy to strictly follow ADMIN only permission model.

DROP POLICY IF EXISTS "Admin can insert offices" ON public.offices;
CREATE POLICY "Admin can insert offices" 
ON public.offices 
FOR INSERT 
TO authenticated 
WITH CHECK (public.get_auth_role() = 'ADMIN');
