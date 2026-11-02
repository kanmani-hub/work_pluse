# WorkPulse HR — Live Admin Panel Audit (consolidated) — 30 Oct 2026

**Scope:** https://work-pluse-dun.vercel.app/admin, signed in as Admin, in the built-in browser.
**Mode:** read-only. The request recorder logged **662 API requests: all GET, no POST/PATCH/DELETE**.
- No data, salary, payroll status, setting, migration or deployment was changed.
- The only thing toggled was the client-side theme switch (stored in the browser only, 0 requests). It was set back to dark.
- Employees are referred to by code only. No credentials or tokens appear in this report.

**Repository state checked:** `main` at `bad3540`, working tree clean. The 28 Oct work, including `20261028090300`, is committed.

---

## 1. Executive summary

- **The live site runs the new frontend against an old database.**
  - The deployed bundle contains the 28 Oct code (payroll replace and stale checks, automatic-break texts).
  - Many of the migrations that code relies on are **not applied** on the live database (§6).
  - This mismatch is the root cause of most failures below.
- **Automatic and geofence breaks are effectively off.**
  - No break row has been created since **22 Oct**.
  - 4 automatic breaks from 8–15 Oct were never closed.
  - This is why Break Management shows 0 minutes.
- **Auto clock-out is not working.** There are **102 past attendance days (6–29 Oct) with a clock-in and no clock-out**, and none is flagged MISSING_CLOCK_OUT.
- **October payroll is stale and partly invalid.**
  - All 12 payrolls are UNDER_REVIEW, calculated 13 Oct.
  - EMP012 has a payroll with ₹0 gross.
  - EMP012 and EMP019 have a ₹0 salary configuration.
- **Recalculating October payroll now is safe for approved/paid records only because none exist.** It is **not recommended yet** (§5).
- **Security checks passed** (no secret keys in the bundle, API schema closed). However, payroll approval rules are currently enforced only in the browser, because the database guard migration is missing (suspected, not exploited).
- **Responsive layout (mobile, tablet, desktop) and light/dark themes pass**, with minor accessibility and contrast notes.
- **Staging verification of automatic breaks is BLOCKED.** No staging environment exists: `.env.staging` still holds placeholders.

### Final test summary

| Result | Count |
|---|---|
| PASS | 17 |
| FAIL (confirmed bugs) | 14 |
| SUSPECTED (needs confirmation) | 10 |
| BLOCKED | 5 |
| NOT TESTED (write operations, no approved test account) | 9 |

---

## 2. Issues ranked by priority, with recommended fixes

"Confirmed" means it was observed on live data or the live API. "Suspected" means it is inferred and still needs a check that would write data or needs database access.

### P0 — fix before any payroll approval

