# WorkPulse HR — Attendance → Payroll Pipeline Audit (Phase A + B)

Date: 2026-10-27 · Repository HEAD `7018ca1` ("Fix attendance correction validation"), working tree clean.
Scope: read-only inspection of the code, plus attacks against a **throwaway** in-memory database built from every repository migration. Nothing was changed in the repository except this report. No Supabase project, staging or production database was contacted.

The screenshot itself was not attached (only its description), so the numbers shown in it (12 clocked in, ₹417 late, ₹0 break / LOP / overtime, ₹417 total) are explained from the code paths, not reproduced.

---

## 1. Existing data flow (as implemented)

| Stage | Where | What is written / read |
|---|---|---|
| Clock-in | `attendanceService.clockIn` (browser) → `INSERT attendance` | `clock_in_at` (browser time), `attendance_date` (company date via `resolveClockInSession`, Asia/Kolkata, overnight-aware), `late_minutes` (browser: shift start + Settings grace), `required_hours`, `status` WORKING/LATE |
| Breaks | `attendance_breaks` + automatic-break triggers (`20261021120000`) | `attendance.break_minutes`, `break_overrun_minutes` recalculated **by the database** (guarded) |
| Clock-out | `attendanceService.clockOut` (browser) → RPC `close_auto_break_for_clock_out`, then `UPDATE attendance` | `clock_out_at` (browser time), `worked_hours`, `early_logout_minutes`, `is_half_day`, `status`, `overtime_minutes` = 0 — all computed **in the browser** |
| Missing clock-out | pg_cron `auto-clock-out` → `process_auto_clock_out()` (`20261022100000`) | flags `status = MISSING_CLOCK_OUT`, closes open breaks at shift end, **no clock-out time invented** (company policy 2026-10-14); correction via `submit/review_missing_clock_out_request` (proposal, not in migrations) |
| Overtime | `overtime_requests` (proposal table) | payroll pays **APPROVED** `approved_overtime_hours` only; `attendance.overtime_minutes` is informational |
| Leave / WFH / permission | `leave_requests`, `wfh_requests`, `permission_requests` (APPROVED only) | read by payroll |
| Day classification | `attendanceClassification.classifyPayrollDays` (pure) | each date once: PRESENT / HALF_DAY / ABSENT / PAID_LEAVE / LOP_LEAVE / SANDWICH_LOP / WEEKLY_OFF / HOLIDAY / TODAY_PENDING. **A day with a clock-in is a worked day** (owner rule 2026-10-09) |
| Money | `payrollService.calculatePayrollDetails` (browser, one function for month **and** daily preview) | LOP = lopDays × daily rate (gross ÷ configured divisor); late (`payrollLateDeductionRules`), break excess, half day, permission excess, MCO adjustments, approved overtime |
| Monthly payroll | `generatePayroll` / `recalculatePayroll` → `payroll` + `payroll_items` rows; approval sets `locked_at` | persisted snapshot in `payroll.notes` / `remarks` |
| Daily view (screenshot) | `getDailyDeductionReport(date)` → per attendance row: `calculatePayrollDetails(emp, y, m, date, date)` → `evaluateDailyImpact` → `buildDailyMetrics` cards | nothing persisted; recomputed on every load and on every realtime event |

The single calculation function is a good basis: the daily cards and the Details dialog use the same rows (`buildDailyMetrics`), so the cards always equal the sum of their rows. The defects below are in **what goes into** that calculation and **what the daily scope means**.

---

## 2. Confirmed defects (root cause, evidence, severity)

### P0 — payroll inputs can be forged by the employee (attendance integrity)
- **Evidence** (throwaway DB with all current migrations, as a signed-in employee through RLS):
  `INSERT attendance … clock_in_at = 08:55, late_minutes = 0` → **accepted**;
  `UPDATE own attendance SET late_minutes = 0 | status = 'PRESENT' | is_half_day = false | worked_hours = 9 | required_hours = 1 | overtime_minutes = 240 | break_overrun_minutes = 0` → **all accepted**;
  `UPDATE … clock_out_at = clock_in_at + 12h` → **accepted**.
- **Root cause**: clock-in/clock-out values are computed in the browser and the "own attendance" policies (0009) allow the employee to write every column; the automatic-break guard only protects break totals, identity and the dates.
- **Effect**: late deduction and half-day deduction can be avoided; clock-in can be back-dated (no late, no LOP); worked hours are fabricated. `docs/security/PROPOSED_attendance_integrity.sql` already describes this (not applied, late-minutes part left as TODO).
- **Fix (migration required)**: a BEFORE INSERT/UPDATE trigger for non-ADMIN/HR callers: clock-in time = `now()`, `late_minutes` / `required_hours` / `attendance_date` recomputed on the server from the assigned shift + Settings grace (same rule as `clockRules.resolveClockInSession`); clock-out time = `now()`, `worked_hours` / `early_logout_minutes` / `is_half_day` / `status` recomputed from stored breaks (same rule as `computeClockOutTotals`); `overtime_minutes` forced 0; completed days immutable for employees. Admin/HR corrections unchanged.

