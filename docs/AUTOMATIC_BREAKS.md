# Automatic Breaks (location / network loss)

Server-authoritative automatic breaks for WorkPulse HR. The employee's device only **reports what it
observes**; every payroll-affecting decision (whether a break starts, its start and end time, which
attendance it belongs to, WFH and shift rules, the policy switches, the grace period) is made by the
database with database time.

Migration: `supabase/migrations/20261021120000_automatic_break_tracking.sql`
Rollback:  `supabase/rollbacks/20261021120000_automatic_break_tracking.rollback.sql`
DB tests:  `supabase/tests/autobreak/run_autobreak_db_tests.mjs`

## Confirmed policy (defaults)

| Setting (Admin → Settings → Breaks → Automatic Breaks) | Key in `app_settings.settings.app` | Default |
|---|---|---|
| Enable automatic breaks for tracking loss | `autoBreakEnabled` | on |
| Location permission denied → break | `autoBreakOnPermissionDenied` | on |
| GPS / location unavailable → break | `autoBreakOnGpsUnavailable` | on |
| No location reaching the server → break | `autoBreakOnStale` | on |
| No-location interval | `autoBreakStaleMinutes` | 15 (2–120) |
| Grace period | `autoBreakGraceMinutes` | **0** |
| Resume automatically on a fresh location | `autoBreakAutoResume` | on |
| WFH: apply network / stale rule | `autoBreakWfhStale` | on |
| WFH: apply GPS-loss rules | `autoBreakWfhGpsLoss` | **off** |

* Zero grace = no intentional waiting period. A **GPS timeout alone never starts a break.**
* Automatic breaks count under the existing break allowance and excess-break deduction (no payroll
  formula changed). Each break is counted once: totals are recalculated by the database from the break rows.
* Geofence ("left the office") breaks keep working as before and are not affected by these switches.
* If the settings row has no value, the database uses the defaults above (`ab_policy()`).

## Events and decisions

| Situation | Who detects it | What happens |
|---|---|---|
| Location permission denied | device → `report_tracking_event('LOCATION_DENIED')` | break `AUTO_TRACKING` / `LOCATION_PERMISSION_DENIED` at server time (office days) |
| GPS / location unavailable | device → `report_tracking_event('LOCATION_UNAVAILABLE')` | break `GPS_UNAVAILABLE` (office days) |
| GPS timeout | device → `report_tracking_event('TIMEOUT')` | state `GPS_TIMEOUT` only, no break |
| Network lost / app closed / device asleep | **server** job `process_stale_tracking()` every minute | no fresh location for the interval → break `TRACKING_STALE`, starting at the last fresh location the server received |
| Network back | device → `report_tracking_event('NETWORK_RECONNECTED', offline seconds)` | state `WAITING_FOR_FIX`; a `TRACKING_STALE` break is relabelled `NETWORK_DISCONNECTED`; the break does **not** end |
| Fresh location reaches the server | trigger on `employee_live_locations` | tracking break ends (`TRACKING_RESTORED`); if the location is outside the office, a geofence break starts |
| Clock-out | `close_auto_break_for_clock_out()` | open automatic break closed at server time (`CLOCK_OUT`) |
| Shift end | scheduled job | open tracking break closed at the shift end (`SHIFT_END`); no new automatic breaks after it |
| WFH day (approved request or roster work mode WFH) | server | GPS-loss events → no break; stale / network rule → break |

A location is **fresh** when the device measured it at most 5 minutes before it reached the server. A
reading replayed from the offline queue is not fresh, so reconnecting alone never ends a break and never
overwrites newer tracking state.

Tracking states (`employee_tracking_state.state`): `TRACKING_OK`, `TRACKING_RESTORED`, `PERMISSION_DENIED`,
`GPS_UNAVAILABLE`, `GPS_TIMEOUT`, `LOCATION_ERROR`, `WAITING_FOR_FIX`, `STALE`.

## Security

* Employees cannot insert `AUTO_GPS` / `AUTO_TRACKING` / `CANCELLED` breaks, change or close system
  breaks, change any completed break, delete breaks, or add breaks to someone else's attendance.
