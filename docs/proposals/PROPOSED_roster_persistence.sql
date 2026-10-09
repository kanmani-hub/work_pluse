-- =====================================================================================
-- PROPOSED (NOT APPLIED) — WorkPulse HR roster persistence, revision 2 (2026-10-09)
-- Review notes: docs/proposals/PROPOSED_roster_persistence_REVIEW.md
--
-- Why: the Shift Roster page cannot save rosters today.
--   * rosters / roster_assignments only have SELECT policies (migration 0002): the app cannot write them.
--   * roster_assignments.shift_template_id is NOT NULL and there is no day type, so a Week Off
--     cannot be stored; there is no work mode (Office / WFH) either.
--   * rosters has a status column (DRAFT / PUBLISHED / ARCHIVED) but no record of who published it and when.
--
-- Owner decisions (2026-10-09): weekly offs are stored per date in the roster; a PUBLISHED roster
-- drives payroll working days / weekly offs; attendance keeps using shift_assignments for the
-- clock-in shift (separate task). Roles: ADMIN manages rosters; everyone signed in may read (unchanged).
--
-- Revision 2 adds database-level safeguards (the app already applies the same rules; these make
-- them impossible to bypass through direct API calls or concurrent edits):
--   * at most ONE active (non-archived) roster may cover any date — overlapping periods are rejected,
--     archived rosters are ignored so a period can be re-planned after archiving;
--   * every roster entry's date must fall inside its roster's start and end dates;
--   * entries of a PUBLISHED or ARCHIVED roster cannot be added, changed or removed — unpublish first;
--   * a PUBLISHED roster cannot change its dates or be deleted, and cannot be unpublished / archived
--     once payroll for a month it covers is APPROVED / PAYMENT_PENDING / PAID / CLOSED.
--   Server-side functions using the service_role key (e.g. the delete-employee function) are exempt.
--
-- Written against supabase/migrations 0002 (rosters, roster_assignments), 0005 (payroll), 0009 and
-- 20260930163500 (get_auth_role) and the app code in src/services/shifts/rosterService.ts.
-- The LIVE database was NOT changed or queried for this file. A read-only check on 2026-10-09 found
-- 0 rows in rosters and 0 rows in roster_assignments.
--
-- ================================ HOW TO APPLY ======================================
--   Use a separate STAGING / TEST project first (see the review notes). Never test on production.
--   STEP 1  Run PART 0 (read-only). Read every result. Stop if anything differs from the notes.
--   STEP 2  Run PART 1 exactly as written: it starts with BEGIN, runs the pre-checks (any failure
--           raises an error and aborts — nothing is changed), applies all changes, and ends with
--           COMMIT. If ANY statement errors, run ROLLBACK; (or close the session) — nothing is kept.
--           Tip: on staging, replace the final COMMIT with ROLLBACK for a dry run first.
--   STEP 3  Run PART 2 (read-only verification) and compare with the expected results.
--   STEP 4  STAGING ONLY: run PART 3 (self-test). It always ends with ROLLBACK and leaves no data.
--   STEP 5  Deploy the app version with rosterService (older app versions never write these tables).
--   Rollback: PART 4 (destructive for Week Off entries — read its warnings first).
-- =====================================================================================


-- ===================== PART 0: READ-ONLY CHECKS (run first, separately) ==============
-- 0a. Current columns (expect roster_assignments.shift_template_id NOT NULL, no day_type / work_mode;
--     rosters without published_at / published_by)
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('rosters', 'roster_assignments')
ORDER BY table_name, ordinal_position;

-- 0b. Current policies (expect only the two "Allow authenticated users to read …" SELECT policies)
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('rosters', 'roster_assignments');

-- 0c. Current constraints (expect: primary keys, foreign keys, valid_roster_date_range; nothing from this file)
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid::regclass::text IN ('rosters', 'roster_assignments');

-- 0d. Current triggers (expect only update_rosters_updated_at / update_roster_assignments_updated_at)
SELECT tgrelid::regclass AS table_name, tgname FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('rosters', 'roster_assignments');

-- 0e. Row counts (0 / 0 on 2026-10-09). If not 0, the checks 0f–0i below must all return no rows.
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


-- ===================== PART 1: APPLY (one transaction) ==============================
BEGIN;

-- Fail fast instead of waiting behind other sessions' locks (the tables are small)
SET LOCAL lock_timeout = '5s';