### P1 — Daily "Late Deductions" do not match the monthly payroll
- **Root cause**: the daily preview calls `calculatePayrollDetails(emp, y, m, date, date)`, so the late rule sees that day as the **only** late occurrence of the month:
  - `salary_based` with `monthlyLateLoginLimit = N > 0`: every day is "occurrence 1" → always **Exempt (₹0)** in the daily view, while the monthly payroll charges the (N+1)-th and later late days.
  - `interval_based`: monthly = floor(Σ minutes ÷ interval); daily = Σ floor(day ÷ interval) — differ (e.g. 10 + 10 min, 15-min interval: daily ₹0 + ₹0, monthly 1 interval).
  - `fixed` / `half_day`: monthly charges **once per month**; daily charges the full amount on **every** late day, so a month of daily figures overstates the monthly deduction.
- **Fix (code)**: compute the daily late figure as *month-to-date through D minus month-to-date through D−1* (marginal cost of day D under the monthly rule), so the sum of the daily figures equals the monthly late deduction. No policy change.
- **Policy question** (not changed): `fixed` and `half_day` late methods deduct a single amount per month regardless of the number of late days. That is how the code works today; please confirm it is the intended policy.

### P1 — Daily "LOP Impact" can only ever be ₹0 for absences
- **Root cause**: `getDailyDeductionReport` iterates attendance rows only (`if (!att) continue`). An employee who is absent on a working day, or on approved Loss-of-Pay leave, has no attendance row and is **not evaluated at all**. Under the confirmed policy a day with a clock-in is a worked day (no absence LOP), so for the rows that are evaluated LOP is correctly ₹0 except LOP half-day leave. The Details dialog already notes "an employee with no record at all for the date is not included".
- **Effect**: the ₹0 LOP card is not evidence that nobody incurred LOP that day.
- **Fix (code)**: include every active employee with a salary structure for the date (absent / LOP leave / sandwich rows), classified with the same `classifyPayrollDays`; for **today** an absent employee is `TODAY_PENDING` and shown as *Pending*, not ₹0. "Employees Clocked In" keeps counting only rows with a clock-in.

### P1 — Recalculation deletes the payroll before it knows the new one can be calculated
- **Root cause**: `recalculatePayroll` deletes `payroll_items` and `payroll` (errors ignored) and only then calls `_doCalculate`. Any failure afterwards (settings unreadable, missing salary structure, a lookup error, network) leaves the employee **without** a payroll row for the month; delete errors are ignored, so a refused delete turns into a confusing unique-constraint error.
- **Fix**: calculate first, then replace inside one database transaction (RPC `replace_payroll_calculation`, refuses APPROVED/PAYMENT_PENDING/PAID/CLOSED) — or, without a migration, calculate first and only delete when the new calculation succeeded (smaller improvement, still not atomic).

### P1 — Finalized payroll is protected only in the browser
- **Root cause**: "Manage payroll" (0009) is `FOR ALL` to ADMIN/HR with no status check, and no trigger protects APPROVED / PAYMENT_PENDING / PAID / CLOSED rows. Every lock rule is in `payrollService` (client).
- **Fix (migration required)**: trigger refusing UPDATE of amounts and DELETE of locked payroll rows and their items (status transitions through the existing workflow remain allowed).

### P1 — Calculated payroll is not marked stale when attendance or leave changes afterwards
- **Root cause**: the only staleness check before approval is for missing-clock-out adjustments (`_staleMissingClockOutCheck`). An attendance correction, an approved leave or an approved overtime request after the payroll was calculated does not change the stored figures and does not block approval.
- **Fix (code)**: store in the snapshot the latest change time of the period's attendance / leave / overtime / permission rows; at approval, compare with the current source and refuse (with "Recalculate first") when it changed. Shown as "Stale — recalculate" on the row.

### P2 — Missing-clock-out adjustments are repeated on every day of the daily view
- **Root cause**: `_fetchPayrollAdjustments(employee, endDate)` returns **all** pending adjustments with `work_date ≤ date`; in the daily view each day shows every earlier pending case under "Other deductions". Correct for the monthly payroll, wrong for a single-day view. (Only when the missing-clock-out proposal tables exist.)
- **Fix (code)**: in the daily scope include only adjustments whose `work_date` equals the date.