* Manual breaks still work; their start and end times are set by the database (`now()`).
* Employees cannot set `break_minutes`, `break_overrun_minutes` or a false `ON_BREAK` status; the database
  derives them. Clocking out with a break still open is refused (the app first asks the server to close an
  automatic break).
* `employee_tracking_state` is written only by the server functions; employees can read their own row,
  ADMIN / HR all rows.
* Internal functions (`ab_*`) are not callable through the API. `process_stale_tracking()` can be called
  by the scheduler / service role and by ADMIN / HR only.
* Employees cannot change their attendance date, shift / roster / assignment link, clock-in time, or a
  recorded clock-out (these decide which attendance is "open", the shift end and the stale start; changing
  them could escape the checks or close an open tracking break at 0 minutes). ADMIN / HR still can.
* Every break write locks the attendance row first (same lock order as the server functions), and the
  server's end-break step skips a break another transaction is changing: no deadlocks between manual
  breaks, admin actions, device reports, fresh locations and the scheduler (tested on a real PostgreSQL
  server with simultaneous connections).
* A failing notification never blocks a break decision, and a failure inside automatic resume never loses
  the employee's location write (the next fresh location retries).
* The tracking-state table is readable by signed-in users (own row; ADMIN / HR all) and writable only by the
  server functions; `anon` has no access.
* ADMIN / HR corrections (End Break, Discard Session, Correct Break) keep working and are audited.

## Version compatibility (read before deploying)

The new database guards refuse the old app's direct writes to automatic breaks, and the new app needs the
new database functions. Mixed versions behave like this:

| Combination | Effect |
|---|---|
| New app + new database | Supported. |
| **Old app + new database** | Manual breaks, clock-in and clock-out without an open automatic break work. Geofence breaks are no longer created (the old direct insert is refused; the old app only logs an error). **An employee on an open geofence break cannot clock out** (the old app tries to close the break itself and the database refuses). Tracking-loss breaks still start and end on the server. |
| New app + old database | No automatic breaks; Break Management shows "Server tracking status could not be loaded"; **an employee on an open geofence break cannot clock out** (the close function does not exist). |

* The **web / PWA** build updates on the next page load (`registerType: 'autoUpdate'`); open tabs keep the
  old code until reloaded.
* The **Android app** (Capacitor, `webDir: 'dist'`, no remote `server.url`) bundles the web build: installed
  phones keep the OLD code until a new APK is installed. This is a deployment blocker unless every Android
  user updates at the same time as the migration (see step 6 below).
* Do **not** also apply `docs/proposals/PROPOSED_break_integrity_guards.sql` or
  `PROPOSED_one_open_break_per_attendance.sql`: this migration supersedes both.

## Deploying (staging first — never test on production)

### Read-only pre-checks (run on the target database; none of them change anything)

```sql
-- 1. Migration history: what is really applied (do not assume files = applied)
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 15;

-- 2. Must return 0 rows (otherwise the migration stops; correct these breaks first)
SELECT attendance_id, count(*) FROM attendance_breaks
WHERE ended_at IS NULL AND break_type <> 'CANCELLED' GROUP BY 1 HAVING count(*) > 1;

-- 3. Extensions: pg_cron decides whether the every-minute schedule is created
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net', 'uuid-ossp');
SELECT jobname, schedule, command FROM cron.job;          -- only if pg_cron is installed

-- 4. Existing triggers on the tables this migration adds triggers to
SELECT tgrelid::regclass AS tbl, tgname FROM pg_trigger
WHERE NOT tgisinternal AND tgrelid IN ('attendance'::regclass, 'attendance_breaks'::regclass, 'employee_live_locations'::regclass);

-- 5. Helper functions the migration relies on, and the settings row
SELECT proname FROM pg_proc WHERE proname IN ('get_auth_role', 'get_auth_employee_id', 'update_updated_at_column', 'correct_tracking_enforcement_break');
SELECT id, settings ? 'app' AS has_app, settings->'payroll'->>'enableBreakOverrunDetection' AS overrun_detection
FROM app_settings WHERE id = '00000000-0000-0000-0000-000000000001';

-- 6. Realtime publication (attendance_breaks / employee_tracking_state are added by the migration)
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;

-- 7. Open automatic breaks right now (each needs an updated app to clock out — see compatibility)
SELECT break_type, count(*) FROM attendance_breaks
WHERE ended_at IS NULL AND break_type IN ('AUTO_GPS', 'AUTO_TRACKING') GROUP BY 1;

-- 8. Who will own the new functions (the guards treat postgres / service_role / supabase_admin as trusted)
SELECT current_user;
```

