# WorkPulse HR — QA Report (2026-10-22)

Scope: the MASTER QA PROMPT, phases A–K. Everything below was executed locally against throwaway databases, a local Redis, and a browser with a mocked Supabase backend. **Nothing was run against Supabase staging or production, and nothing was deployed, committed or pushed.**

Labels used for every result:
**[UNIT]** unit test · **[MOCK-INT]** mocked integration test · **[LOCAL-DB]** disposable local database test · **[LOCAL-REDIS]** local Redis server test · **[MOCK-BROWSER]** real Chromium, built app, mocked Supabase · **[STATIC]** code inspection · **[STAGING]** real staging test (none were possible) · **[DEVICE]** physical device test (none were possible).

---

## 1. Repository, branch and HEAD

| Item | Value |
|---|---|
| Path | `C:\Users\KANZ\Downloads\work_pluse-main\work_pluse-main` |
| Branch | `main` (no remote fetch performed) |
| HEAD | `f3fc024` "automatic break" |
| Backup kept | `../_backup_before_20261021_autobreak.tgz` (present) |

## 2. Working-tree status (actual `git status --short`)

```
 M supabase/tests/rls/run_rls_tests.sh        (QA: test-harness fix)
 M supabase/tests/rls/seed.sql                (QA: test-harness fix, test DB only)
?? docs/proposals/PROPOSED_audit_log_integrity.sql        (QA: proposal, not applied)
?? docs/proposals/PROPOSED_drop_admin_auth_sync_trigger.sql (QA: proposal, not applied)
?? docs/proposals/PROPOSED_request_approval_guards.sql    (QA: proposal, not applied)
?? public/icons/                              (QA: PWA icon fix, 7 files copied from icons/)
```
Plus this report. The other contributor's `server/`, `docker-compose.yml` and root `package.json` were **not modified**; `server/` was tested from a copy outside the repository. QA evidence (browser scripts, screenshots, logs) is in `../_qa_artifacts/` — outside the repository.

## 3. Environment and service availability

| Service | Available? | Used for |
|---|---|---|
| Node 22 / npm on your computer (Linux VM) | Yes | Unit tests, tsc, lint, build, DB tests |
| Supabase staging | **No** — `.env.staging` contains placeholders; no test accounts | Blocks all [STAGING] tests |
| Local Supabase / Docker | **No** | — |
| PGlite (in-memory PostgreSQL) | Yes | [LOCAL-DB] migrations, RLS, attack probes |
| embedded-postgres (real PostgreSQL 18, throwaway) | Yes | [LOCAL-DB] concurrency, existing RLS suite |
| Redis | Installed locally for the test only (redis-server 6.2.14, port 6390, no persistence; stopped afterwards) | [LOCAL-REDIS] |
| Chromium + Playwright | Yes (cloud workspace) | [MOCK-BROWSER] |
| Android device / APK | **No** | Blocks [DEVICE] tests |

## 4. Admin modules discovered

19 admin routes (`src/App.tsx`, guarded by `ProtectedRoute allowedRoles=ADMIN_PORTAL_ROLES`): Dashboard, Live Tracking, Employees, Departments, Offices, Shifts, Attendance, Break Management, WFH, Leave, Payroll, Shift Roster, Permissions, Overtime, Reports, Notifications, Audit Logs, Settings, Face Registration.
11 employee routes: Dashboard, Attendance, Breaks, WFH, Leave, Permission, Overtime, Payroll, Payslip, Profile, Notifications.

## 5. Admin tests executed

