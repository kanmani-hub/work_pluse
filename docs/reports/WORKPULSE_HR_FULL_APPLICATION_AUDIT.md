# WorkPulse HR — Full Application Audit

**Date:** 2026-10-09 · **Scope:** `D:\KANZ\Prasath\work_pluse` (git `243c4f5` + 43 uncommitted/untracked paths, all preserved)
**Method:** source review of every route/service/migration, automated test run, read-only live checks of the Admin portal (2026-10-09, Edge, admin session), and earlier read-only live checks. **No SQL was executed, no live record was created or changed, nothing was committed.**

Legend — evidence types: **[CODE]** read in source · **[MIG]** read in `supabase/migrations` (live DB not inspected) · **[UNIT]** automated unit/service test (mocked database) · **[LIVE]** observed in the running app against the real Supabase project · **[USER]** reported by the owner.

---

## 1. Executive summary

WorkPulse HR is a real, database-backed attendance/HR/payroll web app (React + Supabase). Most admin screens now show real data, and the core business rules (clock-in/out, breaks, geofence distance, overtime eligibility, payroll calculation, payroll status flow) are implemented as tested pure functions.

It is **not production-ready**. The main blockers are in the **database security layer**, not the UI:

1. **Employees can approve their own leave, WFH and permission requests** by calling the API directly (RLS lets them update any column of their own request, including `status`) **[MIG]** — CRITICAL.
2. **Attendance can be forged by the employee**: clock-in/out timestamps come from the phone's clock, the geofence check runs only in the browser, and RLS lets employees insert/update any column of their own attendance **[CODE][MIG]** — HIGH.
3. **Unauthenticated push-notification endpoint** (`send-push-notification`, `verify_jwt = false`, no auth check) **[CODE]** — HIGH.
4. **Employee deletion permanently erases payroll, payment, payslip and attendance history** **[CODE]** — HIGH.
5. **Payroll payment recording requires an SQL function that is not yet applied**; until it is, payments cannot be recorded (by design — it refuses rather than risking double payment) **[CODE]**.
6. Several screens still **simulate success** without saving (employee import, shift "Assign", WFH-page clock-in, Add Leave, Add Permission) **[CODE]**.
7. `npm run build` / `npm run lint` / real `vitest` could not be run in this environment (Windows-only native binaries); the owner reports build passing and lint 275 warnings / 0 errors **[USER]**.

---

## 2. Architecture and technology stack (actual)

