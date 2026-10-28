# WorkPulse HR — Attendance, LOP & Payroll Integrity Fix — Review & Validation Report (2026-10-28)

**Base Commit:** `7018ca1` ("Fix attendance correction validation")  
**Branch:** `main`  
**Execution Environment:** Node.js v24.15.0, Windows, Vitest v5.0.2, Vite v8.3.0  
**Current Status (updated 2026-10-28 09:55 IST):** Part 1 (sections 1–13) was committed by you as `3f60170`. Part 2 (section 14: auto clock-out, missing clock-out settings, overtime) is in the working tree, uncommitted. Latest full validation: 101 frontend test files / 1,267 tests passed, type-check (app + node) 0 errors, lint 0 errors, production build passed, 10 database suites / 370 checks passed on disposable databases. Nothing committed, pushed, deployed or applied to any Supabase project. Awaiting your approval.

---

## 1. Executive Summary

This comprehensive review validates the architecture, security, database migrations, rollbacks, service logic, and automated test coverage across the attendance and payroll pipelines following the October 27-28 audit (`docs/reports/PAYROLL_PIPELINE_AUDIT_2026-10-27.md`).

Key outcomes:
1. **Attendance Input Integrity:** Verified server-side enforcement preventing employee forgery of clock times, late minutes, worked hours, and half-day status via `supabase/migrations/20261028090000_attendance_server_values.sql`.
2. **Atomic Payroll Recalculation:** Verified single-transaction recalculation with per-(employee, year, month) advisory locking and database-level lock enforcement via `supabase/migrations/20261028090100_payroll_lock_and_replace.sql`.
3. **Approval Staleness Protection:** Stored payroll calculations must match fresh calculations before approval; any post-calculation attendance correction, leave approval, or setting drift halts approval with clear guidance.
4. **Daily ↔ Monthly Reconciliation:** Daily deduction impact now evaluates marginal month-to-date differences ($MTD_{D} - MTD_{D-1}$), accurately reflecting monthly late limits, interval roundings, and single monthly deductions.
5. **GPS Supabase Test Warning Resolved:** Identified that `backgroundTrackingBridge.test.ts` omitted `.rpc` from its Supabase mock; added the proper mock shape and added a regression test confirming tracking RPC failures never mutate attendance or break state.

---

## 2. Files Changed and Inventory

### Tracked Files Modified (17 files)
| File | Changes | Purpose |
|---|---|---|
| `src/pages/admin/Payroll.tsx` | +33, -13 | Request sequencing ref, 500ms debounce, pending badges, unclocked row display |
| `src/services/attendance/attendanceService.ts` | +30, -8 | Audit logs and events consume stored server-generated values |
| `src/services/attendance/missingClockOutRules.ts` | +11, -3 | Shared `missingClockOutGraceHours` helper respecting `at_shift_end` mode |
| `src/services/attendance/missingClockOutService.ts` | +4, -2 | Replaced hardcoded fallback with `missingClockOutGraceHours` |
| `src/services/location/backgroundTrackingBridge.test.ts` | +15, -2 | Added `rpc` mock and test for failed diagnostic RPC safety |
| `src/services/payroll/dailyMetricDetails.ts` | +65, -32 | Pending and unavailable counters, marginal late explanation |
| `src/services/payroll/payrollCardRules.ts` | +4, -1 | `clockedInCard` counts only employees who actually clocked in |
| `src/services/payroll/payrollClientRules.test.ts` | +1, -0 | Test double alignment |
| `src/services/payroll/payrollDailyRate.test.ts` | +1, -0 | Test double alignment |
| `src/services/payroll/payrollDailyReport.test.ts` | +105, -12 | Tests for marginal daily reconciliation, unclocked vs absent rows |
| `src/services/payroll/payrollImpactRules.ts` | +20, -5 | Added `NOT_CLOCKED_IN` status and `TODAY_PENDING` handling |
| `src/services/payroll/payrollMissingClockOut.test.ts` | +35, -4 | Updated tests for unified grace logic |
| `src/services/payroll/payrollPaymentSafety.test.ts` | +3, -0 | Test double alignment |
| `src/services/payroll/payrollService.ts` | +295, -139 | Atomic `_savePayrollCalculation`, `_staleCalculationCheck`, marginal report |
| `src/services/realtime/realtimeService.ts` | +8, -0 | Subscriptions to `leave_requests` and `permission_requests` with unique topics |
| `supabase/tests/autobreak/run_autobreak_db_tests.mjs` | +7, -2 | Test harness alignment for server-values trigger |
| `supabase/tests/autoclockout/run_auto_clock_out_tests.mjs` | +8, -2 | Test harness alignment for server-values trigger |