| Test | Type | Result |
|---|---|---|
| Admin login → `/admin/dashboard`; admin opening `/employee/dashboard` is sent back to the admin portal | [MOCK-BROWSER] | PASS |
| All 19 admin routes render at their URL, no error boundary, no page errors — desktop and 390 px phone | [MOCK-BROWSER] | 38/38 PASS |
| All 19 admin routes: no horizontal scrolling at 390 px | [MOCK-BROWSER] | 19/19 PASS |
| Break Management: automatic break shown as "automatic — Network disconnected · ended: tracking restored"; employee with a tracking problem and no breaks shows "No breaks · tracking interrupted"; server tracking state shown (desktop + phone) | [MOCK-BROWSER] | 8/8 PASS |
| Re-check of the earlier audit's admin defects B-01…B-12 | [STATIC] | see §11 |
| Real admin CRUD (create employee, approve leave, run payroll, etc.) against a backend | [STAGING] | **BLOCKED** |

## 6. Employee workflows tested

| Test | Type | Result |
|---|---|---|
| Logged-out access to `/admin/dashboard`, `/admin/payroll`, `/employee/dashboard`, `/` → `/login` | [MOCK-BROWSER] | 4/4 PASS |
| Empty login form is blocked | [MOCK-BROWSER] | PASS |
| Wrong password → "Invalid email/Employee ID or password.", stays on `/login` | [MOCK-BROWSER] | PASS |
| Employee login → `/employee/dashboard` | [MOCK-BROWSER] | PASS |
| Employee opening `/admin/dashboard`, `/admin/payroll`, `/admin/settings`, `/admin/breaks` is redirected to the employee portal | [MOCK-BROWSER] | 4/4 PASS |
| All 11 employee routes render, desktop + phone, no overflow | [MOCK-BROWSER] | 33/33 PASS |
| Employee self-approving leave / WFH / permission, reading others' data, editing payroll, etc. | [LOCAL-DB] attack probe | see §8 |
| Real clock-in/out, break start/end, leave/WFH submission, notifications, attendance history, logout/login persistence against a backend | [STAGING] | **BLOCKED** |

## 7. Automatic-Break scenarios (Phase F, 25 scenarios)

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | GPS permission denied | T1–T1e | PASS [LOCAL-DB] |
| 2 | GPS unavailable | T2, T2b | PASS [LOCAL-DB] |
| 3 | Single GPS timeout | T3 | PASS [LOCAL-DB] |
| 4 | Network disconnect | T4b | PASS [LOCAL-DB] |
| 5 | Stale location at 15 min (zero grace) | T5–T5c, PL1 | PASS [LOCAL-DB] |
| 6 | Network recovery without fresh location | T4, T4c | PASS [LOCAL-DB] |
| 7 | Fresh location recovery | T17–T17e, F3 | PASS [LOCAL-DB] |
| 8 | Geofence exit | G1–G5 | PASS [LOCAL-DB] |
| 9 | Clock-out during geofence break | T18 family | PASS [LOCAL-DB] |
| 10 | Clock-out during tracking break | T18a, T18, T11, T18b | PASS [LOCAL-DB] |
| 11 | WFH + GPS unavailable | T9, T9b, T9c | PASS [LOCAL-DB] |
| 12 | WFH + stale tracking | T8, T8b | PASS [LOCAL-DB] |
| 13 | Overnight shift | T13, T13b | PASS [LOCAL-DB] |
| 14 | Shift end with an open break | T12, T12b | PASS [LOCAL-DB] |
| 15 | Duplicate requests | T6, T6b, T22 | PASS [LOCAL-DB] |
| 16 | Concurrent break starts | C1, C1b, C2, C4 (10 rounds), T14, T14b | PASS [LOCAL-DB, PostgreSQL 18] |
| 17 | Scheduler repeated execution | T22, C3 | PASS [LOCAL-DB] |
| 18 | Forged timestamps / break source | R1, R2, R4, R9, R10, T1b | PASS [LOCAL-DB] |
| 19 | Altering break totals | T16, P5, X1–X5 | PASS [LOCAL-DB] |
| 20 | Admin correction and audit trail | P4, A4, C8, T16c | PASS [LOCAL-DB] |
| 21 | Payroll allowance / deduction consistency | P1–P3, C7 | PASS [LOCAL-DB] |
| 22 | Realtime disconnect, polling fallback | With the realtime WebSocket failing, Live Tracking showed "Live updates interrupted — reloading every minute" and pages still loaded data | PARTIAL [MOCK-BROWSER]; timing not verified |
| 23 | Notification failure | F1 | PASS [LOCAL-DB] |
| 24 | Browser suspension / screen lock | — | **BLOCKED** (needs a real device / long-running browser) |
| 25 | Old Android APK | Option B (web app until a new APK) documented | **RISK, not testable** — old APK still clocks out with the old client path |

