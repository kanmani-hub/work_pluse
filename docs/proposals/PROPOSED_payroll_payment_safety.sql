-- =====================================================================================
-- PROPOSED (NOT APPLIED) — WorkPulse HR payroll payment safety, revision 2 (2026-10-09)
--
-- Confirmed business rules (owner decision, 2026-10-09):
--   * One payment per payroll, and it must EQUAL the approved net salary exactly.
--   * Only ADMIN may record payroll payments (HR may prepare, review and approve).
--   * Overtime cannot be approved for a month whose payroll is APPROVED / PAYMENT_PENDING / PAID / CLOSED.
--
-- Written against the schema in supabase/migrations (0005, 0009, 0015, 20261002092500,
-- 20261002094500) and docs/proposals/PROPOSED_overtime_requests.sql (applied by the owner).
-- The LIVE database was NOT inspected (no SQL was run). PART 0 verifies the assumptions:
-- run it first and stop if anything differs from what is noted there.
--
-- How to apply (on a TEST project first, then production in a quiet window):
--   1. PART 0 (read-only). Resolve any rows returned by 0f–0i before continuing.
--   2. PARTS 1–6 in one transaction (BEGIN; … COMMIT;). 3. Deploy the app version that calls
--   record_payroll_payment (older app versions cannot record payments after PART 3).
-- =====================================================================================


-- ===================== PART 0: READ-ONLY CHECKS (run first) ==========================
-- 0a. Columns used below must exist with these names (payroll: status, net_salary, gross_salary,
--     total_deductions, lop_deduction, overtime_amount, basic_salary, total_allowances?, employee_id,
--     payroll_year, payroll_month; payroll_payments: payroll_id, amount, paid_at, payment_method,
--     transaction_reference, remarks, paid_by; overtime_requests: employee_id, work_date, status).
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('payroll', 'payroll_items', 'payroll_payments', 'overtime_requests')
ORDER BY table_name, ordinal_position;

-- 0b. Existing constraints and indexes (expect unique_payroll_month; NO unique index on payroll_payments.payroll_id yet)
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid::regclass::text IN ('payroll', 'payroll_items', 'payroll_payments', 'overtime_requests');
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('payroll', 'payroll_items', 'payroll_payments', 'overtime_requests');

-- 0c. Existing triggers (expect only the update_*_updated_at triggers on payroll tables)
SELECT tgrelid::regclass AS table_name, tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger WHERE NOT tgisinternal
  AND tgrelid::regclass::text IN ('payroll', 'payroll_items', 'payroll_payments', 'overtime_requests', 'attendance');

-- 0d. RLS policies (expect "Manage payroll_payments" FOR ALL for ADMIN/HR from migration 0009)
SELECT tablename, policyname, cmd, roles, qual, with_check FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('payroll', 'payroll_items', 'payroll_payments', 'overtime_requests');

-- 0e. Helper functions this proposal relies on, and the deployed auto clock-out logic
SELECT proname, prosecdef AS security_definer, proconfig FROM pg_proc
WHERE pronamespace = 'public'::regnamespace AND proname IN ('get_auth_role', 'get_auth_employee_id', 'process_auto_clock_out', 'record_payroll_payment');
SELECT pg_get_functiondef('public.process_auto_clock_out'::regproc);   -- does it still write overtime_minutes = worked - required?
SELECT DISTINCT r.name FROM roles r;                                    -- expect ADMIN, HR, EMPLOYEE (upper case)

-- 0f. Payrolls with MORE THAN ONE payment (must be 0 rows before PART 1)
SELECT payroll_id, COUNT(*) AS payments, SUM(amount) AS total_paid
FROM payroll_payments GROUP BY payroll_id HAVING COUNT(*) > 1;

-- 0g. Payrolls marked PAID/CLOSED with NO payment row (resolve by hand before PART 2)
SELECT p.id, p.employee_id, p.payroll_year, p.payroll_month, p.status, p.net_salary
FROM payroll p LEFT JOIN payroll_payments pp ON pp.payroll_id = p.id
WHERE p.status IN ('PAID', 'CLOSED') AND pp.id IS NULL;

