# Automatic Breaks — Staging Plan (Option B: Android users on the web app)

Companion to `docs/AUTOMATIC_BREAKS.md`. **Staging only — nothing here is run against production.**
Every step that writes to a database or changes an external service needs explicit approval first.

## 0. Prerequisites (blocking — none exist in the repository today)

| # | Prerequisite | Found in the repo (2026-10-22) |
|---|---|---|
| P1 | A **separate staging Supabase project** (never the live project) | `.env.staging` holds placeholders (`YOUR…` URL, 21-character dummy key). No CLI-linked project. |
| P2 | An authorized operator with staging SQL-editor access (role `postgres`) | Only public anon keys exist locally; they cannot read system catalogs. |
| P3 | A staging HTTPS web URL (e.g. Vercel preview built with `npm run build:staging`) | No deployment URL is recorded in the repo. |
| P4 | Staging Auth URL configuration: Site URL + Redirect URLs include the staging web URL (password reset uses `window.location.origin + /reset-password`) | To be set in the staging project. |
| P5 | Synthetic staging accounts: 1 ADMIN, 1 HR, 3 EMPLOYEE (office, WFH, overnight), each with office + shift + roster | To be created on staging; never copy production personal data. |
| P6 | Scheduler decision: `pg_cron` enabled on staging, or an approved alternative (section 2) | Unknown until pre-check 3 runs. |
| P7 | PWA icons for a real "Install app" on Android (optional for Option B) | Confirmed defect: `public/manifest.json` → `/icons/icon-*.webp`, icons live in root `icons/`, the build has no `icons/`. Verified fix (not applied): copy `icons/*.webp` to `public/icons/` → all 7 icons appear in the build. Needs approval (outside the feature scope). |
| P8 | A test Android phone (Chrome) and a desktop browser for the admin | Needed for scenarios marked "phone". |

## 1. Execution order

| Step | Action | Writes? | Approval |
|---|---|---|---|
| 1 | Confirm the staging project: the operator opens the Supabase dashboard, notes the project ref from the URL, and confirms it is **not** the live project's ref. Confirm the staging web URL. | no | — |
| 2 | Back up staging and prove recovery: note the backup/PITR setting (Database → Backups) and take a manual backup or `pg_dump` of the staging database; restore it once into a scratch project or verify PITR is enabled. | staging backup only | owner |
| 3 | Run `supabase/snippets/autobreak_staging_prechecks.sql` (READ ONLY transaction, ends in ROLLBACK). Save every result grid. | no | — |
| 4 | Review: check 2 must be **0 rows** (duplicate open breaks); check 7 open automatic breaks must be 0 or explained; check 4 only `update_*_updated_at` triggers; check 9 owner `postgres`, `rls_forced = false`; check 1 shows which earlier migrations are really applied. | no | — |
| 5 | Scheduler plan: pg_cron present (check 3) → the migration schedules `auto-break-stale-tracking` every minute. Not present → choose section 2 alternative before applying. | no | owner |
| 6 | **Request explicit approval** for the staging migration, attaching steps 1–5 evidence. | — | **required** |
| 7 | Apply missing repo migrations in order, then `20261021120000_automatic_break_tracking.sql`, on **staging only** (SQL editor as `postgres`, or `npx supabase db push` with the CLI linked to the confirmed staging ref). | **staging DB** | step 6 |
| 8 | Deploy the matching staging web build (`npm run build:staging` with `.env.staging` filled in) to the staging URL. | staging hosting | owner |
| 9 | Verify: re-run pre-checks 3–6 (+ cron job list): triggers `trg_ab_guard_attendance_breaks`, `trg_ab_after_break_change`, `trg_ab_guard_attendance_totals`, `trg_ab_on_live_location`; API functions `report_tracking_event`, `geofence_auto_break`, `close_auto_break_for_clock_out`, `process_stale_tracking`; publication includes `attendance_breaks`, `employee_tracking_state`; scheduler **actually runs**: `SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='auto-break-stale-tracking') ORDER BY start_time DESC LIMIT 5;` shows succeeded runs each minute. Settings page shows the defaults (0 grace, 15 min, auto-resume, WFH rules). | no | — |
| 10 | Run the scenario matrix (section 4): functional, security, payroll and mobile-browser. | staging test data | — |
| 11 | Record evidence per scenario (screenshots, query results, Postgres / cron logs, browser console). | — | — |
| 12 | Fix defects locally, re-run local tests, redeploy to staging, repeat affected scenarios. | staging | owner |
| 13 | Only after staging passes: prepare a **separate** production rollout plan (quiet window, pre-check 7 = 0, web build deployed immediately after the migration, Android users on the web app, rollback owner on call). | — | separate approval |

## 2. Scheduler without pg_cron