UI for automatic breaks [MOCK-BROWSER]: an employee on an AUTO_GPS or AUTO_TRACKING break sees "AUTOMATIC BREAK", the correct reason, **no End Break button**, and a Clock Out action (desktop and phone; 16/16 PASS).

## 8. Database and API security findings

Probe: all repository migrations applied to a throwaway PGlite database, then real SQL run as signed-in employees through RLS ([LOCAL-DB]).

| ID | Finding | Result | Proposal |
|---|---|---|---|
| S-01a/b/c | An employee can set their **own** leave / WFH / permission request to APPROVED (also: insert as APPROVED, change dates after approval) | **VULNERABLE** | **NEW** `docs/proposals/PROPOSED_request_approval_guards.sql` — validated: 19/19 checks (attacks refused; create, cancel, HR approve/reject, postgres path still work) |
| S-05 | An employee can read every other employee's row (phone, date of birth …) — `employees` SELECT `USING (true)` | **VULNERABLE** | existing `docs/security/PROPOSED_employee_data_isolation.sql` (not re-validated in this QA) |
| S-06a | An employee can insert a forged audit-log entry attributed to someone else (`WITH CHECK (true)` policy from 0009) | **VULNERABLE** | **NEW** `docs/proposals/PROPOSED_audit_log_integrity.sql` — validated: 7/7 |
| S-06b | An employee can send a notification to another employee (phishing-style) | **VULNERABLE** | existing `docs/security/PROPOSED_notifications.sql` |
| S-09 | An employee can read their own DRAFT payroll before approval | VULNERABLE (policy question) | none yet — needs a decision |
| S-07 | `anon` can execute `get_email_by_employee_code` (account enumeration) | present | existing `docs/security/PROPOSED_employee_login_security.sql` |
| S-10 | `anon` can execute `process_auto_clock_out()` | present | revoked by existing `PROPOSED_missing_clock_out_workflow.sql` |
| S-11 | `trigger_push_notification_webhook` is SECURITY DEFINER without a fixed `search_path` | present | none yet |
| S-12 | `trg_admin_auth_sync` links any new `admin@gmail.com` auth user to the ADMIN profile (e-mail-based admin provisioning); today it fails only by accident (FK error), which also blocks creating that user at all | present | **NEW** `docs/proposals/PROPOSED_drop_admin_auth_sync_trigger.sql` |
| — | Protected: raising own net salary, reading another's payroll, reading/editing another's attendance, reading/overwriting another's live location, self-promotion to ADMIN, changing settings, injection-shaped employee-code lookup | PROTECTED | — |
| — | No public table without RLS; no e-mail-based policies remain | OK | — |

## 9. Node.js / Redis microservice findings (`server/`, other contributor — not modified)

Tests ([LOCAL-REDIS] / [UNIT], from a copy with Linux dependencies): `tsc --noEmit` exit 0; **33/33 passed** with a real local Redis (6.2.14). Without Redis the 5 live-integration tests fail with `ECONNREFUSED` (they do not skip).

The web app does **not** call this service today (no reference in `src/`), so none of the following affects current users. They are blockers before it is deployed or wired in:

