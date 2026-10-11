-- =====================================================================================
-- STAGING STEP 6 (optional, after steps 1–5): ROSTER PERMISSIONS BY ROLE — STAGING ONLY.
-- Impersonates three real STAGING sign-ins (ADMIN, HR, EMPLOYEE) exactly as the API does
-- (role authenticated + the user's id in the JWT), so the live RLS policies and the real
-- get_auth_role() are used. Works on a 2031 test roster created inside this transaction.
-- Nothing is kept: the script always ends with a deliberate error that rolls everything back.
--
-- BEFORE RUNNING: replace the three placeholders below with STAGING auth user ids. Find them with
-- (read-only):
--   SELECT r.name AS role, p.auth_user_id, p.is_active FROM profiles p JOIN roles r ON r.id = p.role_id
--   WHERE r.name IN ('ADMIN','HR','EMPLOYEE') ORDER BY 1;
-- EXPECTED RESULT: an ERROR starting "ROLE CHECK FINISHED (rolled back):" followed by 3 role lines
-- (ADMIN / HR / EMPLOYEE, each must show the expected role) and 8 lines that all start with PASS.
-- =====================================================================================
BEGIN;
DO $$
DECLARE
  admin_uid text := 'PASTE-ADMIN-AUTH-USER-ID';
  hr_uid    text := 'PASTE-HR-AUTH-USER-ID';
  emp_uid   text := 'PASTE-EMPLOYEE-AUTH-USER-ID';
  emp uuid := (SELECT id FROM employees LIMIT 1);
  shf uuid := (SELECT id FROM shift_templates LIMIT 1);
  r1 uuid;
  res text := '';
  outcome text;

BEGIN
  IF admin_uid LIKE 'PASTE-%' OR hr_uid LIKE 'PASTE-%' OR emp_uid LIKE 'PASTE-%' THEN
    RAISE EXCEPTION 'ROLE CHECK NOT RUN: replace the three PASTE-… placeholders with staging auth user ids first.';
  END IF;
  IF emp IS NULL OR shf IS NULL THEN RAISE EXCEPTION 'ROLE CHECK NOT RUN: no employee or shift template in this project.'; END IF;

  -- ADMIN creates a test roster and saves Office / WFH / Week Off (the app's upsert)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  res := res || E'\n' || format('get_auth_role() for ADMIN id = %s (expect ADMIN)', coalesce(public.get_auth_role(), 'NULL'));
  INSERT INTO rosters (name, start_date, end_date, status) VALUES ('ROLECHECK', DATE '2031-03-03', DATE '2031-03-09', 'DRAFT') RETURNING id INTO r1;
  INSERT INTO roster_assignments (roster_id, employee_id, assignment_date, day_type, shift_template_id, work_mode) VALUES
    (r1, emp, DATE '2031-03-03', 'WORK', shf, 'OFFICE'),
    (r1, emp, DATE '2031-03-04', 'WORK', shf, 'WFH'),
    (r1, emp, DATE '2031-03-05', 'WEEK_OFF', NULL, 'OFFICE')
  ON CONFLICT (roster_id, employee_id, assignment_date) DO UPDATE
    SET day_type = EXCLUDED.day_type, shift_template_id = EXCLUDED.shift_template_id, work_mode = EXCLUDED.work_mode;
  res := res || E'\n' || 'PASS : ADMIN saved Office, WFH and Week Off';
  UPDATE roster_assignments SET day_type = 'WEEK_OFF', shift_template_id = NULL WHERE roster_id = r1 AND assignment_date = DATE '2031-03-03';
  res := res || E'\n' || 'PASS : ADMIN changed Office → Week Off';
  UPDATE rosters SET status = 'PUBLISHED', published_at = now() WHERE id = r1;
  res := res || E'\n' || 'PASS : ADMIN published';
  UPDATE rosters SET status = 'DRAFT', published_at = NULL, published_by = NULL WHERE id = r1;
  res := res || E'\n' || 'PASS : ADMIN unpublished';
  EXECUTE 'RESET ROLE';

  -- HR (allowed by "Manage …" policies)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', hr_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  res := res || E'\n' || format('get_auth_role() for HR id = %s (expect HR)', coalesce(public.get_auth_role(), 'NULL'));
  INSERT INTO roster_assignments (roster_id, employee_id, assignment_date, day_type, shift_template_id, work_mode)
    VALUES (r1, emp, DATE '2031-03-06', 'WORK', shf, 'OFFICE');
  res := res || E'\n' || 'PASS : HR saved a roster entry';
  EXECUTE 'RESET ROLE';

  -- EMPLOYEE: may read, must not write
  PERFORM set_config('request.jwt.claims', json_build_object('sub', emp_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  res := res || E'\n' || format('get_auth_role() for EMPLOYEE id = %s (expect EMPLOYEE)', coalesce(public.get_auth_role(), 'NULL'));
  res := res || E'\n' || CASE WHEN (SELECT count(*) FROM roster_assignments WHERE roster_id = r1) = 4
                              THEN 'PASS : EMPLOYEE can read the roster (4 entries)' ELSE 'FAIL : EMPLOYEE cannot read the roster entries' END;
  BEGIN
    INSERT INTO roster_assignments (roster_id, employee_id, assignment_date, day_type, shift_template_id, work_mode)
      VALUES (r1, emp, DATE '2031-03-07', 'WORK', shf, 'OFFICE');
    outcome := 'FAIL : EMPLOYEE could save a roster entry';
  EXCEPTION WHEN insufficient_privilege THEN outcome := 'PASS : EMPLOYEE cannot save roster entries';
  END;
  res := res || E'\n' || outcome;
  UPDATE roster_assignments SET work_mode = 'WFH' WHERE roster_id = r1;   -- RLS hides rows from writes: 0 rows changed
  GET DIAGNOSTICS outcome = ROW_COUNT;
  res := res || E'\n' || CASE WHEN outcome = '0' THEN 'PASS : EMPLOYEE cannot change roster entries' ELSE 'FAIL : EMPLOYEE changed ' || outcome || ' entries' END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'ROLE CHECK FINISHED (rolled back):%', res;
END $$;
ROLLBACK;
