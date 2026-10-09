-- =====================================================================================
-- READ-ONLY verification for overtime_requests (changes nothing). Run after the migration.
-- Every row should say PASS.
-- =====================================================================================
WITH checks(name, ok) AS (
  SELECT 'table overtime_requests exists',
         to_regclass('public.overtime_requests') IS NOT NULL
  UNION ALL SELECT 'RLS enabled',
         COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.overtime_requests')), false)
  UNION ALL SELECT 'policy: View (own or ADMIN/HR)',
         EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'overtime_requests' AND policyname = 'View overtime_requests' AND cmd = 'SELECT'
                 AND qual ILIKE '%get_auth_role()%' AND qual ILIKE '%get_auth_employee_id()%')
  UNION ALL SELECT 'policy: Insert own (or ADMIN/HR)',
         EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'overtime_requests' AND policyname = 'Insert own overtime_requests' AND cmd = 'INSERT'
                 AND with_check ILIKE '%get_auth_employee_id()%')
  UNION ALL SELECT 'policy: Update (ADMIN/HR, or own PENDING)',
         EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'overtime_requests' AND policyname = 'Update overtime_requests' AND cmd = 'UPDATE'
                 AND qual ILIKE '%PENDING%')
  UNION ALL SELECT 'no DELETE policy (requests are kept)',
         NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'overtime_requests' AND cmd IN ('DELETE', 'ALL'))
  UNION ALL SELECT 'guard trigger (server-side eligibility / employee cannot approve)',
         EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.overtime_requests') AND tgname = 'overtime_requests_guard' AND NOT tgisinternal)
  UNION ALL SELECT 'CHECK requested > 0 (no zero/negative)',
         EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.overtime_requests') AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%requested_overtime_hours > %0%')
  UNION ALL SELECT 'CHECK approved >= 0 (no negative)',
         EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.overtime_requests') AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%approved_overtime_hours >= %0%')
  UNION ALL SELECT 'CHECK approved rules (APPROVED > 0, <= requested, <= eligible)',
         EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.overtime_requests') AND conname = 'ot_approved_rules')
  UNION ALL SELECT 'CHECK requested <= eligible',
         EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.overtime_requests') AND conname = 'ot_requested_le_eligible')
  UNION ALL SELECT 'CHECK status in PENDING/APPROVED/REJECTED/CANCELLED',
         EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.overtime_requests') AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%PENDING%CANCELLED%')
  UNION ALL SELECT 'UNIQUE one active request per attendance',
         EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'overtime_requests' AND indexname = 'uniq_ot_active_per_attendance' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%PENDING%APPROVED%')
  UNION ALL SELECT 'foreign keys (employees, attendance, shift_templates)',
         (SELECT COUNT(*) FROM pg_constraint WHERE conrelid = to_regclass('public.overtime_requests') AND contype = 'f') >= 4
  UNION ALL SELECT 'realtime publication includes overtime_requests',
         EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'overtime_requests')
  UNION ALL SELECT 'helpers present: get_auth_role(), get_auth_employee_id()',
         to_regprocedure('public.get_auth_role()') IS NOT NULL AND to_regprocedure('public.get_auth_employee_id()') IS NOT NULL
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM checks;