### Untracked Files Added (14 files)
- `docs/reports/ATTENDANCE_PAYROLL_FIX_REPORT_2026-10-28.md`
- `docs/reports/PAYROLL_PIPELINE_AUDIT_2026-10-27.md`
- `src/services/payroll/dailyImpactRules.ts`
- `src/services/payroll/dailyImpactRules.test.ts`
- `src/services/payroll/payrollAtomicRecalc.test.ts`
- `src/services/payroll/payrollImpactStatus.test.ts`
- `src/services/payroll/payrollWriteRules.ts`
- `src/services/payroll/payrollWriteRules.test.ts`
- `supabase/migrations/20261028090000_attendance_server_values.sql`
- `supabase/migrations/20261028090100_payroll_lock_and_replace.sql`
- `supabase/rollbacks/20261028090000_attendance_server_values.rollback.sql`
- `supabase/rollbacks/20261028090100_payroll_lock_and_replace.rollback.sql`
- `supabase/tests/payroll/run_attendance_payroll_tests.mjs`
- `supabase/tests/payroll/run_payroll_concurrency_tests.mjs`

---

## 3. Root Causes & Fixes Summary

| Ref | Severity | Issue | Root Cause | Fix Applied | Status |
|---|---|---|---|---|---|
| #1 | **P0** | Payroll inputs could be forged | Employee `attendance` RLS allowed writing `late_minutes`, `clock_in_at`, `worked_hours`, `status` | Trigger `trg_aa_attendance_server_values` computes all inputs on DB server at `now()` | **Verified and passed** |
| #2 | **P1** | Recalculation erased payroll before calculating | `recalculatePayroll` deleted row and items prior to computation | Introduced `replace_payroll_calculation` RPC with atomic in-place update and safe fallback | **Verified and passed** |
| #3 | **P1** | Finalized payroll protected only in UI | "Manage payroll" policy was permissive across statuses | Triggers `trg_guard_payroll_lock` and `trg_guard_payroll_items_lock` enforce DB locks | **Verified and passed** |
| #4 | **P1** | Stale calculation could be approved | Approval checked only missing clock-out corrections | `_staleCalculationCheck` re-runs calculation and refuses if drift > ₹0.005 | **Verified and passed** |
| #5 | **P1** | Daily late deduction ≠ monthly | Daily calculation did not consider month-to-date state | Implemented marginal calculation ($MTD_D - MTD_{D-1}$) in `dailyImpactRules.ts` | **Verified and passed** |
| #6 | **P1** | Daily view excluded employees without attendance | Query only scanned `attendance` table | Combined active salary structures with attendance records | **Verified and passed** |
| #7 | **P2** | Earlier MCO adjustments repeated daily | Adjustments queried for all dates $\le D$ | Resolved by marginal delta (adjustments appear solely on effective date) | **Verified and passed** |
| #8 | **P2** | Pending rows showed as final ₹0 | KPI cards had no status awareness | Added `pendingCount` and `unavailableCount` indicators and notes | **Verified and passed** |
| #9 | **P2** | Inconsistent grace hours in daily view | Hardcoded fallback of 2 hours | Unified via `missingClockOutGraceHours` respecting settings | **Verified and passed** |
| #10 | **P3** | Clocked-in card miscounted unclocked rows | Counted all report entries | Filtered strictly to rows containing valid `clockIn` | **Verified and passed** |
| #11 | **P3** | Realtime subscription races | Unsequenced updates triggered concurrent reloads | Added load sequence ref, 500ms debounce, and dedicated channel topics | **Verified and passed** |
| #12 | **P3** | Missing Supabase `.rpc` mock in tracking test | Incomplete test mock object | Added `rpc` mock and test for failed diagnostic handling | **Fixed and retested** |

---

## 4. Attendance Integrity Findings (Phase 2)

- **Server-Derived Clock Timestamps [Verified and passed]:** Trigger `trg_aa_attendance_server_values` forces `clock_in_at` and `clock_out_at` to use `now()` (database time) for non-admin/HR callers.
- **Roster & Shift Assignment Precedence [Verified and passed]:** `att_assigned_shift` evaluates published roster entries first, then permanent shift assignments, refusing clock-in on scheduled Week Offs.
- **Overnight Shifts & Timezone [Verified and passed]:** Local time evaluated in `Asia/Kolkata` (+05:30); overnight shifts crossing midnight correctly map clock-ins before shift end to the prior calendar date.
- **HR/Admin Attendance Corrections [Verified and passed]:** Trigger checks `COALESCE(public.get_auth_role(), '') IN ('ADMIN', 'HR')` and trusted system roles (`postgres`, `service_role`, `supabase_admin`), allowing full administrative corrections without restriction.
- **Audit Trails [Verified and passed]:** `attendanceService.ts` reads the stored row returned from the database, ensuring audit logs and events log actual server values.

