-- =====================================================================================
-- WorkPulse HR roster migration revision 3.1 — STAGING STEP 4: PART 2 VERIFY SUMMARY (READ-ONLY)
-- Run AFTER 04_part1_APPLY.sql has committed. One result table; changes nothing.
-- Every row must show result = OK. Compare the INFO row with step 1 (row counts must be unchanged).
-- =====================================================================================
WITH col AS (
  SELECT table_name, column_name, is_nullable, column_default
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('rosters', 'roster_assignments')
),
pol AS (
  SELECT p.tablename, p.policyname, p.cmd, p.roles,
         replace(replace(coalesce(p.qual, ''), ' ', ''), 'public.', '') AS q,
         replace(replace(coalesce(p.with_check, ''), ' ', ''), 'public.', '') AS w
  FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename IN ('rosters', 'roster_assignments')
),
fn AS (
  SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN ('roster_guard_bypass', 'roster_assignments_guard', 'rosters_guard')
),
c AS (
  SELECT 1 AS ord, 'roster_assignments.day_type NOT NULL, default WORK' AS check_name,
         (SELECT is_nullable || ' / ' || coalesce(column_default, '') FROM col WHERE table_name = 'roster_assignments' AND column_name = 'day_type') AS actual,
         'NO / ''WORK''::character varying' AS expected
  UNION ALL SELECT 2, 'roster_assignments.work_mode NOT NULL, default OFFICE',
         (SELECT is_nullable || ' / ' || coalesce(column_default, '') FROM col WHERE table_name = 'roster_assignments' AND column_name = 'work_mode'),
         'NO / ''OFFICE''::character varying'
  UNION ALL SELECT 3, 'roster_assignments.shift_template_id nullable (Week Off has no shift)',
         (SELECT is_nullable FROM col WHERE table_name = 'roster_assignments' AND column_name = 'shift_template_id'), 'YES'
  UNION ALL SELECT 4, 'rosters.status NOT NULL, default DRAFT',
         (SELECT is_nullable || ' / ' || coalesce(column_default, '') FROM col WHERE table_name = 'rosters' AND column_name = 'status'),
         'NO / ''DRAFT''::character varying'
  UNION ALL SELECT 5, 'rosters.published_at / published_by exist',
         (SELECT count(*) FROM col WHERE table_name = 'rosters' AND column_name IN ('published_at', 'published_by'))::text, '2'
  UNION ALL SELECT 6, 'New constraints present (7)',
         (SELECT count(*) FROM pg_constraint WHERE conrelid::regclass::text IN ('rosters', 'roster_assignments')
           AND conname IN ('roster_assignments_day_type_check', 'roster_assignments_work_mode_check', 'roster_assignments_shift_for_work_check',
                           'roster_assignments_unique_day', 'rosters_status_check', 'rosters_published_at_check', 'rosters_no_overlapping_active'))::text, '7'
  UNION ALL SELECT 7, 'Unique key used by the app upsert',
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'roster_assignments_unique_day'),
         'UNIQUE (roster_id, employee_id, assignment_date)'
  UNION ALL SELECT 8, 'Triggers',
         (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger WHERE NOT tgisinternal
           AND tgrelid::regclass::text IN ('rosters', 'roster_assignments')),
         'roster_assignments_guard, rosters_guard, update_roster_assignments_updated_at, update_rosters_updated_at'
  UNION ALL SELECT 9, 'Guard functions present (3)', (SELECT count(*) FROM fn)::text, '3'
  UNION ALL SELECT 10, 'anon / authenticated can EXECUTE a guard function (must be none)',
         (SELECT count(*) FROM fn WHERE has_function_privilege('anon', oid, 'EXECUTE') OR has_function_privilege('authenticated', oid, 'EXECUTE'))::text, '0'
  UNION ALL SELECT 11, 'Policies unchanged: total', (SELECT count(*) FROM pol)::text, '4'
  UNION ALL SELECT 12, 'Policies unchanged: Manage … = get_auth_role() IN (ADMIN, HR)',
         (SELECT count(*) FROM pol WHERE policyname IN ('Manage rosters', 'Manage roster_assignments') AND cmd = 'ALL' AND roles = '{authenticated}'
           AND q ~ '^[(]*get_auth_role[(][)]=ANY[(]' AND w ~ '^[(]*get_auth_role[(][)]=ANY[(]'
           AND q LIKE '%''ADMIN''%' AND q LIKE '%''HR''%' AND w LIKE '%''ADMIN''%' AND w LIKE '%''HR''%'
           AND (SELECT count(*) FROM regexp_matches(q, '''[^'']*''', 'g')) = 2
           AND (SELECT count(*) FROM regexp_matches(w, '''[^'']*''', 'g')) = 2)::text, '2'
  UNION ALL SELECT 13, 'Policies unchanged: read policies',
         (SELECT count(*) FROM pol WHERE policyname IN ('Allow authenticated users to read rosters', 'Allow authenticated users to read roster_assignments')
           AND cmd = 'SELECT' AND q = 'true')::text, '2'
  UNION ALL SELECT 14, 'Rows: rosters / roster_assignments (must equal step 1)',
         (SELECT count(*) FROM rosters)::text || ' / ' || (SELECT count(*) FROM roster_assignments)::text, NULL
  UNION ALL SELECT 15, 'Existing entries became WORK / OFFICE (count of other values)',
         (SELECT count(*) FROM roster_assignments WHERE day_type <> 'WORK' OR work_mode <> 'OFFICE')::text, '0'
)
SELECT ord AS "#", check_name, actual, expected,
       CASE WHEN expected IS NULL THEN 'INFO' WHEN actual IS NOT DISTINCT FROM expected THEN 'OK' ELSE 'STOP' END AS result
FROM c ORDER BY ord;
