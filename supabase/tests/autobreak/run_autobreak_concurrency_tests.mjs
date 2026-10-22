#!/usr/bin/env node
/**
 * CONCURRENCY tests for the automatic-break migration, on a REAL PostgreSQL server with several
 * simultaneous connections (PGlite in run_autobreak_db_tests.mjs is a single connection).
 *
 * Starts a THROWAWAY local PostgreSQL (embedded-postgres, localhost only, temporary data directory that
 * is deleted at the end) — it never connects to Supabase, staging or production.
 *
 * Run (not project dependencies; install outside package.json):
 *   npm i --no-save embedded-postgres pg
 *   node supabase/tests/autobreak/run_autobreak_concurrency_tests.mjs
 * or: EMBEDDED_PG_DIR=/path/to/node_modules node supabase/tests/autobreak/run_autobreak_concurrency_tests.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');

async function load() {
  const dir = process.env.EMBEDDED_PG_DIR;
  const imp = (name, file) => dir ? import(pathToFileURL(path.join(dir, name, file)).href) : import(name);
  const ep = await imp('embedded-postgres', 'dist/index.js');
  const pg = await imp('pg', 'esm/index.mjs').catch(() => imp('pg', 'lib/index.js'));
  return { EmbeddedPostgres: ep.default, Pool: (pg.default || pg).Pool };
}
const { EmbeddedPostgres, Pool } = await load();

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-conc-'));
const PORT = 55000 + Math.floor(Math.random() * 900);
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'local-test-only', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });

let pass = 0, fail = 0; const out = [];
const check = (name, cond, detail = '') => { if (cond) { pass++; out.push(`PASS  ${name}`); } else { fail++; out.push(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); } };

const U = { emp: '33333333-3333-3333-3333-333333333333', admin: '11111111-1111-1111-1111-111111111111' };
const E = { emp: 'e3333333-3333-3333-3333-333333333333', admin: 'e1111111-1111-1111-1111-111111111111' };
const ATT = 'a0000000-0000-0000-0000-000000000001';
const KDATE = `((now() AT TIME ZONE 'Asia/Kolkata')::date)`;

try {
  await server.initialise();
  await server.start();
  const admin = new Pool({ host: 'localhost', port: PORT, user: 'postgres', password: 'local-test-only', database: 'postgres', max: 2 });
  await admin.query('CREATE DATABASE abconc');
  await admin.end();
  const pool = new Pool({ host: 'localhost', port: PORT, user: 'postgres', password: 'local-test-only', database: 'abconc', max: 30 });

  // ---- build: Supabase stand-ins + every repo migration (incl. the automatic-break one) + seed
  await pool.query(fs.readFileSync(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql'), 'utf8'));
  for (const f of fs.readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    let sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed');
    try { await pool.query(sql); } catch (e) { throw new Error(`migration ${f}: ${e.message}`); }
  }
  await pool.query(`
    INSERT INTO auth.users (id, email) VALUES ('${U.emp}', 'conc-emp@example.com'), ('${U.admin}', 'conc-admin@example.com');
    INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status)
      VALUES ('${E.admin}', 'C-A', 'Con', 'Admin', 'conc-admin@example.com', '2026-01-01', (SELECT id FROM roles WHERE name = 'ADMIN'), 'ACTIVE');
    INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES ('${U.admin}', '${E.admin}', (SELECT id FROM roles WHERE name = 'ADMIN'), true);
    INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status)
      VALUES ('${E.emp}', 'C-1', 'Con', 'Current', 'conc-emp@example.com', '2026-01-01', (SELECT id FROM roles WHERE name = 'EMPLOYEE'), 'ACTIVE');
    INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES ('${U.emp}', '${E.emp}', (SELECT id FROM roles WHERE name = 'EMPLOYEE'), true);
    INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes)
      VALUES ('5a000000-0000-0000-0000-0000000000d1', 'C Day', 'C-DAY', 'GENERAL', '00:00', '23:59', false, 8, 60);`);

  const reset = async (minsAgo = 60) => {
    await pool.query(`DELETE FROM notifications; DELETE FROM attendance_events; DELETE FROM attendance_breaks; DELETE FROM employee_tracking_state;
                      DELETE FROM employee_live_locations; DELETE FROM attendance;`);
    await pool.query(`INSERT INTO attendance (id, employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status)
                      VALUES ('${ATT}', '${E.emp}', '5a000000-0000-0000-0000-0000000000d1', ${KDATE}, now() - make_interval(mins => ${minsAgo}), 8, 'WORKING')`);
  };
  // n connections prepare their transaction, then all fire at once (barrier), then commit
  async function race(calls) {
    const clients = await Promise.all(calls.map(() => pool.connect()));
    try {
      await Promise.all(clients.map(async (c, i) => {
        await c.query('BEGIN');
        if (calls[i].as === 'service') { await c.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`); await c.query('SET LOCAL ROLE service_role'); }
        else { await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: calls[i].as === 'admin' ? U.admin : U.emp, role: 'authenticated' })]); await c.query('SET LOCAL ROLE authenticated'); }
      }));
      const results = await Promise.all(clients.map(async (c, i) => {
        try { const r = await c.query(calls[i].sql); await c.query('COMMIT'); return { ok: true, rows: r.rows }; }
        catch (e) { await c.query('ROLLBACK').catch(() => {}); return { ok: false, error: e.message, code: e.code }; }
      }));
      return results;
    } finally { clients.forEach((c) => c.release()); }
  }
  const q = async (sql) => (await pool.query(sql)).rows;
  const openCount = async () => (await q(`SELECT count(*)::int c FROM attendance_breaks WHERE attendance_id='${ATT}' AND ended_at IS NULL AND break_type <> 'CANCELLED'`))[0].c;
  const allCount = async () => (await q(`SELECT count(*)::int c FROM attendance_breaks WHERE attendance_id='${ATT}'`))[0].c;
  const action = (r) => r.ok ? r.rows[0]?.r?.action : `ERR:${r.code}`;
  const tally = (rs) => rs.reduce((m, r) => { const k = action(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  const deadlocks = (rs) => rs.filter((r) => !r.ok && r.code === '40P01').length;

  // C1 — 12 simultaneous "permission denied" reports from the same employee
  await reset();
  let rs = await race(Array.from({ length: 12 }, () => ({ sql: `SELECT public.report_tracking_event('LOCATION_DENIED') AS r` })));
  check('C1 12 simultaneous reports → exactly one break, one STARTED, no errors / deadlocks',
    (await openCount()) === 1 && tally(rs).STARTED === 1 && rs.every((r) => r.ok) && deadlocks(rs) === 0, JSON.stringify(tally(rs)));
  const n1 = (await q(`SELECT count(*)::int c FROM notifications WHERE recipient_employee_id='${E.emp}'`))[0].c;
  check('C1b exactly one notification', n1 === 1, `notifications=${n1}`);

  // C2 — 8 simultaneous geofence START requests (stored location outside)
  await reset();
  await pool.query(`INSERT INTO employee_live_locations (employee_id, latitude, longitude, location_status, location_context, last_seen_at, source) VALUES ('${E.emp}', 1, 1, 'OUTSIDE_GEOFENCE', 'OFFICE', now() - interval '20 minutes', 'WEB')`);
  rs = await race(Array.from({ length: 8 }, () => ({ sql: `SELECT public.geofence_auto_break('START') AS r` })));
  check('C2 8 simultaneous geofence STARTs → exactly one AUTO_GPS break', (await openCount()) === 1 && tally(rs).STARTED === 1 && rs.every((r) => r.ok), JSON.stringify(tally(rs)));

  // C3 — 6 overlapping scheduler runs while the employee is stale
  await reset(40);
  rs = await race(Array.from({ length: 6 }, () => ({ as: 'service', sql: `SELECT public.process_stale_tracking() AS r` })));
  const started = rs.filter((r) => r.ok).reduce((t, r) => t + (r.rows[0].r.started || 0), 0);
  check('C3 6 overlapping scheduler runs → one stale break in total, no errors', (await openCount()) === 1 && started === 1 && rs.every((r) => r.ok), JSON.stringify(rs.map((r) => r.ok ? r.rows[0].r.started : r.error)));

  // C4 — mixed race: device report, scheduler, geofence and a manual break insert at the same moment.
  // Timing-dependent (lock order), so it is repeated; every round must give one open break and no deadlock.
  const c4 = [];
  for (let round = 0; round < 10; round++) {
    await reset(40);
    await pool.query(`INSERT INTO employee_live_locations (employee_id, latitude, longitude, location_status, location_context, last_seen_at, source) VALUES ('${E.emp}', 1, 1, 'OUTSIDE_GEOFENCE', 'OFFICE', now() - interval '20 minutes', 'WEB')`);
    const order = [
      { sql: `SELECT public.report_tracking_event('LOCATION_UNAVAILABLE') AS r` },
      { as: 'service', sql: `SELECT public.process_stale_tracking() AS r` },
      { sql: `SELECT public.geofence_auto_break('START') AS r` },
      { sql: `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at) VALUES ('${ATT}', '${E.emp}', 'REGULAR', now()) RETURNING id` },
      { sql: `SELECT public.report_tracking_event('LOCATION_DENIED') AS r` },
    ];
    if (round % 2) order.reverse();
    rs = await race(order);
    c4.push({ open: await openCount(), all: await allCount(), dead: deadlocks(rs), bad: rs.filter((r) => !r.ok && r.code !== '23505').map((r) => r.code) });
  }
  check('C4 mixed simultaneous starters (device, scheduler, geofence, manual), 10 rounds → always exactly one break, no deadlock',
    c4.every((x) => x.open === 1 && x.all === 1 && x.dead === 0 && x.bad.length === 0), JSON.stringify(c4.filter((x) => !(x.open === 1 && x.all === 1 && x.dead === 0 && x.bad.length === 0))));

  // C8 — admin "End Break", a fresh location and the scheduler hit the same tracking break at once (10 rounds)
  const c8 = [];
  for (let round = 0; round < 10; round++) {
    await reset();
    await race([{ sql: `SELECT public.report_tracking_event('LOCATION_DENIED') AS r` }]);
    await pool.query(`INSERT INTO employee_live_locations (employee_id, latitude, longitude, location_status, location_context, last_seen_at, source) VALUES ('${E.emp}', 1, 1, 'INSIDE_GEOFENCE', 'OFFICE', now() - interval '30 minutes', 'WEB')`);
    const order = [
      { as: 'admin', sql: `UPDATE attendance_breaks SET ended_at = now(), duration_minutes = 0, ended_reason = 'ADMIN' WHERE attendance_id = '${ATT}' AND ended_at IS NULL RETURNING id` },
      { sql: `UPDATE employee_live_locations SET last_seen_at = now(), latitude = 1.0002 WHERE employee_id = '${E.emp}' RETURNING id` },
      { as: 'service', sql: `SELECT public.process_stale_tracking() AS r` },
    ];
    if (round % 2) order.reverse();
    rs = await race(order);
    const endsN = (await q(`SELECT count(*)::int c FROM attendance_breaks WHERE attendance_id='${ATT}' AND ended_at IS NOT NULL`))[0].c;
    c8.push({ open: await openCount(), ended: endsN, dead: deadlocks(rs), bad: rs.filter((r) => !r.ok).map((r) => r.code + ':' + r.error) });
  }
  check('C8 admin End Break vs fresh location vs scheduler on the same break, 10 rounds → ended once, no deadlock, every write succeeded',
    c8.every((x) => x.open === 0 && x.ended === 1 && x.dead === 0 && x.bad.length === 0), JSON.stringify(c8.filter((x) => !(x.open === 0 && x.ended === 1 && x.dead === 0 && x.bad.length === 0))));

  // C5 — clock-out close and a fresh location arrive together: the break is ended exactly once
  await reset();
  await race([{ sql: `SELECT public.report_tracking_event('LOCATION_DENIED') AS r` }]);
  await pool.query(`INSERT INTO employee_live_locations (employee_id, latitude, longitude, location_status, location_context, last_seen_at, source) VALUES ('${E.emp}', 1, 1, 'INSIDE_GEOFENCE', 'OFFICE', now() - interval '30 minutes', 'WEB')`);
  rs = await race([
    { sql: `SELECT public.close_auto_break_for_clock_out('${ATT}') AS r` },
    { sql: `UPDATE employee_live_locations SET last_seen_at = now(), latitude = 1.0001 WHERE employee_id = '${E.emp}' RETURNING id` },
    { sql: `SELECT public.close_auto_break_for_clock_out('${ATT}') AS r` },
  ]);
  const ends = (await q(`SELECT count(*)::int c FROM attendance_events WHERE attendance_id='${ATT}' AND event_type='BREAK_END'`))[0].c;
  check('C5 clock-out close vs fresh location vs second close → ended once, one BREAK_END event, no errors',
    (await openCount()) === 0 && ends === 1 && rs.every((r) => r.ok) && deadlocks(rs) === 0, JSON.stringify({ ends, rs: rs.map((r) => (r.ok ? (r.rows[0]?.r?.action ?? 'UPDATED') : r.error)) }));

  // C6 — 10 simultaneous fresh locations while a tracking break is open
  await reset();
  await race([{ sql: `SELECT public.report_tracking_event('LOCATION_DENIED') AS r` }]);
  await pool.query(`INSERT INTO employee_live_locations (employee_id, latitude, longitude, location_status, location_context, last_seen_at, source) VALUES ('${E.emp}', 1, 1, 'INSIDE_GEOFENCE', 'OFFICE', now() - interval '30 minutes', 'WEB')`);
  rs = await race(Array.from({ length: 10 }, (_, i) => ({ sql: `UPDATE employee_live_locations SET last_seen_at = now(), latitude = ${1 + i / 10000} WHERE employee_id = '${E.emp}' RETURNING id` })));
  const ends6 = (await q(`SELECT count(*)::int c FROM attendance_events WHERE attendance_id='${ATT}' AND event_type='BREAK_END'`))[0].c;
  const notes6 = (await q(`SELECT count(*)::int c FROM notifications WHERE recipient_employee_id='${E.emp}' AND title = 'Automatic Break Ended'`))[0].c;
  check('C6 10 simultaneous fresh locations → break ended once, one end notification, every location write succeeded',
    (await openCount()) === 0 && ends6 === 1 && notes6 === 1 && rs.every((r) => r.ok), JSON.stringify({ ends6, notes6, errors: rs.filter((r) => !r.ok).map((r) => r.error) }));

  // C7 — totals after concurrent activity equal the break rows (counted once)
  const tot = (await q(`SELECT a.break_minutes, (SELECT COALESCE(sum(duration_minutes),0)::int FROM attendance_breaks b WHERE b.attendance_id=a.id AND b.ended_at IS NOT NULL AND b.break_type<>'CANCELLED') AS rows_sum FROM attendance a WHERE a.id='${ATT}'`))[0];
  check('C7 stored break_minutes equals the sum of the break rows after the races', tot.break_minutes === tot.rows_sum, JSON.stringify(tot));

  await pool.end();
} catch (e) {
  fail++; out.push(`FAIL  harness: ${e.message}`);
} finally {
  await server.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(out.join('\n'));
console.log(`\nRESULT: ${pass} passed, ${fail} failed (real PostgreSQL, ${PORT})`);
process.exit(fail === 0 ? 0 : 1);