---

## 5. Payroll Calculation and Approval Findings (Phases 3 & 4)

- **Atomic Recalculation [Verified and passed]:** `replace_payroll_calculation` executes in a single database transaction. If any item fails validation or insertion, the entire transaction rolls back.
- **Advisory Transaction Lock [Verified and passed]:** `pg_advisory_xact_lock(hashtextextended('payroll:' || v_emp || ':' || v_year || ':' || v_month, 0))` guarantees only one calculation runs at a time for any specific employee and month, preventing duplicate key race conditions.
- **Protected Items Safety (`DELETE FROM payroll_items`) [Verified and passed]:** The deletion is executed only after verifying `NOT public.payroll_is_locked(v_existing.status)`. Locked payrolls (Approved, Paid, Closed) reject the transaction before reaching deletion.
- **State Machine Transitions [Verified and passed]:** `payroll_transition_allowed` strictly enforces:
  $$\text{DRAFT/CALCULATED} \rightarrow \text{UNDER\_REVIEW} \rightarrow \text{APPROVED} \rightarrow \text{PAYMENT\_PENDING} \rightarrow \text{PAID} \rightarrow \text{CLOSED}$$
- **Staleness Detection [Verified and passed]:** When an admin attempts to approve a payroll, `_staleCalculationCheck` re-evaluates current attendance, leave, LOP, overtime, and salary settings. Any mismatch $> ₹0.005$ halts approval with the message:
  `"Attendance, leave, overtime or settings changed after this payroll was calculated (<fields> differ). Recalculate the payroll before approving."`

---

## 6. Daily Payroll and Attendance Impact (Phase 5)

- **Reconciliation with Monthly Payroll [Verified and passed]:** Tested across interval-based, salary-based (with monthly limit), fixed, and per-minute late rules. The sum of marginal daily impacts equals the monthly payroll calculation exactly (`dailyImpactRules.test.ts`).
- **Absence vs. Pending Distinctions [Verified and passed]:** Employees who have not clocked in for today's ongoing shift are tagged as `TODAY_PENDING`, preventing them from being falsely marked as unexcused LOP absence during work hours.
- **KPI Card Visibility [Verified and passed]:** KPI cards display dynamic subtitles (e.g., `"2 pending — not final"`) to prevent operators from treating intraday figures as finalized deductions.

---

## 7. GPS Warning Investigation (Phase 6)

- **Root Cause Analysis [Fixed and retested]:**
  The warning `[GPS] tracking event ... not delivered: __vite_ssr_import_0__.supabase.rpc is not a function` in `src/services/location/backgroundTrackingBridge.test.ts` was caused by an incomplete Supabase mock that implemented `.from` and `.auth` but omitted `.rpc`. When `locationService` handled GPS events like `LOCATION_UNAVAILABLE`, `trackingEnforcementService.reportEvent()` called `supabase.rpc('report_tracking_event', ...)`, causing Vitest to log the uncaught mock failure.
- **Resolution:**
  Added `rpc: vi.fn(async () => ({ data: { action: 'NONE' }, error: null }))` to the Supabase mock in `backgroundTrackingBridge.test.ts`.
- **Diagnostic Safety Regression Test:**
  Added a test verifying that when the diagnostic RPC fails (network error / DB timeout), tracking problem is logged and the bridge preserves attendance and break state without throwing or making incorrect geofence exits.
- **Vite Warning `[INEFFECTIVE_DYNAMIC_IMPORT]` [Verified and passed / Harmless]:**
  Vite logged that `@capacitor/core` was dynamically imported in `nativeBackgroundLocation.ts` but statically imported by `@capacitor/push-notifications`. This is an informational bundler notification that the module cannot be isolated into an independent chunk; it has no adverse effect on runtime execution or bundle functionality.

---

## 8. Migration and Rollback Review (Phase 7)

### Migration 1: `20261028090000_attendance_server_values.sql`
- **Actions:** Creates functions `att_assigned_shift`, `att_may_compute_for`, `att_clock_in_values`, `att_clock_out_values`, trigger function `guard_attendance_server_values`, and trigger `trg_aa_attendance_server_values`.
- **Ordering:** Uses `trg_aa_` prefix to ensure execution *before* `trg_ab_guard_attendance_totals`.
- **Security:** Functions use `SECURITY DEFINER` with explicit `SET search_path = public, pg_temp`. Grants restricted to authenticated with internal authorization checks.
- **Rollback (`20261028090000_attendance_server_values.rollback.sql`):** Safely drops the trigger and newly introduced functions. Does not modify pre-existing tables or drop pre-existing triggers.

