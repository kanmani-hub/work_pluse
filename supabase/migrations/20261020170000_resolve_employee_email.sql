-- 20261020170000_resolve_employee_email.sql
-- Resolves an employee's login email securely from their employee code.
-- Hardened against enumeration and abuse:
-- 1. Validates format and length.
-- 2. Only active employees can be resolved.
-- 3. Implements per-IP rate limiting when called via PostgREST.
-- 4. Explicit GRANT to anon and authenticated with REVOKE from PUBLIC.

-- 1. Internal rate-limiting table for lookup attempts
CREATE TABLE IF NOT EXISTS public.auth_lookup_rate_limits (
    ip_address TEXT PRIMARY KEY,
    attempt_count INT NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_lookup_rate_limits ENABLE ROW LEVEL SECURITY;
-- No public policies: accessible only by SECURITY DEFINER functions

-- 2. Secure lookup function
CREATE OR REPLACE FUNCTION public.get_email_by_employee_code(p_employee_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_code TEXT;
    v_email TEXT;
    v_headers JSONB;
    v_ip TEXT;
    v_rate_record RECORD;
BEGIN
    -- 1. Normalize and validate employee code
    v_clean_code := upper(trim(COALESCE(p_employee_code, '')));
    
    -- Format guard: 2 to 50 alphanumeric, hyphen, or underscore characters
    IF length(v_clean_code) < 2 OR length(v_clean_code) > 50 OR v_clean_code !~ '^[A-Z0-9_-]+$' THEN
        RETURN NULL;
    END IF;

    -- 2. Check rate limit if called via HTTP/PostgREST
    BEGIN
        v_headers := NULLIF(current_setting('request.headers', true), '')::JSONB;
        v_ip := COALESCE(
            v_headers->>'x-forwarded-for',
            v_headers->>'cf-connecting-ip',
            v_headers->>'x-real-ip'
        );
        -- Take the first IP if multiple are listed in x-forwarded-for
        IF v_ip LIKE '%,%' THEN
            v_ip := trim(split_part(v_ip, ',', 1));
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_ip := NULL;
    END;

    IF v_ip IS NOT NULL AND length(v_ip) > 0 THEN
        SELECT * INTO v_rate_record 
        FROM public.auth_lookup_rate_limits 
        WHERE ip_address = v_ip;

        IF NOT FOUND THEN
            INSERT INTO public.auth_lookup_rate_limits (ip_address, attempt_count, window_start)
            VALUES (v_ip, 1, now())
            ON CONFLICT (ip_address) DO UPDATE
            SET attempt_count = public.auth_lookup_rate_limits.attempt_count + 1;
        ELSIF v_rate_record.window_start < now() - INTERVAL '1 minute' THEN
            UPDATE public.auth_lookup_rate_limits
            SET attempt_count = 1, window_start = now()
            WHERE ip_address = v_ip;
        ELSIF v_rate_record.attempt_count >= 30 THEN
            RAISE EXCEPTION 'Too many attempts. Please try again later.' USING ERRCODE = 'P0001';
        ELSE
            UPDATE public.auth_lookup_rate_limits
            SET attempt_count = attempt_count + 1
            WHERE ip_address = v_ip;
        END IF;
    END IF;

    -- 3. Resolve email strictly for active employees
    SELECT email INTO v_email 
    FROM public.employees 
    WHERE upper(employee_code) = v_clean_code
      AND upper(status) = 'ACTIVE'
    LIMIT 1;
    
    RETURN v_email;
END;
$$;

-- 3. Explicit permissions
REVOKE ALL ON FUNCTION public.get_email_by_employee_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_by_employee_code(TEXT) TO anon, authenticated, service_role;

