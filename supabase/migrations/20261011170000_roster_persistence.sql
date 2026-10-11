-- 20261011170000_roster_persistence.sql
-- Fixes: "Could not find the 'day_type' column of 'roster_assignments' in the schema cache"
-- Enables saving and publishing shift rosters in WorkPulse HR.

-- 1. Add missing columns to roster_assignments
ALTER TABLE roster_assignments ADD COLUMN IF NOT EXISTS day_type VARCHAR(20) NOT NULL DEFAULT 'WORK';
ALTER TABLE roster_assignments ADD COLUMN IF NOT EXISTS work_mode VARCHAR(20) NOT NULL DEFAULT 'OFFICE';
ALTER TABLE roster_assignments ALTER COLUMN shift_template_id DROP NOT NULL;

-- 2. Constraints for roster_assignments
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roster_assignments_day_type_check') THEN
    ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignments_day_type_check 
      CHECK (day_type IN ('WORK', 'WEEK_OFF'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roster_assignments_work_mode_check') THEN
    ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignments_work_mode_check 
      CHECK (work_mode IN ('OFFICE', 'WFH'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roster_assignments_shift_for_work_check') THEN
    ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignments_shift_for_work_check
      CHECK ((day_type = 'WORK' AND shift_template_id IS NOT NULL) OR (day_type = 'WEEK_OFF' AND shift_template_id IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roster_assignments_unique_day') THEN
    ALTER TABLE roster_assignments ADD CONSTRAINT roster_assignments_unique_day 
      UNIQUE (roster_id, employee_id, assignment_date);
  END IF;
END $$;

-- 3. Add publication columns to rosters
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES employees(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rosters_status_check') THEN
    ALTER TABLE rosters ADD CONSTRAINT rosters_status_check 
      CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'));
  END IF;
END $$;

-- 4. Enable RLS and add write policies for ADMIN and HR
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages rosters" ON rosters;
DROP POLICY IF EXISTS "Manage rosters" ON rosters;
CREATE POLICY "Manage rosters" ON rosters
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com')
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com');

DROP POLICY IF EXISTS "Admin manages roster_assignments" ON roster_assignments;
DROP POLICY IF EXISTS "Manage roster_assignments" ON roster_assignments;
CREATE POLICY "Manage roster_assignments" ON roster_assignments
  FOR ALL TO authenticated
  USING (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com')
  WITH CHECK (public.get_auth_role() IN ('ADMIN', 'HR') OR auth.jwt()->>'email' = 'admin@gmail.com');

-- 5. Grant table privileges to authenticated & anon roles
GRANT ALL ON TABLE rosters TO authenticated, anon, service_role;
GRANT ALL ON TABLE roster_assignments TO authenticated, anon, service_role;

-- 6. Reload Supabase PostgREST schema cache
NOTIFY pgrst, 'reload schema';