| ID | Finding | Evidence | Minimal fix (proposal only) |
|---|---|---|---|
| MS-1 (P0 if deployed) | Role and employee id come from `user_metadata`, which every user can change on themselves with `supabase.auth.updateUser()`. An employee becomes `admin` and can act as any `employee_id` | `middleware/auth.ts`; QA probe test: user_metadata `{role:'admin', employee_id:'VICTIM-EMP'}` → resolved admin, admin route 200 | Resolve role and employee id from `profiles`/`roles` (or `app_metadata` set only by the server), never `user_metadata` |
| MS-2 (P1) | Schema mismatch: uses `work_date`, `clock_in`, `clock_out`, `clock_in_latitude…`, tables `live_tracking_breadcrumbs`, `payroll_rules` — none exist | `routes/attendance.routes.ts`, `services/trackingBufferService.ts` | Use `attendance_date`, `clock_in_at`, `clock_out_at`, the `employee_live_locations` table / RPCs |
| MS-3 (P1) | Uses the service-role key for writes: bypasses RLS **and** the automatic-break guards (they trust `service_role`); punch uses the client-supplied `timestamp`; clock-out does not call `close_auto_break_for_clock_out` | `services/supabase.ts`, `routes/attendance.routes.ts` | Forward the user's JWT to Supabase (user-scoped client) and call the existing RPCs; ignore client timestamps |
| MS-4 (P1) | GPS buffer insert fails (missing table) → batch re-queued forever (poison loop, order reversed by `lpush`); pings never reach `employee_live_locations`, so automatic breaks would never resume if clients used this path | `trackingBufferService.ts` | Correct target; dead-letter after N failures; `rpush` back |
| MS-5 (P2) | `dev-admin-token` accepted whenever `NODE_ENV` ≠ production — and the default is `development` | `config/env.ts`, `middleware/auth.ts` | Default to production; dev tokens only with an explicit flag |
| MS-6 (P2) | CORS fallback allows every origin with credentials | `app.ts` | Reject unknown origins |
| MS-7 (P3) | Rate-limit key uses `x-forwarded-for` (spoofable for unauthenticated requests); pipeline is not atomic | `redis/rateLimiter.ts` | Trust proxy setting; MULTI or Lua |
| OK | Lock release checks the owner token (Lua compare-and-delete); Redis outage: rate limiter fails open (header `X-RateLimit-Degraded`), punch lock fails closed (409) | `redis/lockService.ts`, `rateLimiter.ts` | — |

## 10. Test commands and actual results

| Layer | Command (scratch copies) | Result |
|---|---|---|
| Frontend unit tests [UNIT] | `vitest run` in 3 batches | **85 files, 1,143 passed, 0 failed** (387 + 324 + 432) — rerun after fixes |
| TypeScript | `tsc -p tsconfig.app.json --noEmit`, `tsc -p tsconfig.node.json --noEmit` | exit 0 / exit 0 — rerun after fixes |
| Lint | `oxlint src` | 0 errors, 250 warnings — rerun after fixes |
| Production build | `vite build` (QA env pointing to a mock URL) | OK; `dist/icons/*.webp` present and precached after the icon fix |
| Automatic-break DB tests [LOCAL-DB] | `node supabase/tests/autobreak/run_autobreak_db_tests.mjs` | **92 passed, 0 failed** — rerun after fixes |
| Concurrency [LOCAL-DB, PostgreSQL 18] | `run_autobreak_concurrency_tests.mjs` | 9 passed, 0 failed (earlier in this QA session; no DB code changed since) |
| Existing RLS suite [LOCAL-DB, PostgreSQL 18] | `supabase/tests/rls/run_rls_tests.sh` | **39 passed, 0 failed** after the harness fixes (it could not run before them) |
| Security attack probe [LOCAL-DB] | QA scratch script | results in §8 |
| Proposal validation [LOCAL-DB] | QA scratch scripts | request guards 19/19; audit integrity 7/7 |
| Microservice | `tsc --noEmit`; `vitest run` with local Redis | exit 0; 33/33 |
| Browser [MOCK-BROWSER] | Playwright + Chromium against the built app | **130/130 checks passed** (13 auth/routing, 16 employee automatic-break UI, 11 Break Management, 90 route crawl) |
| Staging / device | — | **not run** |