-- 1.0 Pre-checks: any failure raises an error, which aborts the whole transaction (nothing changes).
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_auth_role') THEN
    RAISE EXCEPTION 'Pre-check failed: public.get_auth_role() is missing.';
  END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'payroll' AND column_name IN ('payroll_year', 'payroll_month', 'status');
  IF n <> 3 THEN RAISE EXCEPTION 'Pre-check failed: payroll.payroll_year / payroll_month / status not found.'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'roster_assignments' AND column_name IN ('day_type', 'work_mode')) THEN
    RAISE EXCEPTION 'Pre-check failed: roster_assignments.day_type / work_mode already exist (migration already applied or partially applied).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
             AND policyname IN ('Admin manages rosters', 'Admin manages roster_assignments')) THEN
    RAISE EXCEPTION 'Pre-check failed: the Admin write policies already exist.';
  END IF;
  SELECT count(*) INTO n FROM (SELECT 1 FROM roster_assignments GROUP BY roster_id, employee_id, assignment_date HAVING count(*) > 1) d;
  IF n > 0 THEN RAISE EXCEPTION 'Pre-check failed: % duplicate roster entries (see PART 0f).', n; END IF;
  SELECT count(*) INTO n FROM roster_assignments a JOIN rosters r ON r.id = a.roster_id
   WHERE a.assignment_date < r.start_date OR a.assignment_date > r.end_date;
  IF n > 0 THEN RAISE EXCEPTION 'Pre-check failed: % roster entries outside their roster dates (see PART 0g).', n; END IF;
  SELECT count(*) INTO n FROM rosters WHERE status IS NULL OR status NOT IN ('DRAFT', 'PUBLISHED', 'ARCHIVED');
  IF n > 0 THEN RAISE EXCEPTION 'Pre-check failed: % rosters with an unknown status (see PART 0h).', n; END IF;
  SELECT count(*) INTO n FROM rosters a JOIN rosters b ON a.id < b.id
   WHERE a.status <> 'ARCHIVED' AND b.status <> 'ARCHIVED'
     AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]');
  IF n > 0 THEN RAISE EXCEPTION 'Pre-check failed: % pairs of overlapping active rosters (see PART 0i).', n; END IF;
  SELECT count(*) INTO n FROM rosters WHERE status = 'PUBLISHED';
  IF n > 0 THEN RAISE NOTICE 'Note: % published roster(s) exist; published_at will be set to their updated_at.', n; END IF;
END $$;

-- 1.1 roster_assignments: day type, work mode, optional shift on a week off, one entry per day
ALTER TABLE roster_assignments ADD COLUMN day_type VARCHAR(20) NOT NULL DEFAULT 'WORK';
ALTER TABLE roster_assignments ADD COLUMN work_mode VARCHAR(20) NOT NULL DEFAULT 'OFFICE';
ALTER TABLE roster_assignments ALTER COLUMN shift_template_id DROP NOT NULL;
ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignments_day_type_check
  CHECK (day_type IN ('WORK', 'WEEK_OFF'));
ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignments_work_mode_check
  CHECK (work_mode IN ('OFFICE', 'WFH'));
-- A working day must name its shift; a weekly off has none.
ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignments_shift_for_work_check
  CHECK ((day_type = 'WORK' AND shift_template_id IS NOT NULL) OR (day_type = 'WEEK_OFF' AND shift_template_id IS NULL));
-- One entry per employee per date in a roster (the app upserts on exactly this key).
ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignments_unique_day
  UNIQUE (roster_id, employee_id, assignment_date);

-- 1.2 rosters: publication record, valid statuses, one active roster per date
ALTER TABLE rosters ADD COLUMN published_at TIMESTAMPTZ;
ALTER TABLE rosters ADD COLUMN published_by UUID REFERENCES employees(id) ON DELETE SET NULL;
-- Rosters already PUBLISHED before this migration get a publication time so 1.2b holds.
UPDATE rosters SET published_at = COALESCE(updated_at, created_at, now()) WHERE status = 'PUBLISHED' AND published_at IS NULL;
ALTER TABLE rosters ADD CONSTRAINT rosters_status_check
  CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));
-- 1.2b A published roster always records when it was published.
ALTER TABLE rosters ADD CONSTRAINT rosters_published_at_check
  CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL);
-- 1.2c At most one active roster covers any date. Overlap (not just identical dates) is rejected,
--      because the Roster page can produce Mon–Sun and Sun–Sat weeks for the same days (see review).
--      Archived rosters are ignored, so a period can be planned again after archiving.
--      daterange && uses the built-in GiST range operator class (no extension needed).
ALTER TABLE rosters ADD CONSTRAINT rosters_no_overlapping_active
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&) WHERE (status <> 'ARCHIVED');

