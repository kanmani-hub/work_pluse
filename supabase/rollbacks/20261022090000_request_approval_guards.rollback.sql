-- Rollback of 20261022090000_request_approval_guards.sql
-- WARNING: re-opens QA finding S-01 (employees can approve their own leave / WFH / permission requests).
-- No data is changed: requests decided while the guard was active keep their status and reviewer.
BEGIN;
DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.leave_requests;
DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.wfh_requests;
DROP TRIGGER IF EXISTS trg_request_approval_guard ON public.permission_requests;
DROP FUNCTION IF EXISTS public.guard_request_approval();
COMMIT;
