#!/usr/bin/env node
/**
 * Database tests for the automatic-break migration (20261021120000_automatic_break_tracking.sql).
 *
 * Runs against a THROWAWAY in-memory PostgreSQL (PGlite = real PostgreSQL compiled to WebAssembly):
 * it never connects to Supabase, staging or production. Every migration in supabase/migrations is
 * applied to an empty database (with the Supabase stand-ins from supabase/tests/rls/00_supabase_shim.sql),
 * then requests are made as the real API roles (authenticated employee / HR / admin, service_role)
 * with Row Level Security in force.
 *
 * Run (PGlite is not a project dependency, so install it outside package.json):
 *   npm i --no-save @electric-sql/pglite
 *   node supabase/tests/autobreak/run_autobreak_db_tests.mjs
 * or point PGLITE_DIR at a node_modules folder that has it:
 *   PGLITE_DIR=/path/to/node_modules node supabase/tests/autobreak/run_autobreak_db_tests.mjs
 *
 * Limits: PGlite is a single connection, so two truly simultaneous transactions cannot be run here;
 * concurrency is covered by the unique index (tested directly) and the row locks in the functions.
 * pg_cron and pg_net are not available: the schedule is tested by calling process_stale_tracking().
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const NEW_MIG = '20261021120000_automatic_break_tracking.sql';
const ROLLBACK = path.join(ROOT, 'supabase/rollbacks/20261021120000_automatic_break_tracking.rollback.sql');

async function loadPglite() {
  const dir = process.env.PGLITE_DIR;
  if (dir) {
    const base = path.join(dir, '@electric-sql/pglite/dist');
    const { PGlite } = await import(pathToFileURL(path.join(base, 'index.js')).href);
    const { uuid_ossp } = await import(pathToFileURL(path.join(base, 'contrib/uuid_ossp.js')).href);
    return { PGlite, uuid_ossp };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { uuid_ossp } = await import('@electric-sql/pglite/contrib/uuid_ossp');
  return { PGlite, uuid_ossp };
}
const { PGlite, uuid_ossp } = await loadPglite();

// ------------------------------------------------------------------ database build
const read = (p) => fs.readFileSync(p, 'utf8');
function migrationSql(f) {
  let sql = read(path.join(MIG_DIR, f));
  // pg_net is not available outside Supabase; the shim provides a stub net.http_post (same as run_rls_tests.sh)
  if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed by test');
  return sql;
}
const ALL = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
if (!ALL.includes(NEW_MIG)) { console.error(`missing ${NEW_MIG}`); process.exit(2); }

async function newDb({ withNew = true, before } = {}) {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(read(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql')));
  for (const f of ALL) {
    if (f === NEW_MIG) continue;
    try { await db.exec(migrationSql(f)); } catch (e) { throw new Error(`migration ${f} failed: ${e.message}`); }
  }
  await seed(db);
  if (before) await before(db);
  if (withNew) await db.exec(migrationSql(NEW_MIG));
  return db;
}

// ------------------------------------------------------------------ synthetic data
const U = { admin: '11111111-1111-1111-1111-111111111111', hr: '22222222-2222-2222-2222-222222222222', emp: '33333333-3333-3333-3333-333333333333', emp2: '55555555-5555-5555-5555-555555555555' };
const E = { admin: 'e1111111-1111-1111-1111-111111111111', hr: 'e2222222-2222-2222-2222-222222222222', emp: 'e3333333-3333-3333-3333-333333333333', emp2: 'e5555555-5555-5555-5555-555555555555' };
const S = { day: '5a000000-0000-0000-0000-0000000000d1', ended: '5a000000-0000-0000-0000-0000000000d2', night: '5a000000-0000-0000-0000-0000000000d3' };
const A = { emp: 'a0000000-0000-0000-0000-000000000001', emp2: 'a0000000-0000-0000-0000-000000000002' };

async function seed(db) {
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${U.admin}','ab-admin@example.com'),('${U.hr}','ab-hr@example.com'),('${U.emp}','ab-emp@example.com'),('${U.emp2}','ab-emp2@example.com');
    INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status) VALUES
      ('${E.admin}','AB-A','Ada','Admin','ab-admin@example.com','2026-01-01',(SELECT id FROM roles WHERE name='ADMIN'),'ACTIVE'),
      ('${E.hr}','AB-H','Hana','HR','ab-hr@example.com','2026-01-01',(SELECT id FROM roles WHERE name='HR'),'ACTIVE'),
      ('${E.emp}','AB-1','Eli','Emp','ab-emp@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE'),
      ('${E.emp2}','AB-2','Eva','Two','ab-emp2@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE');
    INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES
      ('${U.admin}','${E.admin}',(SELECT id FROM roles WHERE name='ADMIN'),true),
      ('${U.hr}','${E.hr}',(SELECT id FROM roles WHERE name='HR'),true),
      ('${U.emp}','${E.emp}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true),
      ('${U.emp2}','${E.emp2}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true);
    -- all-day shift (ends 23:59 company time today), an already-ended shift, and an overnight shift
    INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes) VALUES
      ('${S.day}','AB Day','AB-DAY','GENERAL','00:00','23:59',false,8,60),
      ('${S.ended}','AB Ended','AB-END','GENERAL','00:00','00:01',false,8,60),
      ('${S.night}','AB Night','AB-NGT','NIGHT','20:00','23:59',true,8,30);
  `);
}

// company date (Asia/Kolkata) without the migration's helper, so setup also works before it is applied
const KDATE = `((now() AT TIME ZONE 'Asia/Kolkata')::date)`;

// ------------------------------------------------------------------ request helpers
const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated', email: `${uid}@example.com` });
async function as(db, who, sql, params = []) {
  // who: 'emp' | 'emp2' | 'hr' | 'admin' (role authenticated) | 'service' (service_role)
  await db.exec('BEGIN');
  try {
    if (who === 'service') {
      await db.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await db.exec('SET LOCAL ROLE service_role');
    } else {
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims(U[who])]);
      await db.exec('SET LOCAL ROLE authenticated');
    }
    const r = await db.query(sql, params);
    await db.exec('COMMIT');
    return { rows: r.rows, affected: r.affectedRows ?? r.rows.length, error: null };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { rows: [], affected: 0, error: e.message };
  }
}
const sys = async (db, sql, params = []) => (await db.query(sql, params)).rows;   // superuser (test setup only)
const one = async (db, sql, params = []) => (await sys(db, sql, params))[0];
const rpc = async (db, who, fn, args = '') => {
  const r = await as(db, who, `SELECT public.${fn}(${args}) AS r`);
  return r.error ? { error: r.error } : r.rows[0].r;
};

async function clockIn(db, { att = A.emp, emp = E.emp, shift = S.day, date = 'today', minsAgo = 60, late = 0 } = {}) {
  const d = date === 'today' ? KDATE : date === 'yesterday' ? `${KDATE} - 1` : `'${date}'::date`;
  await sys(db, `INSERT INTO attendance (id, employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status, late_minutes)
                 VALUES ($1, $2, $3, ${d}, now() - make_interval(mins => $4), 8, $5, $6)`,
    [att, emp, shift, minsAgo, late > 0 ? 'LATE' : 'WORKING', late]);
}
async function setPolicy(db, patch) {
  await sys(db, `UPDATE app_settings SET settings = jsonb_set(COALESCE(settings,'{}'), '{app}', COALESCE(settings->'app','{}') || $1::jsonb) WHERE id='00000000-0000-0000-0000-000000000001'`, [JSON.stringify(patch)]);
}
async function setPayroll(db, patch) {
  await sys(db, `UPDATE app_settings SET settings = jsonb_set(COALESCE(settings,'{}'), '{payroll}', COALESCE(settings->'payroll','{}') || $1::jsonb) WHERE id='00000000-0000-0000-0000-000000000001'`, [JSON.stringify(patch)]);
}
async function approveWfh(db, emp = E.emp, date = 'today') {
  const d = date === 'today' ? KDATE : `${KDATE} - 1`;
  await sys(db, `INSERT INTO wfh_requests (employee_id, request_date, reason, status) VALUES ($1, ${d}, 'test', 'APPROVED')`, [emp]);
}
// a location written the way the app writes it (as the employee, through RLS)
async function liveFix(db, who, { status = 'INSIDE_GEOFENCE', measuredMinsAgo = 0 } = {}) {
  const emp = E[who];
  const exists = await one(db, `SELECT id FROM employee_live_locations WHERE employee_id=$1`, [emp]);
  const ctx = status === 'WFH' ? 'WFH' : 'OFFICE';
  if (!exists) {
    return as(db, who, `INSERT INTO employee_live_locations (employee_id, latitude, longitude, location_status, location_context, last_seen_at, source)
                        VALUES ('${emp}', 12.9, 77.6, '${status}', '${ctx}', now() - make_interval(mins => ${measuredMinsAgo}), 'WEB')`);
  }
  return as(db, who, `UPDATE employee_live_locations SET location_status='${status}', location_context='${ctx}', latitude=12.91,
                      last_seen_at = now() - make_interval(mins => ${measuredMinsAgo}) WHERE employee_id='${emp}'`);
}
const breaks = (db, att = A.emp) => sys(db, `SELECT * FROM attendance_breaks WHERE attendance_id=$1 ORDER BY started_at, created_at`, [att]);
const openBreaks = async (db, att = A.emp) => (await breaks(db, att)).filter((b) => !b.ended_at && b.break_type !== 'CANCELLED');
const attRow = (db, att = A.emp) => one(db, `SELECT * FROM attendance WHERE id=$1`, [att]);
const state = (db, emp = E.emp) => one(db, `SELECT * FROM employee_tracking_state WHERE employee_id=$1`, [emp]);
const ageSec = (ts) => Math.round((Date.now() - new Date(ts).getTime()) / 1000);

// ------------------------------------------------------------------ tiny test runner
let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`PASS  ${name}`); }
  else { fail++; results.push(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

// ================================================================== scenarios
scenario('migration: fresh database and upgrade path', async () => {
  // upgrade: an existing AUTO_GPS break from the browser era, created before this migration
  const db = await newDb({ before: async (d) => {
    await clockIn(d);
    await sys(d, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, ended_at, duration_minutes) VALUES ($1,$2,'AUTO_GPS', now()-interval '50 minutes', now()-interval '40 minutes', 10)`, [A.emp, E.emp]);
  } });
  const b = (await breaks(db))[0];
  check('M1 upgrade: existing AUTO_GPS break back-filled as SYSTEM / GEOFENCE_EXIT', b.source === 'SYSTEM' && b.reason === 'GEOFENCE_EXIT', JSON.stringify(b));
  const pub = await sys(db, `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename IN ('attendance_breaks','employee_tracking_state') ORDER BY 1`);
  check('M2 realtime publication includes attendance_breaks and employee_tracking_state', pub.length === 2, JSON.stringify(pub));
  // re-running the migration is harmless (idempotent DDL, no duplicate schedule)
  let again = null; try { await db.exec(migrationSql(NEW_MIG)); } catch (e) { again = e.message; await db.exec('ROLLBACK').catch(() => {}); }
  check('M3 migration can be applied twice', again === null, again);
  // rollback then re-apply
  let rb = null; try { await db.exec(read(ROLLBACK)); } catch (e) { rb = e.message; await db.exec('ROLLBACK').catch(() => {}); }
  const fnGone = await one(db, `SELECT count(*)::int c FROM pg_proc WHERE proname IN ('report_tracking_event','process_stale_tracking')`);
  const kept = await breaks(db);
  check('M4 rollback removes the functions and keeps the break rows', rb === null && fnGone.c === 0 && kept.length === 1, rb || JSON.stringify(fnGone));
  let re = null; try { await db.exec(migrationSql(NEW_MIG)); } catch (e) { re = e.message; await db.exec('ROLLBACK').catch(() => {}); }
  check('M5 migration re-applies cleanly after rollback', re === null, re);
  await db.close();
});

scenario('migration: refuses when an attendance already has two open breaks', async () => {
  let err = null;
  try {
    await newDb({ before: async (d) => {
      await clockIn(d);
      // a database where 20261020150000's unique index was never applied
      await d.exec('DROP INDEX IF EXISTS public.idx_one_active_break_per_attendance');
      await sys(d, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at) VALUES ($1,$2,'REGULAR', now()-interval '20 minutes'), ($1,$2,'AUTO_GPS', now()-interval '10 minutes')`, [A.emp, E.emp]);
    } });
  } catch (e) { err = e.message; }
  check('M6 migration stops, names the attendance, deletes nothing', !!err && err.includes('more than one open break') && err.includes(A.emp), err);
});

scenario('device events: permission denied / GPS unavailable / timeout', async () => {
  const db = await newDb();
  // 10. before clock-in
  let r = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  check('T10 no break before clock-in (NOT_CLOCKED_IN)', r.action === 'NONE' && r.reason === 'NOT_CLOCKED_IN', JSON.stringify(r));
  await clockIn(db);
  // 3. timeout alone
  r = await rpc(db, 'emp', 'report_tracking_event', `'TIMEOUT', 'Timeout expired'`);
  check('T3 GPS timeout alone does not create a break', r.action === 'NONE' && (await breaks(db)).length === 0 && (await state(db)).state === 'GPS_TIMEOUT', JSON.stringify(r));
  // 1. permission denied → immediate (zero grace)
  r = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED', 'User denied Geolocation'`);
  const b = (await openBreaks(db))[0];
  check('T1 permission denied starts an automatic break immediately', r.action === 'STARTED' && b?.break_type === 'AUTO_TRACKING' && b.reason === 'LOCATION_PERMISSION_DENIED' && b.source === 'SYSTEM', JSON.stringify(r));
  check('T1b break start is database time (now), not a device time', b && Math.abs(ageSec(b.started_at)) <= 5, b?.started_at);
  check('T1c attendance shows ON_BREAK', (await attRow(db)).status === 'ON_BREAK');
  const ev = await one(db, `SELECT count(*)::int c FROM attendance_events WHERE attendance_id=$1 AND event_type='BREAK_START' AND source='SYSTEM'`, [A.emp]);
  const nt = await one(db, `SELECT count(*)::int c FROM notifications WHERE recipient_employee_id=$1 AND notification_type='AUTOMATIC_BREAK'`, [E.emp]);
  const au = await one(db, `SELECT count(*)::int c FROM audit_logs WHERE action='AUTOMATIC_BREAK_STARTED'`);
  check('T1d event, employee notification and audit entry written once', ev.c === 1 && nt.c === 1 && au.c === 1, JSON.stringify({ ev, nt, au }));
  // 6. repeated events: no duplicates
  for (let i = 0; i < 3; i++) await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  r = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_UNAVAILABLE'`);
  check('T6 repeated / different events keep exactly one open break', (await openBreaks(db)).length === 1 && r.reason === 'BREAK_ALREADY_ACTIVE', JSON.stringify(r));
  const nt2 = await one(db, `SELECT count(*)::int c FROM notifications WHERE recipient_employee_id=$1 AND notification_type='AUTOMATIC_BREAK'`, [E.emp]);
  check('T6b no duplicate notifications', nt2.c === 1, JSON.stringify(nt2));
  // unknown event rejected
  r = await rpc(db, 'emp', 'report_tracking_event', `'I_AM_OFFLINE_TRUST_ME'`);
  check('T1e unknown event names are rejected', !!r.error, JSON.stringify(r));
  await db.close();

  // 2. GPS unavailable follows its own policy
  const db2 = await newDb();
  await clockIn(db2);
  await setPolicy(db2, { autoBreakOnGpsUnavailable: false });
  r = await rpc(db2, 'emp', 'report_tracking_event', `'LOCATION_UNAVAILABLE'`);
  check('T2 GPS unavailable with its rule off: no break (POLICY_DISABLED)', r.action === 'NONE' && r.reason === 'POLICY_DISABLED' && (await breaks(db2)).length === 0, JSON.stringify(r));
  await setPolicy(db2, { autoBreakOnGpsUnavailable: true });
  r = await rpc(db2, 'emp', 'report_tracking_event', `'LOCATION_UNAVAILABLE'`);
  check('T2b GPS unavailable with its rule on: break with reason GPS_UNAVAILABLE', r.action === 'STARTED' && (await openBreaks(db2))[0]?.reason === 'GPS_UNAVAILABLE', JSON.stringify(r));
  await db2.close();
});

scenario('policy switched off / grace period', async () => {
  const db = await newDb();
  await clockIn(db, { minsAgo: 40 });
  await setPolicy(db, { autoBreakEnabled: false });
  let r = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  const p = await rpc(db, 'service', 'process_stale_tracking');
  check('T7 disabled policy: no break from events or the stale job', r.reason === 'POLICY_DISABLED' && p.started === 0 && (await breaks(db)).length === 0, JSON.stringify({ r, p }));
  // grace > 0: the event waits; the job starts it once the grace has passed, at problem time + grace
  await setPolicy(db, { autoBreakEnabled: true, autoBreakGraceMinutes: 5 });
  r = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  check('T7b with a 5-minute grace the event does not start a break yet', r.reason === 'GRACE_PERIOD' && (await breaks(db)).length === 0, JSON.stringify(r));
  await sys(db, `UPDATE employee_tracking_state SET state_since = now() - interval '7 minutes' WHERE employee_id=$1`, [E.emp]);
  await rpc(db, 'service', 'process_stale_tracking');
  const b = (await openBreaks(db))[0];
  check('T7c after the grace the job starts it at problem time + grace (≈2 min ago)', b?.reason === 'LOCATION_PERMISSION_DENIED' && ageSec(b.started_at) >= 100 && ageSec(b.started_at) <= 140, b?.started_at);
  await db.close();
});

scenario('stale location (server-side), network loss and recovery', async () => {
  const db = await newDb();
  await clockIn(db, { minsAgo: 60 });
  await liveFix(db, 'emp', { status: 'INSIDE_GEOFENCE' });               // fresh fix now
  let p = await rpc(db, 'service', 'process_stale_tracking');
  check('T5a fresh location: stale job starts nothing', p.started === 0 && (await breaks(db)).length === 0, JSON.stringify(p));
  // last fresh location reached the server 20 minutes ago (stale interval 15)
  await sys(db, `UPDATE employee_tracking_state SET last_fresh_fix_at = now() - interval '20 minutes', last_contact_at = now() - interval '20 minutes' WHERE employee_id=$1`, [E.emp]);
  p = await rpc(db, 'service', 'process_stale_tracking');
  let b = (await openBreaks(db))[0];
  check('T5 stale location detected server-side → TRACKING_STALE break', p.started === 1 && b?.reason === 'TRACKING_STALE' && b.source === 'SYSTEM', JSON.stringify(p));
  check('T5b zero grace: the break starts at the last fresh location (≈20 min ago)', b && ageSec(b.started_at) >= 1180 && ageSec(b.started_at) <= 1220, b?.started_at);
  check('T5c tracking state STALE', (await state(db)).state === 'STALE');
  // 22. repeated scheduler runs are idempotent
  for (let i = 0; i < 3; i++) p = await rpc(db, 'service', 'process_stale_tracking');
  const nt = await one(db, `SELECT count(*)::int c FROM notifications WHERE recipient_employee_id=$1 AND notification_type='AUTOMATIC_BREAK'`, [E.emp]);
  check('T22 repeated scheduler runs: still one break, one notification', p.started === 0 && (await breaks(db)).length === 1 && nt.c === 1, JSON.stringify({ p, nt }));
  // 4. reconnect: device says it was offline → reason refined, break NOT ended by the reconnect itself
  let r = await rpc(db, 'emp', 'report_tracking_event', `'NETWORK_RECONNECTED', null, 1200`);
  b = (await breaks(db))[0];
  check('T4 network reconnect alone does not end the break', !b.ended_at && r.reason === 'WAITING_FOR_FRESH_LOCATION', JSON.stringify(r));
  check('T4b reconnect report distinguishes the cause: reason NETWORK_DISCONNECTED, state WAITING_FOR_FIX', b.reason === 'NETWORK_DISCONNECTED' && (await state(db)).state === 'WAITING_FOR_FIX', `${b.reason} ${(await state(db)).state}`);
  // offline queue replay: a reading measured 18 minutes ago arrives now → not fresh, no change
  await liveFix(db, 'emp', { status: 'INSIDE_GEOFENCE', measuredMinsAgo: 18 });
  check('T4c a replayed (old) queued location does not end the break or reset the state', !(await breaks(db))[0].ended_at && (await state(db)).state === 'WAITING_FOR_FIX');
  // 17. a fresh location → automatic resume
  await liveFix(db, 'emp', { status: 'INSIDE_GEOFENCE', measuredMinsAgo: 0 });
  b = (await breaks(db))[0];
  const st = await state(db);
  check('T17 fresh location ends the tracking break automatically (TRACKING_RESTORED)', !!b.ended_at && b.ended_reason === 'TRACKING_RESTORED' && Math.abs(ageSec(b.ended_at)) <= 5, JSON.stringify(b));
  check('T17b state TRACKING_RESTORED, no open break left', st.state === 'TRACKING_RESTORED' && st.open_auto_break_id === null && (await openBreaks(db)).length === 0, JSON.stringify(st));
  const a = await attRow(db);
  check('T17c attendance totals updated by the database (≈20 min, status back to WORKING)', a.break_minutes >= 19 && a.break_minutes <= 21 && a.status === 'WORKING', JSON.stringify({ m: a.break_minutes, s: a.status }));
  await db.close();
});

scenario('recovery outside the office becomes a geofence break; auto-resume off', async () => {
  const db = await newDb();
  await clockIn(db);
  await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  await liveFix(db, 'emp', { status: 'OUTSIDE_GEOFENCE' });
  const bs = await breaks(db);
  check('T17d tracking restored while outside: tracking break ends, AUTO_GPS (GEOFENCE_EXIT) starts', bs.length === 2 && bs[0].ended_reason === 'TRACKING_RESTORED' && bs[1].break_type === 'AUTO_GPS' && !bs[1].ended_at, JSON.stringify(bs.map((x) => [x.break_type, x.reason, x.ended_reason])));
  await db.close();
  const db2 = await newDb();
  await clockIn(db2);
  await setPolicy(db2, { autoBreakAutoResume: false });
  await rpc(db2, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  await liveFix(db2, 'emp', { status: 'INSIDE_GEOFENCE' });
  check('T17e with auto-resume off a fresh location does not end the break', (await openBreaks(db2)).length === 1);
  await db2.close();
});

scenario('WFH policy', async () => {
  const db = await newDb();
  await clockIn(db, { minsAgo: 60 });
  await approveWfh(db);
  let r = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  check('T9 WFH: permission loss does not start a break', r.reason === 'WFH_EXEMPT' && (await breaks(db)).length === 0, JSON.stringify(r));
  r = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_UNAVAILABLE'`);
  // device keeps reporting the GPS problem (in contact), no location for 20 min → still no break
  await sys(db, `UPDATE employee_tracking_state SET last_fresh_fix_at = now() - interval '20 minutes' WHERE employee_id=$1`, [E.emp]);
  let p = await rpc(db, 'service', 'process_stale_tracking');
  check('T9b WFH: GPS unavailable while the device is still reporting → no stale break', p.started === 0 && (await breaks(db)).length === 0, JSON.stringify(p));
  // device goes silent (network / app closed): stale rule applies to WFH
  await sys(db, `UPDATE employee_tracking_state SET last_contact_at = now() - interval '20 minutes' WHERE employee_id=$1`, [E.emp]);
  p = await rpc(db, 'service', 'process_stale_tracking');
  check('T8 WFH: no contact for the stale interval → TRACKING_STALE break', p.started === 1 && (await openBreaks(db))[0]?.reason === 'TRACKING_STALE', JSON.stringify(p));
  await liveFix(db, 'emp', { status: 'WFH' });
  check('T8b WFH: a fresh WFH location ends it', (await openBreaks(db)).length === 0 && (await breaks(db))[0].ended_reason === 'TRACKING_RESTORED');
  await db.close();
  // WFH by roster entry (no request) is also WFH
  const db2 = await newDb();
  await clockIn(db2);
  const ros = await one(db2, `INSERT INTO rosters (name, status) VALUES ('AB roster','PUBLISHED') RETURNING id`).catch(() => null)
    || await one(db2, `INSERT INTO rosters (name, status, start_date, end_date) VALUES ('AB roster','PUBLISHED', ${KDATE}, ${KDATE}) RETURNING id`);
  await sys(db2, `INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date, work_mode) VALUES ($1,$2,$3, ${KDATE}, 'WFH')`, [ros.id, E.emp, S.day]);
  r = await rpc(db2, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  await liveFix(db2, 'emp', { status: 'OUTSIDE_GEOFENCE' });
  const g = await rpc(db2, 'emp', 'geofence_auto_break', `'START'`);
  check('T9c roster work mode WFH counts as WFH (no GPS-loss break, no geofence break)', r.reason === 'WFH_EXEMPT' && g.reason === 'WFH' && (await breaks(db2)).length === 0, JSON.stringify({ r, g }));
  await db2.close();
});

scenario('clock-out, shift end, overnight', async () => {
  const db = await newDb();
  await clockIn(db);
  await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  // 18. clock-out during a tracking break
  let r = await as(db, 'emp', `UPDATE attendance SET clock_out_at = now(), status = 'PRESENT' WHERE id='${A.emp}'`);
  check('T18a clocking out with the break still open is refused by the database', !!r.error && r.error.includes('still open'), JSON.stringify(r));
  const c = await rpc(db, 'emp', 'close_auto_break_for_clock_out', `'${A.emp}'`);
  r = await as(db, 'emp', `UPDATE attendance SET clock_out_at = now(), status = 'PRESENT' WHERE id='${A.emp}'`);
  const b = (await breaks(db))[0];
  check('T18 clock-out closes the tracking break (CLOCK_OUT) and then succeeds', c.action === 'ENDED' && b.ended_reason === 'CLOCK_OUT' && !r.error, JSON.stringify({ c, r }));
  // 11. after clock-out
  const r2 = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  const p = await rpc(db, 'service', 'process_stale_tracking');
  check('T11 no break after clock-out', r2.reason === 'NOT_CLOCKED_IN' && p.started === 0 && (await breaks(db)).length === 1, JSON.stringify({ r2, p }));
  await db.close();

  // manual break open → clock-out RPC does not close it
  const dbm = await newDb();
  await clockIn(dbm);
  await as(dbm, 'emp', `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at) VALUES ('${A.emp}','${E.emp}','REGULAR', now())`);
  const cm = await rpc(dbm, 'emp', 'close_auto_break_for_clock_out', `'${A.emp}'`);
  check('T18b a manual break is not closed by the clock-out function (MANUAL_BREAK_ACTIVE)', cm.reason === 'MANUAL_BREAK_ACTIVE' && (await openBreaks(dbm)).length === 1, JSON.stringify(cm));
  await dbm.close();

  // 12. shift end: tracking break closed at shift end, no new breaks after it
  const db2 = await newDb();
  await clockIn(db2, { shift: S.ended, minsAgo: 1 });
  // a tracking break that started before the shift ended (set up directly: no API can start one now)
  await sys(db2, `UPDATE attendance SET clock_in_at = ab_company_date(now())::timestamp AT TIME ZONE 'Asia/Kolkata' WHERE id=$1`, [A.emp]);
  await sys(db2, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, source, reason) VALUES ($1,$2,'AUTO_TRACKING', ab_company_date(now())::timestamp AT TIME ZONE 'Asia/Kolkata', 'SYSTEM','TRACKING_STALE')`, [A.emp, E.emp]);
  const p2 = await rpc(db2, 'service', 'process_stale_tracking');
  const b2 = (await breaks(db2))[0];
  const endExpected = await one(db2, `SELECT ab_shift_end($1) AS t`, [A.emp]);
  check('T12 shift-end cleanup closes the tracking break at the shift end (SHIFT_END)', p2.closed_at_shift_end === 1 && b2.ended_reason === 'SHIFT_END' && new Date(b2.ended_at).getTime() === new Date(endExpected.t).getTime(), JSON.stringify({ p2, ended: b2.ended_at, endExpected }));
  const r3 = await rpc(db2, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  const p3 = await rpc(db2, 'service', 'process_stale_tracking');
  check('T12b no new automatic break after the shift end', r3.reason === 'AFTER_SHIFT_END' && p3.started === 0 && (await openBreaks(db2)).length === 0, JSON.stringify({ r3, p3 }));
  await db2.close();

  // 13. overnight: yesterday's overnight attendance is the open one
  const db3 = await newDb();
  await clockIn(db3, { shift: S.night, date: 'yesterday', minsAgo: 120 });
  const r4 = await rpc(db3, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  check('T13 overnight shift: break goes on yesterday\'s attendance (company date Asia/Kolkata)', r4.action === 'STARTED' && (await openBreaks(db3)).length === 1, JSON.stringify(r4));
  await db3.close();
  const db4 = await newDb();
  await clockIn(db4, { shift: S.day, date: 'yesterday', minsAgo: 120 });   // forgot to clock out yesterday (not overnight)
  const r5 = await rpc(db4, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  const g5 = await rpc(db4, 'emp', 'geofence_auto_break', `'START'`);
  check('T13b a stale open attendance from yesterday (day shift) gets no break', r5.reason === 'NOT_CLOCKED_IN' && g5.reason === 'STALE_OPEN_ATTENDANCE' && (await breaks(db4)).length === 0, JSON.stringify({ r5, g5 }));
  await db4.close();
});

scenario('geofence breaks (AUTO_GPS) through the server', async () => {
  const db = await newDb();
  await clockIn(db);
  await liveFix(db, 'emp', { status: 'INSIDE_GEOFENCE' });
  let g = await rpc(db, 'emp', 'geofence_auto_break', `'START'`);
  check('G1 START is refused while the stored location is inside', g.reason === 'NOT_OUTSIDE' && (await breaks(db)).length === 0, JSON.stringify(g));
  await liveFix(db, 'emp', { status: 'OUTSIDE_GEOFENCE' });
  g = await rpc(db, 'emp', 'geofence_auto_break', `'START'`);
  const b = (await openBreaks(db))[0];
  check('G2 START outside → AUTO_GPS / GEOFENCE_EXIT / SYSTEM at database time', g.action === 'STARTED' && b?.break_type === 'AUTO_GPS' && b.reason === 'GEOFENCE_EXIT' && b.source === 'SYSTEM' && Math.abs(ageSec(b.started_at)) <= 5, JSON.stringify(g));
  g = await rpc(db, 'emp', 'geofence_auto_break', `'START'`);
  check('G3 second START: BREAK_ALREADY_ACTIVE', g.reason === 'BREAK_ALREADY_ACTIVE' && (await breaks(db)).length === 1);
  g = await rpc(db, 'emp', 'geofence_auto_break', `'END'`);
  check('G4 END while still outside is refused', g.reason === 'NOT_INSIDE' && (await openBreaks(db)).length === 1, JSON.stringify(g));
  await liveFix(db, 'emp', { status: 'INSIDE_GEOFENCE' });
  g = await rpc(db, 'emp', 'geofence_auto_break', `'END', now() - interval '30 minutes'`);
  const e = await one(db, `SELECT metadata FROM attendance_events WHERE attendance_id=$1 AND event_type='BREAK_END'`, [A.emp]);
  check('G5 END inside closes it (GEOFENCE_RETURN) and records the tracking gap', g.action === 'ENDED' && g.tracking_gap === true && e.metadata.tracking_gap === true && (await breaks(db))[0].ended_reason === 'GEOFENCE_RETURN', JSON.stringify(g));
  await db.close();
});

scenario('RLS / authorization: employees cannot forge or edit protected breaks', async () => {
  const db = await newDb();
  await clockIn(db);
  await clockIn(db, { att: A.emp2, emp: E.emp2 });
  // forge
  let r = await as(db, 'emp', `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, source) VALUES ('${A.emp}','${E.emp}','AUTO_TRACKING', now(), 'SYSTEM')`);
  check('R1 employee cannot insert an AUTO_TRACKING break', !!r.error && (await breaks(db)).length === 0, r.error);
  r = await as(db, 'emp', `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at) VALUES ('${A.emp}','${E.emp}','AUTO_GPS', now())`);
  check('R2 employee cannot insert an AUTO_GPS break', !!r.error, r.error);
  r = await as(db, 'emp', `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at) VALUES ('${A.emp2}','${E.emp2}','REGULAR', now())`);
  check('R3 employee cannot add a break to someone else\'s attendance', !!r.error && (await breaks(db, A.emp2)).length === 0, r.error);
  // a manual break: the database sets the times
  r = await as(db, 'emp', `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, source, reason) VALUES ('${A.emp}','${E.emp}','REGULAR', now() - interval '3 hours', 'SYSTEM', 'X') RETURNING id, started_at, source, reason`);
  const m = r.rows[0];
  check('R4 manual break allowed; back-dated start, source and reason are overridden', !r.error && Math.abs(ageSec(m.started_at)) <= 5 && m.source === 'EMPLOYEE' && m.reason === null, JSON.stringify(r));
  r = await as(db, 'emp', `UPDATE attendance_breaks SET ended_at = now() + interval '5 hours', duration_minutes = 1 WHERE id='${m.id}' RETURNING ended_at, duration_minutes, ended_reason`);
  check('R5 employee ends own manual break: end time and duration come from the database', !r.error && Math.abs(ageSec(r.rows[0].ended_at)) <= 5 && r.rows[0].duration_minutes === 0 && r.rows[0].ended_reason === 'EMPLOYEE', JSON.stringify(r));
  r = await as(db, 'emp', `UPDATE attendance_breaks SET ended_at = now() - interval '1 minute' WHERE id='${m.id}'`);
  check('R6 a completed break cannot be changed', !!r.error, r.error);
  r = await as(db, 'emp', `DELETE FROM attendance_breaks WHERE id='${m.id}'`);
  check('R7 employee cannot delete a break', (!!r.error || r.affected === 0) && (await breaks(db)).length === 1, JSON.stringify(r));
  // a system break
  await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  const sbreak = (await openBreaks(db))[0];
  r = await as(db, 'emp', `UPDATE attendance_breaks SET ended_at = now() WHERE id='${sbreak.id}'`);
  check('R8 employee cannot close (shorten) a system break', !!r.error && (await openBreaks(db)).length === 1, r.error);
  r = await as(db, 'emp', `UPDATE attendance_breaks SET break_type='REGULAR', source='EMPLOYEE' WHERE id='${sbreak.id}'`);
  check('R9 employee cannot relabel a system break', !!r.error && (await openBreaks(db))[0].break_type === 'AUTO_TRACKING', r.error);
  r = await as(db, 'emp', `UPDATE attendance_breaks SET started_at = now() WHERE id='${sbreak.id}'`);
  check('R10 employee cannot re-time a system break', !!r.error, r.error);
  // tracking state and internal functions
  r = await as(db, 'emp', `UPDATE employee_tracking_state SET last_fresh_fix_at = now(), state='TRACKING_OK' WHERE employee_id='${E.emp}'`);
  check('R11 employee cannot write the tracking state', !!r.error || r.affected === 0, JSON.stringify(r));
  r = await as(db, 'emp', `INSERT INTO employee_tracking_state (employee_id, state) VALUES ('${E.emp2}','TRACKING_OK')`);
  check('R12 employee cannot insert tracking state', !!r.error, r.error);
  r = await as(db, 'emp', `SELECT public.ab_end_auto_break('${sbreak.id}', now(), 'TRACKING_RESTORED')`);
  check('R13 internal functions are not callable through the API', !!r.error && r.error.includes('permission denied'), r.error);
  r = await as(db, 'emp', `SELECT public.process_stale_tracking()`);
  check('R14 employee cannot run the scheduler function', !!r.error, r.error);
  r = await as(db, 'emp', `SELECT * FROM public.ab_break_totals('${A.emp2}')`);
  check('R15 employee cannot read another attendance\'s totals', !!r.error, r.error);
  r = await as(db, 'emp2', `SELECT count(*)::int c FROM employee_tracking_state`);
  check('R16 employees see only their own tracking state', !r.error && r.rows[0].c === 0, JSON.stringify(r));
  r = await as(db, 'emp2', `SELECT public.close_auto_break_for_clock_out('${A.emp}')`);
  check('R17 employee cannot close another employee\'s break at clock-out', !!r.error && (await openBreaks(db)).length === 1, r.error);
  // anon cannot call the API functions
  await db.exec('BEGIN'); let anonErr = null;
  try { await db.exec(`SET LOCAL ROLE anon`); await db.query(`SELECT public.report_tracking_event('LOCATION_DENIED')`); } catch (e) { anonErr = e.message; }
  await db.exec('ROLLBACK');
  check('R18 anonymous callers cannot call report_tracking_event', !!anonErr && anonErr.includes('permission denied'), anonErr);
  await db.close();
});

scenario('attendance totals are database-derived; payroll consistency', async () => {
  const db = await newDb();
  await clockIn(db, { minsAgo: 180 });
  // completed breaks: a 40-minute system break and a 30-minute manual break (inserted as trusted setup)
  await sys(db, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, ended_at, duration_minutes, source, reason) VALUES
    ($1,$2,'AUTO_TRACKING', now()-interval '170 minutes', now()-interval '130 minutes', 40, 'SYSTEM', 'TRACKING_STALE'),
    ($1,$2,'REGULAR',       now()-interval '120 minutes', now()-interval '90 minutes', 30, 'EMPLOYEE', null)`, [A.emp, E.emp]);
  let a = await attRow(db);
  check('P1 break minutes = each completed break once (40 + 30 = 70)', a.break_minutes === 70, a.break_minutes);
  check('P2 overrun 0 while payroll break-overrun detection is off (app default)', a.break_overrun_minutes === 0, a.break_overrun_minutes);
  await setPayroll(db, { enableBreakOverrunDetection: true });
  await sys(db, `UPDATE attendance_breaks SET duration_minutes = duration_minutes WHERE attendance_id=$1`, [A.emp]);   // any break change recalculates
  a = await attRow(db);
  check('P3 with detection on: overrun = 70 − 60 (shift allowance) = 10', a.break_overrun_minutes === 10, a.break_overrun_minutes);
  // a cancelled (corrected) break is not counted
  const auto = await one(db, `SELECT id FROM attendance_breaks WHERE attendance_id=$1 AND break_type='AUTO_TRACKING'`, [A.emp]);
  const corr = await rpc(db, 'admin', 'correct_tracking_enforcement_break', `'${auto.id}', '${A.emp}', 'GPS outage confirmed by IT'`);
  a = await attRow(db);
  check('P4 admin correction (cancel) removes it from the totals: 30 min, overrun 0', corr.success === true && a.break_minutes === 30 && a.break_overrun_minutes === 0, JSON.stringify({ corr, m: a.break_minutes, o: a.break_overrun_minutes }));
  // 16. employees cannot set totals / status
  let r = await as(db, 'emp', `UPDATE attendance SET break_minutes = 0, break_overrun_minutes = 0, status = 'ON_BREAK' WHERE id='${A.emp}' RETURNING break_minutes, status`);
  check('T16 employee update cannot change break totals or fake ON_BREAK', !r.error && r.rows[0].break_minutes === 30 && r.rows[0].status === 'WORKING', JSON.stringify(r));
  r = await as(db, 'emp', `UPDATE attendance SET notes = 'hello' WHERE id='${A.emp}'`);
  check('T16b ordinary employee updates still work', !r.error && r.affected === 1, JSON.stringify(r));
  // HR / admin corrections are allowed
  r = await as(db, 'hr', `UPDATE attendance SET break_minutes = 25 WHERE id='${A.emp}' RETURNING break_minutes`);
  check('T16c HR can still correct attendance values', !r.error && r.rows[0]?.break_minutes === 25, JSON.stringify(r));
  // clock-out totals: worked hours computed by the app from the same stored breaks
  await sys(db, `UPDATE attendance_breaks SET duration_minutes = duration_minutes WHERE attendance_id=$1`, [A.emp]);
  r = await as(db, 'emp', `UPDATE attendance SET clock_out_at = now(), worked_hours = 2.5, status = 'PRESENT', break_minutes = 999 WHERE id='${A.emp}' RETURNING break_minutes, status, clock_out_at`);
  // status / worked hours are computed by the server at clock-out (20261028090000): 1 h after clock-in → HALF_DAY
  check('P5 at clock-out the stored break minutes are the database total (30), not the submitted value', !r.error && r.rows[0].break_minutes === 30 && r.rows[0].status === 'HALF_DAY', JSON.stringify(r));
  await db.close();
});

scenario('admin / HR: visibility, corrections, scheduler fallback; concurrency guard', async () => {
  const db = await newDb();
  await clockIn(db);
  await clockIn(db, { att: A.emp2, emp: E.emp2, minsAgo: 30 });
  await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  let r = await as(db, 'admin', `SELECT count(*)::int c FROM employee_tracking_state`);
  check('A1 admin sees all tracking states', !r.error && r.rows[0].c >= 1, JSON.stringify(r));
  r = await as(db, 'admin', `SELECT source, reason, break_type FROM attendance_breaks WHERE attendance_id='${A.emp}'`);
  check('A2 admin sees the break source and reason', r.rows[0]?.source === 'SYSTEM' && r.rows[0]?.reason === 'LOCATION_PERMISSION_DENIED', JSON.stringify(r));
  const hrRun = await rpc(db, 'hr', 'process_stale_tracking');
  check('A3 HR can run the scheduler function (fallback without pg_cron)', typeof hrRun.checked === 'number' && !hrRun.error, JSON.stringify(hrRun));
  const open = (await openBreaks(db))[0];
  r = await as(db, 'admin', `UPDATE attendance_breaks SET ended_at = now(), duration_minutes = 0 WHERE id='${open.id}'`);
  check('A4 admin can still end a system break (Break Management "End Break")', !r.error && (await openBreaks(db)).length === 0, r.error);
  // 14. at most one open break: the unique index refuses a second one even for trusted writers
  await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_UNAVAILABLE'`);
  let dup = null;
  try { await sys(db, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, source, reason) VALUES ($1,$2,'AUTO_TRACKING', now(),'SYSTEM','TRACKING_STALE')`, [A.emp, E.emp]); } catch (e) { dup = e.message; }
  check('T14 a second open break is refused by the unique index', !!dup && dup.includes('idx_one_active_break_per_attendance'), dup);
  const start2 = await one(db, `SELECT public.ab_start_auto_break($1, 'AUTO_TRACKING', 'TRACKING_STALE', now()) AS r`, [A.emp]);
  check('T14b a racing second start returns BREAK_ALREADY_ACTIVE', start2.r.reason === 'BREAK_ALREADY_ACTIVE' && (await openBreaks(db)).length === 1, JSON.stringify(start2));
  await db.close();
});

scenario('bypass attempts through the attendance row (direct API calls)', async () => {
  const db = await newDb();
  await clockIn(db, { minsAgo: 60 });
  // escape the checks by moving the attendance to another date
  let r = await as(db, 'emp', `UPDATE attendance SET attendance_date = '2000-01-01' WHERE id='${A.emp}'`);
  check('X1 employee cannot move an open attendance to another date', !!r.error && (await attRow(db)).attendance_date !== null && String((await attRow(db)).attendance_date).slice(0, 4) !== '2000', r.error);
  const ciBefore = (await attRow(db)).clock_in_at;
  r = await as(db, 'emp', `UPDATE attendance SET clock_in_at = now() WHERE id='${A.emp}'`);
  // refused (automatic-break guard) or ignored (server values, 20261028090000): the stored time never changes
  check('X2 employee cannot change the clock-in time', (!!r.error || r.affected >= 0) && String((await attRow(db)).clock_in_at) === String(ciBefore), r.error || 'ignored');
  // an open tracking break must not be shortened to 0 minutes by switching to an already-ended shift
  await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  await sys(db, `UPDATE attendance_breaks SET started_at = now() - interval '30 minutes' WHERE attendance_id=$1 AND ended_at IS NULL`, [A.emp]);
  r = await as(db, 'emp', `UPDATE attendance SET shift_template_id='${S.ended}' WHERE id='${A.emp}'`);
  await rpc(db, 'service', 'process_stale_tracking');
  check('X3 employee cannot switch to an ended shift; the open tracking break is not closed', !!r.error && (await openBreaks(db)).length === 1, r.error);
  r = await as(db, 'hr', `UPDATE attendance SET notes = 'hr check', shift_template_id = '${S.day}' WHERE id='${A.emp}'`);
  check('X4 HR can still correct the shift', !r.error && r.affected === 1, r.error);
  // after a clock-out the recorded time cannot be moved or re-opened by the employee
  await rpc(db, 'emp', 'close_auto_break_for_clock_out', `'${A.emp}'`);
  r = await as(db, 'emp', `UPDATE attendance SET clock_out_at = now(), status='PRESENT' WHERE id='${A.emp}'`);
  const out1 = (await attRow(db)).clock_out_at;
  const r2 = await as(db, 'emp', `UPDATE attendance SET clock_out_at = NULL WHERE id='${A.emp}'`);
  const r3 = await as(db, 'emp', `UPDATE attendance SET clock_out_at = now() + interval '3 hours' WHERE id='${A.emp}'`);
  check('X5 clock-out works once; the employee cannot re-open or move it afterwards', !r.error && !!out1 && !!r2.error && !!r3.error && String((await attRow(db)).clock_out_at) === String(out1), JSON.stringify({ r: r.error, r2: r2.error, r3: r3.error }));
  await db.close();
});

scenario('policy: the display-only "not updating" threshold does not change the 15-minute rule', async () => {
  const db = await newDb();
  await clockIn(db, { minsAgo: 60 });
  await setPolicy(db, { trackingStaleMinutes: 45 });          // admin display setting only
  await liveFix(db, 'emp', { status: 'INSIDE_GEOFENCE' });
  await sys(db, `UPDATE employee_tracking_state SET last_fresh_fix_at = now() - interval '20 minutes', last_contact_at = now() - interval '20 minutes' WHERE employee_id=$1`, [E.emp]);
  const p = await rpc(db, 'service', 'process_stale_tracking');
  check('PL1 stale after 20 min with trackingStaleMinutes=45 → break (approved 15-minute rule applies)', p.started === 1, JSON.stringify(p));
  await db.close();
});

scenario('failure isolation: notifications and automatic resume', async () => {
  const db = await newDb();
  await clockIn(db);
  // a failing notification (e.g. push webhook error) must not stop the break decision
  await db.exec(`CREATE FUNCTION test_fail_notify() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'push webhook down (simulated)'; END $$;
                 CREATE TRIGGER test_fail_notify BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION test_fail_notify();`);
  let r = await rpc(db, 'emp', 'report_tracking_event', `'LOCATION_DENIED'`);
  check('F1 notification failure: the automatic break is still started', r.action === 'STARTED' && (await openBreaks(db)).length === 1, JSON.stringify(r));
  await db.exec(`DROP TRIGGER test_fail_notify ON notifications`);
  // a failure inside automatic resume must not lose the employee's location write
  await db.exec(`CREATE FUNCTION test_fail_events() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'events table unavailable (simulated)'; END $$;
                 CREATE TRIGGER test_fail_events BEFORE INSERT ON attendance_events FOR EACH ROW EXECUTE FUNCTION test_fail_events();`);
  const w = await liveFix(db, 'emp', { status: 'INSIDE_GEOFENCE' });
  const live = await one(db, `SELECT count(*)::int c FROM employee_live_locations WHERE employee_id=$1`, [E.emp]);
  check('F2 resume failure: the location is still stored and the break stays open (retried later)', !w.error && live.c === 1 && (await openBreaks(db)).length === 1, JSON.stringify(w));
  await db.exec(`DROP TRIGGER test_fail_events ON attendance_events`);
  await sys(db, `UPDATE employee_tracking_state SET last_fresh_fix_at = now() - interval '1 minute' WHERE employee_id=$1`, [E.emp]);
  await liveFix(db, 'emp', { status: 'INSIDE_GEOFENCE' });
  check('F3 the next fresh location ends the break once the problem is gone', (await openBreaks(db)).length === 0 && (await breaks(db))[0].ended_reason === 'TRACKING_RESTORED');
  await db.close();
});

// ------------------------------------------------------------------ run
const t0 = Date.now();
for (const s of scenarios) {
  results.push(`\n== ${s.name}`);
  try { await s.fn(); } catch (e) { fail++; results.push(`FAIL  scenario crashed: ${e.stack || e.message}`); }
}
console.log(results.join('\n'));
console.log(`\nRESULT: ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(fail === 0 ? 0 : 1);
