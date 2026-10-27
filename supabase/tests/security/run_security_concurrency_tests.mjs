#!/usr/bin/env node
/**
 * Concurrency tests on a REAL, THROWAWAY PostgreSQL server (embedded-postgres, temporary data directory,
 * localhost only, deleted afterwards) for:
 *   - request approval (20261022090000_request_approval_guards.sql): two reviewers deciding the same
 *     leave / WFH / permission request at the same moment;
 *   - the missing-clock-out scheduler (20261022100000_fix_auto_clock_out.sql): overlapping runs.
 * Never connects to Supabase, staging or production. Synthetic data only.
 *
 * Run (not project dependencies; install outside package.json):
 *   npm i --no-save embedded-postgres pg && node supabase/tests/security/run_security_concurrency_tests.mjs
 * or: EMBEDDED_PG_DIR=/path/to/node_modules node supabase/tests/security/run_security_concurrency_tests.mjs
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-conc-'));
const PORT = 55000 + Math.floor(Math.random() * 900);
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'local-test-only', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });

let pass = 0, fail = 0; const out = [];
const check = (name, cond, detail = '') => { if (cond) { pass++; out.push(`PASS  ${name}`); } else { fail++; out.push(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); } };

const U = { hr: '22222222-2222-2222-2222-222222222222', hr2: '66666666-6666-6666-6666-666666666666', admin: '11111111-1111-1111-1111-111111111111', emp: '33333333-3333-3333-3333-333333333333' };
const E = { hr: 'e2222222-2222-2222-2222-222222222222', hr2: 'e6666666-6666-6666-6666-666666666666', admin: 'e1111111-1111-1111-1111-111111111111', emp: 'e3333333-3333-3333-3333-333333333333' };
const LT = '1e000000-0000-0000-0000-000000000001';
const KDATE = `((now() AT TIME ZONE 'Asia/Kolkata')::date)`;
const t0 = Date.now();

try {
  await server.initialise();
  await server.start();
  const boot = new Pool({ host: 'localhost', port: PORT, user: 'postgres', password: 'local-test-only', database: 'postgres', max: 2 });
  await boot.query('CREATE DATABASE secconc');
  await boot.end();
  const pool = new Pool({ host: 'localhost', port: PORT, user: 'postgres', password: 'local-test-only', database: 'secconc', max: 30 });

  await pool.query(fs.readFileSync(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql'), 'utf8'));
  for (const f of fs.readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    let sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed');
    try { await pool.query(sql); } catch (e) { throw new Error(`migration ${f}: ${e.message}`); }
  }
  const people = [['admin', 'ADMIN'], ['hr', 'HR'], ['hr2', 'HR'], ['emp', 'EMPLOYEE']];
  await pool.query(`SET session_replication_role = replica; INSERT INTO auth.users (id, email) VALUES ${people.map(([k]) => `('${U[k]}','conc-${k}@example.com')`).join(',')}; SET session_replication_role = origin;`);
  for (const [k, role] of people) {
    await pool.query(`INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status)
                      VALUES ('${E[k]}', 'SC-${k}', 'Sec', '${k}', 'conc-${k}@example.com', '2026-01-01', (SELECT id FROM roles WHERE name='${role}'), 'ACTIVE');
                      INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES ('${U[k]}', '${E[k]}', (SELECT id FROM roles WHERE name='${role}'), true);`);
  }
  await pool.query(`INSERT INTO leave_types (id, name, code) VALUES ('${LT}', 'Casual SC', 'CSC') ON CONFLICT DO NOTHING;
    INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes)
      VALUES ('5a000000-0000-0000-0000-0000000000c1', 'SC Day', 'SC-DAY', 'GENERAL', '09:00', '18:00', false, 8, 60);`);

  async function race(calls) {
    const clients = await Promise.all(calls.map(() => pool.connect()));
    try {
      await Promise.all(clients.map(async (c, i) => {
        await c.query('BEGIN');
        if (calls[i].as === 'postgres') return;
        if (calls[i].as === 'service') { await c.query(`SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true)`); await c.query('SET LOCAL ROLE service_role'); return; }
        await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U[calls[i].as], role: 'authenticated' })]);
        await c.query('SET LOCAL ROLE authenticated');
      }));
      return await Promise.all(clients.map(async (c, i) => {
        try { const r = await c.query(calls[i].sql); await c.query('COMMIT'); return { ok: true, rows: r.rows, n: r.rowCount }; }
        catch (e) { await c.query('ROLLBACK').catch(() => {}); return { ok: false, error: e.message, code: e.code }; }
      }));
    } finally { clients.forEach((c) => c.release()); }
  }
  const q = async (sql) => (await pool.query(sql)).rows;

  // A1 — approve vs reject on the same request by two reviewers, 10 rounds per table, order alternating
  for (const table of ['leave_requests', 'wfh_requests', 'permission_requests']) {
    const rounds = [];
    for (let i = 0; i < 10; i++) {
      const ins = table === 'leave_requests'
        ? `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason) VALUES ('${E.emp}','${LT}', DATE '2026-11-01' + ${i}, DATE '2026-11-01' + ${i}, 1, 'race') RETURNING id`
        : table === 'wfh_requests'
          ? `INSERT INTO wfh_requests (employee_id, request_date, reason) VALUES ('${E.emp}', DATE '2026-12-01' + ${i}, 'race') RETURNING id`
          : `INSERT INTO permission_requests (employee_id, permission_date, start_time, end_time, duration_minutes, reason) VALUES ('${E.emp}', DATE '2026-12-01' + ${i}, '10:00', '11:00', 60, 'race') RETURNING id`;
      const id = (await q(ins))[0].id;
      const calls = [
        { as: 'hr', sql: `UPDATE ${table} SET status='APPROVED' WHERE id='${id}' AND status <> 'APPROVED'` },
        { as: 'hr2', sql: `UPDATE ${table} SET status='REJECTED' WHERE id='${id}' AND status <> 'REJECTED'` },
        { as: 'emp', sql: `UPDATE ${table} SET status='APPROVED' WHERE id='${id}'` },
      ];
      if (i % 2) calls.reverse();
      const rs = await race(calls);
      const row = (await q(`SELECT status, reviewed_by FROM ${table} WHERE id='${id}'`))[0];
      const decided = rs.filter((r) => r.ok && r.n === 1).length;
      const empOk = rs.find((r, k) => calls[k].as === 'emp');
      rounds.push({ status: row.status, reviewer: row.reviewed_by, decided, empBlocked: !empOk.ok, dead: rs.filter((r) => r.code === '40P01').length });
    }
    const good = (r) => ['APPROVED', 'REJECTED'].includes(r.status) && [E.hr, E.hr2].includes(r.reviewer) && r.decided === 1 && r.empBlocked && r.dead === 0
      && (r.status === 'APPROVED' ? r.reviewer === E.hr : r.reviewer === E.hr2);
    check(`A1 [${table}] approve vs reject vs employee self-approval at once, 10 rounds → exactly one reviewer decision, recorded reviewer matches it, employee refused, no deadlock`,
      rounds.every(good), JSON.stringify(rounds.filter((r) => !good(r))));
  }

  // A2 — 8 simultaneous identical approvals (double clicks / several tabs)
  {
    const id = (await q(`INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason) VALUES ('${E.emp}','${LT}','2027-01-04','2027-01-04',1,'dup') RETURNING id`))[0].id;
    const rs = await race(Array.from({ length: 8 }, (_, k) => ({ as: k % 2 ? 'hr' : 'hr2', sql: `UPDATE leave_requests SET status='APPROVED' WHERE id='${id}' AND status <> 'APPROVED'` })));
    const changed = rs.filter((r) => r.ok && r.n === 1).length;
    check('A2 8 simultaneous approvals → the request is approved exactly once, no errors', changed === 1 && rs.every((r) => r.ok), JSON.stringify(rs.map((r) => r.ok ? r.n : r.code)));
  }

  // S1 — overlapping missing-clock-out scheduler runs (pg_cron + service_role fallback) on 20 open days
  {
    for (let d = 2; d < 22; d++) {
      await pool.query(`INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status)
                        VALUES ('${E.emp}', '5a000000-0000-0000-0000-0000000000c1', ${KDATE} - ${d}, ((${KDATE} - ${d}) + time '09:00') AT TIME ZONE 'Asia/Kolkata', 8, 'WORKING')`);
    }
    await pool.query(`INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, source, reason)
                      SELECT id, employee_id, 'AUTO_TRACKING', clock_in_at + interval '6 hours', 'SYSTEM', 'TRACKING_STALE' FROM attendance WHERE attendance_date = ${KDATE} - 2`);
    const rs = await race(Array.from({ length: 6 }, (_, k) => ({ as: k % 2 ? 'service' : 'postgres', sql: `SELECT public.process_auto_clock_out() AS n` })));
    const total = rs.filter((r) => r.ok).reduce((t, r) => t + r.rows[0].n, 0);
    const flagged = (await q(`SELECT count(*)::int c FROM attendance WHERE status='MISSING_CLOCK_OUT'`))[0].c;
    const events = (await q(`SELECT count(*)::int c FROM attendance_events WHERE event_type='MISSING_CLOCK_OUT'`))[0].c;
    const notes = (await q(`SELECT count(*)::int c FROM notifications WHERE title='Clock-out missing'`))[0].c;
    const ends = (await q(`SELECT count(*)::int c FROM attendance_events WHERE event_type='BREAK_END'`))[0].c;
    const open = (await q(`SELECT count(*)::int c FROM attendance_breaks WHERE ended_at IS NULL`))[0].c;
    check('S1 6 overlapping scheduler runs → 20 days flagged once each (20 events, 20 notifications), open break ended once, no errors / deadlocks',
      rs.every((r) => r.ok) && total === 20 && flagged === 20 && events === 20 && notes === 20 && ends === 1 && open === 0,
      JSON.stringify({ results: rs.map((r) => r.ok ? r.rows[0].n : r.code), total, flagged, events, notes, ends, open }));
  }

  await pool.end();
} catch (e) {
  fail++; out.push(`FAIL  setup / run error: ${e.message}`);
} finally {
  await server.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(out.join('\n'));
console.log(`\nRESULT: ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(fail ? 1 : 0);