-- 0h. Payments attached to payrolls that are NOT PAID/CLOSED, or whose amount differs from net salary
SELECT pp.id, pp.payroll_id, p.status, pp.amount, p.net_salary
FROM payroll_payments pp JOIN payroll p ON p.id = pp.payroll_id
WHERE p.status NOT IN ('PAID', 'CLOSED') OR ROUND(pp.amount, 2) <> ROUND(p.net_salary, 2);

-- 0i. Overtime already APPROVED for months whose payroll is locked (informational: never paid)
SELECT o.id, o.employee_id, o.work_date, o.approved_overtime_hours, p.status AS payroll_status
FROM overtime_requests o
JOIN payroll p ON p.employee_id = o.employee_id
  AND p.payroll_year = EXTRACT(YEAR FROM o.work_date) AND p.payroll_month = EXTRACT(MONTH FROM o.work_date)
WHERE o.status = 'APPROVED' AND p.status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED');

-- 0j. Attendance rows carrying overtime_minutes (payroll no longer pays these; informational)
SELECT COUNT(*) AS rows_with_overtime_minutes, SUM(overtime_minutes) AS minutes
FROM attendance WHERE overtime_minutes > 0;


-- ===================== PART 1: one payment per payroll ===============================
-- Compatible with the confirmed single, exact payment policy and with the app, which shows
-- payroll_payments[0] everywhere. Fails if 0f returned rows (resolve those first).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payroll_payment_per_payroll ON public.payroll_payments (payroll_id);


