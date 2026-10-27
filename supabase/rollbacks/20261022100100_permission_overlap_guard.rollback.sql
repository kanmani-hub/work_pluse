-- Rollback of 20261022100100_permission_overlap_guard.sql (re-opens B-11: overlapping permissions).
-- No data is changed.
BEGIN;
DROP TRIGGER IF EXISTS trg_guard_permission_overlap ON public.permission_requests;
DROP FUNCTION IF EXISTS public.guard_permission_overlap();
COMMIT;