### Migration 2: `20261028090100_payroll_lock_and_replace.sql`
- **Actions:** Creates lock helpers `payroll_is_locked`, `payroll_transition_allowed`, triggers `trg_guard_payroll_lock` and `trg_guard_payroll_items_lock`, and function `replace_payroll_calculation`.
- **Security:** `SECURITY DEFINER` with search path controls and role checks (`ADMIN` / `HR`).
- **Rollback (`20261028090100_payroll_lock_and_replace.rollback.sql`):** Drops triggers and functions cleanly without altering stored payroll records. Client code contains graceful fallback (`isMissingReplaceFunction`) if rolled back.

---

## 9. Test Results (Phase 8)

### Frontend Automated Test Suite
- **Command:** `npm test` (`vitest run`)
- **Total Test Files:** 98 passed (98 total)
- **Total Tests:** 1,243 passed (1,243 total)
- **Duration:** 5.07s
- **Status:** **100% Passed**

### Production Build Validation
- **Command:** `npm run build` (`tsc -b && vite build`)
- **Outcome:** Clean compile; PWA assets and service workers generated successfully.
- **Status:** **Passed**

### Static Code Analysis
- **Command:** `npm run lint` (`oxlint`)
- **Outcome:** 0 errors (warnings in pre-existing files unchanged).
- **Status:** **Passed**

### Database Tests Environment Status (corrected 2026-10-28)
- The database suites **were run** on disposable databases: in-memory PGlite and a temporary embedded PostgreSQL server on localhost, both deleted after each run, with all migrations applied. The database libraries were installed outside the project, so `package.json` is unchanged. No Supabase project, staging or production database was used. Current results are in section 14.4.
- Not verified: behaviour on your live Supabase project, including whether `docs/proposals/PROPOSED_overtime_requests.sql` and `PROPOSED_missing_clock_out_workflow.sql` are applied there.

---

## 10. Security & Concurrency Analysis

1. **Privilege Escalation:** Non-admin/HR users cannot forge attendance fields, compute values for other employees, or execute `replace_payroll_calculation`.
2. **Search Path Safety:** All new functions explicitly configure `SET search_path = public, pg_temp` to prevent search path hijacking.
3. **Trigger Execution Order:** `trg_aa_` executes before `trg_ab_`, guaranteeing that the automatic break guard operates on valid server-calculated attendance fields.
4. **Advisory Lock Scope:** Transaction-bound hash locking ensures isolation per employee and payroll period without creating cross-employee bottlenecks.

---

## 11. Staging Verification Status & Checklist

| Test Item | Verification Method | Status |
|---|---|---|
| Employee cannot falsify clock-in date/time | Send direct Supabase update on `attendance` | Verified in mock / Ready for staging DB |
| Early logout results in HALF_DAY status | Clock out before required shift duration | Verified in pure rules / Ready for staging DB |
| Recalculation locked after approval | Attempt `replace_payroll_calculation` on approved row | Verified in pure rules / Ready for staging DB |
| Stale payroll blocks approval | Modify approved leave after calculation, attempt approve | Verified in test suite / Ready for staging DB |
| Daily report matches monthly totals | Check `dailyImpactRules.test.ts` | **Verified and passed** |
| Tracking diagnostic RPC failure handled safely | Check `backgroundTrackingBridge.test.ts` | **Verified and passed** |

---

## 12. Deployment and Rollback Instructions

### Deployment Sequence (staging first; production only with your approval)
1. `supabase/migrations/20261028090000_attendance_server_values.sql`
2. `supabase/migrations/20261028090100_payroll_lock_and_replace.sql`
3. `supabase/migrations/20261028090200_auto_clock_out_and_settings_hardening.sql`
4. Only if the missing clock-out workflow should be enforced and is not yet applied: `docs/proposals/PROPOSED_overtime_requests.sql` (if not already applied), then the revised `docs/proposals/PROPOSED_missing_clock_out_workflow.sql` (run its STEP 0 check first). The revised file must be applied after step 3, because it uses that migration's settings helpers. If an older copy of the proposal was applied after 22 Oct, re-run step 3 so the auto clock-out job is the current version.
5. Deploy the frontend build.

