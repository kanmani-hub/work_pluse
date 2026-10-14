-- PROPOSED (not applied) — at most one open break per attendance, enforced by the database.
--
-- Why: the app checks for an open break before inserting one, but two requests at the same moment
-- (two tabs / devices, or a repeated GPS event) can both pass that check. Only the database can make
-- the second insert fail. The app already treats that failure (23505) as "break already active"
-- (breakService.handleAutoBreakTransition / startBreak), so no app change is needed.
--
-- STEP 0 (read-only) — must return 0 rows, otherwise the index cannot be created. Fix those rows
-- with an administrator first (end or discard the extra breaks):
--   SELECT attendance_id, count(*) AS open_breaks
--   FROM attendance_breaks
--   WHERE ended_at IS NULL AND coalesce(break_type, '') <> 'CANCELLED'
--   GROUP BY attendance_id HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS one_open_break_per_attendance
  ON public.attendance_breaks (attendance_id)
  WHERE ended_at IS NULL AND coalesce(break_type, '') <> 'CANCELLED';

-- ROLLBACK:
-- DROP INDEX IF EXISTS public.one_open_break_per_attendance;
