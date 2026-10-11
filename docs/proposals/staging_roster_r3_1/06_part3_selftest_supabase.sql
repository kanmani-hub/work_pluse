-- =====================================================================================
-- STAGING STEP 5: PART 3 SELF-TEST (STAGING ONLY). Run as ONE script. Leaves NO data.
-- Generated from docs/proposals/PROPOSED_roster_persistence.sql revision 3.1 (do not edit by hand).
-- Same tests as PART 3; because the Supabase SQL editor does not display RAISE NOTICE, the results
-- are collected and shown in ONE deliberate error at the end, which also rolls everything back.
-- EXPECTED RESULT: an ERROR starting "SELF-TEST FINISHED (all test data rolled back):" followed by
-- 10 lines that all contain PASS. Any FAIL line, or any other error, means STOP.
-- Uses dates in 2031 so it never touches real roster weeks.
-- =====================================================================================

-- ===================== PART 3: SELF-TEST (STAGING ONLY — always rolled back) ==========
-- Needs at least one employee and one shift template in the staging project. Runs as an ordinary
-- signed-in user (not service_role) so the guards apply. Prints PASS / FAIL notices; leaves no data.
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $$
DECLARE
  emp uuid := (SELECT id FROM employees LIMIT 1);
  shf uuid := (SELECT id FROM shift_templates LIMIT 1);
  r1 uuid; r2 uuid;
  ok boolean;
  res text := '';
BEGIN
  IF emp IS NULL OR shf IS NULL THEN RAISE EXCEPTION 'SELF-TEST SKIPPED: no employee or shift template in this project (nothing was changed).'; END IF;

  INSERT INTO rosters (name, start_date, end_date, status) VALUES ('SELFTEST', DATE '2031-01-06', DATE '2031-01-12', 'DRAFT') RETURNING id INTO r1;
  INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date, day_type, work_mode)
    VALUES (r1, emp, shf, DATE '2031-01-06', 'WORK', 'WFH');
  INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date, day_type)
    VALUES (r1, emp, NULL, DATE '2031-01-07', 'WEEK_OFF');
  res := res || E'\n' || format('PASS: draft roster accepts a WORK (WFH) entry and a WEEK_OFF entry');

  ok := false; BEGIN
    INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date) VALUES (r1, emp, shf, DATE '2031-01-13');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  res := res || E'\n' || format('%s : entry outside the roster dates is rejected', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  ok := false; BEGIN
    INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date, day_type) VALUES (r1, emp, NULL, DATE '2031-01-08', 'WORK');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  res := res || E'\n' || format('%s : WORK entry without a shift is rejected', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  ok := false; BEGIN
    INSERT INTO rosters (name, start_date, end_date, status) VALUES ('SELFTEST overlap', DATE '2031-01-05', DATE '2031-01-11', 'DRAFT');
  EXCEPTION WHEN exclusion_violation THEN ok := true; END;
  res := res || E'\n' || format('%s : an overlapping active roster (Sun–Sat over Mon–Sun) is rejected', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  UPDATE rosters SET status = 'PUBLISHED' WHERE id = r1;
  ok := (SELECT published_at IS NOT NULL FROM rosters WHERE id = r1);
  res := res || E'\n' || format('%s : publishing works and records published_at', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  ok := false; BEGIN
    UPDATE roster_assignments SET work_mode = 'OFFICE' WHERE roster_id = r1 AND assignment_date = DATE '2031-01-06';
  EXCEPTION WHEN raise_exception THEN ok := true; END;
  res := res || E'\n' || format('%s : entries of a published roster cannot be edited', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  ok := false; BEGIN
    DELETE FROM rosters WHERE id = r1;
  EXCEPTION WHEN raise_exception THEN ok := true; END;
  res := res || E'\n' || format('%s : a published roster cannot be deleted', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);

  UPDATE rosters SET status = 'DRAFT', published_at = NULL, published_by = NULL WHERE id = r1;
  UPDATE roster_assignments SET work_mode = 'OFFICE' WHERE roster_id = r1 AND assignment_date = DATE '2031-01-06';
  res := res || E'\n' || format('PASS: after unpublishing, entries can be edited again');

  UPDATE rosters SET status = 'ARCHIVED' WHERE id = r1;
  INSERT INTO rosters (name, start_date, end_date, status) VALUES ('SELFTEST replacement', DATE '2031-01-06', DATE '2031-01-12', 'DRAFT') RETURNING id INTO r2;
  res := res || E'\n' || format('PASS: after archiving, the same period can be planned again');

  ok := false; BEGIN
    INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date) VALUES (r1, emp, shf, DATE '2031-01-09');
  EXCEPTION WHEN raise_exception THEN ok := true; END;
  res := res || E'\n' || format('%s : an archived roster cannot receive entries', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END);
  -- Supabase SQL editor does not show NOTICEs: report through a deliberate error (also guarantees rollback)
  RAISE EXCEPTION 'SELF-TEST FINISHED (all test data rolled back):%', res;
END $$;
ROLLBACK;  -- ALWAYS roll back the self-test