### Rollback Sequence (if necessary)
1. `supabase/rollbacks/20261028090200_auto_clock_out_and_settings_hardening.rollback.sql`
2. `supabase/rollbacks/20261028090100_payroll_lock_and_replace.rollback.sql`
3. `supabase/rollbacks/20261028090000_attendance_server_values.rollback.sql`
4. The frontend falls back to the previous save path when `replace_payroll_calculation` is missing. Validated: RB-1…RB-7 in section 14.4.

---

## 13. Git status

Part 1 was committed as `3f60170` ("Fix attendance and payroll calculation safety"). The Part 2 files that are still uncommitted, and the next safe commands, are listed in section 14.7. Do not push until you have reviewed and approved them.

---

## 14. Part 2 — Auto Clock-Out, Missing Clock-Out Settings, Attendance & Payroll (2026-10-28, uncommitted)

Request: "Fix Auto Clock-Out, Missing Clock-Out Settings, Attendance and Main Payroll". Decisions you gave at 09:03:
(1) when HR verifies a day after a missing clock-out rejection, the ₹200 is reversed if not yet paid, otherwise refunded once in the next eligible payroll, with the audit history kept;
(2) overtime approval stays separate from payment: approval is allowed while overtime pay is off, the amount stays ₹0, and the status reads "Approved — Unpaid (Overtime Pay Disabled)".

### 14.1 Findings and classification

| # | Item | Root cause / finding | Result | Classification |
|---|---|---|---|---|
| 1 | Missing clock-out settings had no effect unless the proposal was applied | The correction requests, the "Maximum additional working time" limit and the rejected-case deduction exist only in `docs/proposals/PROPOSED_missing_clock_out_workflow.sql`, not in `supabase/migrations`. Settings are saved to `app_settings.settings.payroll`, which the database reads, but without the proposal nothing enforces them | Proposal revised and tested together with all migrations | Fixed and tested (on disposable databases) / **Not verified on your live project** |
| 2 | Applying the proposal would have broken auto clock-out | Its section 9 replaced `process_auto_clock_out()` with an older copy that ignores Settings → auto clock-out off, "at shift end" mode, `SKIP LOCKED` concurrency safety and the closing of open breaks | Section 9 removed. Negative control: the committed proposal fails 11 of 35 checks (ACO-11 "switched off" flags anyway); the revised one passes | Fixed and tested |
| 3 | One bad setting value broke every auto clock-out run | `::NUMERIC` / `::BOOLEAN` casts. A grace of "four" raised `invalid input syntax` every 15 minutes, and the submit/review functions failed the same way | `wp_settings_numeric` / `wp_settings_bool` added; invalid values fall back to the documented defaults (limit 3 h, grace 4 h, ₹0) | Fixed and tested (SET-4, ACO-12) |
| 4 | Settings not validated on save | Only the browser `<input min>` attributes | `trg_validate_app_settings` (server, any writer) plus `settingsSaveErrors` on the Settings screen, with the same rules: limit 0–24 h; amount ≥ ₹0 with at most 2 decimals; amount > ₹0 while the deduction is on; grace ≥ 0; mode is one of the two values; overtime multiplier > 0 / fixed rate ≥ 0 while overtime pay is on. Empty keeps the default | Fixed and tested (VAL-1…3, 7 frontend tests) |
| 5 | "At shift end" mode inconsistent | `mco_settings().grace_hours` ignored the mode: the job flagged at shift end, but the correction was refused for another 4 h | `mco_settings()` is now mode-aware; browser `missingClockOutGraceHours` and `normalizeLimitHours` read values exactly as the database does | Fixed and tested (SET-3, MODE-1) |
| 6 | Deduction "on" with ₹0 recorded nothing | — | Treated as off in the database and refused on save | Fixed and tested (SET-6, VAL-1) |
| 7 | One failing row stopped the whole auto clock-out run; failures were invisible | Single transaction, errors only in pg_cron's log | Each row is processed in its own sub-transaction; the run log `auto_clock_out_runs` records flagged / failed / errors (HR and admins can read it, retained 90 days), adds a `RAISE WARNING`, and the next run retries | Fixed and tested (ACO-6…10) |
| 8 | HR verifies a day after a rejection (decision 1) | — | Proposal section 11, trigger `trg_mco_resolve_deduction_on_correction`. When HR or an admin records the clock-out: a PENDING deduction becomes CANCELLED; a SETTLED deduction (in an approved or paid payroll, which is locked and untouched) gets one `MCO-REV` reversal, credited as an earning in the next calculated payroll. Audited; nothing deleted; employees cannot trigger it | Fixed and tested (HRC-1, HRC-2) |
| 9 | Overtime approval vs payment (decision 2) | Approval was already independent of the setting, and pay was already ₹0 while off, but the status gave no hint | `overtimeStatusLabel()` shows "Approved — Unpaid (Overtime Pay Disabled)" on the admin and employee Overtime pages and in the Payroll → Overtime Pay breakdown. Only for approved hours > 0, and never while settings are still loading | Fixed and tested (6 tests) |
| 10 | `supabase.rpc is not a function` warning | Incomplete test mocks, **not** an integration defect. You fixed `backgroundTrackingBridge.test.ts` in `3f60170`; the same gap remained in `geofenceTrackingRecovery.test.ts` and `trackingResilience.test.ts`. Production uses the real client, and `report_tracking_event` exists in migration `20261021120000` | `rpc` added to both mocks. The warning no longer appears in any test log | Fixed and tested |
| 11 | Auto clock-out invents no clock-out time and never overwrites a real one | Flag-only since 22 Oct (`clock_out_at` never written; `WHERE clock_out_at IS NULL`) | — | Verified without changes (ACO-1, ACO-2) |
| 12 | Overnight shifts, company time zone, idempotency, concurrent runs | `mco_flag_at` (Asia/Kolkata, end on the next day); `SKIP LOCKED`; one event and one notification per day | — | Verified without changes (ACO-3, ACO-5, C3, S1) |
| 13 | Limit enforced and claims beyond it flagged rather than truncated | `mco_evaluate`: requested ≤ min(additional, limit); `excess_hours` stored for the admin | — | Verified without changes (LIM-1, LIM-2) |
| 14 | Pending case not deducted; one deduction per case; recorded amount fixed at rejection | Unique `MCO-DED:<attendance>` reference; amount copied at rejection | — | Verified without changes (PEND-1, REJ-1…4, C4) |
| 15 | Approved correction cancels or reverses the deduction; payroll approval settles adjustments atomically | `review_missing_clock_out_request`, `approve_payroll_with_adjustments` | — | Verified without changes (APP-1…3, PAY-1, PAY-2) |
| 16 | Which payroll cycle a deduction lands in | The first payroll calculated after the decision whose period end ≥ work date. A locked month is never changed, so it goes to the next unlocked payroll (existing policy, 14 Oct) | — | Verified without changes |
| 17 | Missing clock-out shows no invented working hours | Payroll counts the day as present (clock-in) with no worked hours; the daily view shows "not clocked out" / "Missing clock-out — not calculated" | — | Verified without changes |
| 18 | Enable Overtime Pay | Off: ₹0, no overtime item, deferred overtime stays pending (not settled for ₹0). On: only approved hours (≤ eligible, enforced by a constraint). Unapproved extra time is never paid | — | Verified without changes (payrollPolicyMatrix) |
| 19 | A settings change only affects unlocked payroll | Recorded deductions keep their amount; approval refuses a stale payroll until it is recalculated; approved payroll cannot be recalculated | — | Verified without changes (REJ-3, policy matrix) |
| 20 | Live Supabase state (which proposals are applied, pg_cron job present, saved setting values) | No access to your project | — | **Not verified** |
| 21 | "Approved but not yet paid" payroll | A deduction in a payroll that is APPROVED or PAYMENT_PENDING is already settled and locked, so decision 1 handles it like a paid one (refund in the next payroll), not by editing the approved payroll | — | Requires business decision (confirm this reading) |