| # | Issue | Type | Evidence | Recommended fix |
|---|---|---|---|---|
| P0-1 | **The live database is missing the migrations the deployed app needs** (mixed version) | Confirmed | REST probes return 404/400 for objects created by `20261020150000`, `20261020170000`, `20261021120000`, `20261028090000`/`090100`/`090200`, `20261004120000`, and the missing-clock-out proposal (§6). App pages hit these errors live: `payroll_adjustments` 404 ×27 (Dashboard, Payroll, Overtime), `employee_tracking_state` 404 (Dashboard, Breaks), `overtime_requests` 400 and `attendance_breaks` 400 (Overtime, Dashboard) | Apply the migrations **on staging first**, in the order in §6, re-run the test suites, then apply to production with approval. Alternatively, as a stop-gap, roll the frontend back to the build matching the live schema |
| P0-2 | **Automatic and geofence breaks are not being created** | Confirmed | October has 22 break rows (AUTO_GPS 20, REGULAR 1, CANCELLED 1); **the last one is 22 Oct**. Break Management: "Server tracking status could not be loaded (employee_tracking_state)"; 10 employees "location not updating". The `geofence_auto_break` RPC and `report_tracking_event` are absent | Fixed by P0-1 (`20261021120000`, then `20261028090300`). Then verify with the staging plan (§7) |
| P0-3 | **Auto clock-out does not run.** 102 past open attendance days | Confirmed (cause suspected) | 102 attendance rows 6–29 Oct with a clock-in and no clock-out: WORKING 52, LATE 46, ON_BREAK 4. `status=MISSING_CLOCK_OUT` count = 0. `auto_clock_out_runs` 404. The Overtime page lists them as "More than one open clock-in" | Apply `20261022100000` (if not already applied) and `20261028090200`. Confirm `pg_cron` is installed and the job is active (read-only query, diagnostic script §3). The **existing** open days will not be fixed automatically: they need an HR-approved correction plan (reviewed list → corrected clock-out or MISSING_CLOCK_OUT), run on staging first |
| P0-4 | **An invalid payroll exists:** EMP012 October payroll with ₹0 gross, UNDER_REVIEW | Confirmed | Payroll table badge "INVALID SALARY (₹0)". Month net ₹3,18,810 ≠ gross ₹4,56,000 − deductions ₹1,37,890 (₹3,18,110). The ₹700 difference is EMP012's deductions clamped to net ₹0 | Do not approve it. Fix EMP012's salary structure (HR), then recalculate EMP012 only. The current code already refuses calculation for gross ≤ 0. Approval of this row is refused by `approvalBlockReason` in the browser (see P1-5) |

### P1 — fix before October payroll is approved

