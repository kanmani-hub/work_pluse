#!/usr/bin/env node
/**
 * Database tests for the scheduled missing-clock-out job (20261022100000_fix_auto_clock_out.sql).
 *
 * THROWAWAY in-memory PostgreSQL (PGlite) with every migration in supabase/migrations applied; synthetic
 * employees only; never connects to Supabase. pg_cron is not available: the job is run by calling
 * process_auto_clock_out() the way the scheduler does (as postgres). Concurrent runs are covered by
 * supabase/tests/security/run_security_concurrency_tests.mjs (real PostgreSQL).
 *
 * Run:  npm i --no-save @electric-sql/pglite && node supabase/tests/autoclockout/run_auto_clock_out_tests.mjs
 *   or  PGLITE_DIR=/path/to/node_modules node supabase/tests/autoclockout/run_auto_clock_out_tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const FIX = '20261022100000_fix_auto_clock_out.sql';

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
if (!ALL.includes(FIX)) { console.error(`missing ${FIX}`); process.exit(2); }
const migrationSql = (f) => {
  let sql = read(path.join(MIG_DIR, f));
  if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed by test');
  return sql;
};

const U = { admin: '11111111-1111-1111-1111-111111111111', hr: '22222222-2222-2222-2222-222222222222', emp: '33333333-3333-3333-3333-333333333333', emp2: '55555555-5555-5555-5555-555555555555' };
const E = { admin: 'e1111111-1111-1111-1111-111111111111', hr: 'e2222222-2222-2222-2222-222222222222', emp: 'e3333333-3333-3333-3333-333333333333', emp2: 'e5555555-5555-5555-5555-555555555555' };
const S = { day: '5a000000-0000-0000-0000-0000000000a1', night: '5a000000-0000-0000-0000-0000000000a2' };
const KDATE = `((now() AT TIME ZONE 'Asia/Kolkata')::date)`;

async function newDb({ withFix = true } = {}) {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(read(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql')));
  for (const f of ALL) {
    if (!withFix && f === FIX) continue;
    try { await db.exec(migrationSql(f)); } catch (e) { throw new Error(`migration ${f} failed: ${e.message}`); }
  }
  await db.exec(`
    SET session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${U.admin}','aco-admin@example.com'),('${U.hr}','aco-hr@example.com'),('${U.emp}','aco-emp@example.com'),('${U.emp2}','aco-emp2@example.com');
    SET session_replication_role = origin;
    INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status) VALUES
      ('${E.admin}','ACO-A','Ada','Admin','aco-admin@example.com','2026-01-01',(SELECT id FROM roles WHERE name='ADMIN'),'ACTIVE'),
      ('${E.hr}','ACO-H','Hana','HR','aco-hr@example.com','2026-01-01',(SELECT id FROM roles WHERE name='HR'),'ACTIVE'),
      ('${E.emp}','ACO-1','Eli','Emp','aco-emp@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE'),
      ('${E.emp2}','ACO-2','Nia','Night','aco-emp2@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE');
    INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES
      ('${U.admin}','${E.admin}',(SELECT id FROM roles WHERE name='ADMIN'),true),
      ('${U.hr}','${E.hr}',(SELECT id FROM roles WHERE name='HR'),true),
      ('${U.emp}','${E.emp}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true),
      ('${U.emp2}','${E.emp2}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true);
    INSERT INTO shift_templates (id, name, code, shift_type, start_time, end_time, crosses_midnight, required_hours, break_duration_minutes) VALUES
      ('${S.day}','ACO Day','ACO-DAY','GENERAL','09:00','18:00',false,8,60),
      ('${S.night}','ACO Night','ACO-NGT','NIGHT','20:00','04:00',true,8,30);
  `);
  return db;
}
const sys = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const one = async (db, sql, params = []) => (await sys(db, sql, params))[0];
const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated' });
async function as(db, who, sql) {
  await db.exec('BEGIN');
  try {
    if (who === 'anon') { await db.query(`SELECT set_config('request.jwt.claims','{"role":"anon"}',true)`); await db.exec('SET LOCAL ROLE anon'); }
    else if (who === 'service') { await db.query(`SELECT set_config('request.jwt.claims','{"role":"service_role"}',true)`); await db.exec('SET LOCAL ROLE service_role'); }
    else { await db.query(`SELECT set_config('request.jwt.claims',$1,true)`, [claims(U[who])]); await db.exec('SET LOCAL ROLE authenticated'); }
    const r = await db.query(sql); await db.exec('COMMIT');
    return { rows: r.rows, n: r.affectedRows ?? r.rows.length, error: null };
  } catch (e) { await db.exec('ROLLBACK'); return { rows: [], n: 0, error: e.message }; }
}
const run = async (db) => (await one(db, `SELECT public.process_auto_clock_out() AS n`)).n;   // as the scheduler (postgres)
const setApp = (db, patch) => sys(db, `UPDATE app_settings SET settings = jsonb_set(COALESCE(settings,'{}'), '{app}', COALESCE(settings->'app','{}') || $1::jsonb) WHERE id='00000000-0000-0000-0000-000000000001'`, [JSON.stringify(patch)]);
// attendance on company date KDATE - daysAgo, clocked in at 09:00 company time (21:00 for the night shift)
async function att(db, { id, daysAgo, shift = S.day, out = false, emp = E.emp }) {
  const start = shift === S.night ? '20:00' : '09:00';
  await sys(db, `INSERT INTO attendance (id, employee_id, shift_template_id, attendance_date, clock_in_at, clock_out_at, required_hours, status)
                 VALUES ($1, $2, $3, ${KDATE} - $4::int, ((${KDATE} - $4::int) + time '${start}') AT TIME ZONE 'Asia/Kolkata',
                         ${out ? `((${KDATE} - $4::int) + time '17:00') AT TIME ZONE 'Asia/Kolkata'` : 'NULL'}, 8, $5)`,
    [id, emp, shift, daysAgo, out ? 'PRESENT' : 'WORKING']);
}

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); } };
const t0 = Date.now();
const id = (n) => `ac000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

console.log('\n== baseline: the 0015 version fails on every run');
{
  const db = await newDb({ withFix: false });
  await att(db, { id: id(1), daysAgo: 2 });
  let err = null; try { await run(db); } catch (e) { err = e.message; }
  check('BASE-1 0015 process_auto_clock_out() errors ("settings" is ambiguous)', !!err && /ambiguous/i.test(err), err || 'no error');
  const anon = await as(db, 'anon', `SELECT public.process_auto_clock_out()`);
  check('BASE-2 0015 version is callable by anon (reaches the function body)', !!anon.error && /ambiguous/i.test(anon.error), anon.error || 'ok');
  await db.close();
}

const db = await newDb();
console.log('\n== flagging');
{
  await att(db, { id: id(10), daysAgo: 2, out: true });
  await att(db, { id: id(11), daysAgo: 7 });
  await att(db, { id: id(12), daysAgo: 0 });
  // a shift ending in the future: today's night shift ends tomorrow 04:00 company time
  await att(db, { id: id(13), daysAgo: 0, shift: S.night, emp: E.emp2 });
  // yesterday's night shift ended today 04:00 + 4 h grace = 08:00 company time
  await att(db, { id: id(14), daysAgo: 1, shift: S.night, emp: E.emp2 });
  const n = await run(db);
  const rows = Object.fromEntries((await sys(db, `SELECT id, status, clock_out_at FROM attendance`)).map((r) => [r.id, r]));
  check('ACO-1 a day with a clock-out is not touched', rows[id(10)].status === 'PRESENT');
  check('ACO-2 missing clock-out after shift end + grace is flagged MISSING_CLOCK_OUT; no clock-out time invented',
    rows[id(11)].status === 'MISSING_CLOCK_OUT' && rows[id(11)].clock_out_at === null, JSON.stringify(rows[id(11)]));
  const nowK = await one(db, `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::time >= time '22:00' AS after`);
  check('ACO-3 today\'s day shift is flagged only after 18:00 + 4 h company time', nowK.after ? rows[id(12)].status === 'MISSING_CLOCK_OUT' : rows[id(12)].status === 'WORKING', JSON.stringify(rows[id(12)]));
  check('ACO-4 overnight shift: today\'s night shift (ends tomorrow 04:00) is not flagged', rows[id(13)].status === 'WORKING', JSON.stringify(rows[id(13)]));
  const after8 = await one(db, `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::time >= time '08:00' AS after`);
  check('ACO-5 overnight shift: yesterday\'s night shift is flagged only after today 04:00 + 4 h', after8.after ? rows[id(14)].status === 'MISSING_CLOCK_OUT' : rows[id(14)].status === 'WORKING', JSON.stringify(rows[id(14)]));
  const ev = await one(db, `SELECT count(*)::int c FROM attendance_events WHERE attendance_id=$1 AND event_type='MISSING_CLOCK_OUT'`, [id(11)]);
  const nt = await one(db, `SELECT count(*)::int c FROM notifications WHERE title='Clock-out missing'`);
  check('ACO-6 one event and one notification per flagged day', ev.c === 1 && nt.c === n, `events ${ev.c}, notifications ${nt.c}, flagged ${n}`);
  const n2 = await run(db);
  const ev2 = await one(db, `SELECT count(*)::int c FROM attendance_events WHERE event_type='MISSING_CLOCK_OUT'`);
  check('ACO-7 repeated scheduled run changes nothing (idempotent)', n2 === 0 && ev2.c === n, `second run ${n2}, events ${ev2.c}`);
  const ot = await one(db, `SELECT COALESCE(overtime_minutes,0) AS o FROM attendance WHERE id=$1`, [id(11)]);
  check('ACO-8 nothing written to overtime', ot.o === 0, JSON.stringify(ot));
}

console.log('\n== time zone (explicit Asia/Kolkata, no DST in India)');
{
  const t = await one(db, `SELECT public.mco_flag_at(a, 0) AS t, public.mco_flag_at(a, 4) AS g FROM (SELECT * FROM attendance WHERE id=$1) a`, [id(11)]);
  const d = await one(db, `SELECT (${KDATE} - 7)::text AS d`);
  const expected = new Date(`${d.d}T18:00:00+05:30`).getTime();
  check('TZ-1 shift end 18:00 company time = 12:30 UTC (not 18:00 UTC)', new Date(t.t).getTime() === expected, `${t.t} vs ${new Date(expected).toISOString()}`);
  check('TZ-2 grace is added on top (4 h)', new Date(t.g).getTime() === expected + 4 * 3600e3, String(t.g));
  const ngt = await one(db, `SELECT public.mco_flag_at(a, 0) AS t FROM (SELECT * FROM attendance WHERE id=$1) a`, [id(14)]);
  const d1 = await one(db, `SELECT (${KDATE})::text AS d`);
  check('TZ-3 overnight shift end is the next day 04:00 company time', new Date(ngt.t).getTime() === new Date(`${d1.d}T04:00:00+05:30`).getTime(), String(ngt.t));
  await sys(db, `SET TIME ZONE 'America/New_York'`);
  const t2 = await one(db, `SELECT public.mco_flag_at(a, 0) AS t FROM (SELECT * FROM attendance WHERE id=$1) a`, [id(11)]);
  await sys(db, `SET TIME ZONE 'UTC'`);
  check('TZ-4 result does not depend on the database session time zone', new Date(t2.t).getTime() === expected, String(t2.t));
}

console.log('\n== open breaks at shift end');
{
  await att(db, { id: id(20), daysAgo: 3 });
  await att(db, { id: id(21), daysAgo: 4 });
  await att(db, { id: id(22), daysAgo: 5 });
  const at = (days, hhmm) => `((${KDATE} - ${days}) + time '${hhmm}') AT TIME ZONE 'Asia/Kolkata'`;
  await sys(db, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at) VALUES ($1,$2,'REGULAR', ${at(3, '17:30')})`, [id(20), E.emp]);
  await sys(db, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, source, reason) VALUES ($1,$2,'AUTO_GPS', ${at(4, '17:00')}, 'SYSTEM','GEOFENCE_EXIT')`, [id(21), E.emp]);
  await sys(db, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, source, reason) VALUES ($1,$2,'AUTO_TRACKING', ${at(5, '16:00')}, 'SYSTEM','TRACKING_STALE')`, [id(22), E.emp]);
  // a completed break before, to check totals: 20 minutes
  await sys(db, `INSERT INTO attendance_breaks (attendance_id, employee_id, break_type, started_at, ended_at, duration_minutes) VALUES ($1,$2,'REGULAR', ${at(3, '13:00')}, ${at(3, '13:20')}, 20)`, [id(20), E.emp]);
  await run(db);
  const b = async (a) => sys(db, `SELECT break_type, ended_at, ended_reason, duration_minutes FROM attendance_breaks WHERE attendance_id=$1 ORDER BY started_at`, [a]);
  const shiftEnd = (days) => sys(db, `SELECT ${at(days, '18:00')} AS t`).then((r) => new Date(r[0].t).getTime());
  const m = (await b(id(20)))[1];
  check('BRK-1 open manual break closed at the shift end (SHIFT_END, 30 min)', m.ended_reason === 'SHIFT_END' && new Date(m.ended_at).getTime() === await shiftEnd(3) && m.duration_minutes === 30, JSON.stringify(m));
  const g = (await b(id(21)))[0];
  check('BRK-2 open geofence break closed at the shift end (60 min)', g.ended_reason === 'SHIFT_END' && new Date(g.ended_at).getTime() === await shiftEnd(4) && g.duration_minutes === 60, JSON.stringify(g));
  const tr = (await b(id(22)))[0];
  check('BRK-3 open tracking-interruption break closed at the shift end (120 min)', tr.ended_reason === 'SHIFT_END' && new Date(tr.ended_at).getTime() === await shiftEnd(5) && tr.duration_minutes === 120, JSON.stringify(tr));
  const tot = await one(db, `SELECT break_minutes, status FROM attendance WHERE id=$1`, [id(20)]);
  check('BRK-4 stored break minutes = sum of the break rows (20 + 30), status MISSING_CLOCK_OUT', tot.break_minutes === 50 && tot.status === 'MISSING_CLOCK_OUT', JSON.stringify(tot));
  const evs = await one(db, `SELECT count(*)::int c FROM attendance_events WHERE attendance_id IN ($1,$2) AND event_type='BREAK_END'`, [id(21), id(22)]);
  check('BRK-5 automatic breaks end through the automatic-break path (BREAK_END events)', evs.c === 2, JSON.stringify(evs));
  const open = await one(db, `SELECT count(*)::int c FROM attendance_breaks WHERE ended_at IS NULL`);
  check('BRK-6 no break is left open on a flagged day', open.c === 0, JSON.stringify(open));
}

console.log('\n== correction after flagging');
{
  const r = await as(db, 'hr', `UPDATE attendance SET clock_out_at = ((${KDATE} - 3) + time '18:30') AT TIME ZONE 'Asia/Kolkata', status='PRESENT' WHERE id='${id(20)}'`);
  const a = await one(db, `SELECT clock_out_at IS NOT NULL AS closed, status, break_minutes FROM attendance WHERE id=$1`, [id(20)]);
  check('COR-1 HR can still record the verified clock-out on a flagged day; break totals unchanged', r.n === 1 && a.closed && a.status === 'PRESENT' && a.break_minutes === 50, `${r.error || ''} ${JSON.stringify(a)}`);
  const n = await run(db);
  check('COR-2 a corrected day is not flagged again', n === 0);
  const e = await as(db, 'emp', `UPDATE attendance SET status='PRESENT' WHERE id='${id(11)}'`);
  const s = await one(db, `SELECT status FROM attendance WHERE id=$1`, [id(11)]);
  check('COR-3 the employee cannot clear the flag by editing the row', s.status === 'MISSING_CLOCK_OUT' && !!e.error, `${e.error || e.n} ${JSON.stringify(s)}`);
  const late = await as(db, 'emp', `UPDATE attendance SET clock_out_at = now() WHERE id='${id(11)}'`);
  const s2 = await one(db, `SELECT clock_out_at FROM attendance WHERE id=$1`, [id(11)]);
  check('COR-4 the employee cannot clock out days later on a flagged day (no invented time)', !!late.error && s2.clock_out_at === null, late.error || 'updated');
  const today = await as(db, 'emp', `UPDATE attendance SET notes = 'ok' WHERE id='${id(12)}'`);
  check('COR-5 ordinary employee updates on an open, unflagged day still work', today.n === 1 || (await one(db, `SELECT status FROM attendance WHERE id=$1`, [id(12)])).status === 'MISSING_CLOCK_OUT', today.error || '');
  const forgeFlag = await as(db, 'emp', `UPDATE attendance SET status='MISSING_CLOCK_OUT' WHERE id='${id(12)}'`);
  const s3 = await one(db, `SELECT status FROM attendance WHERE id=$1`, [id(12)]);
  // refused, or ignored by the server-values guard (20261028090000): the flag is never set by the employee
  check('COR-6 the employee cannot set the flag themselves', !!forgeFlag.error || forgeFlag.n === 0 || s3.status !== 'MISSING_CLOCK_OUT', forgeFlag.error || JSON.stringify(s3));
}

console.log('\n== settings and permissions');
{
  await att(db, { id: id(30), daysAgo: 6 });
  await setApp(db, { autoClockOut: false });
  check('SET-1 autoClockOut = false: the job flags nothing', (await run(db)) === 0 && (await one(db, `SELECT status FROM attendance WHERE id=$1`, [id(30)])).status === 'WORKING');
  await setApp(db, { autoClockOut: true, autoClockOutMode: 'at_shift_end', autoClockOutGraceHours: 48 });
  // checks its own row: other open rows (e.g. last night's night shift) may also be due, depending on the time of day
  await run(db);
  check('SET-2 mode at_shift_end ignores the grace hours', (await one(db, `SELECT status FROM attendance WHERE id=$1`, [id(30)])).status === 'MISSING_CLOCK_OUT');
  for (const who of ['anon', 'emp', 'hr', 'admin']) {
    const r = await as(db, who, `SELECT public.process_auto_clock_out()`);
    check(`PERM-${who} ${who} cannot run the job through the API`, !!r.error, r.error || 'ran');
  }
  const svc = await as(db, 'service', `SELECT public.process_auto_clock_out() AS n`);
  check('PERM-service service_role can run it (server-side fallback without pg_cron)', !svc.error, svc.error || '');
  const helper = await as(db, 'emp', `SELECT public.mco_settings()`);
  check('PERM-helpers internal helpers are not callable by employees', !!helper.error, helper.error || 'ran');
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(fail ? 1 : 0);
