# WorkPulse HR — database update pack (2026-11-02)

The live app already runs code that expects these database changes. Until they are applied:
- automatic and geofence breaks are not created;
- auto clock-out never flags a missing clock-out;
- the ₹200 missing clock-out workflow cannot run;
- payroll approval and locking are enforced only in the browser.

**Nothing here has been run. Every step that writes needs your approval, on staging first.**

## 0. Before anything
1. Back up production (Supabase → Database → Backups, or `pg_dump`).
2. Run `docs/diagnostics/PRECHECK_live_migrations_2026-11-02.sql` (read-only). Keep the output.
   - Query 2 shows which rows below are already present; skip those.
   - Query 3 shows whether `pg_cron` exists.
   - Query 7 must return 0.

## 1. Apply in this order (SQL editor, one file at a time)

Each file is in `supabase/migrations/` (or `docs/proposals/`), with its rollback in `supabase/rollbacks/`.

| # | File | Needs | What it fixes on the live site |
|---|---|---|---|
| 1 | `20261004120000_notification_devices.sql`, then `20261004120100_notification_push_trigger.sql` | — | Push notification devices table (404 today) |
| 2 | `20261012120000…`, `20261012130000…`, `20261014090000…` | — | RLS / admin hardening (status unknown: query 2) |
| 3 | `20261020150000_tracking_enforcement_policy.sql` | — | Break incident column, one open break per attendance |
| 4 | `20261020160000_trusted_break_correction_function.sql` | 3 | Admin break correction |
| 5 | `20261020170000_resolve_employee_email.sql` | — | Rate-limited employee-ID login lookup |
| 6 | `20261021120000_automatic_break_tracking.sql` | 3 | **Automatic breaks** (none created since 22 Oct) |
| 7 | `20261022090000` … `20261022090400` | — | Approval, data-isolation, notification and audit guards |
| 8 | `20261022100000_fix_auto_clock_out.sql` | — | **Auto clock-out** flags missing clock-outs (the old job failed on every run) |
| 9 | `20261022100100_permission_overlap_guard.sql` | — | Overlapping permission requests |
| 10 | `20261028090000_attendance_server_values.sql` | — | Late minutes / attendance date computed by the server |
| 11 | `20261028090100_payroll_lock_and_replace.sql` | — | **Payroll lock** + one-transaction recalculation |
| 12 | `20261028090200_auto_clock_out_and_settings_hardening.sql` | 8 | Auto clock-out run log, settings validation |
| 13 | `20261028090300_auto_break_tracking_off_immediate.sql` | 6 | Break starts at once when location is switched off |
| 14 | `docs/proposals/PROPOSED_missing_clock_out_workflow.sql` | overtime_requests (present), 12 | **₹200 workflow**: corrections, HR approve/reject, `payroll_adjustments` |

Then confirm the scheduler jobs exist and are active:
- `process_auto_clock_out` every 15 min;
- `process_stale_tracking` every minute.

Use query 3 to check.

## 2. What happens the moment step 8 / 12 runs (please plan for it)
- **118 October days** with a clock-in and no clock-out are flagged **MISSING_CLOCK_OUT** on the job's first run.
- Each employee gets **one notification per day**: 14 employees, up to 16 each.
  - Run it at a time you choose.
  - Or tell staff beforehand.
- The 4 automatic breaks left open since 8–15 Oct are closed at their shift end.
- **October payroll is already approved**, so nothing in it changes.
  - Under your 28 Oct rule, a ₹200 deduction for an October day that HR rejects goes into the next unpaid payroll (November).

## 3. ₹200 deduction: two modes (no double charge)

| Mode | When | How the ₹200 is decided |
|---|---|---|
| **In payroll (new, works today)** | Workflow table `payroll_adjustments` not set up | Each past day with clock-in and no clock-out is a payroll review flag. **Apply** = ₹200 (Settings amount) for that day. **Waive** = no deduction. Approval stays blocked until each flag is decided |
| **Correction workflow** | After step 14 | Employee submits the real clock-out. HR approves (no deduction) or rejects (₹200). The payroll flag above is then no longer raised |

**Before** HR uses the workflow, run query 8 of the pre-check. It lists the days already decided in a payroll. Do **not** reject those same days again with a deduction.

## 4. After applying
1. Re-run the pre-check: every row of query 2 should be `true`.
2. Open Break Management. The "could not be loaded (employee_tracking_state)" error is gone.
3. Overtime → Missing Clock-Outs no longer says "not set up".
4. Deploy the web build with the 2026-11-02 code fixes. Users with the app open reload automatically into the new version.

Rollback: run the matching `supabase/rollbacks/*.rollback.sql` in reverse order.
