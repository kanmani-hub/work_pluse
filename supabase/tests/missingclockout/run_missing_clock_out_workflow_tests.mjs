#!/usr/bin/env node
/**
 * Database tests: auto clock-out, missing clock-out settings and the missing clock-out correction /
 * deduction workflow, as they behave once everything is applied in the documented order:
 *   all supabase/migrations  →  docs/proposals/PROPOSED_overtime_requests.sql
 *                            →  docs/proposals/PROPOSED_missing_clock_out_workflow.sql
 * THROWAWAY in-memory PostgreSQL (PGlite); synthetic employees only; never connects to Supabase.
 * The scheduler is simulated by calling process_auto_clock_out() as postgres (pg_cron is not available).
 *
 * Run:  npm i --no-save @electric-sql/pglite && node supabase/tests/missingclockout/run_missing_clock_out_workflow_tests.mjs
 *   or  PGLITE_DIR=/path/to/node_modules node supabase/tests/missingclockout/run_missing_clock_out_workflow_tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const OT_PROPOSAL = path.join(ROOT, 'docs/proposals/PROPOSED_overtime_requests.sql');
const MCO_PROPOSAL = path.join(ROOT, 'docs/proposals/PROPOSED_missing_clock_out_workflow.sql');
const HARDENING = '20261028090200_auto_clock_out_and_settings_hardening.sql';

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
const read = (p) => fs.readFileSync(p, 'utf8');
const ALL = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
if (!ALL.includes(HARDENING)) { console.error(`missing ${HARDENING}`); process.exit(2); }
const migrationSql = (f) => {
  let sql = read(path.join(MIG_DIR, f));
  if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed by test');
  return sql;
};
// The proposals' read-only "STEP 0" / "PART 0" checks are plain SELECTs: harmless to run.

const U = { admin: '11111111-1111-1111-1111-111111111111', hr: '22222222-2222-2222-2222-222222222222', emp: '33333333-3333-3333-3333-333333333333', emp2: '55555555-5555-5555-5555-555555555555' };
const E = { admin: 'e1111111-1111-1111-1111-111111111111', hr: 'e2222222-2222-2222-2222-222222222222', emp: 'e3333333-3333-3333-3333-333333333333', emp2: 'e5555555-5555-5555-5555-555555555555' };
const S = { day: '5a000000-0000-0000-0000-0000000000a1', night: '5a000000-0000-0000-0000-0000000000a2', recent: '5a000000-0000-0000-0000-0000000000a3' };
const KDATE = `((now() AT TIME ZONE 'Asia/Kolkata')::date)`;
const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

async function newDb({ proposals = true } = {}) {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(read(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql')));
  for (const f of ALL) {
    try { await db.exec(migrationSql(f)); } catch (e) { throw new Error(`migration ${f} failed: ${e.message}`); }
  }
  if (proposals) {
    for (const p of [OT_PROPOSAL, MCO_PROPOSAL]) {
      try { await db.exec(read(p)); } catch (e) { throw new Error(`${path.basename(p)} failed: ${e.message}`); }
    }
  }
  await db.exec(`
    SET session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${U.admin}','mco-admin@example.com'),('${U.hr}','mco-hr@example.com'),('${U.emp}','mco-emp@example.com'),('${U.emp2}','mco-emp2@example.com');
    SET session_replication_role = origin;
    INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status) VALUES
      ('${E.admin}','MCO-A','Ada','Admin','mco-admin@example.com','2026-01-01',(SELECT id FROM roles WHERE name='ADMIN'),'ACTIVE'),
      ('${E.hr}','MCO-H','Hana','HR','mco-hr@example.com','2026-01-01',(SELECT id FROM roles WHERE name='HR'),'ACTIVE'),
      ('${E.emp}','MCO-1','Eli','Emp','mco-emp@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE'),
      ('${E.emp2}','MCO-2','Nia','Night','mco-emp2@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE');
    INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES
      ('${U.admin}','${E.admin}',(SELECT id FROM roles WHERE name='ADMIN'),true),
      ('${U.hr}','${E.hr}',(SELECT id FROM roles WHERE name='HR'),true),
      ('${U.emp}','${E.emp}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true),
      ('${U.emp2}','${E.emp2}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true);
    INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes) VALUES
      ('${S.day}','MCO Day','MCO-DAY','GENERAL','09:00','18:00',false,8,60),
      ('${S.night}','MCO Night','MCO-NGT','NIGHT','20:00','04:00',true,8,30);
    INSERT INTO app_settings (id, settings) VALUES ('${SETTINGS_ID}', '{"app":{},"payroll":{}}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
  `);
  return db;
}
const sys = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const one = async (db, sql, params = []) => (await sys(db, sql, params))[0];
async function as(db, who, sql) {
  await db.exec('BEGIN');
  try {
    if (who === 'service') { await db.query(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',true)`); await db.exec('SET LOCAL ROLE service_role'); }
    else { await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U[who], role: 'authenticated' })]); await db.exec('SET LOCAL ROLE authenticated'); }
    const r = await db.query(sql); await db.exec('COMMIT');
    return { rows: r.rows, n: r.affectedRows ?? r.rows.length, error: null };
  } catch (e) { await db.exec('ROLLBACK'); return { rows: [], n: 0, error: e.message }; }
}
const run = async (db) => (await one(db, `SELECT public.process_auto_clock_out() AS n`)).n;
const patch = (db, section, obj) => sys(db, `UPDATE app_settings SET settings = jsonb_set(COALESCE(settings,'{}'), '{${section}}', COALESCE(settings->'${section}','{}') || $1::jsonb) WHERE id='${SETTINGS_ID}'`, [JSON.stringify(obj)]);
// raw write that bypasses the validation trigger (as a value written before the trigger existed / via SQL)
const rawPatch = async (db, section, obj) => { await db.exec('SET session_replication_role = replica'); try { await patch(db, section, obj); } finally { await db.exec('SET session_replication_role = origin'); } };
const cfg = (db) => one(db, `SELECT * FROM public.mco_settings()`);
async function att(db, { id, daysAgo, shift = S.day, out = false, emp = E.emp }) {
  const start = shift === S.night ? '20:00' : '09:00';
  await sys(db, `INSERT INTO attendance (id, employee_id, shift_template_id, attendance_date, clock_in_at, clock_out_at, required_hours, status)
                 VALUES ($1, $2, $3, ${KDATE} - $4::int, ((${KDATE} - $4::int) + time '${start}') AT TIME ZONE 'Asia/Kolkata',
                         ${out ? `((${KDATE} - $4::int) + time '17:30') AT TIME ZONE 'Asia/Kolkata'` : 'NULL'}, 8, $5)`,
    [id, emp, shift, daysAgo, out ? 'COMPLETED' : 'WORKING']);
}
const at = (daysAgo, hhmm) => `(((${KDATE} - ${daysAgo}) + time '${hhmm}') AT TIME ZONE 'Asia/Kolkata')`;
const submit = (db, who, attId, outExpr, hours, reason = 'Finished the release checklist with the team') =>
  as(db, who, `SELECT public.submit_missing_clock_out_request('${attId}', ${outExpr}, ${hours}, '${reason}') AS id`);
const review = (db, who, reqId, decision, outExpr, hours, remarks) =>
  as(db, who, `SELECT public.review_missing_clock_out_request('${reqId}', '${decision}', ${outExpr ?? 'NULL'}, ${hours ?? 'NULL'}, ${remarks ? `'${remarks}'` : 'NULL'}) AS r`);
const adjs = (db, attId) => sys(db, `SELECT reference, kind, status, amount::numeric AS amount FROM payroll_adjustments WHERE attendance_id=$1 ORDER BY created_at`, [attId]);

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); } };
const t0 = Date.now();
const id = (n) => `ad000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// ================================================================================== settings
console.log('\n== missing clock-out / auto clock-out settings (mco_settings, validation on save)');
{
  const db = await newDb();
  let c = await cfg(db);
  check('SET-1 nothing saved → limit 3 h, deduction off, ₹0, grace 4 h', Number(c.limit_hours) === 3 && c.deduction_enabled === false && Number(c.deduction_amount) === 0 && Number(c.grace_hours) === 4, JSON.stringify(c));
  await patch(db, 'payroll', { missingClockOutMaxAdditionalHours: 1.5, enableMissingClockOutDeduction: true, missingClockOutDeductionAmount: 200 });
  await patch(db, 'app', { autoClockOutGraceHours: 2 });
  c = await cfg(db);
  check('SET-2 saved values are the ones the database uses (1.5 h, on, ₹200, grace 2 h)', Number(c.limit_hours) === 1.5 && c.deduction_enabled === true && Number(c.deduction_amount) === 200 && Number(c.grace_hours) === 2, JSON.stringify(c));
  await patch(db, 'app', { autoClockOutMode: 'at_shift_end' });
  c = await cfg(db);
  check('SET-3 mode "at shift end" → grace 0 for the job AND the correction (was 4 h for the correction)', Number(c.grace_hours) === 0, JSON.stringify(c));
  await patch(db, 'app', { autoClockOutMode: 'after_grace_period' });
  await rawPatch(db, 'payroll', { missingClockOutMaxAdditionalHours: 'three', missingClockOutDeductionAmount: 'abc', enableMissingClockOutDeduction: 'maybe' });
  await rawPatch(db, 'app', { autoClockOutGraceHours: 'four' });
  let err = null; try { c = await cfg(db); } catch (e) { err = e.message; }
  check('SET-4 unreadable saved values (written before validation existed) → documented defaults, no error', !err && Number(c.limit_hours) === 3 && c.deduction_enabled === false && Number(c.deduction_amount) === 0 && Number(c.grace_hours) === 4, err || JSON.stringify(c));
  await rawPatch(db, 'payroll', { missingClockOutMaxAdditionalHours: 30, missingClockOutDeductionAmount: -5, enableMissingClockOutDeduction: true });
  await rawPatch(db, 'app', { autoClockOutGraceHours: -2 });
  c = await cfg(db);
  check('SET-5 out-of-range values → limit 3 (0–24 only), negative amount → ₹0 and deduction off, negative grace → 0', Number(c.limit_hours) === 3 && Number(c.deduction_amount) === 0 && c.deduction_enabled === false && Number(c.grace_hours) === 0, JSON.stringify(c));
  await rawPatch(db, 'payroll', { missingClockOutMaxAdditionalHours: 3, missingClockOutDeductionAmount: 0, enableMissingClockOutDeduction: true });
  c = await cfg(db);
  check('SET-6 deduction "on" with ₹0 → treated as off (nothing could be deducted)', c.deduction_enabled === false, JSON.stringify(c));
  await rawPatch(db, 'payroll', { missingClockOutDeductionAmount: 0, enableMissingClockOutDeduction: false });
  await rawPatch(db, 'app', { autoClockOutGraceHours: 4 });

  const tryPatch = async (section, obj) => { await db.exec('SAVEPOINT s'); try { await patch(db, section, obj); await db.exec('RELEASE SAVEPOINT s'); return null; } catch (e) { await db.exec('ROLLBACK TO SAVEPOINT s'); return e.message; } };
  const cases = [
    ['payroll', { missingClockOutMaxAdditionalHours: 25 }, /from 0 to 24/],
    ['payroll', { missingClockOutMaxAdditionalHours: -1 }, /from 0 to 24/],
    ['payroll', { missingClockOutMaxAdditionalHours: 'abc' }, /from 0 to 24/],
    ['payroll', { missingClockOutDeductionAmount: -1 }, /₹0 or more/],
    ['payroll', { missingClockOutDeductionAmount: 10.555 }, /2 decimals/],
    ['payroll', { enableMissingClockOutDeduction: true, missingClockOutDeductionAmount: 0 }, /above ₹0/],
    ['payroll', { enableMissingClockOutDeduction: 'perhaps' }, /on or off/],
    ['app', { autoClockOutGraceHours: -3 }, /0 or more hours/],
    ['app', { autoClockOutMode: 'sometimes' }, /mode/],
    ['payroll', { enableOvertimePay: true, overtimeRateType: 'multiplier', overtimeMultiplier: 0 }, /multiplier/],
    ['payroll', { enableOvertimePay: true, overtimeRateType: 'fixed', overtimeFixedRate: -10 }, /rate per hour/],
  ];
  const results = [];
  for (const [sec, obj, re] of cases) { await db.exec('BEGIN'); const e = await tryPatch(sec, obj); await db.exec('ROLLBACK'); results.push({ obj, ok: !!e && re.test(e), e }); }
  check('VAL-1 invalid values are refused on save with a message naming the field (11 cases)', results.every(r => r.ok), JSON.stringify(results.filter(r => !r.ok)));
  await db.exec('BEGIN');
  const okSave = await tryPatch('payroll', { missingClockOutMaxAdditionalHours: 0, enableMissingClockOutDeduction: true, missingClockOutDeductionAmount: 200.5, enableOvertimePay: false, overtimeMultiplier: 0 });
  const okNull = await tryPatch('payroll', { missingClockOutMaxAdditionalHours: null });
  await db.exec('COMMIT');
  check('VAL-2 valid values save (limit 0, ₹200.50; multiplier ignored while overtime pay is off); empty keeps the default', okSave === null && okNull === null && Number((await cfg(db)).limit_hours) === 3, `${okSave} ${okNull}`);
  const empSave = await as(db, 'emp', `UPDATE app_settings SET settings = settings WHERE id='${SETTINGS_ID}'`);
  check('VAL-3 an employee cannot change settings (existing RLS unchanged)', empSave.n === 0 || !!empSave.error, JSON.stringify(empSave));
  await db.close();
}

// ================================================================================== auto clock-out
console.log('\n== auto clock-out job (flag only)');
{
  const db = await newDb();
  await att(db, { id: id(1), daysAgo: 1, out: true });              // normal clock-out
  await att(db, { id: id(2), daysAgo: 2 });                         // no clock-out, deadline passed
  await att(db, { id: id(3), daysAgo: 3, shift: S.night, emp: E.emp2 }); // overnight, deadline passed
  await att(db, { id: id(4), daysAgo: 0, shift: S.night, emp: E.emp2 }); // tonight's night shift: not due
  const outBefore = (await one(db, `SELECT clock_out_at FROM attendance WHERE id=$1`, [id(1)])).clock_out_at;
  const n1 = await run(db);
  const rows = Object.fromEntries((await sys(db, `SELECT id, status, clock_out_at, worked_hours FROM attendance`)).map(r => [r.id, r]));
  check('ACO-1 normal clock-out: not flagged, clock-out unchanged', rows[id(1)].status === 'COMPLETED' && String(rows[id(1)].clock_out_at) === String(outBefore));
  check('ACO-2 no clock-out after shift end + grace → MISSING_CLOCK_OUT; no clock-out time, no worked hours invented',
    rows[id(2)].status === 'MISSING_CLOCK_OUT' && rows[id(2)].clock_out_at === null && rows[id(2)].worked_hours === null, JSON.stringify(rows[id(2)]));
  const ev = await one(db, `SELECT metadata->>'flag_at' AS flag_at, (${at(2, '04:00')} + interval '4 hours')::text AS expected FROM attendance_events WHERE attendance_id=$1 AND event_type='MISSING_CLOCK_OUT'`, [id(3)]);
  check('ACO-3 overnight shift 20:00–04:00: due at 04:00 the NEXT day + 4 h grace', rows[id(3)].status === 'MISSING_CLOCK_OUT' && ev && new Date(ev.flag_at).getTime() === new Date(ev.expected).getTime(), JSON.stringify(ev));
  check('ACO-4 a shift that has not ended is not flagged', rows[id(4)].status === 'WORKING');
  const n2 = await run(db);
  const counts = await one(db, `SELECT (SELECT count(*)::int FROM attendance_events WHERE event_type='MISSING_CLOCK_OUT') AS ev, (SELECT count(*)::int FROM notifications WHERE title='Clock-out missing') AS notes`);
  check('ACO-5 running twice: 2 flagged, then 0; one event and one notification per day (no duplicates)', n1 === 2 && n2 === 0 && counts.ev === 2 && counts.notes === 2, JSON.stringify({ n1, n2, counts }));
  const log = await sys(db, `SELECT flagged, failed, grace_hours::numeric AS g, finished_at IS NOT NULL AS done FROM auto_clock_out_runs ORDER BY id`);
  check('ACO-6 every run is recorded (flagged / failed / grace) for diagnostics', log.length === 2 && log[0].flagged === 2 && log[1].flagged === 0 && log.every(l => l.done && l.failed === 0 && Number(l.g) === 4), JSON.stringify(log));
  const empLog = await as(db, 'emp', `SELECT count(*)::int AS c FROM auto_clock_out_runs`);
  const hrLog = await as(db, 'hr', `SELECT count(*)::int AS c FROM auto_clock_out_runs`);
  check('ACO-7 the run log is visible to HR / admin only', empLog.rows[0]?.c === 0 && hrLog.rows[0]?.c === 2, JSON.stringify({ empLog, hrLog }));
  const empRun = await as(db, 'emp', `SELECT public.process_auto_clock_out()`);
  check('ACO-8 an employee cannot run the job', !!empRun.error, JSON.stringify(empRun));
  await db.close();
}
{
  const db = await newDb();
  await att(db, { id: id(10), daysAgo: 2 });
  await att(db, { id: id(11), daysAgo: 2, emp: E.emp2 });
  // one row cannot be flagged (simulated failure, e.g. a break that cannot be closed)
  await db.exec(`CREATE FUNCTION t_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
                   IF NEW.id = '${id(10)}' AND NEW.status = 'MISSING_CLOCK_OUT' THEN RAISE EXCEPTION 'simulated failure'; END IF; RETURN NEW; END $$;
                 CREATE TRIGGER t_fail BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION t_fail();`);
  let err = null, n = null; try { n = await run(db); } catch (e) { err = e.message; }
  const st = Object.fromEntries((await sys(db, `SELECT id, status FROM attendance`)).map(r => [r.id, r.status]));
  const log = await one(db, `SELECT flagged, failed, errors FROM auto_clock_out_runs ORDER BY id DESC LIMIT 1`);
  check('ACO-9 one failing row does not stop the run: the other day is flagged, the failure is recorded with its attendance id',
    !err && n === 1 && st[id(11)] === 'MISSING_CLOCK_OUT' && st[id(10)] === 'WORKING' && log.failed === 1 && log.errors[0].attendance_id === id(10) && /simulated/.test(log.errors[0].error),
    err || JSON.stringify({ n, st, log }));
  await db.exec(`DROP TRIGGER t_fail ON attendance`);
  const n2 = await run(db);
  check('ACO-10 the failed row is retried by the next run (flagged once, one event)', n2 === 1 && (await one(db, `SELECT count(*)::int c FROM attendance_events WHERE attendance_id=$1`, [id(10)])).c === 1);
  await att(db, { id: id(12), daysAgo: 2, emp: E.admin });
  await patch(db, 'app', { autoClockOut: false });
  const off = await run(db);
  check('ACO-11 auto clock-out switched off → nothing flagged; the run says why', off === 0 && (await one(db, `SELECT skipped FROM auto_clock_out_runs ORDER BY id DESC LIMIT 1`)).skipped?.includes('switched off'));
  await patch(db, 'app', { autoClockOut: true });
  await rawPatch(db, 'app', { autoClockOutGraceHours: 'four' });
  err = null; try { n = await run(db); } catch (e) { err = e.message; }
  check('ACO-12 an unreadable grace setting no longer breaks every run (was: invalid input syntax for type numeric)', !err && n === 1, err || String(n));
  await db.close();
}

// ================================================================================== correction workflow
console.log('\n== missing clock-out correction: limit, pending, reject / approve, deductions');
{
  const db = await newDb();
  await patch(db, 'payroll', { missingClockOutMaxAdditionalHours: 1, enableMissingClockOutDeduction: true, missingClockOutDeductionAmount: 200 });
  for (const [k, d] of [[20, 2], [21, 3], [22, 4], [23, 5], [24, 6]]) await att(db, { id: id(k), daysAgo: d });
  await run(db);

  // limit 1 h; claimed clock-out 21:00: 12 h worked − 8 h required = 4 h additional → eligible 1 h, excess 3 h kept for review
  let r = await submit(db, 'emp', id(20), at(2, '21:00'), 2);
  check('LIM-1 requesting more than the configured limit (2 h > 1 h) is refused with the limit in the message', !!r.error && /at most 1(\.00)? hours/.test(r.error), JSON.stringify(r));
  r = await submit(db, 'emp', id(20), at(2, '21:00'), 1);
  const req1 = r.rows[0]?.id;
  const row1 = await one(db, `SELECT claimed_additional_hours::numeric AS c, eligible_overtime_hours::numeric AS e, excess_hours::numeric AS x, additional_limit_hours::numeric AS l, status FROM overtime_requests WHERE id=$1`, [req1]);
  check('LIM-2 within the limit: accepted; the 3 h beyond it are stored as excess for the admin (not dropped)', !r.error && Number(row1.c) === 4 && Number(row1.e) === 1 && Number(row1.x) === 3 && Number(row1.l) === 1 && row1.status === 'PENDING', JSON.stringify({ r, row1 }));
  check('PEND-1 a pending correction has no deduction', (await adjs(db, id(20))).length === 0);

  r = await review(db, 'hr', req1, 'REJECTED', null, null, 'No evidence of work after 18:00');
  let a = await adjs(db, id(20));
  check('REJ-1 rejected with the deduction on → exactly one ₹200 deduction, referenced to the case', !r.error && a.length === 1 && a[0].reference === `MCO-DED:${id(20)}` && Number(a[0].amount) === 200 && a[0].status === 'PENDING', JSON.stringify({ r, a }));
  const again = await review(db, 'admin', req1, 'REJECTED', null, null, 'Rejecting again');
  const direct = await as(db, 'admin', `SELECT public.apply_missing_clock_out_deduction('${id(20)}', 'Second attempt') AS r`);
  a = await adjs(db, id(20));
  check('REJ-2 the same case cannot be deducted twice (second rejection refused, direct deduction records nothing new)', !!again.error && direct.rows[0]?.r?.created === false && a.length === 1, JSON.stringify({ again: again.error, direct, a }));
  await patch(db, 'payroll', { missingClockOutDeductionAmount: 500 });
  check('REJ-3 changing the amount later does not rewrite a recorded case (still ₹200)', Number((await adjs(db, id(20)))[0].amount) === 200);

  await patch(db, 'payroll', { enableMissingClockOutDeduction: false });
  r = await submit(db, 'emp', id(21), at(3, '18:30'), 0.5);
  r = await review(db, 'hr', r.rows[0].id, 'REJECTED', null, null, 'Not verified');
  check('REJ-4 rejected with the deduction off → no deduction', !r.error && (await adjs(db, id(21))).length === 0, JSON.stringify(r));
  await patch(db, 'payroll', { enableMissingClockOutDeduction: true, missingClockOutDeductionAmount: 200 });

  // approval: closes the day at the VERIFIED time; overtime only up to the limit
  r = await submit(db, 'emp', id(22), at(4, '19:00'), 1);
  const req3 = r.rows[0].id;
  const over = await review(db, 'hr', req3, 'APPROVED', at(4, '19:00'), 1.5, null);
  r = await review(db, 'hr', req3, 'APPROVED', at(4, '18:45'), 0.75, 'Verified with access logs');
  const day = await one(db, `SELECT status, clock_out_source, worked_hours::numeric AS w, overtime_minutes, (clock_out_at = ${at(4, '18:45')}) AS at_verified FROM attendance WHERE id=$1`, [id(22)]);
  const req3row = await one(db, `SELECT status, approved_overtime_hours::numeric AS h FROM overtime_requests WHERE id=$1`, [req3]);
  check('APP-1 approve: more than requested refused; approved → clock-out = verified time (source CORRECTION), worked hours from it, overtime only as approved hours',
    !!over.error && !r.error && day.at_verified && day.clock_out_source === 'CORRECTION' && day.status === 'COMPLETED' && Number(day.w) === 9.75 && day.overtime_minutes === 0 && Number(req3row.h) === 0.75 && (await adjs(db, id(22))).length === 0,
    JSON.stringify({ over: over.error, r, day, req3row }));

  // a deduction recorded without a correction, then the employee's correction is approved → cancelled
  r = await as(db, 'admin', `SELECT public.apply_missing_clock_out_deduction('${id(23)}', 'No response from the employee') AS r`);
  const before = await adjs(db, id(23));
  r = await submit(db, 'emp', id(23), at(5, '18:00'), 0);
  r = await review(db, 'hr', r.rows[0].id, 'APPROVED', at(5, '18:00'), 0, null);
  a = await adjs(db, id(23));
  check('APP-2 an approved correction cancels an unsettled deduction for the same day (no deduction left in payroll)', before.length === 1 && before[0].status === 'PENDING' && !r.error && a.length === 1 && a[0].status === 'CANCELLED', JSON.stringify({ before, r, a }));

  // deduction already paid out (settled by an approved payroll) → approval reverses it ONCE
  await as(db, 'admin', `SELECT public.apply_missing_clock_out_deduction('${id(24)}', 'No response from the employee') AS r`);
  const ded = await one(db, `SELECT id, work_date FROM payroll_adjustments WHERE reference=$1`, [`MCO-DED:${id(24)}`]);
  const ym = await one(db, `SELECT EXTRACT(YEAR FROM $1::date)::int AS y, EXTRACT(MONTH FROM $1::date)::int AS m`, [ded.work_date]);
  const payrollJson = JSON.stringify({ employee_id: E.emp, payroll_year: ym.y, payroll_month: ym.m, period_start: `${ym.y}-${String(ym.m).padStart(2, '0')}-01`, period_end: `${ym.y}-${String(ym.m).padStart(2, '0')}-28`,
    basic_salary: 26000, gross_salary: 26000, total_allowances: 0, total_deductions: 200, lop_deduction: 0, overtime_amount: 0, net_salary: 25800, remarks: '{}' });
  const items = JSON.stringify([{ item_type: 'EARNING', item_name: 'Gross Salary', amount: 26000 }, { item_type: 'DEDUCTION', item_name: 'Missing Clock-Out Deduction (1 case)', amount: 200 }]);
  const pr = await as(db, 'hr', `SELECT public.replace_payroll_calculation('${payrollJson}'::jsonb, '${items}'::jsonb) AS r`);
  const pid = pr.rows[0]?.r?.id;
  await sys(db, `UPDATE payroll SET status='UNDER_REVIEW' WHERE id=$1`, [pid]);
  const stalePeriod = await as(db, 'admin', `SELECT public.approve_payroll_with_adjustments('${pid}', ARRAY['${ded.id}', '${id(99)}']::uuid[]) AS n`);
  const ap = await as(db, 'admin', `SELECT public.approve_payroll_with_adjustments('${pid}', ARRAY['${ded.id}']::uuid[]) AS n`);
  const settled = await one(db, `SELECT status, settled_payroll_id FROM payroll_adjustments WHERE id=$1`, [ded.id]);
  check('PAY-1 payroll approval settles exactly the included deduction, atomically (a stale list approves nothing)',
    !!stalePeriod.error && !ap.error && settled.status === 'SETTLED' && settled.settled_payroll_id === pid && (await one(db, `SELECT status FROM payroll WHERE id=$1`, [pid])).status === 'APPROVED',
    JSON.stringify({ stale: stalePeriod.error, ap, settled }));
  const editLocked = await as(db, 'hr', `UPDATE payroll SET net_salary = 26000 WHERE id='${pid}'`);
  check('PAY-2 the approved payroll is locked (amount change refused)', !!editLocked.error, JSON.stringify(editLocked));
  r = await submit(db, 'emp', id(24), at(6, '18:00'), 0);
  r = await review(db, 'hr', r.rows[0].id, 'APPROVED', at(6, '18:00'), 0, null);
  a = await adjs(db, id(24));
  check('APP-3 correction approved after the deduction was paid out → one reversal (earning in a later payroll), deduction history kept',
    !r.error && a.length === 2 && a[0].status === 'SETTLED' && a[1].reference === `MCO-REV:${id(24)}` && a[1].kind === 'MISSING_CLOCK_OUT_REVERSAL' && Number(a[1].amount) === 200, JSON.stringify({ r, a }));

  // decision 2026-10-28: HR verifies the attendance after a rejection
  for (const [k, d] of [[25, 7], [26, 8]]) await att(db, { id: id(k), daysAgo: d });
  await run(db);
  r = await submit(db, 'emp', id(25), at(7, '18:30'), 0);
  await review(db, 'hr', r.rows[0].id, 'REJECTED', null, null, 'No evidence');
  const empTry = await as(db, 'emp', `UPDATE attendance SET clock_out_at = ${at(7, '18:00')} WHERE id='${id(25)}'`);
  r = await as(db, 'hr', `UPDATE attendance SET clock_out_at = ${at(7, '18:00')}, status = 'COMPLETED' WHERE id='${id(25)}'`);
  a = await adjs(db, id(25));
  const dedRow = await one(db, `SELECT id FROM payroll_adjustments WHERE reference=$1`, [`MCO-DED:${id(25)}`]);
  const auditC = await one(db, `SELECT count(*)::int c FROM audit_logs WHERE action='MISSING_CLOCK_OUT_DEDUCTION_CANCELLED' AND entity_id=$1`, [dedRow.id]);
  check('HRC-1 rejected, then HR records the verified clock-out before payroll is paid → the ₹200 deduction is cancelled (row and audit kept); the employee cannot do this',
    !!empTry.error && !r.error && a.length === 1 && a[0].status === 'CANCELLED' && auditC.c === 1, JSON.stringify({ emp: empTry.error, r, a, auditC }));
  r = await submit(db, 'emp', id(26), at(8, '18:30'), 0);
  await review(db, 'hr', r.rows[0].id, 'REJECTED', null, null, 'No evidence');
  const ded26 = await one(db, `SELECT id FROM payroll_adjustments WHERE reference=$1`, [`MCO-DED:${id(26)}`]);
  // already part of an approved / paid payroll (settled)
  await sys(db, `UPDATE payroll_adjustments SET status='SETTLED', settled_payroll_id=$2, settled_year=2026, settled_month=9, settled_at=now() WHERE id=$1`, [ded26.id, pid]);
  const payrollBefore = await one(db, `SELECT net_salary::text AS n, status FROM payroll WHERE id=$1`, [pid]);
  r = await as(db, 'hr', `UPDATE attendance SET clock_out_at = ${at(8, '18:00')}, status = 'COMPLETED' WHERE id='${id(26)}'`);
  const r2 = await as(db, 'hr', `UPDATE attendance SET clock_out_at = ${at(8, '18:15')} WHERE id='${id(26)}'`);
  a = await adjs(db, id(26));
  const payrollAfter = await one(db, `SELECT net_salary::text AS n, status FROM payroll WHERE id=$1`, [pid]);
  const auditR = await one(db, `SELECT count(*)::int c FROM audit_logs WHERE action='MISSING_CLOCK_OUT_DEDUCTION_REVERSED'`);
  check('HRC-2 deduction already in an approved / paid payroll → that payroll is unchanged; one reversal (earning) for the next payroll, audited; a later edit adds nothing',
    !r.error && !r2.error && a.length === 2 && a[0].status === 'SETTLED' && a[1].kind === 'MISSING_CLOCK_OUT_REVERSAL' && a[1].status === 'PENDING' && Number(a[1].amount) === 200
      && payrollBefore.n === payrollAfter.n && payrollAfter.status === payrollBefore.status && auditR.c === 1,
    JSON.stringify({ r, r2, a, payrollBefore, payrollAfter, auditR }));

  // security
  const ins = await as(db, 'emp', `INSERT INTO payroll_adjustments (reference, kind, employee_id, work_date, amount, reason) VALUES ('X', 'MISSING_CLOCK_OUT_REVERSAL', '${E.emp}', CURRENT_DATE, 999, 'forged')`);
  const empDed = await as(db, 'emp', `SELECT public.apply_missing_clock_out_deduction('${id(20)}', 'x')`);
  check('SEC-1 employees cannot write adjustments or record deductions', !!ins.error && !!empDed.error, JSON.stringify({ ins: ins.error, empDed: empDed.error }));
  await db.close();
}
{
  // "at shift end" mode: the correction can be submitted as soon as the job can flag the day
  const db = await newDb();
  await sys(db, `INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes)
                 VALUES ($1, 'Ended 1h ago', 'MCO-REC', 'GENERAL', ((now() AT TIME ZONE 'Asia/Kolkata') - interval '10 hours')::time(0),
                         ((now() AT TIME ZONE 'Asia/Kolkata') - interval '1 hour')::time(0),
                         ((now() AT TIME ZONE 'Asia/Kolkata') - interval '10 hours')::date <> ((now() AT TIME ZONE 'Asia/Kolkata') - interval '1 hour')::date, 8, 0)`, [S.recent]);
  await sys(db, `INSERT INTO attendance (id, employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status)
                 VALUES ($1, $2, $3, ((now() AT TIME ZONE 'Asia/Kolkata') - interval '10 hours')::date, now() - interval '10 hours', 8, 'WORKING')`, [id(30), E.emp, S.recent]);
  const early = await submit(db, 'emp', id(30), `now() - interval '30 minutes'`, 0);
  await patch(db, 'app', { autoClockOutMode: 'at_shift_end' });
  const flagged = await run(db);
  const ok = await submit(db, 'emp', id(30), `now() - interval '30 minutes'`, 0);
  check('MODE-1 grace 4 h: correction refused 1 h after shift end ("still in progress"); mode "at shift end": the job flags it and the correction is accepted at once',
    /still in progress/.test(early.error || '') && flagged === 1 && !ok.error, JSON.stringify({ early: early.error, flagged, ok }));
  await db.close();
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(fail ? 1 : 0);