### P2 — Summary cards treat Pending as ₹0
- **Root cause**: card totals are plain sums; rows whose break / overtime / impact status is PENDING contribute ₹0 with no indication. The table shows "Pending" per row, the cards do not.
- **Fix (code)**: cards show "₹X + N pending" (and *Unavailable* when any row is unavailable); totals still sum only final amounts.

### P2 — Inconsistent missing-clock-out grace default in the payroll view
- `payrollImpactRules.evaluateDailyImpact` uses `autoClockOutGraceHours ?? 2`; everywhere else (Settings default, `missingClockOutService`, server `mco_settings`) uses 4, and the view ignores `autoClockOutMode = at_shift_end` and the server's `MISSING_CLOCK_OUT` status. A row can show *Missing* in the payroll view while the server has not flagged it (or the reverse).
- **Fix (code)**: one helper used by both: server status first, then the same grace / mode rule as the server.

### P3 — Smaller items
- "Employees Clocked In" counts every attendance row for the date, including rows without a clock-in (e.g. `SANDWICH LOP` rows created by an admin).
- The daily report runs `calculatePayrollDetails` sequentially per employee (≈ 8 queries each, plus settings reload): slow with many employees; realtime events trigger full reloads with no de-duplication, and an older, slower reload can overwrite a newer one (no request sequencing). Leave approvals do not refresh the daily view (leave_requests not in the payroll subscription).
- `lateFormula` text for `salary_based` always shows "daily rate ÷ 480" (8 h) and ignores the monthly exemption, while the amount uses the shift's required hours and the exemption; the explanation can disagree with the amount.

### Not defects (verified)
- Attendance dates use the company date (Asia/Kolkata) at clock-in, including overnight shifts (`resolveClockInSession`), and the classification uses UTC-noon arithmetic per date (no off-by-one).
- Overtime is paid only from APPROVED requests; a failed overtime lookup stops the calculation instead of paying ₹0.
- A failed attendance / leave / roster / settings lookup stops the calculation (never treated as "no absences").
- Each date is classified once: LOP and leave/half-day are never charged twice for the same day; late and break deductions are separate minute-based components by policy.
- Cards = sum of their Details rows (same builder).
- Missing clock-out: the server flags the day and does not invent a clock-out time; a flagged day counts as worked (no LOP), any deduction comes later through the correction workflow (company policy 2026-10-14).

---

## 3. Conflict with the requested auto clock-out behaviour (needs your decision)

Section 3 of the request asks to *persist the clock-out timestamp, worked duration and an automatic-clock-out marker*. The company policy recorded on 2026-10-14 (`PROPOSED_missing_clock_out_workflow.sql`, used by the app's missing clock-out screens and implemented by migration `20261022100000`) is the opposite: **no clock-out time is invented; the day is flagged and the employee submits the real time for HR to verify**. I have not changed this. Options: (a) keep the flag-only policy (current), (b) write the shift-end time as an *unverified* automatic clock-out (`is_auto_logged_out = true`, `clock_out_source = 'AUTO'`) that the correction workflow can still replace.

---

## 4. Proposed changes (Phase B)

| # | Change | Files | Migration |
|---|---|---|---|
| 1 | Attendance integrity trigger (server computes clock-in/out values) | new `supabase/migrations/2026102710xxxx_attendance_server_values.sql` + rollback; `attendanceService` reads values back | **yes** |
| 2 | Payroll lock trigger + atomic `replace_payroll_calculation` RPC | new migration + rollback; `payrollService.recalculatePayroll` | **yes** |
| 3 | Daily late = marginal month-to-date figure | `payrollService.getDailyDeductionReport`, new pure helper + tests | no |
| 4 | Daily view includes absent / LOP-leave employees; today = Pending | `payrollService`, `dailyMetricDetails`, `Payroll.tsx` | no |
| 5 | Daily scope for missing-clock-out adjustments | `payrollService` | no |
| 6 | Pending / Unavailable shown on the cards | `dailyMetricDetails`, `Payroll.tsx` | no |
| 7 | One missing-clock-out status rule (server status → grace/mode) | `payrollImpactRules`, `missingClockOutRules` | no |
| 8 | Stale-payroll detection before approval | `payrollService`, `payrollRules` + tests | no |
| 9 | Request sequencing / debounce for realtime reloads; leave changes refresh | `Payroll.tsx`, `realtimeService` | no |

Tests: the 20 cases of the request, using the existing Vitest suites (pure rules, deterministic clocks, `Asia/Kolkata` fixed) and the disposable-database runners (`supabase/tests/...`, PGlite + embedded PostgreSQL for concurrency).

Nothing in this plan changes LOP, late, break, half-day or overtime **policy**; items 3–7 change what the daily preview shows so that it matches the monthly payroll and the stored records.
