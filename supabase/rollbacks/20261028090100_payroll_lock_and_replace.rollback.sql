-- Rollback of 20261028090100_payroll_lock_and_replace.sql
-- WARNING: approved / paid payroll is then protected only by the browser again, and the app falls back to
-- the non-atomic recalculation (it detects the missing function). No payroll data is changed.
BEGIN;
DROP TRIGGER IF EXISTS trg_guard_payroll_items_lock ON public.payroll_items;
DROP TRIGGER IF EXISTS trg_guard_payroll_lock ON public.payroll;
DROP FUNCTION IF EXISTS public.replace_payroll_calculation(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.guard_payroll_items_lock();
DROP FUNCTION IF EXISTS public.guard_payroll_lock();
DROP FUNCTION IF EXISTS public.payroll_transition_allowed(text, text);
DROP FUNCTION IF EXISTS public.payroll_is_locked(text);
COMMIT;