| # | Issue | Type | Evidence | Recommended fix |
|---|---|---|---|---|
| P1-1 | **Salary configuration ₹0 for EMP012 and EMP019** | Confirmed | Payroll → Today: "2 employees require salary configuration" (EMP012, EMP019); all other employees calculate | HR enters the correct salary structures (needs your approval; I did not change salaries) |
| P1-2 | **October payroll is stale** | Confirmed | All 12 rows calculated 13/10/2026 14:49. EMP013's drawer shows current attendance (Present 14, Absent 12, 13 late logins) but the stored row is from 13 Oct (Present 1, LOP 10 days, no late deduction). The table and drawer show different figures | Recalculate only after P0-1…P0-3 and P1-1 are fixed and the month has ended (§5). Show a "stale — recalculate" badge in the table, not only in the drawer |
| P1-3 | **4 automatic breaks never closed** (8, 10, 14, 15 Oct); attendance stuck ON_BREAK | Confirmed | 4 AUTO_GPS rows with no `ended_at`; the matching attendance rows have status ON_BREAK | HR-reviewed correction (end time = last known location or clock-out). Run on staging first. Very long completed breaks (384, 466, 177, 172 min) should be reviewed in the same pass |
| P1-4 | **"Leave/LOP" column shows 0/0 although an absence LOP exists** | Confirmed | EMP013 row shows Leave/LOP 0/0 while the stored deduction includes 10 LOP days | The column counts only LOP *leave*. Either label it "LOP leave" or include absence LOP days |
| P1-5 | **Payroll approval rules are enforced only in the browser** | Suspected (not exploited, by rule) | Code: `updateStatus()` checks invalid salary, stale calculation and allowed transitions client-side. The database guards (`guard_payroll_lock`, `payroll_transition_allowed`, `payroll_is_locked`) come from `20261028090100`, which returns 404 live. So a direct API update by an admin session would not be stopped by the database | Apply `20261028090100` (P0-1). Verify on staging that a direct PATCH to APPROVED of a stale/invalid row is refused |
| P1-6 | **Recalculation would use the non-atomic fallback and notify employees** | Confirmed in code; not run live | `replace_payroll_calculation` is missing → `_savePayrollCalculation` falls back to *delete items → delete payroll → insert payroll → insert items*. A failure mid-way can lose a payroll row. Re-submitting to UNDER_REVIEW calls `notifyEmployee` for **each** employee | Apply `20261028090100` before any recalculation (§5) |
| P1-7 | **Attendance and Payroll disagree for today** | Confirmed | At 11:31, Attendance marks EMP002, EMP013, EMP015, EMP020 **ABSENT** (EMP013's shift starts 11:00), while Payroll → Today shows TODAY_PENDING. EMP012: Attendance LATE (11:05 vs 10:00 shift), Payroll late 0 m (config error) | Use one shared day-status rule. Attendance should not mark ABSENT before shift start + grace for the rest of the day |
| P1-8 | **All 10 working employees are LOCATION STALE** (last location = clock-in time) | Confirmed | Live Tracking: 10 of 10 stale. EMP003 had a GPS UNAVAILABLE event at 10:59 with no break | Mostly P0-1 (tracking pipeline). Then check whether employees run the current app version (`trackingStaleMinutes` is set to **1 min**, which is very aggressive) |

### P2 — data and configuration quality

| # | Issue | Type | Evidence | Recommended fix |
|---|---|---|---|---|
| P2-1 | Duplicate office code **WHITEE-L** used by 2 offices | Confirmed | Offices page | Rename one code. Add a unique constraint on office code (staging first) |
| P2-2 | Break and grace settings disagree with the shifts | Confirmed | Settings: break 75 min, grace 0. Shifts: break 80 min, grace 15 min | Decide which is authoritative. Shifts are used when present; Settings is the fallback |
| P2-3 | Employee counts differ: Dashboard 14, Payroll and Employees 15 | Confirmed | The admin profile (ADMIN-001, salary not configured) is counted in Payroll and Employees only | Exclude non-payroll admin profiles from payroll lists, or label them |
| P2-4 | EMP020 has no October payroll | Confirmed | 12 payrolls for 15 listed employees (EMP012/EMP019 config issue, admin profile, EMP020) | Confirm EMP020's joining date or salary setup |
| P2-5 | Pending leave for past dates (EMP016, 23–24 Oct) | Confirmed | Leave page: 1 pending | HR decision needed before recalculation (affects LOP) |
| P2-6 | Push notification devices table missing | Suspected | `notification_devices` 404 (migration `20261004120000`) | Apply with the other migrations; verify push on staging |
| P2-7 | Main office radius 30 m | Suspected | Offices page | With phone GPS accuracy of 20–50 m indoors, this can cause false "outside" events. Review with HR (do not change production without approval) |
| P2-8 | Shift name and code typos ("Morinig_shift", "MORINING") | Confirmed | Shifts page | Rename (cosmetic; check that nothing keys on the code) |

### P3 — UI, accessibility and performance

| # | Issue | Type | Evidence | Recommended fix |
|---|---|---|---|---|
| P3-1 | Mobile menu button is labelled "Close menu" while the menu is closed | Confirmed | 375 px: sidebar off-screen (x = −336), button `aria-label="Close menu"` | Toggle the label with state |
| P3-2 | Light theme: pending workflow-step labels have low contrast (≈2.6:1) | Confirmed | Payroll page in light theme, step labels "Approved … Closed" | Use the secondary text token (≥ 4.5:1) |
| P3-3 | Payroll page issues ~290 API requests per visit | Suspected (performance) | Request recorder: Payroll 293 requests vs Dashboard 64 | Batch the per-employee queries |
| P3-4 | Employees page has requests of ~3 s (employees, offices, departments, roles, shifts) | Suspected | 5 requests 2.9–3.1 s on one load; other visits were faster | Re-measure; consider parallel and cached reference lists |
| P3-5 | Reports: location verification stats all 0 % | Suspected | Reports page | Probably caused by P0-1 (no verification events). Re-check after migrations |
| P3-6 | Face status NOT REGISTERED for all 15 employees | Suspected | Face Registration page | Confirm whether face verification is meant to be in use |

---

## 3. Module-wise results

| Module | Result | Evidence |
|---|---|---|
| Page loads (19 admin pages) | **PASS** | Dashboard, Payroll, Breaks, Employees, Departments, Offices, Shifts, Roster, Attendance, Live Tracking, WFH, Leave, Permission, Overtime, Reports, Audit Logs, Face Registration and Settings all render with no error banner. Average API time per page is 150–900 ms. Console error recorder: 0 errors |
| Dashboard | PASS (figures) / FAIL (P0-1 errors in the background) | 14 total, 10 working, 71 %, 1 pending; 404/400 requests listed in P0-1 |
| Live tracking | **FAIL** (P1-8) | Map loads (12 tiles, 0 broken images) — PASS; 10/10 stale — FAIL |
| Attendance | **FAIL** (P0-3, P1-7) | 102 open days; early ABSENT |
| Break management | **FAIL** (P0-2, P1-3) | Page honestly shows "could not be loaded" instead of a false 0 (PASS for the UI); no breaks created since 22 Oct |
| Employees / Departments | PASS (read) | 15 / 14 + 1 unassigned; writes NOT TESTED |
| Offices | **FAIL** (P2-1) | Duplicate code |
| Shifts / Roster | PASS (read), P2-8 cosmetic | Roster persistence columns exist live |
| WFH / Leave / Permission | PASS (read) | 0 WFH, 0 permission requests; 1 pending leave (P2-5) |
| Overtime | **FAIL** (P0-1) | `overtime_requests` 400 (`request_type` missing), `attendance_breaks` 400 (`source` missing); overtime pay is OFF in settings |
| Payroll | **FAIL** (P0-4, P1-1, P1-2, P1-4) | §5 |
| Payroll settings / export | PASS (read) / NOT TESTED (export = file download) | 26 days, LOP daily rate, late salary-based, MCO ₹200 × 3 |
| Settings | PASS (read) | Last saved 21 Oct 2026 12:58; no `autoBreak*` keys saved (defaults apply) |
| Audit logs | PASS | 446 events, read-only notice shown |
| Reports | PASS (loads) / P3-5 | Attendance 54.2 %, late 99/199 |
| RBAC (HR / Employee roles) | **BLOCKED** | No HR or employee test account was provided |
| Security | PASS (see §4) | |
| Responsive & themes | PASS with P3 notes | §8 |
| Performance | PASS with P3 notes | §3 / P3-3, P3-4 |

**NOT TESTED** (write operations, no approved test account or isolated data):
1. Create or edit an employee.
2. Department create/delete.
3. Office create/edit.
4. Shift or roster publish.
5. Leave/WFH/permission approval.
6. Payroll generate/recalculate/approve/pay.
7. Settings save.
8. Export download.
9. Tracking or geofence simulation.

---

## 4. Security

| Check | Result | Evidence |
|---|---|---|
| Secret or service-role key in the frontend bundle | **PASS** | All JS chunks scanned: no `sb_secret`/service_role. Only `VITE_SUPABASE_URL` and the publishable key |
| API schema (OpenAPI root) exposed to signed-in users | **PASS** | `GET /rest/v1/` → 401 |
| Session role | PASS | `authenticated` (not service role) |
| Server-side payroll guards | **SUSPECTED FAIL** | P1-5 |
| Auth lookup rate limiting (`20261020170000`) | **SUSPECTED FAIL** | `auth_lookup_rate_limits` 404 → employee-code login lookup is not rate-limited by the database |
| RLS per role, cross-employee isolation | **BLOCKED** | Needs HR/Employee test accounts. Destructive or bypass tests are not run on production by rule |

---

## 5. Payroll validation — can October be recalculated safely?

**Approved or paid records: none exist, so none can be changed.** Evidence:
- `payroll` with status APPROVED, PAYMENT_PENDING, PAID or CLOSED: **0 rows**.
- `payroll_payments`: **0 rows**.
- All 12 October rows are UNDER_REVIEW.
- The code also refuses to recalculate APPROVED/PAYMENT_PENDING/PAID/CLOSED (`recalculatePayroll`).

**It is still not safe to recalculate today**, for four reasons:
1. **Non-atomic save (P1-6).** Without `20261028090100`, each recalculation deletes and re-inserts the payroll (new IDs). A failure between steps can lose a row.
2. **Employee notifications (P1-6).** Re-submitting to UNDER_REVIEW sends every employee a "payroll status changed" notification.
3. **Wrong inputs.** The source data is incomplete:
   - 102 open clock-outs (P0-3);
   - no breaks since 22 Oct (P0-2);
   - 4 unclosed breaks (P1-3);
   - ₹0 salaries (P1-1);
   - a pending past leave (P2-5).

   Recalculating now would replace stale figures with figures that are just as wrong.
4. **Month not finished** (30 Oct). Two more days of attendance will change the figures.

**Safe order:**
1. Apply the migrations on staging, then production, with approval (§6).
2. HR fixes the salary structures for EMP012 and EMP019.
3. HR resolves the open clock-outs, open breaks and the pending leave.
4. After 31 Oct, recalculate October. With `replace_payroll_calculation` present, this is one transaction per employee that keeps UNDER_REVIEW and refuses locked months.
5. Review the "stale" indicators, then approve.

---

## 6. Pending database migrations and dependencies

Status was determined by read-only REST probes:
- a missing table returns 404;
- a missing column returns 400;
- a missing function returns 404 PGRST202.

Migrations that only create functions or policies cannot be confirmed without SQL access. They are marked **Unknown**: run query 1 of `docs/diagnostics/DIAGNOSE_zero_minute_breaks_2026-10-28.sql` and `SELECT version FROM supabase_migrations.schema_migrations` in the SQL editor to settle them.

| Order | Migration | Live status | Depends on |
|---|---|---|---|
| 1 | `20261004120000_notification_devices` | **Not applied** (table 404) | — |
| 2 | `20261004120100_notification_push_trigger` | Unknown (needs 1) | 1 |
| — | `20261011170000_roster_persistence` | Applied (columns exist) | — |
| 3 | `20261012120000`, `20261012130000`, `20261014090000` (RLS / hardening) | Unknown | — |
| 4 | `20261020150000_tracking_enforcement_policy` | **Not applied** (`attendance_breaks.incident_id` 400) | — |
| 5 | `20261020160000_trusted_break_correction_function` | Unknown | 4 |
| 6 | `20261020170000_resolve_employee_email` | **Not applied** (`auth_lookup_rate_limits` 404) | — |
| 7 | `20261021120000_automatic_break_tracking` | **Not applied** (`employee_tracking_state` 404; `source`, `reason`, `ended_reason` missing) | 4 |
| 8 | `20261022090000`–`090400` (approval guards, data isolation, notifications, audit log, admin provisioning) | Unknown | — |
| 9 | `20261022100000_fix_auto_clock_out` | Unknown (behaviour suggests not effective) | — |
| 10 | `20261022100100_permission_overlap_guard` | Unknown | — |
| 11 | `20261028090000_attendance_server_values` | **Not applied** (`att_clock_in_values` 404) | — |
| 12 | `20261028090100_payroll_lock_and_replace` | **Not applied** (`payroll_is_locked` 404) | — |
| 13 | `20261028090200_auto_clock_out_and_settings_hardening` | **Not applied** (`auto_clock_out_runs` 404) | 9 (redefines `process_auto_clock_out`, `mco_settings`) |
| 14 | `20261028090300_auto_break_tracking_off_immediate` | **Not applied** | 7 |

Proposals (`docs/proposals/`):

| Proposal | Live status | Depends on |
|---|---|---|
| `PROPOSED_overtime_requests` | Applied (table exists, 0 rows) | — |
| `PROPOSED_payroll_payment_safety` | Table `payroll_payments` exists; guard functions unknown | — |
| `PROPOSED_missing_clock_out_workflow` | **Not applied** (`request_type` 400, `payroll_adjustments` 404) | overtime_requests, payment safety, 9/13 |
| `PROPOSED_office_boundary_polygon` | **Not applied** (`boundary_polygon` 400) | — (optional feature) |
| `PROPOSED_roster_persistence` | Applied (same as migration) | — |

---

## 7. Real-time functionality and automatic breaks (staging)

- **Staging verification: BLOCKED.**
  - `.env.staging` still contains a placeholder URL and a 21-character dummy key.
  - No staging deployment URL exists.
  - Prerequisites P1–P8 are listed in `docs/AUTOMATIC_BREAKS_STAGING.md`.
- **What is verified, on disposable databases (28 Oct):**
  - automatic breaks 96/96;
  - concurrency 9/9 (real PostgreSQL);
  - rollback 10/10;
  - frontend tests trackingPermissionOff 6/6 and breakDashboardTrackingOff 9/9.
- **What is not verified:** live behaviour. On production, automatic breaks cannot work until migrations 4, 7 and 14 are applied.
- **Live realtime (map/location updates): BLOCKED.**
  - It needs a dedicated test employee and device. Production accounts must not be used to simulate tracking.
  - Read-only observation: no location updates after clock-in for any of the 10 working employees (P1-8).

---

## 8. Responsive layout and themes

| Check | Result | Evidence |
|---|---|---|
| Mobile 375×812: Dashboard, Payroll, Attendance, Breaks, Employees, Live Tracking | **PASS** | Page scroll width = 375 on all 6. Wide tables scroll inside `.table-container` (overflow-x auto); the sidebar collapses behind the menu button; no tap target under 32 px in main content |
| Tablet 768×1024: Dashboard, Payroll, Breaks, Attendance, Settings | **PASS** | Page scroll width = 768 on all 5; overflow only inside table containers |
| Desktop | PASS | All pages audited at desktop width |
| Dark theme | **PASS** | Default theme; screenshot of the mobile dashboard |
| Light theme | **PASS** with P3-2 | Screenshot of the tablet Payroll page renders correctly. The theme switch made 0 API requests (browser storage only) and was set back to dark |
| Accessibility | P3-1 | Menu button label |

---

## 9. Evidence index

- Request recorder: 662 requests, 0 writes. Error requests by page are listed in P0-1.
- Screenshots taken in this session (on screen in the browser pane; not saved because they show employee names):
  - mobile dashboard, dark;
  - tablet Payroll, light, showing 15 employees / 12 generated / 12 under review / 0 approved / 0 paid, and the month totals.
- Code references: `src/services/payroll/payrollService.ts`:
  - `updateStatus` (client guards);
  - `recalculatePayroll` (status refusal);
  - `_savePayrollCalculation` (non-atomic fallback);
  - `calculatePayrollDetails` (gross ≤ 0 refusal).

  `src/services/payroll/payrollDataService.ts`: `_fetchPayrollAdjustments` treats the missing table as "not set up".
- Read-only diagnostic: `docs/diagnostics/DIAGNOSE_zero_minute_breaks_2026-10-28.sql`.

---

## 10. Recommended next steps (each needs your approval)

1. **P0:**
   - Set up staging (Supabase project, Vercel preview, synthetic accounts).
   - Apply migrations 1–14 plus the missing-clock-out proposal there, in order.
   - Run the test suites and the staging plan.
2. **P0:** Run the read-only SQL diagnostics on production (migration history, `pg_cron` jobs) to settle the "Unknown" rows.
3. **P0:** With approval, apply the same migrations to production in a maintenance window. Back up first; the rollback scripts are in `supabase/rollbacks/`.
4. **P1:** HR data clean-up, reviewed on staging first:
   - EMP012 and EMP019 salaries;
   - the 102 open clock-outs;
   - the 4 open breaks;
   - the pending past leave.
5. **P1:** After 31 Oct, recalculate October (§5), then review and approve.
6. **P2/P3:** Small code and config fixes:
   - Leave/LOP column;
   - early ABSENT status;
   - duplicate office code;
   - menu label;
   - light-theme contrast;
   - payroll request batching.

   I can prepare these as uncommitted changes with tests for your review.
