-- =====================================================================================
-- STAGING STEP 1b (optional detail): PART 0 exactly as reviewed. READ-ONLY.
-- The Supabase SQL editor shows only the LAST result of a script: select ONE query at a time
-- (highlight it) and press Run, or use 02_part0_summary.sql instead.
-- Generated from docs/proposals/PROPOSED_roster_persistence.sql revision 3.1 (do not edit by hand).
-- =====================================================================================

-- ===================== PART 0: READ-ONLY CHECKS (run first, separately) ==============
-- 0a. Current columns (expect roster_assignments.shift_template_id NOT NULL, no day_type / work_mode;
--     rosters without published_at / published_by)
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('rosters', 'roster_assignments')
ORDER BY table_name, ordinal_position;

-- 0b. Current policies (revision 3 expects 4: the two "Allow authenticated users to read …" SELECT policies
--     and "Manage rosters" / "Manage roster_assignments" FOR ALL with get_auth_role() IN ('ADMIN','HR'))
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('rosters', 'roster_assignments');

-- 0c. Current constraints (expect: primary keys, foreign keys, valid_roster_date_range; nothing from this file)
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid::regclass::text IN ('rosters', 'roster_assignments');

-- 0d. Current triggers (expect only update_rosters_updated_at / update_roster_assignments_updated_at)
SELECT tgrelid::regclass AS table_name, tgname FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('rosters', 'roster_assignments');

-- 0e. Row counts (1 / 0 on 2026-10-10). The checks 0f–0i below must all return no rows.
SELECT (SELECT count(*) FROM rosters) AS rosters, (SELECT count(*) FROM roster_assignments) AS roster_assignments;

-- 0f. Duplicate entries per roster / employee / date (expect no rows)
SELECT roster_id, employee_id, assignment_date, count(*) FROM roster_assignments GROUP BY 1, 2, 3 HAVING count(*) > 1;

-- 0g. Entries outside their roster's dates (expect no rows)
SELECT a.id, a.roster_id, a.assignment_date, r.start_date, r.end_date
FROM roster_assignments a JOIN rosters r ON r.id = a.roster_id
WHERE a.assignment_date < r.start_date OR a.assignment_date > r.end_date;

-- 0h. Statuses other than DRAFT / PUBLISHED / ARCHIVED (expect no rows)
SELECT id, status FROM rosters WHERE status IS NULL OR status NOT IN ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- 0i. Overlapping active (non-archived) rosters (expect no rows)
SELECT a.id, a.start_date, a.end_date, b.id AS overlaps_with, b.start_date, b.end_date
FROM rosters a JOIN rosters b ON a.id < b.id
WHERE a.status <> 'ARCHIVED' AND b.status <> 'ARCHIVED'
  AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]');

-- 0j. Functions / columns this file relies on (expect get_auth_role = 1; payroll columns 3 rows)
SELECT count(*) AS get_auth_role FROM pg_proc WHERE proname = 'get_auth_role';
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'payroll' AND column_name IN ('payroll_year', 'payroll_month', 'status');