### 14.2 Auto clock-out behaviour before and after

| | Before (`20261022100000`, plus the committed proposal if applied later) | After (`20261028090200`, revised proposal) |
|---|---|---|
| Clock-out time | Never invented | Never invented (unchanged) |
| Grace | `autoClockOutGraceHours`, or 0 in "at shift end" mode, in the job only; the correction used 4 h | One value from `mco_settings()` for the job, the correction and the app |
| Invalid saved value | Every run failed | Defaults used; invalid values now refused on save |
| Failure of one row | Whole run rolled back, nothing flagged | That row is recorded and retried next run; others are flagged |
| Diagnostics | pg_cron log only | `auto_clock_out_runs` (HR / admin) plus `RAISE WARNING` |
| Applying the proposal afterwards | Replaced the job with an older version | Leaves the job unchanged |

### 14.3 Attendance table ↔ payroll reconciliation

Unchanged from Part 1 and re-verified: the Payroll daily table and cards are each day's share of the monthly calculation (Σ daily = monthly, `dailyImpactRules.test.ts`). Late and break deductions come from the same calculation, so nothing is counted twice. Missing clock-out deductions enter only through `payroll_adjustments` (one line per payroll, on the work date in the daily view). Overtime comes only from approved requests. Rows reconcile with totals: Σ deduction items = `total_deductions`, earnings − deductions = `net_salary` (policy matrix, C1, C3).