-- 1.3 Who may bypass the guards: only server-side calls made with the service_role key.
--     (Handles both PostgREST claim formats. Ordinary signed-in users — including Admins — never bypass.)
CREATE OR REPLACE FUNCTION public.roster_guard_bypass()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
           NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           NULLIF(current_setting('request.jwt.claim.role', true), ''),
           ''
         ) = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.roster_guard_bypass() FROM PUBLIC;

-- 1.4 roster_assignments guard (BEFORE INSERT / UPDATE / DELETE, per row)
--     * the entry's date must be inside its roster's dates;
--     * only entries of a DRAFT roster may be added, changed or removed.
--     The roster row is locked FOR SHARE so a concurrent publish/unpublish waits for this change
--     (and vice versa): an entry can never slip into a roster that is being published.
--     SECURITY DEFINER so the checks see the roster row regardless of the caller's RLS.
CREATE OR REPLACE FUNCTION public.roster_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r rosters%ROWTYPE;
BEGIN
  IF public.roster_guard_bypass() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO r FROM rosters WHERE id = OLD.roster_id FOR SHARE;
    -- NOT FOUND = the roster itself is being deleted (cascade from a DRAFT roster): allowed
    IF FOUND AND r.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'This roster is %. Unpublish it before changing its entries.', lower(r.status)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT * INTO r FROM rosters WHERE id = NEW.roster_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Roster not found.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF r.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'This roster is %. Unpublish it before changing its entries.', lower(r.status)
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.assignment_date < r.start_date OR NEW.assignment_date > r.end_date THEN
      RAISE EXCEPTION 'The date % is outside this roster (% to %).', NEW.assignment_date, r.start_date, r.end_date
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.roster_assignments_guard() FROM PUBLIC;

CREATE TRIGGER roster_assignments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON roster_assignments
  FOR EACH ROW EXECUTE FUNCTION public.roster_assignments_guard();

-- 1.5 rosters guard (BEFORE UPDATE / DELETE, per row)
--     * publish: only DRAFT → PUBLISHED, only with at least one entry; publication time is filled in;
--     * a PUBLISHED roster cannot change its dates or be deleted;
--     * leaving PUBLISHED (unpublish → DRAFT, or archive) is refused once payroll for any month the
--       roster covers is APPROVED / PAYMENT_PENDING / PAID / CLOSED (same rule as the app);
--     * changing dates of a DRAFT roster is refused if any entry would fall outside the new dates.
CREATE OR REPLACE FUNCTION public.rosters_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.roster_guard_bypass() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'A published roster cannot be deleted. Unpublish it first.' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF (NEW.start_date, NEW.end_date) IS DISTINCT FROM (OLD.start_date, OLD.end_date) THEN
    IF OLD.status = 'PUBLISHED' THEN
      RAISE EXCEPTION 'The dates of a published roster cannot be changed. Unpublish it first.' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM roster_assignments a WHERE a.roster_id = OLD.id
               AND (a.assignment_date < NEW.start_date OR a.assignment_date > NEW.end_date)) THEN
      RAISE EXCEPTION 'Some roster entries would fall outside the new dates.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'PUBLISHED' AND OLD.status IS DISTINCT FROM 'PUBLISHED' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only a draft roster can be published.' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM roster_assignments a WHERE a.roster_id = OLD.id) THEN
      RAISE EXCEPTION 'Save at least one roster entry before publishing.' USING ERRCODE = 'P0001';
    END IF;
    NEW.published_at := COALESCE(NEW.published_at, now());
  END IF;

  IF OLD.status = 'PUBLISHED' AND NEW.status IS DISTINCT FROM 'PUBLISHED' THEN
    IF EXISTS (
      SELECT 1 FROM payroll p
      WHERE p.status IN ('APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED')
        AND make_date(p.payroll_year, p.payroll_month, 1) <= OLD.end_date
        AND (make_date(p.payroll_year, p.payroll_month, 1) + interval '1 month' - interval '1 day')::date >= OLD.start_date
    ) THEN
      RAISE EXCEPTION 'Payroll for this period is already approved or paid, so its roster cannot be changed.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.rosters_guard() FROM PUBLIC;

CREATE TRIGGER rosters_guard
  BEFORE UPDATE OR DELETE ON rosters
  FOR EACH ROW EXECUTE FUNCTION public.rosters_guard();

