#!/usr/bin/env node
/**
 * Concurrency tests on a REAL, THROWAWAY PostgreSQL server (embedded-postgres, temporary data directory,
 * localhost only, deleted afterwards) for:
 *   - 20261028090100_payroll_lock_and_replace.sql: simultaneous (re)calculations of one employee-month,
 *     and a recalculation racing an approval;
 *   - 20261028090000_attendance_server_values.sql: two simultaneous clock-ins (double click / two tabs);
 *   - auto clock-out runs racing payroll recalculation (C3); two reviewers rejecting one correction (C4).
 * Never connects to Supabase, staging or production. Synthetic data only.
 *
 * Run (not project dependencies; install outside package.json):
 *   npm i --no-save embedded-postgres pg && node supabase/tests/payroll/run_payroll_concurrency_tests.mjs
 * or: EMBEDDED_PG_DIR=/path/to/node_modules node supabase/tests/payroll/run_payroll_concurrency_tests.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
for (const f of ['20261028090000_attendance_server_values.sql', '20261028090100_payroll_lock_and_replace.sql']) {
  if (!fs.existsSync(path.join(MIG_DIR, f))) { console.error(`missing migration ${f}`); process.exit(2); }
}

async function load() {
  const dir = process.env.EMBEDDED_PG_DIR;
  const imp = (name, file) => dir ? import(pathToFileURL(path.join(dir, name, file)).href) : import(name);
  const ep = await imp('embedded-postgres', 'dist/index.js');
  const pg = await imp('pg', 'esm/index.mjs').catch(() => imp('pg', 'lib/index.js'));
  return { EmbeddedPostgres: ep.default, Pool: (pg.default || pg).Pool };
}
const { EmbeddedPostgres, Pool } = await load();

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-conc-'));
const PORT = 55000 + Math.floor(Math.random() * 900);
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'local-test-only', port: PORT, persistent: false, onLog: () => {}, onError: () => {} });

let pass = 0, fail = 0; const out = [];
const check = (name, cond, detail = '') => { if (cond) { pass++; out.push(`PASS  ${name}`); } else { fail++; out.push(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); } };

const U = { hr: '22222222-2222-2222-2222-222222222222', admin: '11111111-1111-1111-1111-111111111111', emp: '33333333-3333-3333-3333-333333333333' };
const E = { hr: 'e2222222-2222-2222-2222-222222222222', admin: 'e1111111-1111-1111-1111-111111111111', emp: 'e3333333-3333-3333-3333-333333333333' };
const SHIFT = '5a000000-0000-0000-0000-0000000000d1';
const t0 = Date.now();

const row = (month, lop) => JSON.stringify({
  employee_id: E.emp, payroll_year: 2026, payroll_month: month, period_start: `2026-${String(month).padStart(2, '0')}-01`, period_end: `2026-${String(month).padStart(2, '0')}-28`,
  basic_salary: 26000, gross_salary: 26000, total_allowances: 0, total_deductions: lop, lop_deduction: lop, overtime_amount: 0, net_salary: 26000 - lop, remarks: '{}',
});
const items = (lop) => JSON.stringify([
  { item_type: 'EARNING', item_name: 'Gross Salary', amount: 26000 },
  ...(lop > 0 ? [{ item_type: 'DEDUCTION', item_name: `LOP Deduction (${lop / 1000} day)`, amount: lop }] : []),
]);
const replaceSql = (month, lop) => `SELECT public.replace_payroll_calculation('${row(month, lop)}'::jsonb, '${items(lop)}'::jsonb) AS r`;

try {
  await server.initialise();
  await server.start();
  const boot = new Pool({ host: 'localhost', port: PORT, user: 'postgres', password: 'local-test-only', database: 'postgres', max: 2 });
  await boot.query('CREATE DATABASE payconc');
  await boot.end();
  const pool = new Pool({ host: 'localhost', port: PORT, user: 'postgres', password: 'local-test-only', database: 'payconc', max: 30 });

  await pool.query(fs.readFileSync(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql'), 'utf8'));
  for (const f of fs.readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    let sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed');
    try { await pool.query(sql); } catch (e) { throw new Error(`migration ${f}: ${e.message}`); }
  }
  // the missing clock-out workflow, in its documented order (needed for C4)
  for (const p of ['PROPOSED_overtime_requests.sql', 'PROPOSED_missing_clock_out_workflow.sql']) {
    try { await pool.query(fs.readFileSync(path.join(ROOT, 'docs/proposals', p), 'utf8')); } catch (e) { throw new Error(`${p}: ${e.message}`); }
  }
  const people = [['admin', 'ADMIN'], ['hr', 'HR'], ['emp', 'EMPLOYEE']];
  await pool.query(`SET session_replication_role = replica; INSERT INTO auth.users (id, email) VALUES ${people.map(([k]) => `('${U[k]}','payconc-${k}@example.com')`).join(',')}; SET session_replication_role = origin;`);
  for (const [k, role] of people) {
    await pool.query(`INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status)
                      VALUES ('${E[k]}', 'PC-${k}', 'Pay', '${k}', 'payconc-${k}@example.com', '2026-01-01', (SELECT id FROM roles WHERE name='${role}'), 'ACTIVE');
                      INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES ('${U[k]}', '${E[k]}', (SELECT id FROM roles WHERE name='${role}'), true);`);
  }
  await pool.query(`INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes)
                      VALUES ('${SHIFT}', 'PC Day', 'PC-DAY', 'GENERAL', '00:00', '23:59', false, 8, 60);
                    INSERT INTO shift_assignments (employee_id, shift_template_id, effective_date, assignment_type) VALUES ('${E.emp}', '${SHIFT}', '2026-01-01', 'PERMANENT');`);

  async function race(calls) {
    const clients = await Promise.all(calls.map(() => pool.connect()));
    try {
      await Promise.all(clients.map(async (c, i) => {
        await c.query('BEGIN');
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
  const consistent = async (month) => {
    const p = await q(`SELECT id, status, total_deductions::numeric AS d, net_salary::numeric AS n FROM payroll WHERE employee_id='${E.emp}' AND payroll_year=2026 AND payroll_month=${month}`);
    if (p.length !== 1) return { ok: false, why: `${p.length} payroll rows` };
    const it = await q(`SELECT item_type, amount::numeric AS a FROM payroll_items WHERE payroll_id='${p[0].id}'`);
    const ded = it.filter((i) => i.item_type === 'DEDUCTION').reduce((s, i) => s + Number(i.a), 0);
    const earn = it.filter((i) => i.item_type === 'EARNING').reduce((s, i) => s + Number(i.a), 0);
    return { ok: ded === Number(p[0].d) && earn - ded === Number(p[0].n) && it.filter((i) => i.item_type === 'EARNING').length === 1, p: p[0], ded, earn, items: it.length };
  };

  // C1 — 8 simultaneous first calculations of the same month (bulk generate in two tabs, double clicks)
  {
    const rs = await race(Array.from({ length: 8 }, (_, k) => ({ as: k % 2 ? 'hr' : 'admin', sql: replaceSql(10, (k % 3) * 1000) })));
    const c = await consistent(10);
    check('C1 8 simultaneous first calculations of one month → all succeed, exactly one payroll row, its items match its totals (no duplicate items)',
      rs.every((r) => r.ok) && c.ok, JSON.stringify({ results: rs.map((r) => r.ok ? 'ok' : r.code + ' ' + r.error), c }));
  }

  // C2 — recalculation racing an approval, 10 rounds (alternating order)
  {
    const rounds = [];
    for (let i = 0; i < 10; i++) {
      const month = 11;
      await pool.query(`DELETE FROM payroll_items WHERE payroll_id IN (SELECT id FROM payroll WHERE payroll_month=${month}); DELETE FROM payroll WHERE payroll_month=${month};`);
      await pool.query(replaceSql(month, 2000)); // as postgres: initial payroll, 2 LOP days
      await pool.query(`UPDATE payroll SET status='UNDER_REVIEW' WHERE payroll_month=${month}`);
      const calls = [
        { as: 'hr', sql: replaceSql(month, 0) }, // correction: LOP removed
        { as: 'admin', sql: `UPDATE payroll SET status='APPROVED', approved_at=now() WHERE employee_id='${E.emp}' AND payroll_year=2026 AND payroll_month=${month} AND status='UNDER_REVIEW'` },
      ];
      if (i % 2) calls.reverse();
      const rs = await race(calls);
      const recalc = rs[calls.findIndex((c) => c.as === 'hr')];
      const approve = rs[calls.findIndex((c) => c.as === 'admin')];
      const c = await consistent(month);
      rounds.push({ recalcOk: recalc.ok, recalcErr: recalc.ok ? null : recalc.error, approved: approve.ok && approve.n === 1, status: c.p?.status, d: Number(c.p?.d), consistent: c.ok, dead: rs.filter((r) => r.code === '40P01').length });
    }
    // Either the recalculation landed first (then the approval locked the NEW figures) or the approval did
    // (then the recalculation was refused and the approved figures stayed). Never a mix, never a lost update.
    const good = (r) => r.consistent && r.dead === 0 && r.approved && r.status === 'APPROVED'
      && (r.recalcOk ? r.d === 0 : (r.d === 2000 && /locked/.test(r.recalcErr || '')));
    check('C2 recalculation vs approval at the same moment, 10 rounds → approved figures are exactly one complete calculation; a recalculation after approval is refused; no deadlock',
      rounds.every(good), JSON.stringify(rounds.filter((r) => !good(r))));
  }

  // A1 — two simultaneous clock-ins by the same employee (double click / two tabs)
  {
    const ins = `INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status, late_minutes)
                 VALUES ('${E.emp}', '${SHIFT}', (now() AT TIME ZONE 'Asia/Kolkata')::date, now() - interval '5 hours', 8, 'WORKING', 0)`;
    const rs = await race([{ as: 'emp', sql: ins }, { as: 'emp', sql: ins }, { as: 'emp', sql: ins }]);
    const rows = await q(`SELECT clock_in_at, late_minutes, (SELECT late_minutes FROM public.att_clock_in_values('${E.emp}', a.clock_in_at)) AS expected FROM attendance a WHERE employee_id='${E.emp}'`);
    check('A1 3 simultaneous clock-ins → exactly one attendance row, the others refused by the unique constraint; stored late minutes are the server value',
      rs.filter((r) => r.ok).length === 1 && rs.filter((r) => !r.ok).every((r) => r.code === '23505') && rows.length === 1 && rows[0].late_minutes === rows[0].expected,
      JSON.stringify({ results: rs.map((r) => r.ok ? 'ok' : r.code), rows }));
  }

  // C3 — 4 overlapping auto clock-out runs and 4 payroll recalculations at the same moment
  {
    const emps = [];
    for (let k = 0; k < 6; k++) {
      const eid = `e9000000-0000-0000-0000-00000000000${k}`;
      emps.push(eid);
      await pool.query(`INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status)
                        VALUES ('${eid}', 'PC-C3-${k}', 'Conc', '${k}', 'payconc-c3-${k}@example.com', '2026-01-01', (SELECT id FROM roles WHERE name='EMPLOYEE'), 'ACTIVE');
                        INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status)
                        VALUES ('${eid}', '${SHIFT}', CURRENT_DATE - 3, (CURRENT_DATE - 3) + time '09:00', 8, 'WORKING')`);
    }
    const jobSql = `SELECT public.process_auto_clock_out() AS n`;   // as the scheduler (postgres)
    const clients = await Promise.all(Array.from({ length: 8 }, () => pool.connect()));
    let rs;
    try {
      rs = await Promise.all(clients.map(async (c, k) => {
        try {
          await c.query('BEGIN');
          if (k % 2 === 0) { const r = await c.query(jobSql); await c.query('COMMIT'); return { ok: true, kind: 'job', n: r.rows[0].n }; }
          await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.hr, role: 'authenticated' })]);
          await c.query('SET LOCAL ROLE authenticated');
          await c.query(replaceSql(9, (k % 3) * 1000)); await c.query('COMMIT'); return { ok: true, kind: 'payroll' };
        } catch (e) { await c.query('ROLLBACK').catch(() => {}); return { ok: false, error: e.message, code: e.code }; }
      }));
    } finally { clients.forEach((c) => c.release()); }
    const flaggedRuns = rs.filter((r) => r.kind === 'job').reduce((t, r) => t + r.n, 0);
    const flagged = (await q(`SELECT count(*)::int c FROM attendance WHERE status='MISSING_CLOCK_OUT' AND employee_id = ANY('{${emps.join(',')}}'::uuid[])`))[0].c;
    const events = (await q(`SELECT count(*)::int c FROM attendance_events WHERE event_type='MISSING_CLOCK_OUT' AND employee_id = ANY('{${emps.join(',')}}'::uuid[])`))[0].c;
    const c9 = await consistent(9);
    check('C3 4 auto clock-out runs + 4 payroll recalculations at once → all succeed, each open day flagged exactly once, one consistent payroll, no deadlock',
      rs.every((r) => r.ok) && flaggedRuns === 6 && flagged === 6 && events === 6 && c9.ok, JSON.stringify({ rs: rs.map((r) => r.ok ? r.kind : r.code), flaggedRuns, flagged, events, c9 }));
  }

  // C4 — two reviewers reject the same missing clock-out correction at once (deduction on, ₹200)
  {
    await pool.query(`UPDATE app_settings SET settings = jsonb_set(COALESCE(settings, '{}'), '{payroll}', COALESCE(settings->'payroll', '{}') || '{"enableMissingClockOutDeduction": true, "missingClockOutDeductionAmount": 200}'::jsonb)
                      WHERE id = '00000000-0000-0000-0000-000000000001'`);
    const attId = (await q(`INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status)
                            VALUES ('${E.emp}', '${SHIFT}', CURRENT_DATE - 5, ((CURRENT_DATE - 5) + time '09:00') AT TIME ZONE 'Asia/Kolkata', 8, 'MISSING_CLOCK_OUT') RETURNING id`))[0].id;
    const sub = await race([{ as: 'emp', sql: `SELECT public.submit_missing_clock_out_request('${attId}', ((CURRENT_DATE - 5) + time '23:30') AT TIME ZONE 'Asia/Kolkata', 0, 'Worked late on the quarterly close') AS id` }]);
    const reqId = sub[0].rows?.[0]?.id;
    const rs = await race([
      { as: 'hr', sql: `SELECT public.review_missing_clock_out_request('${reqId}', 'REJECTED', NULL, NULL, 'Not verified (HR)') AS r` },
      { as: 'admin', sql: `SELECT public.review_missing_clock_out_request('${reqId}', 'REJECTED', NULL, NULL, 'Not verified (admin)') AS r` },
    ]);
    const adjs = (await q(`SELECT amount::numeric AS a FROM payroll_adjustments WHERE attendance_id='${attId}'`));
    check('C4 two simultaneous rejections of one correction → one decision, the other refused, exactly one ₹200 deduction',
      !!reqId && rs.filter((r) => r.ok).length === 1 && adjs.length === 1 && Number(adjs[0].a) === 200,
      JSON.stringify({ sub, rs: rs.map((r) => r.ok ? 'ok' : r.error), adjs }));
  }

  await pool.end();
} catch (e) {
  fail++; out.push(`FAIL  setup / run error: ${e.message}`);
} finally {
  await server.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(out.join('\n'));
console.log(`\nRESULT: ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)} s, real PostgreSQL)`);
process.exit(fail ? 1 : 0);