| Layer | Technology (from `package.json` / source) |
|---|---|
| Frontend | React 19, TypeScript 6, Vite 8 (rolldown), react-router-dom 7, lucide-react, Leaflet + OpenStreetMap (live tracking), jsPDF/xlsx (exports) |
| Mobile | Capacitor 8 (Android project present), push notifications plugin |
| Backend | **Supabase** only: Postgres + RLS, Auth, PostgREST, Realtime, Storage not used, 4 Edge Functions (`create-employee`, `delete-employee`, `face-verification`, `send-push-notification`), `pg_cron` job for auto clock-out (if extension enabled) |
| Auth | Supabase email/password; employee-code login via RPC `get_email_by_employee_code`; roles from `profiles.role_id → roles.name` |
| Tests | Vitest (unit, `src/**/*.test.ts`), Playwright (`tests/`, 1 outdated spec) |
| Config | `.env` (not committed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (+ optional `VITE_QA_FAST_MODE`). `.env.example` contains the project URL only (no keys). No hard-coded secrets found in tracked files (scan: JWT/AWS/Stripe/password patterns). |
| Deploy | `vercel.json` present; no CI pipeline, no backup/restore documentation in repo |

**Role model mismatch:** the owner states the only roles are **ADMIN and EMPLOYEE**, but code and RLS also grant **HR** wide rights (`PAYROLL_MANAGER_ROLES = [ADMIN, HR]`, every RLS policy `IN ('ADMIN','HR')`, Edge functions accept HR/"HR/STAFF") **[CODE][MIG]**.

**Data flow:** Page → `src/services/**` (supabase-js) → PostgREST/RLS → Postgres. Business rules are client-side (`*Rules.ts`); the database enforces only RLS, constraints and the overtime trigger (from the applied `PROPOSED_overtime_requests.sql`).

---

## 3. Inventory of implemented modules

| Module | Routes | Data source | State |
|---|---|---|---|
| Auth / login / reset / change password | `/login`, `/reset-password`, `/change-password` | Supabase Auth, `profiles`, `roles` | Real |
| Route guard (RBAC) | all `/admin/*` (ADMIN, HR), `/employee/*` (EMPLOYEE) | `ProtectedRoute` + `routeAccess.ts` | Real (client-side) |
| Admin dashboard | `/admin/dashboard` | employees, attendance, leave, wfh, permission, shifts | Real |
| Employees | `/admin/employees` | `employees` + Edge `create-employee`/`delete-employee` | Real; **import simulated** |
| Departments / Offices | `/admin/departments`, `/admin/offices` | tables of same name | Real; Offices "Geofence Simulator" is a UI tool only |
| Shifts / Roster | `/admin/shifts`, `/admin/roster` | `shift_templates`, `shift_assignments`, `roster_assignments` | Real; **Shifts "Assign" modal simulated** |
| Attendance / Breaks | `/admin/attendance`, `/admin/breaks`, `/employee/attendance`, `/employee/breaks` | `attendance`, `attendance_breaks`, `attendance_events` | Real (client timestamps) |
| Live tracking / geofence | `/admin/live-tracking` | `employee_live_locations`, location events | Real |
| Leave | `/admin/leave`, `/employee/leave` | `leave_requests`, `leave_types`, `leave_balances` | Real; **admin "Add Leave" simulated**, calendar view placeholder |
| WFH | `/admin/wfh`, `/employee/wfh` | `wfh_requests` | Real requests; **WFH-page clock-in simulated**, calendar placeholder |
| Permission | `/admin/permission`, `/employee/permission` | `permission_requests` | Real; **admin "Add Permission" simulated**, Usage tab empty |
| Overtime | `/admin/overtime`, `/employee/overtime` | `overtime_requests` (+ DB trigger) | Real |
| Payroll / payslips | `/admin/payroll`, `/employee/payroll`, `/employee/payslip` | `salary_structures`, `payroll`, `payroll_items`, `payroll_payments`, `payslips` | Real; payment recording needs `record_payroll_payment` (not applied) |
| Reports | `/admin/reports` | attendance, leave, wfh, payroll, verification events | Overview/Attendance real; other tabs "prototype" |
| Audit logs | `/admin/audit-logs` | `audit_logs` | Real |
| Notifications | `/admin/notifications`, `/employee/notifications`, bell | `notifications` (+ realtime, push) | Real; preferences drawer is UI-only |
| Face registration / verification | `/admin/face-registration` | `face_registrations` + Edge `face-verification` | Real wiring; provider NOT_CONFIGURED (live) |
| Settings | `/admin/settings` | `app_settings` (single JSON row) | Real |
| QA control panel | global component | `qaTimeService` | Active only when `VITE_QA_FAST_MODE=true` |
| Dead code | `src/pages/Attendance.tsx`, `Dashboard.tsx`, `Employees.tsx` (not routed; contain mock data) | — | Unused |

---

## 4. Working features (with evidence)

| Feature | Evidence |
|---|---|
| Admin portal loads with real Supabase data on all 19 admin routes, 0 console errors | [LIVE] 2026-10-09 read-only pass (Dashboard 14 employees/5 present/36%, Employees 14, Shifts assigned 14, Attendance 14/5/8, Leave 1 pending, Notifications 17/16 unread = bell, Audit 176 events) |
| Employee account is redirected away from `/admin` | [LIVE] ANISH K (EMPLOYEE) → `/employee/dashboard` |
| Cross-page consistency Dashboard ↔ Attendance ↔ Employees (workforce = ACTIVE non-ADMIN) | [LIVE] + `dashboardRules.test.ts` |
| Clock-in/out rules, half-day, breaks, auto-break transitions | [UNIT] `clockRules`, `breakRules`, `autoBreakRules`, `currentAttendance` tests (45 tests) |
| Geofence distance / accuracy / stale-location rules | [UNIT] `locationRules`, `liveTrackingRules`, `liveActivityRules` (53 tests) |
| Duplicate clock-in prevented | [MIG] `unique_attendance_per_day`; [CODE] conditional clock-out `.is('clock_out_at', null)` |
| Duplicate WFH per day prevented | [MIG] `unique_wfh_per_day` |
| Overlapping leave prevented | [CODE] `leaveService.createLeaveRequest` overlap check |
| Overtime: eligibility, request/approve flow, duplicate prevention, employee cannot self-approve | [UNIT] `overtimeRules` (21), service tests; DB trigger `overtime_requests_guard` [applied SQL] |
| Payroll pays only APPROVED overtime; refuses to calculate if approved overtime cannot be loaded | [UNIT] `payrollClientRules`, `payrollDataService`, `payrollPaymentSafety` |
| Payroll status flow forward-only; PAID only via payment | [UNIT] `payrollRules`, `payrollPaymentSafety` |
| Payment policy: exact net salary, ADMIN-only, one payment, concurrency, failed insert rolls back | [UNIT] against an **in-memory emulation** of the proposed DB function — the real SQL is **not applied/tested** |
| Overtime approval blocked for locked payroll months (app) | [UNIT] `overtimeLockedMonth.test.ts` (fails on old code, passes on new) |
| Reports attendance rate = present / expected employee-days | [UNIT] `reportRules`; [LIVE] 23.2% Oct (26/112) |
| Leave/permission timelines and settings switches persist via `app_settings` | [UNIT] settings tests; [LIVE] values loaded |
| Notifications deduplication / delivery logic | [UNIT] notification tests (27 service + 17 rules) |

---

## 5. Broken features and reproducible bugs

| ID | File / route | Problem | Impact | Safe reproduction | Fix | Regression test |
|---|---|---|---|---|---|---|
| B-01 | `src/pages/employee/Wfh.tsx` (≈L300–325, L568) | WFH page shows Clock In / Break / Clock Out buttons that only change local state; no attendance row is written | WFH employee believes they clocked in → recorded absent → LOP in payroll | Test project: approved WFH today → WFH page → "Start Work" → check `attendance` table (no row) | Remove these buttons or route them through `attendanceService.clockIn/clockOut` (which already supports WFH mode) | Component/service test: clicking clock-in calls `attendanceService.clockIn` |
| B-02 | `src/pages/admin/Shifts.tsx` L182–191 | "Assign" form opens a mock conflict and toasts "Shift assigned successfully (Overridden)" without saving | Admin thinks a shift was assigned; employee keeps old shift | Shifts → Assign → submit → `shift_assignments` unchanged | Wire to the real assignment service used by Roster, or remove the modal | Test that success toast only follows a confirmed insert |
| B-03 | `src/pages/admin/Employees.tsx` L245 | "Import Employees" waits 1.5 s and shows done; nothing is imported | False success | Import modal → Choose File → "done" with no new rows | Hide until implemented, or implement CSV import via `create-employee` | — |
| B-04 | `src/pages/admin/Leave.tsx` (Add Leave drawer), `Permission.tsx` (Add Permission drawer) | Forms show "created successfully" without saving | False success | Open drawer → submit → no new row | Wire to services with admin-on-behalf rules, or remove | Success only after insert |
| B-05 | `supabase/migrations/0015_auto_clock_out.sql` L67–76 | Shift start/end built as `attendance_date + time` (no time zone) and compared with `NOW()`; on a UTC database a 19:30 shift end is treated as 19:30 **UTC** (01:00 IST) | Auto clock-out ~5.5 h late and recorded clock-out time inflated → wrong worked hours | Read-only: `SHOW timezone;` and compare `clock_out_source='AUTO'` rows' `clock_out_at` with shift end | Build timestamps with `AT TIME ZONE 'Asia/Kolkata'` | SQL test on test project |
| B-06 | `src/pages/admin/Payroll.tsx` / `payrollService.markPayrollPaid` | Payments now require `record_payroll_payment` (not applied) | No payroll payment can be recorded until SQL PART 2 is applied (fails safely with a clear message) | — | Apply `docs/proposals/PROPOSED_payroll_payment_safety.sql` on test, then prod | Manual plan (§10) |
| B-07 | `src/pages/admin/Leave.tsx` "Approval Workflow" | Shows Employee → Manager → HR → Approved; the real flow is a single admin approval | Misleading policy display | Leave Settings drawer | Show the actual flow | — |
| B-08 | `src/pages/admin/AuditLogs.tsx` | Pagination buttons 1/2/3 are decorative; module/severity filter values don't match stored values (e.g. "Authentication" vs `AUTH`) | Filters return nothing; can't page | Filter Module = Authentication → 0 rows though AUTH events exist | Map filter values to stored codes; real pagination | Filter unit test |
| B-09 | `src/pages/admin/Reports.tsx` | Working Hours/WFH/Leave/Permission/Shifts/Payroll/Payments tabs are "prototype" placeholders; Export only works on Attendance tab | Reports incomplete | Open any non-Overview tab | Implement or hide tabs | — |
| B-10 | `src/pages/admin/Shifts.tsx` | Min/Max hours inputs are not saved | Settings silently ignored | Edit shift → change Min hours → reload | Persist or remove | — |
| B-11 | `src/services/permission/permissionService.ts` | No overlap check for two permissions at the same time/day | Double-counted permission hours | Submit two overlapping permissions | Add overlap check (+ DB exclusion constraint) | Service test |
| B-12 | Settings switches "Allow Half Day", "Allow Backdated Leave", "Enable Permission Requests", "Require Approval" | Saved but not enforced (labelled as such) | Admin expectations vs behaviour | Toggle → employee form unchanged | Enforce in employee forms + DB | Form tests |

---

## 6. Missing or incomplete features

- Leave balances: **no `leave_balances` rows for 2026** [LIVE]; allocation/accrual is not automated; balance shows "unavailable".
- No real partial-payment / multi-payment model (by decision: exact single payment).
- Payslip PDF numbering: payslips are only stored if generated; preview shows "Not issued".
- Face verification provider not configured (`NOT_CONFIGURED`) [LIVE].
- Calendar views (Leave/WFH) are placeholders.
- Scheduled reports not implemented (honest empty state).
- No manager hierarchy/approval chain (single-level admin approval).
- No CI, no automated DB integration tests, Playwright suite outdated (`tests/auto_break_e2e.spec.ts`: wrong port 5013, stale selectors, clocks a real user in).
- No documented backup/restore or incident runbook in the repo.

---

## 7. Real-world HR problems the application solves (when the gaps above are fixed)

1. Daily attendance with office geofence + GPS verification and live location monitoring.
2. Shift templates, rosters and late/early/half-day detection.
3. Automatic break tracking (geofence exit/enter) and break-overrun visibility.
4. Leave, WFH and short-permission requests with admin approval and employee notifications.
5. Overtime requested by employees and approved by admins (only approved hours paid).
6. Monthly payroll with LOP, late, permission, break deductions, approval lifecycle and payslips.
7. Workforce dashboards, attendance-rate reports and audit trail of admin actions.

---

## 8. Use-case matrix

| ID | Business problem | Role | Start | Actions | Expected | Actual | Evidence | Status | Bug / limitation |
|---|---|---|---|---|---|---|---|---|---|
| UC-01 | Employee sees only own data | EMPLOYEE | Logged in | Open dashboard/attendance/leave/payslip | Only own records | UI shows own data; RLS restricts attendance/leave/payroll to own rows, **but `employees` (email, phone, DOB of everyone) is readable by all** | [LIVE] own dashboard; [MIG] 0001 policy `USING (true)` never dropped | PARTIAL | S-05 |
| UC-02 | Clock in at office | EMPLOYEE | Inside geofence, GPS on | Secure Clock In | Attendance row, verified location | Logic tested; not executed live (would modify real attendance) | [UNIT] clock/location rules | NOT TESTED (live) | S-02 |
| UC-03 | Clock in outside geofence | EMPLOYEE | Outside geofence | Clock In | Refused | Refused in browser only; direct API insert would succeed | [CODE] client-side `locationService`; [MIG] RLS insert own | PARTIAL | S-02 |
| UC-04 | Leave request → admin approve/reject | EMPLOYEE/ADMIN | Leave types exist | Submit; admin reviews | Status change, attendance marked leave, notification | Implemented; double-review guarded; **employee can self-approve via API** | [CODE] `leaveService`; [MIG] RLS | PARTIAL | S-01 |
| UC-05 | WFH request → attendance in WFH mode | EMPLOYEE/ADMIN | — | Request, approve, work from home | Clock-in recorded as WFH | Request/approve real; WFH page clock-in fake (B-01); main Attendance page supports WFH mode | [CODE] | PARTIAL | B-01, S-01 |
| UC-06 | Admin assigns shift, employee schedule updates | ADMIN | — | Assign via Roster/Employees | Employee sees new shift; notified | Roster/Employees assignment real (live counts consistent); Shifts-page Assign fake | [LIVE] Shifts counts = 14; [CODE] | PARTIAL | B-02 |
| UC-07 | Generate monthly payroll from source records | ADMIN | Salary structures | Generate | Correct per-employee payroll; failures listed | Logic tested; not run live (would create payroll records) | [UNIT] | NOT TESTED (live) | — |
| UC-08 | Only approved overtime is paid | ADMIN | OT requests in all states | Generate | Only APPROVED hours paid | Yes | [UNIT] fails on old code (paid ₹75 for 120 unapproved min) | PASS (unit) | live NOT TESTED |
| UC-09 | Pay exactly net salary | ADMIN | PAYMENT_PENDING payroll | Record payment | One payment = net; status PAID | App logic + emulated DB function pass; **real SQL not applied** | [UNIT] | PARTIAL | B-06 |
| UC-10 | Two concurrent payments | ADMIN×2 | PAYMENT_PENDING | Pay twice at once | One payment only | Passes against in-memory emulation; DB-level guarantee pending SQL | [UNIT] | PARTIAL | B-06 |
| UC-11 | Employee opens another's payslip | EMPLOYEE | — | Request other payroll id | Denied | RLS `View payroll`: own rows only (ADMIN/HR all) | [MIG] 0009 | PASS (migration review) | live NOT TESTED; employees also see own DRAFT payroll rows (S-09) |
| UC-12 | OT approved after payroll locked | ADMIN | Month payroll APPROVED/PAID | Approve OT | Blocked | App blocks (tested); DB trigger in proposal PART 5 (not applied) | [UNIT] | PARTIAL | — |
| UC-13 | Report totals match records | ADMIN | — | Reports overview | Totals consistent | Attendance rate/present/absent consistent; other tabs placeholder | [LIVE] + [UNIT] | PARTIAL | B-09 |
| UC-14 | Sensitive action creates audit log | ADMIN | — | Approve/pay/settings | Audit row with real actor | Audit rows created client-side (176 live); **any user can insert forged audit rows** | [LIVE]; [MIG] `WITH CHECK (true)` | PARTIAL | S-06 |
| UC-15 | Login with employee code | ANY | — | Enter EMP0xx | Login | Works; RPC returns email for any code to anonymous callers | [MIG] 0015 (no REVOKE) | PARTIAL | S-07 |
| UC-16 | Forced password change | NEW USER | flag set | Login | Must change password | Flag in `user_metadata` (user-editable) | [CODE] | PARTIAL | S-08 |
| UC-17 | Auto clock-out for forgotten clock-out | SYSTEM | Open attendance | Cron | Closed at correct IST time | Likely 5.5 h late on UTC DB | [MIG] | FAIL (likely) | B-05 |
| UC-18 | Delete an employee who left | ADMIN | Employee with history | Delete | Deactivate; keep history | Hard-deletes payroll, payments, payslips, attendance | [CODE] `delete-employee` | FAIL | S-04 |
| UC-19 | Employee receives push notification | EMPLOYEE | Device registered | Admin action | Push delivered | Implemented; endpoint unauthenticated | [CODE] | PARTIAL | S-03 |
| UC-20 | Live tracking of working staff | ADMIN | Employees working | Live tracking page | Current positions | Works; all 5 locations stale >100 min on 2026-10-09; 2 employees denied permission | [LIVE] | PARTIAL | operational |

---

## 9. Security findings

| ID | Severity | Finding | Evidence | Practical impact | Safe verification | Recommended fix |
|---|---|---|---|---|---|---|
| S-01 | **CRITICAL** | Employees can update any column of their own `leave_requests`, `wfh_requests`, `permission_requests` (RLS `USING employee_id = own`, no `WITH CHECK` column/status restriction; no guard trigger) — self-approval | [MIG] `0009_security_hardening.sql` L137–154, `20260929123000_fix_wfh_rls.sql` | Self-approved leave avoids LOP; payroll affected | **Read-only:** `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename IN ('leave_requests','wfh_requests','permission_requests');` and list triggers. Exploit only on a test project. | Guard triggers like `overtime_requests_guard`: employees may only create PENDING and cancel own PENDING; only ADMIN may set APPROVED/REJECTED; `docs/security/PROPOSED_*` already drafted |
| S-02 | **HIGH** | Attendance integrity: clock times from the device clock (`attendanceService` L215/330 `qaTimeService.getDate()` → `Date.now()`), geofence verified only in browser, RLS allows employees to insert/update all columns of own attendance/breaks | [CODE][MIG] 0009 L109–122 | Time theft / fake presence | Read-only policy listing; exploit only on test project | Server-side RPC `clock_in/clock_out` using `now()` and server geofence check; restrict employee UPDATE; `docs/security/PROPOSED_attendance_integrity.sql` |
| S-03 | **HIGH** | `send-push-notification` has `verify_jwt = false` and no caller check | [CODE] `supabase/config.toml`, function index.ts | Anyone with the URL can push arbitrary messages to any employee's phone (phishing) if FCM key is configured | Inspect deployed function settings in Supabase dashboard | Require a shared secret header from the DB webhook, or enable JWT and verify service role |
| S-04 | **HIGH** | `delete-employee` hard-deletes payroll, payroll_payments, payslips, attendance, breaks, events (HR allowed) | [CODE] index.ts L61–112 | Loss of statutory payroll/attendance records; audit gap | Code review | Replace with deactivation (status INACTIVE, revoke login); keep history |
| S-05 | **HIGH** | `employees` readable by every authenticated user (`USING (true)` from 0001 never dropped) — email, phone, date of birth of all staff | [MIG] 0001 L105 | Personal data exposure | Read-only `pg_policies` on `employees` | Drop policy; employees see own row (+ minimal directory view) — `docs/security/PROPOSED_employee_data_isolation.sql` |
| S-06 | **MEDIUM** | `audit_logs` and `notifications` INSERT `WITH CHECK (true)` | [MIG] 0009 L179, L187 | Forged audit entries / fake notifications to other employees | Read-only policy listing | Insert via SECURITY DEFINER functions or triggers; restrict actor to `get_auth_employee_id()` |
| S-07 | **MEDIUM** | `get_email_by_employee_code` is SECURITY DEFINER with default EXECUTE for PUBLIC/anon | [MIG] `0015_resolve_employee_email.sql` | Unauthenticated enumeration of staff emails (codes are sequential) | `SELECT has_function_privilege('anon','public.get_email_by_employee_code(text)','execute');` | Return a login token flow server-side, or rate-limit; `REVOKE … FROM anon` with an Edge Function login |
| S-08 | **MEDIUM** | `force_password_change` stored in `user_metadata` (user-writable via `auth.updateUser`) | [CODE] ProtectedRoute L37, ChangePassword L44 | New user can skip forced password change | Code review | Move flag to `app_metadata` / profiles column writable only by admin |
| S-09 | **MEDIUM** | Employees can read their own payroll rows in DRAFT/CALCULATED/UNDER_REVIEW (RLS doesn't filter status; UI filters) | [MIG] 0009 L40 | Early disclosure of unapproved figures | Read-only policy | Add `status IN ('PAID','CLOSED')` for non-admins |
| S-10 | **MEDIUM** | Payroll/payment race and lock rules only in app until `PROPOSED_payroll_payment_safety.sql` is applied; `payroll_payments` FOR ALL policy allows HR to insert/delete payments | [MIG] 0009 L56 | Contradicts ADMIN-only payment rule at DB level | Read-only policy | Apply proposal PARTS 1–5 |
| S-11 | **MEDIUM** | HR role has admin-level rights everywhere, contradicting the ADMIN/EMPLOYEE-only model | [CODE][MIG] | Unintended privileged accounts if an HR role is ever assigned | `SELECT r.name, COUNT(*) FROM profiles p JOIN roles r ON r.id=p.role_id GROUP BY 1;` | Decide: remove HR or define its rights explicitly |
| S-12 | **LOW** | Edge functions use `Access-Control-Allow-Origin: *` and return HTTP 200 with `{success:false}` for forbidden | [CODE] | Weaker defence in depth; monitoring blind spots | Code review | Restrict origin; proper 401/403 |
| S-13 | **LOW** | Destructive maintenance scripts committed at repo root (`delete_employees.js`, `wipe_all_test_data.sql`, `master_cleanup_final.cjs`, `clean_db_final.sql`, …) | [CODE] git ls-files | Accidental production wipe if run with service key | — | Move to a guarded `scripts/` folder with explicit environment checks, or remove |
| S-14 | **INFO** | No hard-coded secrets found; `.env` ignored; `seed_admin.sql` uses a guarded placeholder password | scan | — | — | Keep the secret scan in CI |

Confirmed vs potential: S-01, S-05–S-07, S-09–S-11 are confirmed **in migration files**; whether later manual changes in the live database altered them is **unverified** (no live SQL was run). S-02–S-04, S-08, S-12–S-13 are confirmed in source code.

---

## 10. Test results and command outputs

| Command | Where | Result |
|---|---|---|
| Unit suite (all 30 `src/**/*.test.ts`) | Linux VM, Node 22 with a Vitest-compatible runner (`vi.mock` emulated) | **30 files, 283 tests passed, 0 failed** (2026-10-09). Not the real Vitest binary. |
| `tsc -p tsconfig.app.json --noEmit` | VM | **pass** (exit 0) |
| `tsc -p tsconfig.node.json --noEmit` | VM | **pass** (exit 0) |
| `git diff --check` | VM | Plain: thousands of "trailing whitespace" lines = **CRLF line-ending noise** (repo stores LF, Windows working copy CRLF). With `-c core.autocrlf=true` (Windows behaviour): 2 real issues found in `Payroll.tsx` L5–6 → fixed → **clean**. |
| `npm test` (real Vitest) | — | **NOT RUN** here: Vite/rolldown native binding is Windows-only and npm registry unreachable. Owner earlier reported 28 files / 259 passed (before the latest payroll tests were added). |
| `npm run build` | — | **NOT RUN** (Windows-only binding). Owner reported **pass**. |
| `npm run lint` (oxlint) | — | **NOT RUN** (Windows-only binding). Owner reported **275 warnings, 0 errors**; last log here (8 Oct) 274 warnings. 12 warnings in `Payroll.tsx` were addressed today; net change unverified. |
| Playwright `npm run test:e2e` | — | **NOT RUN**: only spec is outdated and would clock in a real user. |

**What the tests really exercise:** pure business rules (real logic, no mocks) and service orchestration against **in-memory/mocked Supabase**. No test runs against a real Postgres, RLS policy or Edge Function. Database integration is therefore **NOT TESTED**.

---

## 11. Database and integration verification

| Item | Result |
|---|---|
| Live schema / policies / triggers | **Not inspected** (no SQL run). All DB statements in this report come from migration files and applied proposal files. |
| Live data (read-only, admin UI) | 14 workforce employees, 3 offices, 5 shifts, 1 pending leave, 0 overtime requests, 0 payroll for Oct, 176 audit events, 17 notifications [LIVE] |
| Realtime notifications | Earlier diagnosis: `notifications` likely missing from `supabase_realtime` publication (`docs/proposals/ENABLE_notifications_realtime.sql` pending) |
| Proposals pending owner action | `PROPOSED_payroll_payment_safety.sql` (rev 2), `ENABLE_notifications_realtime.sql`, `docs/security/PROPOSED_*.sql` (6 files) |
| Read-only SQL to run first | PART 0 of `PROPOSED_payroll_payment_safety.sql` + the `pg_policies` queries in §9 |

---

## 12. Production readiness checklist

| Item | Status |
|---|---|
| Server-side authorization for all writes (RLS + guards) | ❌ (S-01, S-02, S-06) |
| Payment safety at DB level | ❌ pending SQL |
| Personal data isolation | ❌ (S-05) |
| No simulated success messages | ❌ (B-01–B-04) |
| Time-zone-correct server jobs | ❌ (B-05) |
| Records retention (no hard delete of payroll/attendance) | ❌ (S-04) |
| Build passes | ✅ [USER] |
| Lint 0 errors | ✅ [USER] (warnings remain) |
| Unit tests pass | ✅ (283, emulated runner) |
| DB integration / E2E tests | ❌ none |
| Secrets not in repo | ✅ |
| Backups / restore runbook | ❌ not documented (Supabase PITR status unknown) |
| Monitoring / error reporting | ❌ none found |
| Staging environment | ❌ none (tests would hit production) |

---

## 13. Prioritised fixes

**P0 (before any production reliance)**
1. S-01 Self-approval guard triggers for leave/WFH/permission.
2. S-02 Server-side clock-in/out (server time, server geofence) + restrict employee attendance updates.
3. S-03 Authenticate `send-push-notification`.
4. Apply `PROPOSED_payroll_payment_safety.sql` (test project first) — enables payments safely (B-06, S-10).
5. Create a staging Supabase project; never test against production.

**P1**
6. S-04 Replace hard delete with deactivation.
7. S-05 Employee data isolation; S-09 payroll status filter for employees.
8. B-01 WFH-page clock-in; B-02 Shifts Assign; B-03/B-04 fake-success forms (remove or wire).
9. B-05 Auto clock-out time zone.
10. S-06 audit/notification insert hardening; S-07 employee-code lookup; S-08 forced password flag.
11. S-11 Decide on HR role.

**P2**
12. Leave balance allocation for 2026 + enforcement of saved leave/permission settings (B-12).
13. Audit Logs filters/pagination (B-08); permission overlap (B-11); Shifts min/max hours (B-10).
14. Real Playwright suite on staging; DB integration tests for RLS/triggers.

**P3**
15. Reports placeholder tabs (B-09), calendar views, scheduled reports.
16. Remove dead pages and root maintenance scripts (S-13); lint warning clean-up; CORS tightening (S-12).

---

## 14. Recommended implementation order

1. Staging project + seed synthetic data (no production testing).
2. Run read-only PART 0 + policy queries on production; compare with this report.
3. Write and test guard SQL for S-01/S-02/S-06 on staging (pattern: `overtime_requests_guard`).
4. Apply payroll safety SQL on staging → run manual payment plan → production.
5. Fix S-03, S-04 Edge Functions.
6. Remove/wire fake-success UI (B-01–B-04) with tests asserting success only after a confirmed write.
7. Auto clock-out time zone (B-05) with SQL test.
8. Data isolation (S-05, S-09) and auth hardening (S-07, S-08).
9. Playwright E2E for UC-01…UC-20 on staging; add to CI with build/lint/test.

---

## 15. Assumptions, blockers, unverified areas

- Live database state (policies, triggers, functions, time zone, pg_cron, realtime publication) **unverified** — only migration files were read.
- Employee-side flows (clock-in, breaks, leave/WFH/permission submission, payslip download) **not executed live**: they would modify real records; no staging project/test accounts exist.
- Payroll generation and payment **not executed live** (no synthetic payroll environment).
- `npm test` / `build` / `lint` with real tooling **not run here** (Windows-only native bindings; npm registry unreachable); build/lint results are owner-reported.
- Face verification provider, push (FCM) configuration and Capacitor Android build **not tested**.
- Performance/accessibility reviewed only by code reading (observed: repeated `auth/v1/user` + `profiles` lookups per page and notification polling — minor).
