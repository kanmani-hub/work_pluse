-- Fix RLS policy on app_settings to handle case-insensitive role check

DROP POLICY IF EXISTS "Enable update for admins only" ON public.app_settings;
DROP POLICY IF EXISTS "Enable insert for admins only" ON public.app_settings;

CREATE POLICY "Enable update for admins only" 
ON public.app_settings FOR UPDATE 
TO authenticated 
USING (UPPER(get_auth_role()) = 'ADMIN')
WITH CHECK (UPPER(get_auth_role()) = 'ADMIN');

CREATE POLICY "Enable insert for admins only" 
ON public.app_settings FOR INSERT 
TO authenticated 
WITH CHECK (UPPER(get_auth_role()) = 'ADMIN');