`process_stale_tracking()` must run once a minute. It is idempotent and safe to overlap (row locks with
`SKIP LOCKED`; tested: 6 overlapping runs start exactly one break). Options, in order of preference:

1. Enable `pg_cron` on the project (Database → Extensions) and re-apply the scheduling block of the migration (it is idempotent).
2. A Supabase **Scheduled Edge Function** (or any trusted scheduler) calling the database function with the **service-role** key every minute; failures logged and alerted; the key stored only in the scheduler's secret store.
3. Fallback only: Admin → Break Management runs the same evaluation once a minute **while it is open** — not sufficient on its own.

Verify the scheduler by its own run history (cron.job_run_details or the scheduler's logs) — never assume it is active because the migration succeeded.

## 3. Rollback (staging rehearsal, then production plan)

Before rollback: `SELECT count(*) FROM attendance_breaks WHERE ended_at IS NULL AND break_type IN ('AUTO_GPS','AUTO_TRACKING');` — close or record open automatic breaks first (the previous app can end AUTO_TRACKING breaks but not AUTO_GPS ones until a return / clock-out).

`supabase/rollbacks/20261021120000_automatic_break_tracking.rollback.sql`:
* removes the schedule, triggers, functions and the tracking-state table; removes the realtime additions;
* **keeps every break row** (system-created ones included); **drops** the `source`, `reason`, `ended_reason` columns — export them first: `SELECT id, attendance_id, break_type, source, reason, ended_reason FROM attendance_breaks WHERE source <> 'EMPLOYEE';`
* break totals already stored stay as they are (they were computed with the same formula);
* the **previous app version must be deployed together with the rollback**: the new app calls the removed functions (clock-out during an automatic break would fail);
* employee protections added by this migration (immutable attendance date / shift / clock-in, system-break guards) disappear with it.

Rehearse on staging: rollback → confirm functions / triggers / cron job gone and break rows intact → re-apply → re-run step 9.

## 4. Android users on the web app (Option B)

* Use the **verified** HTTPS web URL only (do not announce a URL that has not been checked). Geolocation and the camera require HTTPS.
* Chrome for Android, current version. Location: Android Settings → Location on; Chrome app permissions → Location "while using the app", Camera "allow"; site padlock → Location and Camera "Allow".
* Sign-in: same e-mail / employee code and password; password reset needs P4.
* No install is required (the site works in the browser); "Add to Home screen" gives a shortcut. A real install needs P7.
* **Keep WorkPulse open with the screen on while working.** A browser sends no locations with the screen locked or the tab in the background; after 15 minutes without a location the server starts an automatic break (approved policy). Work resumes automatically when a fresh location arrives.
* **Do not use the installed WorkPulse APK** after the migration: it writes automatic breaks directly, which the database refuses; an employee on a geofence break could not clock out. There is no version check that blocks the old APK, so this must be communicated (and evaluated only with a staging test account — scenario 25).

## 5. Scenario matrix

Needs: **S** = staging DB + web build, **P** = real Android phone, **C** = concurrent database sessions. Locally verified equivalents are listed where they exist (PGlite suite `run_autobreak_db_tests.mjs`, real-PostgreSQL concurrency suite `run_autobreak_concurrency_tests.mjs`) — they do not replace the staging run.

Verification query (staging, read-only):
```sql
SELECT b.break_type, b.source, b.reason, b.ended_reason, b.started_at, b.ended_at, b.duration_minutes,
       a.status, a.break_minutes, a.break_overrun_minutes, s.state, s.last_fresh_fix_at
FROM attendance_breaks b JOIN attendance a ON a.id = b.attendance_id
LEFT JOIN employee_tracking_state s ON s.employee_id = a.employee_id
WHERE a.employee_id = '<test employee id>' AND a.attendance_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 1
ORDER BY b.started_at;
```

| # | Scenario | Setup | Action | Expected result | Evidence | Needs | Local equivalent | Pass/Fail |
|---|---|---|---|---|---|---|---|---|
| 1 | Office GPS permission denied | EMP-OFFICE clocked in, tracking OK | Site permission Location → Block, reload | Immediate break AUTO_TRACKING / LOCATION_PERMISSION_DENIED / SYSTEM, start = server time; reason + recovery text, no End Break button; notification | Screenshot, query, notification row | S P | T1, T1b–d | |
| 2 | GPS unavailable | Clocked in | Android Location off | Break GPS_UNAVAILABLE | Screenshot, query | S P | T2b | |
| 3 | Single GPS timeout | Clocked in | Poor-signal spot causing a timeout | State GPS_TIMEOUT, **no** break | Query (state), no break row | S P | T3 | |
| 4 | Device offline | Clocked in | Airplane mode | Screen "No Internet Connection"; nothing sent; no break before 15 min | Screenshot, query | S P | trackingEventReporting tests | |
| 5 | Stale 15 min | Device offline (4) | Wait 16 min | Scheduler starts TRACKING_STALE at the last fresh location time | Query, cron run log | S P | T5, T5b | |
| 6 | Reconnect, no fresh location | After 5 | Airplane mode off, location blocked | Reason → NETWORK_DISCONNECTED; state WAITING_FOR_FIX; break **stays open** | Query | S P | T4, T4b, T4c | |
| 7 | Fresh valid location | After 6 | Allow location | Break ends TRACKING_RESTORED at server time; state TRACKING_RESTORED; totals updated | Query, screenshot | S P | T17, T17b–c | |
| 8 | Geofence exit | Office employee inside | Walk out of the radius | AUTO_GPS / GEOFENCE_EXIT; return → GEOFENCE_RETURN | Query | S P | G1–G5 | |
| 9 | Clock-out during geofence break | Outside the office on AUTO_GPS | Clock Out | Succeeds; ended_reason CLOCK_OUT; counted once | Query | S P | T18 (tracking), clockOutBreaks tests | |
| 10 | Clock-out during tracking break | During 1 or 5 | Clock Out | Succeeds; ended_reason CLOCK_OUT | Query | S P | T18, C5 | |
| 11 | WFH loses GPS | EMP-WFH (approved WFH) | Block location | **No** break; state PERMISSION_DENIED | Query | S P | T9, T9b | |
| 12 | WFH stale | EMP-WFH | Airplane mode 16 min | TRACKING_STALE break; fresh WFH location ends it | Query | S P | T8, T8b | |
| 13 | Overnight shift | EMP-NIGHT, shift started yesterday, after midnight | Block location | Break on yesterday's attendance (company date Asia/Kolkata) | Query (attendance_date) | S P | T13, T13b | |
| 14 | Shift ends with tracking break open | Test shift ending 10 min after a tracking break starts | Wait past shift end | Break closed SHIFT_END at the shift end; no new automatic breaks | Query, cron log | S | T12, T12b | |
| 15 | Simultaneous creation | One employee, two tabs/devices | Block location in both at the same moment; also run the scheduler | Exactly one open break, one notification | Query (count) | S C | C1, C2, C4 (×10 rounds) | |
| 16 | Scheduler twice | During 5 | `SELECT public.process_stale_tracking();` twice (staging SQL editor) | Second run starts nothing | Function output | S | T22, C3 | |
| 17 | Forged timestamps / source | Employee session (browser console, staging) | `insert` AUTO_TRACKING / back-dated REGULAR; `update` a system break | Refused / start overwritten by server time | Console errors, query | S | R1–R10 | |
| 18 | Forged break totals | Employee session | `update attendance set break_minutes=0, attendance_date='2000-01-01'` | Totals stay database values; date change refused | Console, query | S | T16, X1–X5 | |
| 19 | Admin ends / corrects a break | ADMIN in Break Management | End Break; Correct Break (with reason) | Ended / CANCELLED, totals recalculated, audit entry | Screenshot, audit_logs | S | A4, P4 | |
| 20 | Payroll | Break-overrun detection on; automatic + manual breaks above the allowance; clock-out | Payroll → daily details | Overrun = total − allowance, existing deduction method, each break once | Payroll screenshot, query | S | P1–P5, C7 | |
| 21 | Admin realtime | ADMIN Break Management open | Run 1 / 8 | Row updates within seconds | Screen recording | S | breakReportAutoBreak tests | |
| 22 | Realtime down → polling | As 21 | Block the realtime websocket (devtools), repeat 1 | Row updates within ~1 minute | Screen recording | S | — | |
| 23 | Notification / dependency failure | Staging only: temporarily disable the push webhook secret | Run 1 | Break still created; notification may be missing | Query, Postgres log WARNING | S | F1, F2, F3 | |
| 24 | Browser suspended / screen locked | EMP-OFFICE | Lock the phone 16 min | TRACKING_STALE break (documented browser limitation); unlock → fresh location → resumes | Query | S P | — | |
| 25 | Old APK compatibility | **Staging test account only**, old APK pointed at staging | Geofence exit, then clock out | Documents the refusal (geofence break not created; clock-out during an existing AUTO_GPS break refused). Never with real employees. | Screenshots | S P | R2, R8 | |
| 26 | Privileged microservice write | Only if `server/` is aligned to the schema and pointed at staging | Its check-out while a tracking break is open | Expected today: its writes fail (columns `work_date`, `clock_in`, … do not exist); once aligned with the service-role key it would bypass the guards and leave the break open → must call `close_auto_break_for_clock_out` logic first | Service logs, query | S | — | |

Exit criteria: all applicable scenarios pass with evidence; no unexpected break on any test account; payroll daily details match the stored totals; scheduler run history shows a successful run every minute.
