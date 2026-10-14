# Admin Module Fix Plan (Phase 0)

Date: 2026-10-14 · Scope agreed for this round: **Phase 0 + C1, C2, C3**. Later phases wait for review.

## Repository confirmation

| Item | Value |
| --- | --- |
| Root | `C:\Users\KANZ\Downloads\work_pluse-main\work_pluse-main` (the plan named `D:\KANZ\Prasath\work_pluse`; the owner chose the Downloads copy) |
| Branch / commit | `main` @ `41f62a65` "updated shift roaster" (2026-10-12) |
| Remote | `https://github.com/kanmani-hub/work_pluse.git` |
| Uncommitted (preserved, not touched) | `README.md`, `src/pages/admin/Breaks.tsx`, `src/pages/admin/LiveTracking.tsx`, `src/services/attendance/{autoBreakRules.test,breakRules.test,breakRules,breakService,breakSummaryRules.test,breakSummaryRules}.ts` (Auto Break work) |
| Untracked junk (not touched) | `t run`, `tatus --short` (accidental git output files), `.wp_test_bundle.tgz` (audit copy, safe to delete) |

None of the C1–C3 changes touch the Auto Break files.

## Map

- **Admin routes (19):** `src/App.tsx` lines 64–85, all under one `ProtectedRoute allowedRoles={ADMIN, HR}`.
- **Role source of truth:** `profiles.role_id → roles.name`, read by `public.get_auth_role()` (SECURITY DEFINER). `employees.role_id` is display only; it does not grant access.
- **Profiles writes:** the web client never writes `profiles`; only the `create-employee` / `delete-employee` edge functions do (service role).
- **Policies that use the hard-coded email:** `get_auth_role()` (20260930163500), `rosters` + `roster_assignments` (20261012120000), `shift_assignments` (20261012130000). The edge functions `create-employee` / `delete-employee` also fall back to matching the caller's **email** against `employees` when no profile exists.
- **FKs to employees:** history tables are `ON DELETE RESTRICT`; location/notification tables `CASCADE`; actor/reviewer columns `SET NULL`.
- **Tests:** Vitest (`npm test`, `src/**/*.test.ts(x)`), Playwright e2e (`npm run test:e2e`, `tests/`). No database/RLS tests existed.

## Verified before changing anything (disposable PostgreSQL 16 built from the repo's migrations)

| Report item | Reproduced? |
| --- | --- |
| C1 `admin@gmail.com` with no profile → ADMIN | Yes: `get_auth_role()` returned `ADMIN` |
| C2 HR self-promotion | Yes: HR updated its own `profiles.role_id` and `get_auth_role()` then returned `ADMIN` |
| R3 employees read all personal data | Yes: an EMPLOYEE read all 4 rows incl. phone numbers |

New findings during Phase 0 (not in the 18):

- **N1** `0015_auto_clock_out.sql` does not compile: `v_status` is used but never declared, so the migration fails on a clean database.
- **N2** `employeeService.deactivateEmployee` writes `status: 'Inactive'`, but every screen checks `'INACTIVE'`; a deactivated employee still shows the Deactivate action and never shows Reactivate.
- **N3** Changing an employee's role on the Employees screen updates only `employees.role_id`, not `profiles.role_id`, so the person's real access does not change.
- **N4** `create-employee` authorizes by **email match** on `employees` when the caller has no profile (same class as C1).

## Plan for this round

### C1 — remove the email backdoor
Migration `20261014090000_admin_security_hardening.sql` (proposal, not applied):
1. Pre-flight: abort unless at least one active profile with role ADMIN exists (prevents locking everyone out).
2. Redefine `get_auth_role()` / `get_auth_employee_id()` from the profile only; additionally require the linked employee's status to be `ACTIVE`, so deactivation revokes database access immediately.
3. Recreate the roster, roster-assignment and shift-assignment policies without the email clause.
4. Edge functions authorize from the caller's profile only (no email fallback) — fixes N4.
5. `employeeService.getEmployees` stops hiding `admin@gmail.com` by email; it hides nobody.

### C2 — only ADMIN can change roles
Same migration:
1. Replace `Manage profiles` (ADMIN + HR, FOR ALL) with ADMIN-only INSERT / UPDATE / DELETE policies; HR keeps read access.
2. Trigger on `profiles`: non-ADMIN API callers cannot change `role_id`, `auth_user_id`, `employee_id`, `is_active`; nobody can remove the last active ADMIN.
3. Trigger on `employees`: non-ADMIN API callers cannot change `role_id`, cannot create non-EMPLOYEE rows, and cannot edit or delete an ADMIN's employee row (stops HR deactivating the admin).
4. Service role and database owner are exempt (edge functions, SQL editor).
Rollback: `supabase/rollbacks/20261014090000_admin_security_hardening.rollback.sql` restores the previous functions and policies.

### C3 — safe Delete Employee
Rewrite `supabase/functions/delete-employee/index.ts` around a pure, unit-tested module:
1. Caller must be an active ADMIN (profile only). HR → 403.
2. Refuse to delete yourself or any ADMIN.
3. Never delete history. If the employee has **any** attendance, breaks, leave, WFH, permission, overtime, salary, payroll, payslip, payment, roster/shift or face records, refuse and tell the admin to **Deactivate** instead (deactivation already exists: `status = INACTIVE`).
4. Only an employee with no history (e.g. created by mistake) is removed: profile → employee row → login account, every step checked; if the employee row cannot be removed the profile is put back; the login account is looked up by the stored `auth_user_id`, never by paging `listUsers()`.
5. Proper HTTP status codes (401/403/404/409/500) instead of 200 for everything.
6. UI: the Delete dialog says history blocks deletion; fix N2 so Deactivate actually marks `INACTIVE`.
No new schema is needed.

### Verification
- SQL regression suite `supabase/tests/rls/run_rls_tests.sh`: builds a throwaway database from the migrations and checks C1/C2 attacks are refused and normal admin/HR work still succeeds.
- Vitest unit tests for the delete-employee rules.
- `npm test`, `npm run build`, `npm run lint` on the owner's machine.

Nothing is committed, pushed, deployed, or applied to Supabase.