-- ===================== PART 2: atomic payment function ===============================
-- One transaction: lock the payroll row, check role/status/amount/existing payment, insert the
-- payment, set PAID. Any failure rolls everything back, so a payroll can never end up PAID
-- without a payment, and two simultaneous calls serialise on the row lock (the second sees PAID).
-- SECURITY INVOKER: the caller's RLS still applies on top of the explicit ADMIN check.
CREATE OR REPLACE FUNCTION public.record_payroll_payment(
  p_payroll_id            uuid,
  p_amount                numeric,
  p_payment_method        text,
  p_transaction_reference text DEFAULT NULL,
  p_remarks               text DEFAULT NULL,
  p_paid_at               timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payroll    public.payroll%ROWTYPE;
  v_actor      uuid;
  v_payment_id uuid;
BEGIN
  IF upper(coalesce(public.get_auth_role(), '')) <> 'ADMIN' THEN
    RAISE EXCEPTION 'Only an Admin can record payroll payments.' USING ERRCODE = '42501';
  END IF;
  v_actor := public.get_auth_employee_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Your account has no active employee profile.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_payroll FROM public.payroll WHERE id = p_payroll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_payroll.status IN ('PAID', 'CLOSED') THEN
    RAISE EXCEPTION 'This payroll has already been paid.' USING ERRCODE = 'P0001';
  END IF;
  IF v_payroll.status <> 'PAYMENT_PENDING' THEN
    RAISE EXCEPTION 'Payroll must be in PAYMENT_PENDING status to record a payment (current: %).', v_payroll.status USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payroll_payments WHERE payroll_id = p_payroll_id) THEN
    RAISE EXCEPTION 'A payment is already recorded for this payroll.' USING ERRCODE = 'P0001';
  END IF;

  IF p_amount IS NULL OR p_amount = 'NaN'::numeric OR p_amount < 0 THEN
    RAISE EXCEPTION 'Enter a valid payment amount.' USING ERRCODE = '22023';
  END IF;
  IF ROUND(p_amount, 2) <> ROUND(v_payroll.net_salary, 2) THEN
    RAISE EXCEPTION 'Payment must equal the approved net salary of %.', ROUND(v_payroll.net_salary, 2) USING ERRCODE = '22023';
  END IF;
  IF coalesce(trim(p_payment_method), '') = '' THEN
    RAISE EXCEPTION 'Choose a payment method.' USING ERRCODE = '22023';
  END IF;
  IF p_paid_at IS NOT NULL
     AND (p_paid_at AT TIME ZONE 'Asia/Kolkata')::date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Payment date cannot be in the future.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payroll_payments (payroll_id, paid_at, amount, payment_method, transaction_reference, remarks, paid_by)
  VALUES (p_payroll_id, coalesce(p_paid_at, now()), ROUND(p_amount, 2), trim(p_payment_method),
          nullif(trim(p_transaction_reference), ''), nullif(trim(p_remarks), ''), v_actor)
  RETURNING id INTO v_payment_id;

  UPDATE public.payroll SET status = 'PAID' WHERE id = p_payroll_id AND status = 'PAYMENT_PENDING';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll status changed while recording the payment.' USING ERRCODE = '40001';
  END IF;

  RETURN v_payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_payroll_payment(uuid, numeric, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_payroll_payment(uuid, numeric, text, text, text, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_payroll_payment(uuid, numeric, text, text, text, timestamptz) TO authenticated;


-- ===================== PART 3: payment table rules (RLS + triggers) ==================
-- Replace the broad FOR ALL policy (ADMIN/HR) with: INSERT for ADMIN only; no UPDATE/DELETE for
-- app users. The existing SELECT policies stay unchanged.
DROP POLICY IF EXISTS "Manage payroll_payments" ON public.payroll_payments;
CREATE POLICY "Insert payroll_payments (admin only)" ON public.payroll_payments
  FOR INSERT TO authenticated
  WITH CHECK (upper(coalesce(public.get_auth_role(), '')) = 'ADMIN');

-- Explicit override for authorised data repair only:  BEGIN; SET LOCAL workpulse.payroll_override = 'on'; …; COMMIT;
-- The service role (server-side Edge Functions, e.g. delete-employee) is also allowed.
CREATE OR REPLACE FUNCTION public.payroll_override_active()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(current_setting('workpulse.payroll_override', true), '') = 'on'
      OR coalesce(auth.role(), '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.guard_payroll_payments()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.payroll_override_active() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- record_payroll_payment inserts while the (locked) payroll is still PAYMENT_PENDING
    IF NOT EXISTS (SELECT 1 FROM public.payroll WHERE id = NEW.payroll_id AND status = 'PAYMENT_PENDING') THEN
      RAISE EXCEPTION 'A payment can only be recorded for a payroll in PAYMENT_PENDING status.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Recorded payroll payments cannot be changed or deleted.' USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payroll_payments ON public.payroll_payments;
CREATE TRIGGER trg_guard_payroll_payments
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_payments();


-- ===================== PART 4: payroll status + lock after approval ==================
-- Same path as src/services/payroll/payrollRules.ts (PAYROLL_TRANSITIONS):
--   DRAFT/CALCULATED → UNDER_REVIEW → APPROVED → PAYMENT_PENDING → PAID → CLOSED
-- PAYMENT_PENDING → PAID only when a payment row exists (i.e. inside record_payroll_payment).
-- Amounts, period and employee are frozen from APPROVED on; locked payrolls cannot be deleted.
-- Recalculation deletes and re-inserts only DRAFT/CALCULATED/UNDER_REVIEW payrolls: unaffected.
CREATE OR REPLACE FUNCTION public.guard_payroll()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.payroll_override_active() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('DRAFT', 'CALCULATED') THEN
      RAISE EXCEPTION 'A payroll cannot be created in status %.', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED') THEN
      RAISE EXCEPTION 'A % payroll cannot be deleted.', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED')
     AND (NEW.net_salary       IS DISTINCT FROM OLD.net_salary
       OR NEW.gross_salary     IS DISTINCT FROM OLD.gross_salary
       OR NEW.basic_salary     IS DISTINCT FROM OLD.basic_salary
       OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions
       OR NEW.lop_deduction    IS DISTINCT FROM OLD.lop_deduction
       OR NEW.overtime_amount  IS DISTINCT FROM OLD.overtime_amount
       OR NEW.employee_id      IS DISTINCT FROM OLD.employee_id
       OR NEW.payroll_year     IS DISTINCT FROM OLD.payroll_year
       OR NEW.payroll_month    IS DISTINCT FROM OLD.payroll_month) THEN
    RAISE EXCEPTION 'Payroll amounts are locked in status %.', OLD.status USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status IN ('DRAFT', 'CALCULATED') AND NEW.status = 'UNDER_REVIEW')
     OR (OLD.status = 'UNDER_REVIEW'    AND NEW.status = 'APPROVED')
     OR (OLD.status = 'APPROVED'        AND NEW.status = 'PAYMENT_PENDING')
     OR (OLD.status = 'PAYMENT_PENDING' AND NEW.status = 'PAID'
         AND EXISTS (SELECT 1 FROM public.payroll_payments WHERE payroll_id = OLD.id))
     OR (OLD.status = 'PAID'            AND NEW.status = 'CLOSED') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid payroll status change: % -> %.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payroll ON public.payroll;
CREATE TRIGGER trg_guard_payroll
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll();

-- Line items follow their payroll: no insert/update/delete once it is APPROVED or later.
-- (A missing parent — e.g. during a cascaded delete — is allowed.)
CREATE OR REPLACE FUNCTION public.guard_payroll_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF public.payroll_override_active() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_status FROM public.payroll WHERE id = OLD.payroll_id;
  ELSE
    SELECT status INTO v_status FROM public.payroll WHERE id = NEW.payroll_id;
  END IF;
  IF v_status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED') THEN
    RAISE EXCEPTION 'Payroll line items are locked in status %.', v_status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payroll_items ON public.payroll_items;
CREATE TRIGGER trg_guard_payroll_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_payroll_items();


-- ===================== PART 5: no overtime approval for locked months ================
CREATE OR REPLACE FUNCTION public.guard_overtime_approval_locked_month()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'APPROVED') THEN
    SELECT status INTO v_status FROM public.payroll
    WHERE employee_id = NEW.employee_id
      AND payroll_year = EXTRACT(YEAR FROM NEW.work_date)
      AND payroll_month = EXTRACT(MONTH FROM NEW.work_date);
    IF v_status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED') THEN
      RAISE EXCEPTION 'Payroll for % is already %; overtime for that month can no longer be approved.',
        to_char(NEW.work_date, 'MM/YYYY'), v_status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_overtime_locked_month ON public.overtime_requests;
CREATE TRIGGER trg_guard_overtime_locked_month
  BEFORE INSERT OR UPDATE ON public.overtime_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_overtime_approval_locked_month();


-- ===================== PART 6 (optional, review separately): auto clock-out ===========
-- process_auto_clock_out (migration 0015) sets overtime_minutes = worked - required. Payroll no longer
-- pays it (only APPROVED overtime_requests are paid), so this is cosmetic. To stop writing it, re-create
-- the function from the definition shown by 0e with   v_overtime := v_effective_mins - v_required_mins;
-- replaced by   v_overtime := 0;   (no other change). Not included here because the live definition
-- must be checked first.


-- ===================== ROLLBACK (reverse order) ======================================
-- DROP TRIGGER IF EXISTS trg_guard_overtime_locked_month ON public.overtime_requests;
-- DROP FUNCTION IF EXISTS public.guard_overtime_approval_locked_month();
-- DROP TRIGGER IF EXISTS trg_guard_payroll_items ON public.payroll_items;
-- DROP FUNCTION IF EXISTS public.guard_payroll_items();
-- DROP TRIGGER IF EXISTS trg_guard_payroll ON public.payroll;
-- DROP FUNCTION IF EXISTS public.guard_payroll();
-- DROP TRIGGER IF EXISTS trg_guard_payroll_payments ON public.payroll_payments;
-- DROP FUNCTION IF EXISTS public.guard_payroll_payments();
-- DROP FUNCTION IF EXISTS public.payroll_override_active();
-- DROP POLICY IF EXISTS "Insert payroll_payments (admin only)" ON public.payroll_payments;
-- CREATE POLICY "Manage payroll_payments" ON public.payroll_payments FOR ALL TO authenticated
--   USING (public.get_auth_role() IN ('ADMIN', 'HR')) WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR'));   -- original (0009)
-- DROP FUNCTION IF EXISTS public.record_payroll_payment(uuid, numeric, text, text, text, timestamptz);
-- DROP INDEX IF EXISTS public.uniq_payroll_payment_per_payroll;
-- Note: after rollback the app cannot record payments (it requires record_payroll_payment);
-- restore the previous app version at the same time.