## 11. Defects by severity

**P0 — data exposure / privilege escalation**
- **S-01** Self-approval of leave / WFH / permission (affects leave balances, attendance exemptions, payroll). Repro: as employee, `UPDATE leave_requests SET status='APPROVED' WHERE id=<own>` via the REST API. Expected: refused. Actual: 1 row updated. Root cause: UPDATE policies in `0009_security_hardening.sql` / `20260929123000_fix_wfh_rls.sql` have no WITH CHECK or column limits. Fix: `PROPOSED_request_approval_guards.sql` (validated). Regression test: the 19-check probe (to add to the RLS suite once applied).
- **S-05** Employees can read all employees' personal data. Root cause: `employees` SELECT `USING (true)`. Fix: existing `PROPOSED_employee_data_isolation.sql`.
- **MS-1** Microservice trusts user-editable metadata (only if the service is deployed).

**P1 — critical workflow / integrity**
- **S-06a** Forged audit-log entries. Fix: `PROPOSED_audit_log_integrity.sql` (validated).
- **D-ACO** `process_auto_clock_out()` (migration 0015) fails at runtime with `column reference "settings" is ambiguous` (a PL/pgSQL variable named like the column). Repro [LOCAL-DB]: open attendance from 2 days ago, `SELECT process_auto_clock_out()` → error, nothing changed. Effect: wherever 0015 is deployed unchanged, the every-15-minutes auto clock-out never works. Fix: existing `PROPOSED_missing_clock_out_workflow.sql` replaces the function (it also closes open breaks at the verified time). Read-only check on staging: `SELECT pg_get_functiondef('public.process_auto_clock_out'::regproc);` and the cron run history.
- **B-05** Auto clock-out shift times built without a time zone (still present in 0015; superseded by the same proposal).
- **S-12** `trg_admin_auth_sync` (proposal ready).
- **MS-2, MS-3, MS-4** microservice (before integration).

**P2 — major functional / incorrect result**
- **B-02** Shifts → Assign shows "Shift assigned successfully (Overridden)" without saving (`Shifts.tsx` `triggerMockConflict` / `resolveConflict`) — still present.
- **B-03** Employees → Import waits 1.5 s and shows done; nothing imported (`simulateImport`) — still present.
- **B-04** Leave → Add Leave and Permission → Add Permission show success without saving (`Leave.tsx` L720, `Permission.tsx` L638) — still present.
- **B-09** Reports: non-Overview tabs are "Analytics Prototype" placeholders — still present.
- **B-11** No overlap check for permissions (service or database) — still present.
- **S-06b, S-07, S-09, S-10, S-11** (see §8). **MS-5, MS-6**.

**P3 — minor**
- **B-07** Leave settings shows a Manager → HR approval chain that does not exist — still present.
- **B-12** "Allow Half Day" etc. saved but not enforced (labelled as such in code) — still present.
- **PWA-1** Manifest icons `/icons/icon-*.webp` missing from the build — **fixed** (see §12).
- **PERF-1** One employee-dashboard load makes ~10 `/auth/v1/user` and ~9 `profiles` requests ([MOCK-BROWSER] request log) — redundant auth/profile loading.
- **LINT-1** 250 oxlint warnings (167 unused variables, 40 setState-in-effect, 17 hook dependencies).
- **MS-7**.

**No longer found in the code [STATIC; not exercised against a backend]**: B-01 (WFH page now sends the employee to the Attendance dashboard to clock in), B-08 (Audit Logs filter values now match stored values, pagination is functional), B-10 (Min/Max hours inputs no longer exist). **B-06** remains by design (payments need `PROPOSED_payroll_payment_safety.sql`).

## 12. Fixes made and regression tests added