-- 1.6 Write policies (ADMIN only). Reading stays as in 0002 (all signed-in users); nothing is dropped.
CREATE POLICY "Admin manages rosters" ON rosters
  FOR ALL TO authenticated
  USING (public.get_auth_role() = 'ADMIN')
  WITH CHECK (public.get_auth_role() = 'ADMIN');

CREATE POLICY "Admin manages roster_assignments" ON roster_assignments
  FOR ALL TO authenticated
  USING (public.get_auth_role() = 'ADMIN')
  WITH CHECK (public.get_auth_role() = 'ADMIN');

COMMIT;
-- If anything above failed: run  ROLLBACK;  — no part of PART 1 is kept.


-- ===================== PART 2: VERIFY (read-only, after COMMIT) =====================
-- 2a. New columns (expect day_type / work_mode NOT NULL with defaults; shift_template_id nullable;
--     rosters.published_at, published_by)
SELECT table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('rosters', 'roster_assignments')
  AND column_name IN ('day_type', 'work_mode', 'shift_template_id', 'published_at', 'published_by');

-- 2b. Constraints (expect: roster_assignments_day_type_check, _work_mode_check, _shift_for_work_check,
--     _unique_day; rosters_status_check, rosters_published_at_check, rosters_no_overlapping_active)
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid::regclass::text IN ('rosters', 'roster_assignments') ORDER BY 1, 2;

-- 2c. Triggers (expect roster_assignments_guard and rosters_guard, plus the updated_at triggers)
SELECT tgrelid::regclass AS table_name, tgname FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid::regclass::text IN ('rosters', 'roster_assignments') ORDER BY 1, 2;

-- 2d. Policies (expect, per table: the original SELECT policy + "Admin manages …" FOR ALL)
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('rosters', 'roster_assignments') ORDER BY 1, 2;

-- 2e. Data unchanged (same counts as PART 0e)
SELECT (SELECT count(*) FROM rosters) AS rosters, (SELECT count(*) FROM roster_assignments) AS roster_assignments;


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
BEGIN
  IF emp IS NULL OR shf IS NULL THEN RAISE NOTICE 'SKIPPED: no employee or shift template in this project.'; RETURN; END IF;

  INSERT INTO rosters (name, start_date, end_date, status) VALUES ('SELFTEST', DATE '2031-01-06', DATE '2031-01-12', 'DRAFT') RETURNING id INTO r1;
  INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date, day_type, work_mode)
    VALUES (r1, emp, shf, DATE '2031-01-06', 'WORK', 'WFH');
  INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date, day_type)
    VALUES (r1, emp, NULL, DATE '2031-01-07', 'WEEK_OFF');
  RAISE NOTICE 'PASS: draft roster accepts a WORK (WFH) entry and a WEEK_OFF entry';

  ok := false; BEGIN
    INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date) VALUES (r1, emp, shf, DATE '2031-01-13');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  RAISE NOTICE '% : entry outside the roster dates is rejected', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  ok := false; BEGIN
    INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date, day_type) VALUES (r1, emp, NULL, DATE '2031-01-08', 'WORK');
  EXCEPTION WHEN check_violation THEN ok := true; END;
  RAISE NOTICE '% : WORK entry without a shift is rejected', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  ok := false; BEGIN
    INSERT INTO rosters (name, start_date, end_date, status) VALUES ('SELFTEST overlap', DATE '2031-01-05', DATE '2031-01-11', 'DRAFT');
  EXCEPTION WHEN exclusion_violation THEN ok := true; END;
  RAISE NOTICE '% : an overlapping active roster (Sun–Sat over Mon–Sun) is rejected', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  UPDATE rosters SET status = 'PUBLISHED' WHERE id = r1;
  ok := (SELECT published_at IS NOT NULL FROM rosters WHERE id = r1);
  RAISE NOTICE '% : publishing works and records published_at', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  ok := false; BEGIN
    UPDATE roster_assignments SET work_mode = 'OFFICE' WHERE roster_id = r1 AND assignment_date = DATE '2031-01-06';
  EXCEPTION WHEN raise_exception THEN ok := true; END;
  RAISE NOTICE '% : entries of a published roster cannot be edited', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  ok := false; BEGIN
    DELETE FROM rosters WHERE id = r1;
  EXCEPTION WHEN raise_exception THEN ok := true; END;
  RAISE NOTICE '% : a published roster cannot be deleted', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;

  UPDATE rosters SET status = 'DRAFT', published_at = NULL, published_by = NULL WHERE id = r1;
  UPDATE roster_assignments SET work_mode = 'OFFICE' WHERE roster_id = r1 AND assignment_date = DATE '2031-01-06';
  RAISE NOTICE 'PASS: after unpublishing, entries can be edited again';

  UPDATE rosters SET status = 'ARCHIVED' WHERE id = r1;
  INSERT INTO rosters (name, start_date, end_date, status) VALUES ('SELFTEST replacement', DATE '2031-01-06', DATE '2031-01-12', 'DRAFT') RETURNING id INTO r2;
  RAISE NOTICE 'PASS: after archiving, the same period can be planned again';

  ok := false; BEGIN
    INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date) VALUES (r1, emp, shf, DATE '2031-01-09');
  EXCEPTION WHEN raise_exception THEN ok := true; END;
  RAISE NOTICE '% : an archived roster cannot receive entries', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END;