### 14.4 Tests actually run (latest code, 2026-10-28 09:40–09:55 IST, on your computer's Linux workspace)

Frontend (Vitest 4, Node 22). `npx vitest run <files>` in 15 batches of up to 7 files, covering all 101 test files:
| Result | |
|---|---|
| Test files | **101 passed / 101** |
| Tests | **1,267 passed, 0 failed** |
| New in Part 2 | `settingsValidation.test.ts` (7), `payrollPolicyMatrix.test.ts` (10), `overtimeStatusLabel.test.ts` (6) |
| Fixed and re-run | `dailyMetricDetails.test.ts` 14/14 (status text now "Approved" / "Pending"); location mocks 31/31, warning gone; policy matrix 10/10 after lint clean-up |

| Check | Command | Result |
|---|---|---|
| Type-check (app) | `npx tsc -p tsconfig.app.json --noEmit` | 0 errors |
| Type-check (node) | `npx tsc -p tsconfig.node.json --noEmit` | 0 errors |
| Lint | `npx oxlint -c .oxlintrc.json src` | 0 errors, 250 warnings (baseline; the 3 new ones from my test file were fixed) |
| Production build | `npx vite build` | Passed, built in 53.5 s (informational `INEFFECTIVE_DYNAMIC_IMPORT` notice, as in section 7) |

Database (disposable: PGlite in memory, or a temporary embedded PostgreSQL server; all migrations applied; the proposals where noted):
| Suite | Result |
|---|---|
| `supabase/tests/missingclockout/run_missing_clock_out_workflow_tests.mjs` (new; migrations + both proposals) | **37 / 37** |
| `supabase/tests/rollback/run_rollback_tests.mjs` (new) | **8 / 8** |
| `supabase/tests/payroll/run_payroll_concurrency_tests.mjs` (real PostgreSQL; C3 + C4 new) | **5 / 5** |
| `supabase/tests/payroll/run_attendance_payroll_tests.mjs` | 36 / 36 |
| `supabase/tests/autoclockout/run_auto_clock_out_tests.mjs` | 34 / 34 (baseline mode now also leaves out the new migration, which builds on the 22 Oct fix) |
| `supabase/tests/security/run_security_tests.mjs` | 105 / 105 |
| `supabase/tests/autobreak/run_autobreak_db_tests.mjs` | 92 / 92 |
| RLS suite (`supabase/tests/rls`, embedded PostgreSQL) | 39 / 39 |
| Security concurrency / automatic-break concurrency (real PostgreSQL) | 5 / 5, 9 / 9 |
| **Total** | **370 checks, 0 failed** |

Negative control: with the committed (unrevised) proposal, the workflow suite fails 11 / 35. That proves the regression in item 2 and that the suite detects it.

The 20 required cases map to these tests:
- 1, 2, 3, 6 → ACO-1, ACO-2
- 4 → ACO-5, C3
- 5 → ACO-3
- 7 → LIM-1, LIM-2
- 8 → PEND-1
- 9 → REJ-1
- 10 → REJ-4
- 11 → REJ-2, C4
- 12 → APP-1…3, HRC-1, HRC-2, policy matrix
- 13, 14 → policy matrix, overtimeStatusLabel
- 15 → dailyImpactRules reconciliation, policy matrix
- 16 → ACO-2, day classification
- 17 → ATM-6, policy matrix
- 18 → LCK-1…5, PAY-2, policy matrix
- 19 → SET-2, REJ-3, policy matrix
- 20 → C3

Zero, null and invalid values, date boundaries and failed operations are covered by SET-4…6, VAL-1…2, settingsValidation, ACO-9/10/12 and the "cannot be loaded" cases.

### 14.5 Database security and concurrency checks
- Only ADMIN / HR can save settings (existing RLS, VAL-3). Validation runs for every writer.
- Every new function sets `search_path = public, pg_temp`. Internal helpers and `validate_app_settings_values` have EXECUTE revoked. `process_auto_clock_out` can be run only by postgres and service_role (ACO-8).
- Employees cannot write adjustments, record deductions, run the job, read the run log, or trigger the HR cancellation/reversal (SEC-1, ACO-7, HRC-1).
- Concurrency (real PostgreSQL): overlapping auto clock-out runs together with payroll recalculations flag each day once with one consistent payroll (C3); two simultaneous rejections give one decision and one ₹200 deduction (C4).

