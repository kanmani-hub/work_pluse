-- 20261020170000_resolve_employee_email.rollback.sql
-- Rollback for employee email resolution function and rate limiting table

DROP FUNCTION IF EXISTS public.get_email_by_employee_code(TEXT);
DROP TABLE IF EXISTS public.auth_lookup_rate_limits;
