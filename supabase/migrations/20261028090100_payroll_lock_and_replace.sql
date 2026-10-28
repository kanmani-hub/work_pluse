-- =============================================================================================
-- 20261028090100_payroll_lock_and_replace.sql
-- Finalized payroll is protected by the database, and a recalculation replaces a payroll in one
-- transaction (payroll audit 2026-10-27, P1 items "finalized payroll protected only in the browser" and
-- "recalculation deletes the payroll before it knows the new one can be calculated").
--
-- Before:
--   * "Manage payroll" (0009) lets ADMIN / HR UPDATE or DELETE any payroll row and its items, whatever the
--     status. The approval / payment lock lived only in payrollService (browser).
--   * recalculatePayroll deleted payroll_items and payroll (errors ignored) BEFORE calculating; a failed
--     calculation left the employee without a payroll for the month. The items insert after the payroll
--     insert was not checked either (a payroll without its items could remain).
--
-- After:
--   * guard_payroll_lock (BEFORE INSERT / UPDATE / DELETE on payroll) for API callers:
--       - INSERT only as DRAFT / CALCULATED / UNDER_REVIEW (approval goes through the workflow);
--       - status changes follow the existing workflow (payrollRules.PAYROLL_TRANSITIONS):
--         DRAFT|CALCULATED → UNDER_REVIEW → APPROVED → PAYMENT_PENDING → PAID → CLOSED;
--       - a locked payroll (APPROVED, PAYMENT_PENDING, PAID, CLOSED) keeps its amounts, period and snapshot;
--         only the forward status step and locked_at may change; it cannot be deleted.
--   * guard_payroll_items_lock: no item of a locked payroll can be added, changed or removed.
--   * replace_payroll_calculation(payroll jsonb, items jsonb): ADMIN / HR only. Locks the month's row,
--     refuses a locked month, then updates the row in place (same id, so links to it stay valid) or creates
--     it, and replaces its items — all in one transaction. Any error (bad value, constraint) changes nothing.
--     A payroll that was UNDER_REVIEW stays UNDER_REVIEW; otherwise it becomes CALCULATED.
--   * Trusted server code (postgres, service_role, supabase_admin: e.g. approve_payroll_with_adjustments,
--     record_payroll_payment) is not restricted by the triggers.
-- Rollback: supabase/rollbacks/20261028090100_payroll_lock_and_replace.rollback.sql
-- =============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.payroll_is_locked(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(COALESCE(p_status, '')) IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED')
$$;

CREATE OR REPLACE FUNCTION public.payroll_transition_allowed(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (upper(p_from), upper(p_to)) IN (
    ('DRAFT', 'UNDER_REVIEW'), ('CALCULATED', 'UNDER_REVIEW'), ('UNDER_REVIEW', 'APPROVED'),
    ('APPROVED', 'PAYMENT_PENDING'), ('PAYMENT_PENDING', 'PAID'), ('PAID', 'CLOSED'))
$$;

CREATE OR REPLACE FUNCTION public.guard_payroll_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF upper(COALESCE(NEW.status, 'DRAFT')) NOT IN ('DRAFT', 'CALCULATED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'A payroll is created as DRAFT / CALCULATED / UNDER_REVIEW and approved through the workflow' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF public.payroll_is_locked(OLD.status) THEN
      RAISE EXCEPTION 'A % payroll cannot be deleted', OLD.status USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.payroll_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'Payroll status cannot change from % to %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  IF public.payroll_is_locked(OLD.status) AND (
       NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.payroll_year IS DISTINCT FROM OLD.payroll_year
    OR NEW.payroll_month IS DISTINCT FROM OLD.payroll_month OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end OR NEW.basic_salary IS DISTINCT FROM OLD.basic_salary
    OR NEW.gross_salary IS DISTINCT FROM OLD.gross_salary OR NEW.total_allowances IS DISTINCT FROM OLD.total_allowances
    OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions OR NEW.lop_deduction IS DISTINCT FROM OLD.lop_deduction
    OR NEW.overtime_amount IS DISTINCT FROM OLD.overtime_amount OR NEW.net_salary IS DISTINCT FROM OLD.net_salary
    OR NEW.calculated_at IS DISTINCT FROM OLD.calculated_at OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.remarks IS DISTINCT FROM OLD.remarks) THEN
    RAISE EXCEPTION 'A % payroll is locked: its amounts and details cannot be changed', OLD.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_payroll_items_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_status text;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT status INTO v_status FROM payroll WHERE id = COALESCE(NEW.payroll_id, OLD.payroll_id);
  IF public.payroll_is_locked(v_status) THEN
    RAISE EXCEPTION 'The items of a % payroll cannot be changed', v_status USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.payroll_id IS DISTINCT FROM OLD.payroll_id THEN
    SELECT status INTO v_status FROM payroll WHERE id = NEW.payroll_id;
    IF public.payroll_is_locked(v_status) THEN
      RAISE EXCEPTION 'The items of a % payroll cannot be changed', v_status USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.guard_payroll_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_payroll_items_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_payroll_lock ON public.payroll;
CREATE TRIGGER trg_guard_payroll_lock BEFORE INSERT OR UPDATE OR DELETE ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_lock();
DROP TRIGGER IF EXISTS trg_guard_payroll_items_lock ON public.payroll_items;
CREATE TRIGGER trg_guard_payroll_items_lock BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_items_lock();

-- Atomic (re)calculation: one call, one transaction.
CREATE OR REPLACE FUNCTION public.replace_payroll_calculation(p_payroll jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emp uuid := (p_payroll->>'employee_id')::uuid;
  v_year int := (p_payroll->>'payroll_year')::int;
  v_month int := (p_payroll->>'payroll_month')::int;
  v_existing payroll%ROWTYPE;
  v_id uuid;
  v_status text;
  v_item jsonb;
BEGIN
  -- signed-in callers must be ADMIN / HR; calls without a signed-in user can only come from trusted
  -- server code (postgres / service_role), because anon and PUBLIC have no EXECUTE right
  IF auth.uid() IS NOT NULL AND COALESCE(public.get_auth_role(), '') NOT IN ('ADMIN', 'HR') THEN
    RAISE EXCEPTION 'Only HR or an administrator can calculate payroll' USING ERRCODE = '42501';
  END IF;
  IF v_emp IS NULL OR v_year IS NULL OR v_month IS NULL THEN
    RAISE EXCEPTION 'employee_id, payroll_year and payroll_month are required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'items must be an array' USING ERRCODE = '22023';
  END IF;

  -- One calculation at a time per employee and month: two first-time calculations would otherwise both
  -- find no row and the second would fail on the unique (employee, year, month) constraint.
  PERFORM pg_advisory_xact_lock(hashtextextended('payroll:' || v_emp::text || ':' || v_year || ':' || v_month, 0));

  SELECT * INTO v_existing FROM payroll
  WHERE employee_id = v_emp AND payroll_year = v_year AND payroll_month = v_month
  FOR UPDATE;

  IF FOUND THEN
    IF public.payroll_is_locked(v_existing.status) THEN
      RAISE EXCEPTION 'Payroll for %/% is % and locked; it cannot be recalculated', v_month, v_year, v_existing.status USING ERRCODE = '42501';
    END IF;
    v_status := CASE WHEN v_existing.status = 'UNDER_REVIEW' THEN 'UNDER_REVIEW' ELSE 'CALCULATED' END;
    UPDATE payroll SET
      period_start = (p_payroll->>'period_start')::date,
      period_end = (p_payroll->>'period_end')::date,
      basic_salary = (p_payroll->>'basic_salary')::numeric,
      gross_salary = (p_payroll->>'gross_salary')::numeric,
      total_allowances = (p_payroll->>'total_allowances')::numeric,
      total_deductions = (p_payroll->>'total_deductions')::numeric,
      lop_deduction = COALESCE((p_payroll->>'lop_deduction')::numeric, 0),
      overtime_amount = COALESCE((p_payroll->>'overtime_amount')::numeric, 0),
      net_salary = (p_payroll->>'net_salary')::numeric,
      status = v_status,
      calculated_at = now(),
      approved_at = NULL,
      approved_by = NULL,
      remarks = p_payroll->>'remarks'
    WHERE id = v_existing.id;
    v_id := v_existing.id;
    DELETE FROM payroll_items WHERE payroll_id = v_id;
  ELSE
    v_status := 'CALCULATED';
    INSERT INTO payroll (employee_id, payroll_year, payroll_month, period_start, period_end, basic_salary, gross_salary,
                         total_allowances, total_deductions, lop_deduction, overtime_amount, net_salary, status, calculated_at, remarks)
    VALUES (v_emp, v_year, v_month, (p_payroll->>'period_start')::date, (p_payroll->>'period_end')::date,
            (p_payroll->>'basic_salary')::numeric, (p_payroll->>'gross_salary')::numeric, (p_payroll->>'total_allowances')::numeric,
            (p_payroll->>'total_deductions')::numeric, COALESCE((p_payroll->>'lop_deduction')::numeric, 0),
            COALESCE((p_payroll->>'overtime_amount')::numeric, 0), (p_payroll->>'net_salary')::numeric,
            v_status, now(), p_payroll->>'remarks')
    RETURNING id INTO v_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    INSERT INTO payroll_items (payroll_id, item_type, item_name, amount, calculation_basis, notes)
    VALUES (v_id, v_item->>'item_type', v_item->>'item_name', (v_item->>'amount')::numeric,
            v_item->>'calculation_basis', v_item->>'notes');
  END LOOP;

  RETURN jsonb_build_object('id', v_id, 'status', v_status, 'replaced', v_existing.id IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.replace_payroll_calculation(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_payroll_calculation(jsonb, jsonb) TO authenticated;

COMMIT;