### 14.6 Migration and rollback validation
- New: `20261028090200_auto_clock_out_and_settings_hardening.sql`, with its rollback. It restores the 22 Oct `mco_settings()` / `process_auto_clock_out()` exactly, drops the trigger, the helpers and the diagnostic run log, and changes no data.
- `run_rollback_tests.mjs` checks:
  - all three new migrations roll back cleanly in reverse order (RB-1);
  - their objects are gone (RB-2);
  - unrelated functionality is kept (RB-3): the auto clock-out job and its guard, the automatic-break guard, the missing clock-out workflow and the payroll tables;
  - the restored job runs (RB-4), and `mco_settings()` still works for the proposal (RB-5);
  - the migrations re-apply after a rollback and are safe to run twice (RB-6, RB-7).
- Proposal revised (not a migration, applied by hand as before):
  - `mco_settings()` is identical to the migration's;
  - section 9 no longer redefines the job;
  - section 11 adds the HR-correction rule;
  - the rollback notes are updated.
- **Nothing was applied to any Supabase project.**

### 14.7 Files changed in Part 2 (uncommitted; 12 modified, 8 new)
Modified:
- `docs/proposals/PROPOSED_missing_clock_out_workflow.sql`
- `src/pages/admin/Settings.tsx`
- `src/pages/admin/Overtime.tsx`
- `src/pages/employee/Overtime.tsx`
- `src/services/attendance/missingClockOutRules.ts`
- `src/services/overtime/overtimeRules.ts`
- `src/services/payroll/dailyMetricDetails.ts`
- `src/services/payroll/dailyMetricDetails.test.ts`
- `src/services/location/geofenceTrackingRecovery.test.ts`
- `src/services/location/trackingResilience.test.ts`
- `supabase/tests/autoclockout/run_auto_clock_out_tests.mjs`
- `supabase/tests/payroll/run_payroll_concurrency_tests.mjs`

New:
- `supabase/migrations/20261028090200_auto_clock_out_and_settings_hardening.sql`
- `supabase/rollbacks/20261028090200_auto_clock_out_and_settings_hardening.rollback.sql`
- `src/services/settings/settingsValidation.ts`
- `src/services/settings/settingsValidation.test.ts`
- `src/services/payroll/payrollPolicyMatrix.test.ts`
- `src/services/overtime/overtimeStatusLabel.test.ts`
- `supabase/tests/missingclockout/run_missing_clock_out_workflow_tests.mjs`
- `supabase/tests/rollback/run_rollback_tests.mjs`

This report is also updated.

Next safe step, after you review `git diff`:
```powershell
git status
git diff
git add docs/reports/ATTENDANCE_PAYROLL_FIX_REPORT_2026-10-28.md docs/proposals/PROPOSED_missing_clock_out_workflow.sql src supabase/migrations/20261028090200_auto_clock_out_and_settings_hardening.sql supabase/rollbacks/20261028090200_auto_clock_out_and_settings_hardening.rollback.sql supabase/tests
git commit -m "fix(attendance,payroll): harden auto clock-out and missing clock-out settings, overtime unpaid status"
```
Do not push, and do not apply the migration or proposal to production, until you approve. Use a staging project first.

### 14.8 Remaining risks and manual verification
Risks:
- **Live state unknown.** If the workflow proposal is not applied on your project, the limit and the deduction settings still do nothing there. If the old proposal was applied after 22 Oct, the live auto clock-out job is the older version until `20261028090200` is applied.
- **Saving settings can now be refused.** If the live settings row already holds an invalid value (e.g. deduction on with ₹0), the next save will be refused with a message naming the field. This is intended, but HR should know.
- **Decision 1 covers clock-outs only.** It applies when HR records the clock-out. Other HR edits to a day with a clock-out already recorded do not change the deduction.
- **A dual write path remains.** HR corrections go directly to `attendance`. Without the workflow proposal, the trigger in section 11 does not exist and no deductions exist either.

Manual checks on staging:
1. Apply the migrations, then (if wanted) the two proposals in order.
2. Settings: try saving a limit of 25, and the deduction on with ₹0 → both are refused with clear messages. Save 3 h, deduction on, ₹200.
3. Leave a test employee without a clock-out past shift end + grace → the next 15-minute run flags it, and `auto_clock_out_runs` shows it.
4. The employee submits a correction above the limit → refused. Within the limit → pending, no deduction. Reject it → ₹200 appears in the next payroll.
5. HR records the verified clock-out on that day before payroll approval → the deduction shows as cancelled. Repeat after approval → a ₹200 refund appears in the following payroll, and the approved payroll is unchanged.
6. Turn Enable Overtime Pay off and approve an overtime request → it shows "Approved — Unpaid (Overtime Pay Disabled)" and pays ₹0. Turn it on and recalculate → it is paid on the approved hours.