### Steps

1. Run the database tests locally (`node supabase/tests/autobreak/run_autobreak_db_tests.mjs`) and the
   app checks (`npm test`, `npx tsc -b`, `npm run build:staging`, `npm run lint`).
2. On **staging**: run the pre-checks above; resolve anything unexpected (rows in check 2, unknown
   triggers in check 4, missing functions in check 5).
3. Apply the migration on staging (`npx supabase db push --linked` against the staging project, or run the
   file in the staging SQL editor as `postgres`). Re-run checks 3, 4 and 6 to confirm the schedule,
   triggers and publication.
4. Without pg_cron: schedule `SELECT public.process_stale_tracking();` every minute another way. Admin →
   Break Management runs it once a minute only while it is open (fallback).
5. Deploy the matching staging web build and test with separate employee and admin sessions: manual
   break; permission denied; GPS off; airplane mode > 15 min then back; fresh location ends the break;
   clock-out during each kind of automatic break; WFH day; overnight shift; Break Management realtime.
6. Production, in a quiet window when nobody is on an automatic break (pre-check 7 = 0 rows): apply the
   migration, deploy the web build immediately, and release the Android APK at the same time (or keep
   Android users on the web app until they update).
7. Watch the first day: `SELECT state, count(*) FROM employee_tracking_state GROUP BY 1;` and
   `SELECT reason, ended_reason, count(*) FROM attendance_breaks WHERE source = 'SYSTEM' AND created_at > now() - interval '1 day' GROUP BY 1, 2;`

Rollback: run the rollback file and redeploy the previous app version. Break rows are kept; the
source / reason / ended_reason columns are dropped (export them first if needed).

## Tests

```bash
# database (throwaway in-memory PostgreSQL; never connects to Supabase)
npm i --no-save @electric-sql/pglite
node supabase/tests/autobreak/run_autobreak_db_tests.mjs

# concurrency on a real local PostgreSQL server (throwaway, localhost, temporary data dir)
npm i --no-save embedded-postgres pg
node supabase/tests/autobreak/run_autobreak_concurrency_tests.mjs

# unit tests
npm test
```

## Known limits

* **Browsers cannot track in the background.** A phone with the browser closed or the screen locked
  sends no locations, so the stale rule starts a break after the interval. The Android app with the native
  background-location plugin avoids this (see `docs/BACKGROUND_LOCATION.md`).
* Inside / outside the office is still decided on the device (debounced) and stored in
  `employee_live_locations`; the server checks the stored side before starting or ending a geofence break,
  but cannot prove a device location is genuine. Locations are client-reported: an employee who writes
  fake rows to `employee_live_locations` through the API (or uses a GPS-spoofing app) can appear "fresh"
  and avoid / end tracking breaks. Only server-verified location (not possible from a browser) would close this.
* Clock-in / clock-out times are still written by the app (see the audit report, S-02). After clock-in the
  database now protects the date, shift and times, but the clock-in INSERT itself is still client-written:
  an employee calling the API directly could insert an attendance with a wrong date or an already-ended
  shift and so avoid automatic breaks for that day. Server-side clock-in (S-02) is required to close this.
* `server/` (separate Node.js / Redis service by another contributor) writes `attendance` columns that do
  not exist in this schema (`work_date`, `clock_in`, `clock_out`, …) and uses the service-role key, which
  bypasses these guards; its check-out would not close an open automatic break. It must be aligned before use.
* The existing auto clock-out job (`0015_auto_clock_out.sql`) is unchanged; its shift times are built
  without a time zone (audit B-05). With mode "after grace period", time between shift end and the
  automatic clock-out counts as worked, because the tracking break is closed at shift end.