| Change | Why | Verified by |
|---|---|---|
| `supabase/tests/rls/run_rls_tests.sh` — the old `v_status` patch is applied only when the migration still lacks the declaration | The suite failed before running any test | RLS suite 39/0 |
| `supabase/tests/rls/seed.sql` — role re-key with references, test DB only removes the bootstrap ADMIN-001 rows, auth users inserted with user triggers paused | Seed failed on FKs and on `trg_admin_auth_sync`; 5 tests failed because of the bootstrap admin | RLS suite 39/0 |
| `public/icons/` — copied the 7 existing `icons/*.webp` | Manifest referenced icons that were not in `public/`, so they were missing from the build and the PWA install | Build: `dist/icons/` present, all 7 in the service-worker precache |
| 3 new proposal SQL files (not applied) | S-01, S-06a, S-12 need database changes → approval required | Throwaway-DB validation (19/19, 7/7; S-12 behaviour shown earlier) |

No application source (`src/`) was changed. No test was removed or weakened. Regression checks for the proposals exist as QA scratch scripts; they should be added to `supabase/tests/rls/` when the proposals are approved (they would fail today by design).

## 13. Tests blocked

- Everything against real Supabase: login with real accounts, RLS as deployed, realtime, pg_cron, edge functions (`create-employee`), payroll runs, notifications delivery — **no staging project and no test accounts**.
- Real employee E2E (clock-in/out with real GPS, breaks, leave/WFH submission, persistence after re-login).
- Physical devices: Android APK, background location, screen lock, browser suspension (Phase F #24, #25).
- Production read-only checks (e.g. whether `process_auto_clock_out` runs there) — not attempted by rule.

## 14. Remaining production risks

1. S-01 and S-05 are live in any environment built from these migrations (unless the proposals were applied manually — check with the read-only queries in each proposal).
2. Auto clock-out probably fails on every run (D-ACO); forgotten clock-outs stay open, and an open automatic break keeps counting until someone acts.
3. The automatic-break migration has not been applied or observed on a real Supabase project; pg_cron, realtime and RLS behaviour there is unverified.
4. Old Android APK users bypass the new clock-out path until they use the web app or a new APK.
5. The microservice must not be deployed in its current form (MS-1…MS-4).
6. Unit and mocked tests passing does not prove real GPS, Supabase, Redis, payroll or browser behaviour.

## 15. Next actions (priority order)

1. **Approve and apply to STAGING** (after the read-only checks in each file): `PROPOSED_request_approval_guards.sql` (S-01), `docs/security/PROPOSED_employee_data_isolation.sql` (S-05), `PROPOSED_audit_log_integrity.sql` (S-06a).
2. On staging, read-only: check `process_auto_clock_out` definition and cron history; then approve `PROPOSED_overtime_requests.sql` + `PROPOSED_missing_clock_out_workflow.sql` (D-ACO, B-05, S-10).
3. Apply the automatic-break migration on staging following `docs/AUTOMATIC_BREAKS_STAGING.md` (pre-checks first), then run the 26-scenario matrix with dedicated test accounts on real devices.
4. Approve `PROPOSED_drop_admin_auth_sync_trigger.sql`, `PROPOSED_notifications.sql`, `PROPOSED_employee_login_security.sql`; decide S-09 (draft payroll visibility) and S-11.
5. Hide or implement the fake-success actions B-02, B-03, B-04 and the Reports placeholders B-09.
6. Microservice owner: fix MS-1…MS-6 before any deployment; make the live Redis tests skip when Redis is absent.
7. Add the proposal regression checks to the RLS suite once applied; reduce redundant auth/profile requests; work down lint warnings.
8. Commit the QA changes listed in §2 when you are satisfied (not done by QA).

## 16. Readiness decision

**Not ready for release due to blockers.**

Local verification passed for everything that can run here (1,143 unit tests, 92 + 9 database tests, 39 RLS tests, 33 microservice tests, 130 mocked-browser checks, clean type check and build). Release is blocked by the open P0 database vulnerabilities (S-01 self-approval, S-05 data exposure), the P1 auto-clock-out failure, and the absence of any staging verification.