END $$;
ROLLBACK;  -- ALWAYS roll back the self-test


-- ===================== PART 4: ROLLBACK (only if the feature is abandoned) =============
-- WARNING — DESTRUCTIVE: the old schema cannot store a Week Off, so every WEEK_OFF entry is
-- PERMANENTLY DELETED (4.1). Work-mode (WFH) values and publication records (who / when) are
-- also lost. Export them first if they matter:
--   SELECT * FROM roster_assignments WHERE day_type = 'WEEK_OFF' OR work_mode = 'WFH';
--   SELECT id, name, start_date, end_date, status, published_at, published_by FROM rosters;
-- After rollback, payroll treats those dates according to the company working days.
-- Run as one transaction. The first statement refuses to continue unless you confirm the deletion
-- in the same session by running:  SELECT set_config('roster.rollback_confirm', 'DELETE_WEEK_OFFS', true);
-- (place that line right after BEGIN).
/*
BEGIN;
SET LOCAL lock_timeout = '5s';
-- SELECT set_config('roster.rollback_confirm', 'DELETE_WEEK_OFFS', true);   -- uncomment to confirm
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM roster_assignments WHERE day_type = 'WEEK_OFF';
  IF COALESCE(current_setting('roster.rollback_confirm', true), '') <> 'DELETE_WEEK_OFFS' THEN
    RAISE EXCEPTION 'Rollback not confirmed: % Week Off entries would be permanently deleted. See the PART 4 warnings.', n;
  END IF;
  RAISE NOTICE 'Rollback confirmed: deleting % Week Off entries.', n;
END $$;

DROP POLICY IF EXISTS "Admin manages roster_assignments" ON roster_assignments;
DROP POLICY IF EXISTS "Admin manages rosters" ON rosters;
DROP TRIGGER IF EXISTS rosters_guard ON rosters;
DROP TRIGGER IF EXISTS roster_assignments_guard ON roster_assignments;
DROP FUNCTION IF EXISTS public.rosters_guard();
DROP FUNCTION IF EXISTS public.roster_assignments_guard();
DROP FUNCTION IF EXISTS public.roster_guard_bypass();

ALTER TABLE rosters DROP CONSTRAINT IF EXISTS rosters_no_overlapping_active;
ALTER TABLE rosters DROP CONSTRAINT IF EXISTS rosters_published_at_check;
ALTER TABLE rosters DROP CONSTRAINT IF EXISTS rosters_status_check;
ALTER TABLE rosters DROP COLUMN IF EXISTS published_by;
ALTER TABLE rosters DROP COLUMN IF EXISTS published_at;

ALTER TABLE roster_assignments DROP CONSTRAINT IF EXISTS roster_assignments_unique_day;
ALTER TABLE roster_assignments DROP CONSTRAINT IF EXISTS roster_assignments_shift_for_work_check;
ALTER TABLE roster_assignments DROP CONSTRAINT IF EXISTS roster_assignments_work_mode_check;
ALTER TABLE roster_assignments DROP CONSTRAINT IF EXISTS roster_assignments_day_type_check;
-- 4.1 DESTRUCTIVE: Week Off entries cannot exist in the old schema (shift was required)
DELETE FROM roster_assignments WHERE shift_template_id IS NULL;
ALTER TABLE roster_assignments ALTER COLUMN shift_template_id SET NOT NULL;
ALTER TABLE roster_assignments DROP COLUMN IF EXISTS work_mode;
ALTER TABLE roster_assignments DROP COLUMN IF EXISTS day_type;
COMMIT;
-- If anything failed: ROLLBACK;  (the database stays as it was before this rollback attempt)
-- Then deploy an app version that does not use rosterService for writes.
*/
