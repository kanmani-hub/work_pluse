CREATE OR REPLACE FUNCTION public.get_email_by_employee_code(p_employee_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT;
BEGIN
    SELECT email INTO v_email 
    FROM employees 
    WHERE employee_code = p_employee_code;
    
    RETURN v_email;
END;
$$;
