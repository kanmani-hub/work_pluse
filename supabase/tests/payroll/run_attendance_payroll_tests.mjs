#!/usr/bin/env node
/**
 * Attendance → payroll integrity tests on a THROWAWAY in-memory PostgreSQL (PGlite). Every migration in
 * supabase/migrations is applied to an empty database; synthetic employees only; never connects to Supabase.
 *
 * Covers 20261028090000_attendance_server_values.sql (server-computed clock-in / clock-out values) and
 * 20261028090100_payroll_lock_and_replace.sql (locked payroll, atomic recalculation).
 * Clock rules are tested with FIXED instants through att_clock_in_values / att_clock_out_values; the
 * trigger path (which uses now()) is checked against the same functions at the stored instant.
 *
 * Run:  npm i --no-save @electric-sql/pglite && node supabase/tests/payroll/run_attendance_payroll_tests.mjs
 *   or  PGLITE_DIR=/path/to/node_modules node supabase/tests/payroll/run_attendance_payroll_tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const ATT_MIG = '20261028090000_attendance_server_values.sql';
const PAY_MIG = '20261028090100_payroll_lock_and_replace.sql';

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
for (const f of [ATT_MIG, PAY_MIG]) if (!ALL.includes(f)) { console.error(`missing ${f}`); process.exit(2); }
const migrationSql = (f) => {
  let sql = read(path.join(MIG_DIR, f));
  if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed by test');
  return sql;
};

const U = { admin: '11111111-1111-1111-1111-111111111111', hr: '22222222-2222-2222-2222-222222222222', emp: '33333333-3333-3333-3333-333333333333', emp2: '55555555-5555-5555-5555-555555555555' };
const E = { admin: 'e1111111-1111-1111-1111-111111111111', hr: 'e2222222-2222-2222-2222-222222222222', emp: 'e3333333-3333-3333-3333-333333333333', emp2: 'e5555555-5555-5555-5555-555555555555' };
const S = { day: '5a000000-0000-0000-0000-0000000000b1', night: '5a000000-0000-0000-0000-0000000000b2', now: '5a000000-0000-0000-0000-0000000000b3', other: '5a000000-0000-0000-0000-0000000000b4' };

async function newDb({ skip = [] } = {}) {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(read(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql')));
  for (const f of ALL) {
    if (skip.includes(f)) continue;
    try { await db.exec(migrationSql(f)); } catch (e) { throw new Error(`migration ${f} failed: ${e.message}`); }
  }
  await db.exec(`
    SET session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${U.admin}','pi-admin@example.com'),('${U.hr}','pi-hr@example.com'),('${U.emp}','pi-emp@example.com'),('${U.emp2}','pi-emp2@example.com');
    SET session_replication_role = origin;
    INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status) VALUES
      ('${E.admin}','PI-A','Ada','Admin','pi-admin@example.com','2026-01-01',(SELECT id FROM roles WHERE name='ADMIN'),'ACTIVE'),
      ('${E.hr}','PI-H','Hana','HR','pi-hr@example.com','2026-01-01',(SELECT id FROM roles WHERE name='HR'),'ACTIVE'),
      ('${E.emp}','PI-1','Eli','Emp','pi-emp@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE'),
      ('${E.emp2}','PI-2','Nia','Night','pi-emp2@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE');
    INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES
      ('${U.admin}','${E.admin}',(SELECT id FROM roles WHERE name='ADMIN'),true),
      ('${U.hr}','${E.hr}',(SELECT id FROM roles WHERE name='HR'),true),
      ('${U.emp}','${E.emp}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true),
      ('${U.emp2}','${E.emp2}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true);
    INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes) VALUES
      ('${S.day}','PI Day','PI-DAY','GENERAL','09:00','18:00',false,8,60),
      ('${S.night}','PI Night','PI-NGT','NIGHT','22:00','06:00',true,8,30),
      ('${S.other}','PI Late','PI-LATE','GENERAL','12:00','21:00',false,8,60);
    UPDATE app_settings SET settings = jsonb_set(COALESCE(settings,'{}'), '{app}', COALESCE(settings->'app','{}') || '{"gracePeriodMins": 10}') WHERE id='00000000-0000-0000-0000-000000000001';
  `);
  return db;
}
const sys = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const one = async (db, sql, params = []) => (await sys(db, sql, params))[0];
async function as(db, who, sql) {
  await db.exec('BEGIN');
  try {
    await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: U[who], role: 'authenticated' })]);
    await db.exec('SET LOCAL ROLE authenticated');
    const r = await db.query(sql); await db.exec('COMMIT');
    return { rows: r.rows, n: r.affectedRows ?? r.rows.length, error: null };
  } catch (e) { await db.exec('ROLLBACK'); return { rows: [], n: 0, error: e.message }; }
}
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); } };
const show = (r) => (r.error ? `error: ${r.error}` : `rows: ${r.n}`);
const t0 = Date.now();
const assign = (db, emp, shift, from = '2026-01-01') => sys(db, `INSERT INTO shift_assignments (employee_id, shift_template_id, effective_date, assignment_type) VALUES ($1,$2,$3,'PERMANENT')`, [emp, shift, from]);
const ist = (local) => `'${local}+05:30'::timestamptz`;

// ============================================================================================ baseline
console.log('\n== BASELINE (without the attendance migration): payroll inputs can be forged');
{
  const db = await newDb({ skip: [ATT_MIG, PAY_MIG] });
  await assign(db, E.emp, S.day);
  const r = await as(db, 'emp', `INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status, late_minutes) VALUES ('${E.emp}','${S.day}', CURRENT_DATE, now() - interval '3 hours', 8, 'WORKING', 0)`);
  const u = await as(db, 'emp', `UPDATE attendance SET late_minutes = 0, is_half_day = false, worked_hours = 9, status = 'PRESENT' WHERE employee_id='${E.emp}'`);
  check('BASE-1 employee back-dates clock-in and edits late / half day / worked hours (defect present before the fix)', r.n === 1 && u.n === 1, `${show(r)} / ${show(u)}`);
  await db.close();
}

const db = await newDb();
await assign(db, E.emp, S.day);
await assign(db, E.emp2, S.night);

console.log('\n== clock-in rule with fixed clocks (Asia/Kolkata, grace 10 min)');
{
  const ci = async (emp, local) => one(db, `SELECT attendance_date::text AS attendance_date, late_minutes, required_hours, shift_template_id, roster_assignment_id, shift_assignment_id, error FROM public.att_clock_in_values($1, ${ist(local)})`, [emp]);
  let r = await ci(E.emp, '2026-10-27T09:05:00');
  check('CI-1 09:05 for a 09:00 shift (within grace) → 0 late, date 2026-10-27', r.late_minutes === 0 && String(r.attendance_date).startsWith('2026-10-27') && r.error === null, JSON.stringify(r));
  r = await ci(E.emp, '2026-10-27T09:17:00');
  check('CI-2 09:17 → 17 late minutes (grace not subtracted, existing rule)', r.late_minutes === 17, JSON.stringify(r));
  r = await ci(E.emp, '2026-10-27T08:40:00');
  check('CI-3 early clock-in → 0 late', r.late_minutes === 0, JSON.stringify(r));
  r = await one(db, `SELECT attendance_date::text AS attendance_date, late_minutes, required_hours, shift_template_id, roster_assignment_id, shift_assignment_id, error FROM public.att_clock_in_values($1, '2026-10-27T03:47:00Z'::timestamptz)`, [E.emp]);
  check('CI-4 UTC boundary: 03:47 UTC = 09:17 IST → 17 late, IST date', r.late_minutes === 17 && String(r.attendance_date).startsWith('2026-10-27'), JSON.stringify(r));
  r = await one(db, `SELECT attendance_date::text AS attendance_date, late_minutes, required_hours, shift_template_id, roster_assignment_id, shift_assignment_id, error FROM public.att_clock_in_values($1, '2026-10-27T19:00:00Z'::timestamptz)`, [E.emp]);
  check('CI-5 UTC evening 19:00 = 00:30 IST next day → attendance date 2026-10-28', String(r.attendance_date).startsWith('2026-10-28'), JSON.stringify(r));
  r = await ci(E.emp2, '2026-10-28T00:30:00');
  check('CI-6 overnight 22:00–06:00, clock-in 00:30 → yesterday\'s shift, 150 late', String(r.attendance_date).startsWith('2026-10-27') && r.late_minutes === 150, JSON.stringify(r));
  r = await ci(E.emp2, '2026-10-27T22:05:00');
  check('CI-7 overnight shift, 22:05 → same date, within grace', String(r.attendance_date).startsWith('2026-10-27') && r.late_minutes === 0, JSON.stringify(r));
  r = await ci(E.admin, '2026-10-27T09:00:00');
  check('CI-8 no shift assigned → refused with a clear message', r.error === 'No shift assigned for today.', JSON.stringify(r));
  // roster: published WORK entry overrides the permanent shift; WEEK_OFF refuses
  const ro = (await one(db, `INSERT INTO rosters (name, start_date, end_date, status) VALUES ('R', '2026-10-01', '2026-10-31', 'PUBLISHED') RETURNING id`)).id;
  await sys(db, `INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date, day_type) VALUES ($1,$2,$3,'2026-10-29','WORK'), ($1,$2,NULL,'2026-10-30','WEEK_OFF')`, [ro, E.emp, S.other]);
  r = await ci(E.emp, '2026-10-29T12:20:00');
  check('CI-9 published roster shift (12:00) overrides the permanent 09:00 shift → 20 late', r.shift_template_id === S.other && r.late_minutes === 20, JSON.stringify(r));
  r = await ci(E.emp, '2026-10-30T09:00:00');
  check('CI-10 roster week off → refused', /Week Off/.test(r.error || ''), JSON.stringify(r));
  const draft = (await one(db, `INSERT INTO rosters (name, start_date, end_date, status) VALUES ('D', '2026-10-01', '2026-10-31', 'DRAFT') RETURNING id`)).id;
  await sys(db, `INSERT INTO roster_assignments (roster_id, employee_id, shift_template_id, assignment_date) VALUES ($1,$2,$3,'2026-10-26')`, [draft, E.emp, S.other]);
  r = await ci(E.emp, '2026-10-26T09:30:00');
  check('CI-11 a DRAFT roster is ignored (permanent shift applies)', r.shift_template_id === S.day && r.late_minutes === 30, JSON.stringify(r));
}

console.log('\n== clock-out rule with fixed clocks');
{
  const att = (await one(db, `INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status) VALUES ($1,$2,'2026-10-20', ${ist('2026-10-20T09:00:00')}, 8, 'WORKING') RETURNING id`, [E.emp, S.day])).id;
  await sys(db, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, ended_at, duration_minutes) VALUES ($1,$2,'REGULAR', ${ist('2026-10-20T13:00:00')}, ${ist('2026-10-20T14:00:00')}, 60),
                ($1,$2,'CANCELLED', ${ist('2026-10-20T15:00:00')}, ${ist('2026-10-20T15:30:00')}, 30)`, [att, E.emp]);
  let r = await one(db, `SELECT * FROM public.att_clock_out_values($1, ${ist('2026-10-20T18:00:00')})`, [att]);
  check('CO-1 09:00–18:00 with a 60-min break (cancelled break ignored) → 8h worked, COMPLETED, 0 early', Number(r.worked_hours) === 8 && r.worked_minutes === 480 && r.early_logout_minutes === 0 && r.status === 'COMPLETED' && r.break_minutes === 60, JSON.stringify(r));
  r = await one(db, `SELECT * FROM public.att_clock_out_values($1, ${ist('2026-10-20T14:30:00')})`, [att]);
  check('CO-2 out at 14:30 → 4.5h, not a half day (≥ 4h), 210 early', r.worked_minutes === 270 && r.early_logout_minutes === 210 && r.status === 'COMPLETED' && r.is_half_day === false, JSON.stringify(r));
  const att3 = (await one(db, `INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status) VALUES ($1,$2,'2026-10-21', ${ist('2026-10-21T09:00:00')}, 8, 'WORKING') RETURNING id`, [E.emp, S.day])).id;
  r = await one(db, `SELECT * FROM public.att_clock_out_values($1, ${ist('2026-10-21T12:00:00')})`, [att3]);
  check('CO-3 out at 12:00 with no break → 3h (< half of 8h) → HALF_DAY', r.worked_minutes === 180 && Number(r.worked_hours) === 3 && r.is_half_day === true && r.status === 'HALF_DAY', JSON.stringify(r));
}

console.log('\n== employee writes through the API (trigger, database time)');
{
  // shift that started 40 minutes ago (company time) so this clock-in is genuinely late
  await sys(db, `INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes)
                 VALUES ($1,'PI Now','PI-NOW','GENERAL', ((now() AT TIME ZONE 'Asia/Kolkata') - interval '40 minutes')::time(0),
                         ((now() AT TIME ZONE 'Asia/Kolkata') + interval '7 hours')::time(0), false, 8, 60)`, [S.now]);
  const crossesMidnight = (await one(db, `SELECT ((now() AT TIME ZONE 'Asia/Kolkata') - interval '40 minutes')::date <> (now() AT TIME ZONE 'Asia/Kolkata')::date
                                                 OR ((now() AT TIME ZONE 'Asia/Kolkata') + interval '7 hours')::date <> (now() AT TIME ZONE 'Asia/Kolkata')::date AS x`)).x;
  await sys(db, `UPDATE shift_assignments SET end_date = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1 WHERE employee_id=$1`, [E.emp]);
  await assign(db, E.emp, S.now);
  await sys(db, `UPDATE shift_assignments SET effective_date = (now() AT TIME ZONE 'Asia/Kolkata')::date WHERE shift_template_id=$1`, [S.now]);
  if (crossesMidnight) await sys(db, `UPDATE shift_templates SET crosses_midnight = true WHERE id=$1`, [S.now]);

  let r = await as(db, 'emp', `INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status, late_minutes, worked_hours, overtime_minutes)
                                VALUES ('${E.emp}','${S.now}', '2020-01-01', now() - interval '3 hours', 1, 'COMPLETED', 0, 12, 600)`);
  const a = await one(db, `SELECT a.*, extract(epoch FROM (now() - a.clock_in_at)) AS age, v.late_minutes AS expected_late, v.attendance_date::text AS expected_date, a.attendance_date::text AS att_date_text
                           FROM attendance a, LATERAL public.att_clock_in_values(a.employee_id, a.clock_in_at) v WHERE a.employee_id=$1 AND a.shift_template_id=$2`, [E.emp, S.now]);
  check('INT-1 forged clock-in time / date / late / hours / overtime replaced by server values', r.n === 1 && a && Math.abs(Number(a.age)) < 5
    && a.late_minutes === a.expected_late && a.late_minutes >= 39 && a.att_date_text === a.expected_date
    && Number(a.required_hours) === 8 && a.status === 'LATE' && a.worked_hours === null && a.overtime_minutes === 0, `${show(r)} ${JSON.stringify(a && { late: a.late_minutes, exp: a.expected_late, st: a.status, req: a.required_hours })}`);
  r = await as(db, 'emp', `INSERT INTO attendance (employee_id, shift_template_id, attendance_date, clock_in_at, required_hours, status) VALUES ('${E.emp}','${S.other}', CURRENT_DATE + 5, now(), 8, 'WORKING')`);
  check('INT-2 clock-in with a shift other than the assigned one is refused', !!r.error && /does not match your assignment/.test(r.error), show(r));
  r = await as(db, 'emp', `INSERT INTO attendance (employee_id, attendance_date, status) VALUES ('${E.emp}', CURRENT_DATE + 6, 'SANDWICH LOP')`);
  check('INT-3 an employee cannot insert a row without a clock-in (e.g. an LOP marker)', !!r.error, show(r));

  const id = a.id;
  for (const [col, val] of [['late_minutes', '0'], ['clock_in_at', `now() - interval '9 hours'`], ['required_hours', '1'], ['overtime_minutes', '240'], ['is_half_day', 'true'], ['worked_hours', '9'], ['status', `'PRESENT'`], ['is_auto_logged_out', 'true']]) {
    await as(db, 'emp', `UPDATE attendance SET ${col} = ${val} WHERE id='${id}'`);
  }
  const b = await one(db, `SELECT late_minutes, clock_in_at = $2::timestamptz AS same_in, required_hours, overtime_minutes, is_half_day, worked_hours, status, is_auto_logged_out FROM attendance WHERE id=$1`, [id, a.clock_in_at]);
  check('INT-4 employee updates of late / clock-in / required hours / overtime / half day / worked hours / status have no effect',
    b.late_minutes === a.late_minutes && b.same_in && Number(b.required_hours) === 8 && b.overtime_minutes === 0 && b.is_half_day === false && b.worked_hours === null && b.status === 'LATE' && b.is_auto_logged_out === false, JSON.stringify(b));

  r = await as(db, 'emp', `UPDATE attendance SET clock_out_at = now() + interval '9 hours', worked_hours = 12, is_half_day = false, status = 'COMPLETED', early_logout_minutes = 0 WHERE id='${id}'`);
  const c = await one(db, `SELECT a.*, extract(epoch FROM (now() - a.clock_out_at)) AS age, v.worked_minutes, v.early_logout_minutes AS exp_early, v.is_half_day AS exp_half
                           FROM attendance a, LATERAL public.att_clock_out_values(a.id, a.clock_out_at) v WHERE a.id=$1`, [id]);
  check('INT-5 clock-out: time = database time; worked hours / early logout / half day / status computed by the server (just clocked in → HALF_DAY)',
    r.n === 1 && Math.abs(Number(c.age)) < 5 && c.early_logout_minutes === c.exp_early && c.is_half_day === c.exp_half && c.is_half_day === true && c.status === 'HALF_DAY' && Number(c.worked_hours) < 0.1,
    `${show(r)} ${JSON.stringify({ worked: c.worked_hours, early: c.early_logout_minutes, half: c.is_half_day, status: c.status })}`);
  r = await as(db, 'emp', `UPDATE attendance SET is_half_day = false, status = 'COMPLETED', worked_hours = 8 WHERE id='${id}'`);
  const d = await one(db, `SELECT is_half_day, status, worked_hours FROM attendance WHERE id=$1`, [id]);
  check('INT-6 a completed day keeps its values (employee edits have no effect)', d.is_half_day === true && d.status === 'HALF_DAY' && Number(d.worked_hours) === Number(c.worked_hours), JSON.stringify(d));
  r = await as(db, 'emp', `UPDATE attendance SET clock_out_at = clock_out_at + interval '8 hours' WHERE id='${id}'`);
  check('INT-7 a recorded clock-out cannot be moved by the employee', !!r.error, show(r));

  r = await as(db, 'hr', `UPDATE attendance SET clock_out_at = clock_in_at + interval '9 hours', worked_hours = 8, is_half_day = false, status = 'COMPLETED', early_logout_minutes = 0, late_minutes = 5 WHERE id='${id}'`);
  const e = await one(db, `SELECT is_half_day, status, worked_hours, late_minutes FROM attendance WHERE id=$1`, [id]);
  check('INT-8 HR corrections are not restricted', r.n === 1 && e.status === 'COMPLETED' && e.late_minutes === 5 && Number(e.worked_hours) === 8, `${show(r)} ${JSON.stringify(e)}`);
  r = await as(db, 'emp2', `UPDATE attendance SET late_minutes = 0 WHERE id='${id}'`);
  check('INT-9 another employee cannot touch the row', r.n === 0, show(r));
  r = await as(db, 'emp2', `SELECT * FROM public.att_clock_in_values('${E.emp}', now())`);
  const own = await as(db, 'emp2', `SELECT error FROM public.att_clock_in_values('${E.emp2}', now())`);
  const out = await as(db, 'emp2', `SELECT * FROM public.att_clock_out_values('${id}', now())`);
  check('INT-10 an employee can compute clock values only for themself (not another employee or their attendance)',
    /Not allowed/.test(r.error || '') && /Not allowed/.test(out.error || '') && own.error === null, `${show(r)} ${show(own)} ${show(out)}`);
}

console.log('\n== payroll lock and atomic recalculation');
{
  const pay = async (emp, month, status) => (await one(db, `INSERT INTO payroll (employee_id, payroll_year, payroll_month, period_start, period_end, basic_salary, gross_salary, total_allowances, total_deductions, net_salary, status)
      VALUES ($1, 2026, $2, '2026-01-01', '2026-01-31', 1000, 1000, 0, 100, 900, $3) RETURNING id`, [emp, month, status])).id;
  const approved = await pay(E.emp, 1, 'APPROVED');
  let r = await as(db, 'hr', `UPDATE payroll SET net_salary = 99999 WHERE id='${approved}'`);
  check('LCK-1 HR cannot change the amounts of an APPROVED payroll', !!r.error, show(r));
  r = await as(db, 'admin', `DELETE FROM payroll WHERE id='${approved}'`);
  check('LCK-2 admin cannot delete an APPROVED payroll', !!r.error || (await one(db, `SELECT count(*)::int c FROM payroll WHERE id=$1`, [approved])).c === 1, show(r));
  r = await as(db, 'hr', `UPDATE payroll SET status = 'PAYMENT_PENDING' WHERE id='${approved}'`);
  check('LCK-3 the workflow can still move APPROVED → PAYMENT_PENDING', r.n === 1, show(r));
  r = await as(db, 'hr', `UPDATE payroll SET status = 'CALCULATED' WHERE id='${approved}'`);
  check('LCK-4 a locked payroll cannot be re-opened to an editable status', !!r.error, show(r));
  r = await as(db, 'hr', `INSERT INTO payroll_items (payroll_id, item_type, item_name, amount) VALUES ('${approved}', 'DEDUCTION', 'sneaky', 10)`);
  check('LCK-5 no payroll item can be added to a locked payroll', !!r.error, show(r));

  const draft = await pay(E.emp, 2, 'UNDER_REVIEW');
  await sys(db, `INSERT INTO payroll_items (payroll_id, item_type, item_name, amount) VALUES ($1,'DEDUCTION','old item',100)`, [draft]);
  const newRow = { employee_id: E.emp, payroll_year: 2026, payroll_month: 2, period_start: '2026-02-01', period_end: '2026-02-28', basic_salary: 1000, gross_salary: 1000, total_allowances: 0, total_deductions: 150, net_salary: 850, lop_deduction: 0, overtime_amount: 0, status: 'CALCULATED' };
  const items = [{ item_type: 'DEDUCTION', item_name: 'Late Deduction (30m)', amount: 150 }];
  r = await as(db, 'hr', `SELECT public.replace_payroll_calculation('${JSON.stringify(newRow).replace(/'/g, "''")}'::jsonb, '${JSON.stringify(items)}'::jsonb) AS r`);
  const after = await one(db, `SELECT p.id, p.total_deductions, p.status, (SELECT array_agg(item_name) FROM payroll_items WHERE payroll_id = p.id) AS items FROM payroll p WHERE employee_id=$1 AND payroll_year=2026 AND payroll_month=2`, [E.emp]);
  check('ATM-1 recalculation replaces row and items in one call; UNDER_REVIEW kept', !r.error && Number(after.total_deductions) === 150 && JSON.stringify(after.items) === JSON.stringify(['Late Deduction (30m)']) && after.status === 'UNDER_REVIEW', `${show(r)} ${JSON.stringify(after)}`);
  r = await as(db, 'hr', `SELECT public.replace_payroll_calculation('${JSON.stringify({ ...newRow, net_salary: 'not a number' })}'::jsonb, '${JSON.stringify(items)}'::jsonb) AS r`);
  const kept = await one(db, `SELECT total_deductions, (SELECT count(*)::int FROM payroll_items WHERE payroll_id = p.id) AS n FROM payroll p WHERE employee_id=$1 AND payroll_year=2026 AND payroll_month=2`, [E.emp]);
  check('ATM-2 a failing recalculation leaves the previous payroll and its items untouched', !!r.error && Number(kept.total_deductions) === 150 && kept.n === 1, `${show(r)} ${JSON.stringify(kept)}`);
  r = await as(db, 'hr', `SELECT public.replace_payroll_calculation('${JSON.stringify({ ...newRow, payroll_month: 1 })}'::jsonb, '[]'::jsonb) AS r`);
  check('ATM-3 recalculation of a locked month is refused', !!r.error && /locked|APPROVED|PAYMENT_PENDING/i.test(r.error), show(r));
  r = await as(db, 'emp', `SELECT public.replace_payroll_calculation('${JSON.stringify({ ...newRow, payroll_month: 3 })}'::jsonb, '[]'::jsonb) AS r`);
  check('ATM-4 an employee cannot run the recalculation', !!r.error, show(r));
  r = await as(db, 'hr', `SELECT public.replace_payroll_calculation('${JSON.stringify({ ...newRow, payroll_month: 4 })}'::jsonb, '${JSON.stringify(items)}'::jsonb) AS r`);
  const fresh = await one(db, `SELECT status FROM payroll WHERE employee_id=$1 AND payroll_month=4`, [E.emp]);
  check('ATM-5 first calculation of a month creates it (CALCULATED)', !r.error && fresh?.status === 'CALCULATED', `${show(r)} ${JSON.stringify(fresh)}`);
  r = await as(db, 'hr', `SELECT public.replace_payroll_calculation('${JSON.stringify({ ...newRow, payroll_month: 4 })}'::jsonb, '${JSON.stringify(items)}'::jsonb) AS r`);
  const cnt = await one(db, `SELECT count(*)::int c, (SELECT count(*)::int FROM payroll_items i JOIN payroll p ON p.id = i.payroll_id WHERE p.employee_id=$1 AND p.payroll_month=4) AS items FROM payroll WHERE employee_id=$1 AND payroll_month=4`, [E.emp]);
  check('ATM-6 repeated recalculation: still one payroll row and one set of items (no duplicate deductions)', cnt.c === 1 && cnt.items === 1, JSON.stringify(cnt));
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(fail ? 1 : 0);
