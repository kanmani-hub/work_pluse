-- =====================================================================================
-- STAGING STEP 4b (optional detail): PART 2 exactly as reviewed. READ-ONLY.
-- Select ONE query at a time and Run (the editor shows only the last result), or use 05_part2_verify_summary.sql.
-- Generated from docs/proposals/PROPOSED_roster_persistence.sql revision 3.1 (do not edit by hand).
-- =====================================================================================

-- ===================== PART 2: VERIFY (read-only, after COMMIT) =====================
-- 2a. New columns (expect day_type / work_mode NOT NULL with defaults; shift_template_id nullable;
--     rosters.published_at, published_by; rosters.status NOT NULL with default 'DRAFT')
SELECT table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('rosters', 'roster_assignments')
  AND column_name IN ('day_type', 'work_mode', 'shift_template_id', 'published_at', 'published_by', 'status');

-- 2a2. Function privileges (expect false for anon and authenticated on all three functions)
SELECT p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
WHERE ns.nspname = 'public' AND p.proname IN ('roster_guard_bypass', 'roster_assignments_guard', 'rosters_guard');

-- 2b. Constraints (expect: roster_assignments_day_type_check, _work_mode_check, _shift_for_work_check,
--     _unique_day; rosters_status_check, rosters_published_at_check, rosters_no_overlapping_active)
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid::regclass::text IN ('rosters', 'roster_assignments') ORDER BY 1, 2;

-- 2c. Triggers (expect roster_assignments_guard and rosters_guard, plus the updated_at triggers)
SELECT tgrelid::regclass AS table_name, tgname FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('rosters', 'roster_assignments') ORDER BY 1, 2;

-- 2d. Policies (expect UNCHANGED from PART 0b: per table the original SELECT policy + "Manage …" FOR ALL)
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('rosters', 'roster_assignments') ORDER BY 1, 2;

-- 2e. Data unchanged (same counts as PART 0e; the existing DRAFT roster is still there)
SELECT (SELECT count(*) FROM rosters) AS rosters, (SELECT count(*) FROM roster_assignments) AS roster_assignments;
