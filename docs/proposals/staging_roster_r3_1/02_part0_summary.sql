-- =====================================================================================
-- WorkPulse HR roster migration revision 3.1 — STAGING STEP 1: PART 0 SUMMARY (READ-ONLY)
-- One query, one result table (the Supabase SQL editor shows only the last result of a script).
-- Changes nothing. Every row must show result = OK (INFO rows are for your notes).
-- Any STOP row: do not continue — send this output for review.
-- Same checks as PART 0 (0a–0j) of docs/proposals/PROPOSED_roster_persistence.sql plus roles.
-- =====================================================================================
WITH pol AS (
  SELECT p.tablename, p.policyname, p.cmd, p.roles,
         replace(replace(coalesce(p.qual, ''), ' ', ''), 'public.', '') AS q,
         replace(replace(coalesce(p.with_check, ''), ' ', ''), 'public.', '') AS w
  FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename IN ('rosters', 'roster_assignments')
),
manage_ok AS (
  SELECT count(*) AS n FROM pol
  WHERE ((tablename = 'rosters' AND policyname = 'Manage rosters')
      OR (tablename = 'roster_assignments' AND policyname = 'Manage roster_assignments'))
    AND cmd = 'ALL' AND roles = '{authenticated}'
    AND q ~ '^[(]*get_auth_role[(][)]=ANY[(]' AND w ~ '^[(]*get_auth_role[(][)]=ANY[(]'
    AND q LIKE '%''ADMIN''%' AND q LIKE '%''HR''%' AND w LIKE '%''ADMIN''%' AND w LIKE '%''HR''%'
    AND (SELECT count(*) FROM regexp_matches(q, '''[^'']*''', 'g')) = 2
    AND (SELECT count(*) FROM regexp_matches(w, '''[^'']*''', 'g')) = 2
),
read_ok AS (
  SELECT count(*) AS n FROM pol
  WHERE policyname IN ('Allow authenticated users to read rosters', 'Allow authenticated users to read roster_assignments')
    AND cmd = 'SELECT' AND roles = '{authenticated}' AND q = 'true'
),
c AS (
  SELECT 1 AS ord, 'Roles anon / authenticated / service_role exist' AS check_name,
         (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))::text AS actual, '3' AS expected
  UNION ALL SELECT 2, 'public.get_auth_role() exists and returns text',
         (SELECT string_agg(pg_get_function_result(p.oid), ',') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_auth_role'), 'text'
  UNION ALL SELECT 3, 'payroll.payroll_year / payroll_month / status exist',
         (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payroll'
           AND column_name IN ('payroll_year', 'payroll_month', 'status'))::text, '3'
  UNION ALL SELECT 4, 'roster_assignments.day_type / work_mode do NOT exist yet',
         (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'roster_assignments'
           AND column_name IN ('day_type', 'work_mode'))::text, '0'
  UNION ALL SELECT 5, 'rosters.published_at / published_by do NOT exist yet',
         (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rosters'
           AND column_name IN ('published_at', 'published_by'))::text, '0'
  UNION ALL SELECT 6, 'roster_assignments.shift_template_id is NOT NULL (original 0002)',
         (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'roster_assignments'
           AND column_name = 'shift_template_id'), 'NO'
  UNION ALL SELECT 7, 'Policies on rosters / roster_assignments (total)',
         (SELECT count(*) FROM pol)::text, '4'
  UNION ALL SELECT 8, 'Read policies "Allow authenticated users to read …" (SELECT, authenticated, true)',
         (SELECT n FROM read_ok)::text, '2'
  UNION ALL SELECT 9, 'Write policies "Manage rosters" / "Manage roster_assignments" = get_auth_role() IN (ADMIN, HR)',
         (SELECT n FROM manage_ok)::text, '2'
  UNION ALL SELECT 10, 'Revision-2 "Admin manages …" policies absent',
         (SELECT count(*) FROM pol WHERE policyname IN ('Admin manages rosters', 'Admin manages roster_assignments'))::text, '0'
  UNION ALL SELECT 11, 'Constraints from this migration absent',
         (SELECT count(*) FROM pg_constraint WHERE conrelid::regclass::text IN ('rosters', 'roster_assignments')
           AND conname IN ('roster_assignments_day_type_check', 'roster_assignments_work_mode_check', 'roster_assignments_shift_for_work_check',
                           'roster_assignments_unique_day', 'rosters_status_check', 'rosters_published_at_check', 'rosters_no_overlapping_active'))::text, '0'
  UNION ALL SELECT 12, 'Triggers: only the two updated_at triggers',
         (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger WHERE NOT tgisinternal
           AND tgrelid::regclass::text IN ('rosters', 'roster_assignments')),
         'update_roster_assignments_updated_at, update_rosters_updated_at'
  UNION ALL SELECT 13, 'Functions from this migration absent',
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
           AND p.proname IN ('roster_guard_bypass', 'roster_assignments_guard', 'rosters_guard'))::text, '0'
  UNION ALL SELECT 14, '0f duplicate entries (roster, employee, date)',
         (SELECT count(*) FROM (SELECT 1 FROM roster_assignments GROUP BY roster_id, employee_id, assignment_date HAVING count(*) > 1) d)::text, '0'
  UNION ALL SELECT 15, '0g entries outside their roster dates',
         (SELECT count(*) FROM roster_assignments a JOIN rosters r ON r.id = a.roster_id
           WHERE a.assignment_date < r.start_date OR a.assignment_date > r.end_date)::text, '0'
  UNION ALL SELECT 16, '0h rosters with NULL or unknown status',
         (SELECT count(*) FROM rosters WHERE status IS NULL OR status NOT IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))::text, '0'
  UNION ALL SELECT 17, '0i overlapping active (non-archived) rosters',
         (SELECT count(*) FROM rosters a JOIN rosters b ON a.id < b.id
           WHERE a.status <> 'ARCHIVED' AND b.status <> 'ARCHIVED'
             AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]'))::text, '0'
  UNION ALL SELECT 18, 'Self-test needs ≥1 employee and ≥1 shift template',
         (SELECT (SELECT count(*) FROM employees) > 0 AND (SELECT count(*) FROM shift_templates) > 0)::text, 'true'
  UNION ALL SELECT 19, 'Rows: rosters / roster_assignments (production on 2026-10-10: 1 / 0)',
         (SELECT count(*) FROM rosters)::text || ' / ' || (SELECT count(*) FROM roster_assignments)::text, NULL
  UNION ALL SELECT 20, 'Published rosters (published_at will be set to their updated_at)',
         (SELECT count(*) FROM rosters WHERE status = 'PUBLISHED')::text, NULL
)
SELECT ord AS "#", check_name, actual, expected,
       CASE WHEN expected IS NULL THEN 'INFO' WHEN actual IS NOT DISTINCT FROM expected THEN 'OK' ELSE 'STOP' END AS result
FROM c ORDER BY ord;
