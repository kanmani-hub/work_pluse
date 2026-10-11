-- =====================================================================================
-- STAGING STEP 2: PART 1 — DRY RUN. Run as ONE script. NOTHING IS KEPT.
-- Generated from docs/proposals/PROPOSED_roster_persistence.sql revision 3.1 (do not edit by hand).
-- Identical to 04_part1_APPLY.sql except the final COMMIT is replaced by a deliberate error and
-- ROLLBACK (and the schema-reload NOTIFY is removed). This works even if the editor would auto-commit.
-- EXPECTED RESULT: an ERROR reading
--   "DRY RUN OK: every step succeeded and everything was rolled back (this error is expected)."
-- Any OTHER error (e.g. "Pre-check failed: …") means STOP. Then run 99_rollback_if_error.sql.
-- =====================================================================================

-- ===================== PART 1: APPLY (one transaction) ==============================
BEGIN;

-- Fail fast instead of waiting behind other sessions' locks (the tables are small)
SET LOCAL lock_timeout = '5s';

-- 1.0 Pre-checks: any failure raises an error, which aborts the whole transaction (nothing changes).
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Pre-check failed: roles anon / authenticated not found (is this a Supabase project?).';
  END IF;
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
    RAISE EXCEPTION 'Pre-check failed: the revision-2 "Admin manages" policies exist; review before continuing.';
  END IF;
  -- Revision 3: the existing write policies must be exactly the reviewed ones (ADMIN / HR only):
  -- FOR ALL, TO authenticated, and both USING and WITH CHECK = get_auth_role() IN ('ADMIN','HR')
  -- (compared after removing spaces and a "public." prefix; exactly the two role literals allowed).
  SELECT count(*) INTO n
    FROM pg_policies p,
         LATERAL (SELECT replace(replace(coalesce(p.qual, ''), ' ', ''), 'public.', '') AS q,
                         replace(replace(coalesce(p.with_check, ''), ' ', ''), 'public.', '') AS w) x
   WHERE p.schemaname = 'public'
     AND ((p.tablename = 'rosters' AND p.policyname = 'Manage rosters')
       OR (p.tablename = 'roster_assignments' AND p.policyname = 'Manage roster_assignments'))
     AND p.cmd = 'ALL' AND p.roles = '{authenticated}'
     AND x.q ~ '^[(]*get_auth_role[(][)]=ANY[(]' AND x.w ~ '^[(]*get_auth_role[(][)]=ANY[(]'
     AND x.q LIKE '%''ADMIN''%' AND x.q LIKE '%''HR''%' AND x.w LIKE '%''ADMIN''%' AND x.w LIKE '%''HR''%'
     AND (SELECT count(*) FROM regexp_matches(x.q, '''[^'']*''', 'g')) = 2
     AND (SELECT count(*) FROM regexp_matches(x.w, '''[^'']*''', 'g')) = 2;
  IF n <> 2 THEN
    RAISE EXCEPTION 'Pre-check failed: "Manage rosters" / "Manage roster_assignments" are missing or differ from get_auth_role() IN (ADMIN, HR) — send PART 0b output for review.';
  END IF;
  -- No other write policy (and nothing for anon / public) may exist on these tables.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('rosters', 'roster_assignments')
     AND policyname NOT IN ('Manage rosters', 'Manage roster_assignments',
                            'Allow authenticated users to read rosters', 'Allow authenticated users to read roster_assignments');
  IF n > 0 THEN RAISE EXCEPTION 'Pre-check failed: % unexpected polic(ies) on rosters / roster_assignments (see PART 0b).', n; END IF;
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
-- 1.2a A roster always has a status (NULL would pass the CHECK above and escape the overlap guard).
--      Safe: the 1.0 pre-check has already aborted if any row has a NULL status; default stays 'DRAFT'.
ALTER TABLE rosters ALTER COLUMN status SET NOT NULL;
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
-- Supabase grants EXECUTE on new functions to anon / authenticated by default: remove it too.
-- (Triggers do not need EXECUTE to fire; the guards call roster_guard_bypass() as the owner.)
REVOKE EXECUTE ON FUNCTION public.roster_guard_bypass() FROM anon, authenticated;

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
-- Supabase grants EXECUTE on new functions to anon / authenticated by default: remove it too.
-- (Triggers do not need EXECUTE to fire; the guards call roster_guard_bypass() as the owner.)
REVOKE EXECUTE ON FUNCTION public.roster_assignments_guard() FROM anon, authenticated;

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
-- Supabase grants EXECUTE on new functions to anon / authenticated by default: remove it too.
-- (Triggers do not need EXECUTE to fire; the guards call roster_guard_bypass() as the owner.)
REVOKE EXECUTE ON FUNCTION public.rosters_guard() FROM anon, authenticated;

CREATE TRIGGER rosters_guard
  BEFORE UPDATE OR DELETE ON rosters
  FOR EACH ROW EXECUTE FUNCTION public.rosters_guard();

-- 1.6 Write policies: revision 3 creates NONE. The existing "Manage rosters" / "Manage roster_assignments"
--     (ADMIN / HR, checked in 1.0) stay as they are; reading stays as in 0002. See PART 5 for ADMIN-only.

-- ===== DRY RUN END: the deliberate error below rolls back EVERYTHING above. =====
DO $$ BEGIN RAISE EXCEPTION 'DRY RUN OK: every step succeeded and everything was rolled back (this error is expected).'; END $$;
ROLLBACK;
-- If anything above failed: run  ROLLBACK;  — no part of PART 1 is kept.

