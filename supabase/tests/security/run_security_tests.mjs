#!/usr/bin/env node
/**
 * Security regression tests (QA 2026-10-22): employee data isolation, request approval, audit-log and
 * notification integrity, admin provisioning / role escalation, function hardening.
 *
 * Runs against a THROWAWAY in-memory PostgreSQL (PGlite): it never connects to Supabase, staging or
 * production. All migrations in supabase/migrations are applied to an empty database (with the Supabase
 * stand-ins from supabase/tests/rls/00_supabase_shim.sql); requests are made as the real API roles
 * (anon, authenticated employee / HR / admin) with Row Level Security in force. Synthetic users only.
 *
 * "BASELINE" checks build the database WITHOUT the 2026-10-22 security migrations and confirm each attack
 * really worked there, so the tests are known to detect the original defects.
 *
 * Run:  npm i --no-save @electric-sql/pglite && node supabase/tests/security/run_security_tests.mjs
 *   or  PGLITE_DIR=/path/to/node_modules node supabase/tests/security/run_security_tests.mjs
 * Limits: single connection (no true concurrency here; see run_security_concurrency_tests.mjs);
 * realtime is not available, but Supabase realtime postgres_changes applies the same SELECT policies
 * that are tested here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const FIX_MIGRATIONS = [
  '20261022090000_request_approval_guards.sql',
  '20261022090100_employee_data_isolation.sql',
  '20261022090200_notification_integrity.sql',
  '20261022090300_audit_log_integrity.sql',
  '20261022090400_remove_email_admin_provisioning.sql',
  '20261022100100_permission_overlap_guard.sql',
];

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
for (const f of FIX_MIGRATIONS) if (!ALL.includes(f)) { console.error(`missing ${f}`); process.exit(2); }
function migrationSql(f) {
  let sql = read(path.join(MIG_DIR, f));
  if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed by test');
  return sql;
}

const U = { admin: '11111111-1111-1111-1111-111111111111', hr: '22222222-2222-2222-2222-222222222222', emp: '33333333-3333-3333-3333-333333333333', emp2: '55555555-5555-5555-5555-555555555555', hr2: '66666666-6666-6666-6666-666666666666' };
const E = { admin: 'e1111111-1111-1111-1111-111111111111', hr: 'e2222222-2222-2222-2222-222222222222', emp: 'e3333333-3333-3333-3333-333333333333', emp2: 'e5555555-5555-5555-5555-555555555555', hr2: 'e6666666-6666-6666-6666-666666666666' };
const LT = '1e000000-0000-0000-0000-000000000001';

async function newDb({ fixed = true } = {}) {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(read(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql')));
  for (const f of ALL) {
    if (!fixed && FIX_MIGRATIONS.includes(f)) continue;
    try { await db.exec(migrationSql(f)); } catch (e) { throw new Error(`migration ${f} failed: ${e.message}`); }
  }
  // synthetic accounts (auth triggers paused only while seeding the test users)
  await db.exec(`
    SET session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${U.admin}','sec-admin@example.com'),('${U.hr}','sec-hr@example.com'),('${U.emp}','sec-emp@example.com'),('${U.emp2}','sec-emp2@example.com'),('${U.hr2}','sec-hr2@example.com');
    SET session_replication_role = origin;
    INSERT INTO employees (id, employee_code, first_name, last_name, email, joining_date, role_id, status, phone, date_of_birth) VALUES
      ('${E.admin}','SEC-A','Ada','Admin','sec-admin@example.com','2026-01-01',(SELECT id FROM roles WHERE name='ADMIN'),'ACTIVE','900000','1980-01-01'),
      ('${E.hr}','SEC-H','Hana','HR','sec-hr@example.com','2026-01-01',(SELECT id FROM roles WHERE name='HR'),'ACTIVE','900009','1985-01-01'),
      ('${E.hr2}','SEC-H2','Hugo','HR','sec-hr2@example.com','2026-01-01',(SELECT id FROM roles WHERE name='HR'),'ACTIVE','900008','1986-01-01'),
      ('${E.emp}','SEC-1','Eli','Emp','sec-emp@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE','900001','1990-01-01'),
      ('${E.emp2}','SEC-2','Eva','Two','sec-emp2@example.com','2026-01-01',(SELECT id FROM roles WHERE name='EMPLOYEE'),'ACTIVE','900002','1991-02-02');
    INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES
      ('${U.admin}','${E.admin}',(SELECT id FROM roles WHERE name='ADMIN'),true),
      ('${U.hr}','${E.hr}',(SELECT id FROM roles WHERE name='HR'),true),
      ('${U.hr2}','${E.hr2}',(SELECT id FROM roles WHERE name='HR'),true),
      ('${U.emp}','${E.emp}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true),
      ('${U.emp2}','${E.emp2}',(SELECT id FROM roles WHERE name='EMPLOYEE'),true);
    INSERT INTO leave_types (id, name, code) VALUES ('${LT}','Casual SEC','CSEC') ON CONFLICT DO NOTHING;
  `);
  return db;
}

const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated', email: `${uid}@example.com` });
async function as(db, who, sql, params = []) {
  await db.exec('BEGIN');
  try {
    if (who === 'anon') {
      await db.query(`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await db.exec('SET LOCAL ROLE anon');
    } else {
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims(U[who])]);
      await db.exec('SET LOCAL ROLE authenticated');
    }
    const r = await db.query(sql, params);
    await db.exec('COMMIT');
    const isRead = /^\s*(select|with)/i.test(sql);
    return { rows: r.rows, n: isRead ? r.rows.length : (r.affectedRows ?? 0), error: null };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { rows: [], n: 0, error: e.message };
  }
}
const sys = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const one = async (db, sql, params = []) => (await sys(db, sql, params))[0];

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
};
const denied = (r) => !!r.error || r.n === 0;
const show = (r) => (r.error ? `error: ${r.error}` : `rows: ${r.n}`);
const t0 = Date.now();

const newLeave = (db, emp = E.emp, extra = '') => one(db, `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason${extra ? ', status' : ''}) VALUES ('${emp}','${LT}','2026-11-02','2026-11-03',2,'sec'${extra ? `, '${extra}'` : ''}) RETURNING id`);
let wfhDay = 0;
const newWfh = (db, emp = E.emp) => one(db, `INSERT INTO wfh_requests (employee_id, request_date, reason) VALUES ('${emp}', DATE '2026-11-01' + ${++wfhDay}, 'sec') RETURNING id`);
const newPerm = (db, emp = E.emp) => one(db, `INSERT INTO permission_requests (employee_id, permission_date, start_time, end_time, duration_minutes, reason) VALUES ('${emp}','2026-11-05','10:00','11:00',60,'sec') RETURNING id`);

// =============================================================================================
console.log('\n== BASELINE (database without the 2026-10-22 security migrations): the attacks work');
{
  const db = await newDb({ fixed: false });
  const lr = await newLeave(db);
  check('BASE-1 employee self-approves own leave (S-01 present before the fix)', (await as(db, 'emp', `UPDATE leave_requests SET status='APPROVED' WHERE id='${lr.id}'`)).n === 1);
  check("BASE-2 employee reads another employee's phone (S-05 present before the fix)", (await as(db, 'emp', `SELECT phone FROM employees WHERE id='${E.emp2}'`)).n === 1);
  await as(db, 'emp', `INSERT INTO audit_logs (actor_employee_id, action, module, description) VALUES ('${E.hr}','PAYROLL_APPROVED','PAYROLL','base-forge')`);
  check('BASE-3 forged audit entry stored (S-06a present before the fix)', (await one(db, `SELECT count(*)::int c FROM audit_logs WHERE description='base-forge'`)).c === 1);
  await as(db, 'emp', `INSERT INTO notifications (recipient_employee_id, notification_type, title, message) VALUES ('${E.emp2}','PAYROLL','Salary Paid','base-phish')`);
  check('BASE-4 notification into another inbox stored (S-06b present before the fix)', (await one(db, `SELECT count(*)::int c FROM notifications WHERE message='base-phish'`)).c === 1);
  let err = null; try { await db.exec(`INSERT INTO auth.users (id, email) VALUES ('77777777-7777-7777-7777-777777777777','admin@gmail.com')`); } catch (e) { err = e.message; }
  check('BASE-5 creating admin@gmail.com fails through trg_admin_auth_sync (S-12 present before the fix)', !!err && /foreign key|violates/i.test(err), err || 'no error');
  await as(db, 'emp', `INSERT INTO permission_requests (employee_id, permission_date, start_time, end_time, duration_minutes, reason) VALUES ('${E.emp}','2026-12-01','10:00','11:00',60,'b'),('${E.emp}','2026-12-01','10:30','12:00',90,'b')`);
  check('BASE-6 two overlapping permissions are both stored (B-11 present before the fix)', (await one(db, `SELECT count(*)::int c FROM permission_requests WHERE reason='b'`)).c === 2);
  await db.close();
}

// =============================================================================================
const db = await newDb();

console.log('\n== 2.1 employee personal data');
{
  const own = await as(db, 'emp', `SELECT id, phone, date_of_birth FROM employees WHERE id='${E.emp}'`);
  check('ISO-1 employee reads own record', own.n === 1 && own.rows[0].phone === '900001', show(own));
  const other = await as(db, 'emp', `SELECT phone, date_of_birth FROM employees WHERE id='${E.emp2}'`);
  check("ISO-2 employee cannot read another employee's record (by id)", other.n === 0 && !other.error, show(other));
  const all = await as(db, 'emp', `SELECT id FROM employees`);
  check('ISO-3 enumeration returns only the own row', all.n === 1 && all.rows[0].id === E.emp, show(all));
  const byCode = await as(db, 'emp', `SELECT id FROM employees WHERE employee_code LIKE 'SEC-%' OR email LIKE '%@example.com'`);
  check('ISO-3b filters on code / e-mail do not reveal other rows', byCode.n === 1, show(byCode));
  const anon = await as(db, 'anon', `SELECT id FROM employees`);
  check('ISO-4 anonymous REST request cannot read employees', denied(anon), show(anon));
  const upd = await as(db, 'emp', `UPDATE employees SET phone='0' WHERE id='${E.emp2}'`);
  check("ISO-4b employee cannot update another employee's record", denied(upd), show(upd));
  const login = await as(db, 'anon', `SELECT public.get_email_by_employee_code('SEC-2') AS e`);
  check('ISO-4c login lookup returns only the e-mail (no other personal fields)', !login.error && Object.keys(login.rows[0] || {}).length === 1, show(login));
  const adm = await as(db, 'admin', `SELECT id FROM employees`);
  const hr = await as(db, 'hr', `SELECT phone FROM employees WHERE id='${E.emp2}'`);
  const total = (await one(db, `SELECT count(*)::int c FROM employees`)).c;   // includes the bootstrap ADMIN-001 row from 20260930163000
  check('ISO-5 admin reads all employees; HR reads another employee', adm.n === total && total >= 5 && hr.n === 1, `${show(adm)} of ${total} / ${show(hr)}`);
  const promo = await as(db, 'emp', `UPDATE profiles SET role_id=(SELECT id FROM roles WHERE name='ADMIN') WHERE auth_user_id='${U.emp}'`);
  check('ISO-6 employee cannot promote own profile to ADMIN (admin-only operation)', denied(promo), show(promo));
  const hrPromo = await as(db, 'hr', `UPDATE employees SET role_id=(SELECT id FROM roles WHERE name='ADMIN') WHERE id='${E.emp}'`);
  check('ISO-6b HR cannot assign the ADMIN role on an employee record', !!hrPromo.error, show(hrPromo));
  const hrEdit = await as(db, 'hr', `UPDATE employees SET phone='900011' WHERE id='${E.emp}'`);
  check('ISO-6c HR can still edit other employee fields', hrEdit.n === 1, show(hrEdit));
  const admRole = await as(db, 'admin', `UPDATE employees SET role_id=(SELECT id FROM roles WHERE name='HR') WHERE id='${E.emp2}'`);
  check('ISO-6d ADMIN can change an employee role', admRole.n === 1, show(admRole));
  await sys(db, `UPDATE employees SET role_id=(SELECT id FROM roles WHERE name='EMPLOYEE') WHERE id='${E.emp2}'`);
  const rt = await as(db, 'emp2', `SELECT id FROM employees WHERE id <> '${E.emp2}'`);
  check('ISO-7 realtime: the SELECT policy realtime applies gives employee 2 no other employee rows', rt.n === 0, show(rt));
}

console.log('\n== 2.2 request approval');
for (const [table, mk] of [['leave_requests', newLeave], ['wfh_requests', newWfh], ['permission_requests', newPerm]]) {
  const r1 = await mk(db);
  const self = await as(db, 'emp', `UPDATE ${table} SET status='APPROVED' WHERE id='${r1.id}'`);
  check(`APR-1 [${table}] employee cannot approve own request`, !!self.error, show(self));
  const selfRej = await as(db, 'emp', `UPDATE ${table} SET status='REJECTED' WHERE id='${r1.id}'`);
  check(`APR-1b [${table}] employee cannot reject own request`, !!selfRej.error, show(selfRej));
  const forge = await as(db, 'emp', `UPDATE ${table} SET reviewed_by='${E.hr}', reviewed_at=now(), reviewer_remarks='ok' WHERE id='${r1.id}'`);
  const after = await one(db, `SELECT status, reviewed_by, reviewer_remarks FROM ${table} WHERE id='${r1.id}'`);
  check(`APR-2 [${table}] forged reviewer fields are ignored`, after.reviewed_by === null && after.reviewer_remarks === null && after.status === 'PENDING', `${show(forge)} ${JSON.stringify(after)}`);
  const owner = await as(db, 'emp', `UPDATE ${table} SET employee_id='${E.emp2}' WHERE id='${r1.id}'`);
  check(`APR-3 [${table}] owner cannot be changed`, !!owner.error, show(owner));
  const other = await as(db, 'emp2', `UPDATE ${table} SET status='CANCELLED' WHERE id='${r1.id}'`);
  check(`APR-4 [${table}] another employee cannot touch the request`, other.n === 0, show(other));
  const ok = await as(db, 'hr', `UPDATE ${table} SET status='APPROVED', reviewed_by='${E.emp}', reviewed_at='2020-01-01' WHERE id='${r1.id}'`);
  const ap = await one(db, `SELECT status, reviewed_by, reviewed_at > now() - interval '1 minute' AS fresh FROM ${table} WHERE id='${r1.id}'`);
  check(`APR-5 [${table}] HR approves; reviewer and time come from the database`, ok.n === 1 && ap.status === 'APPROVED' && ap.reviewed_by === E.hr && ap.fresh, `${show(ok)} ${JSON.stringify(ap)}`);
  const dup = await as(db, 'hr2', `UPDATE ${table} SET status='APPROVED' WHERE id='${r1.id}'`);
  const ap2 = await one(db, `SELECT reviewed_by FROM ${table} WHERE id='${r1.id}'`);
  check(`APR-6 [${table}] duplicate approval changes nothing (first reviewer kept)`, ap2.reviewed_by === E.hr, `${show(dup)} ${JSON.stringify(ap2)}`);
  const flip = await as(db, 'hr2', `UPDATE ${table} SET status='REJECTED' WHERE id='${r1.id}'`);
  check(`APR-7 [${table}] approved request cannot be rejected afterwards (stale second reviewer)`, !!flip.error, show(flip));
  const empEdit = await as(db, 'emp', `UPDATE ${table} SET reason='changed after approval' WHERE id='${r1.id}'`);
  check(`APR-8 [${table}] employee cannot edit an approved request`, !!empEdit.error, show(empEdit));
  const revoke = await as(db, 'admin', `UPDATE ${table} SET status='CANCELLED' WHERE id='${r1.id}'`);
  check(`APR-9 [${table}] admin can revoke an approved request`, revoke.n === 1, show(revoke));
  const reopen = await as(db, 'admin', `UPDATE ${table} SET status='APPROVED' WHERE id='${r1.id}'`);
  check(`APR-10 [${table}] a cancelled request is final`, !!reopen.error, show(reopen));
  const r2 = await mk(db);
  const cancel = await as(db, 'emp', `UPDATE ${table} SET status='CANCELLED' WHERE id='${r2.id}'`);
  check(`APR-11 [${table}] employee cancels own PENDING request`, cancel.n === 1, show(cancel));
  const r3 = await mk(db, E.hr);
  const hrSelf = await as(db, 'hr', `UPDATE ${table} SET status='APPROVED' WHERE id='${r3.id}'`);
  check(`APR-12 [${table}] HR cannot approve their own request`, !!hrSelf.error, show(hrSelf));
  const hrOther = await as(db, 'hr2', `UPDATE ${table} SET status='REJECTED', reviewer_remarks='no' WHERE id='${r3.id}'`);
  check(`APR-13 [${table}] another HR can decide it`, hrOther.n === 1, show(hrOther));
}
{
  const ins = await as(db, 'emp', `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, status, reviewed_by) VALUES ('${E.emp}','${LT}','2026-12-01','2026-12-01',1,'sec','APPROVED','${E.hr}')`);
  check('APR-14 employee cannot insert an already-APPROVED request', !!ins.error, show(ins));
  const pend = await as(db, 'emp', `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, requested_at) VALUES ('${E.emp}','${LT}','2026-12-02','2026-12-02',1,'sec','2020-01-01')`);
  const row = await one(db, `SELECT requested_at > now() - interval '1 minute' AS fresh FROM leave_requests WHERE start_date='2026-12-02'`);
  check('APR-15 employee inserts PENDING; back-dated requested_at replaced by database time', pend.n === 1 && row.fresh, show(pend));
  const pendEdit = await as(db, 'emp', `UPDATE leave_requests SET reason='edited while pending' WHERE start_date='2026-12-02'`);
  check('APR-16 employee can still edit own PENDING request', pendEdit.n === 1, show(pendEdit));
  const onBehalf = await as(db, 'admin', `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, total_days, reason, status, reviewed_by) VALUES ('${E.emp2}','${LT}','2026-12-03','2026-12-03',1,'added by admin','APPROVED','${E.emp2}')`);
  const ob = await one(db, `SELECT status, reviewed_by FROM leave_requests WHERE start_date='2026-12-03'`);
  check('APR-17 admin adds an approved leave on behalf; reviewer recorded as the admin', onBehalf.n === 1 && ob.status === 'APPROVED' && ob.reviewed_by === E.admin, `${show(onBehalf)} ${JSON.stringify(ob)}`);
  const anonUpd = await as(db, 'anon', `UPDATE leave_requests SET status='APPROVED'`);
  check('APR-18 anonymous caller cannot change requests', denied(anonUpd), show(anonUpd));
  const del = await as(db, 'emp', `DELETE FROM leave_requests WHERE employee_id='${E.emp}'`);
  check('APR-19 employee cannot delete requests', denied(del), show(del));
}

console.log('\n== permission overlap (B-11)');
{
  const ins = (who, start, end, date = '2026-12-10') => as(db, who, `INSERT INTO permission_requests (employee_id, permission_date, start_time, end_time, duration_minutes, reason) VALUES ('${E.emp2}','${date}','${start}','${end}',60,'ovl')`);
  let r = await ins('emp2', '10:00', '11:00');
  check('OVL-1 first permission saved', r.n === 1, show(r));
  r = await ins('emp2', '10:30', '12:00');
  check('OVL-2 overlapping permission refused by the database', !!r.error && /overlaps/.test(r.error), show(r));
  r = await ins('emp2', '11:00', '12:00');
  check('OVL-3 touching interval allowed', r.n === 1, show(r));
  r = await ins('emp2', '10:15', '10:45', '2026-12-11');
  check('OVL-4 same time on another day allowed', r.n === 1, show(r));
  r = await as(db, 'admin', `INSERT INTO permission_requests (employee_id, permission_date, start_time, end_time, duration_minutes, reason, status) VALUES ('${E.emp2}','2026-12-10','09:30','10:30',60,'ovl','APPROVED')`);
  check('OVL-5 admin cannot add an overlapping approved permission either', !!r.error, show(r));
  await as(db, 'emp2', `UPDATE permission_requests SET status='CANCELLED' WHERE employee_id='${E.emp2}' AND permission_date='2026-12-10' AND start_time='10:00'`);
  r = await ins('emp2', '10:15', '10:45');
  check('OVL-6 a cancelled permission frees the time', r.n === 1, show(r));
  r = await as(db, 'emp2', `UPDATE permission_requests SET end_time='11:30' WHERE employee_id='${E.emp2}' AND permission_date='2026-12-10' AND start_time='10:15'`);
  check('OVL-7 editing a pending permission into an overlap is refused', !!r.error, show(r));
}

console.log('\n== 2.3 audit logs');
{
  const cnt = async (d) => (await one(db, `SELECT count(*)::int c FROM audit_logs WHERE description=$1`, [d])).c;
  const ins = (actor, d, extra = '') => `INSERT INTO audit_logs (actor_employee_id, action, module, description, source${extra ? ', created_at' : ''}) VALUES (${actor ? `'${actor}'` : 'NULL'},'X','PAYROLL','${d}','WEB'${extra ? `, '${extra}'` : ''})`;
  let r = await as(db, 'emp', ins(E.hr, 'forge'));
  check('AUD-1 employee cannot write an entry in another person\'s name', !!r.error && (await cnt('forge')) === 0, show(r));
  r = await as(db, 'emp', ins(null, 'null-actor'));
  check('AUD-2 entry without an actor is refused', !!r.error, show(r));
  r = await as(db, 'emp', ins(E.emp, 'own', '2020-01-01'));
  const own = await one(db, `SELECT created_at > now() - interval '1 minute' AS fresh FROM audit_logs WHERE description='own'`);
  check('AUD-3 own entry stored with the database time (client time ignored)', r.n === 1 && own.fresh, show(r));
  r = await as(db, 'admin', ins(E.emp, 'admin-forge'));
  check('AUD-4 admin cannot attribute an entry to someone else', !!r.error, show(r));
  r = await as(db, 'emp', `INSERT INTO audit_logs (actor_employee_id, action, module, description, source) VALUES ('${E.emp}','X','AUTH','sys','SYSTEM')`);
  check('AUD-5 a browser session cannot write SYSTEM entries', !!r.error, show(r));
  r = await as(db, 'admin', `UPDATE audit_logs SET description='rewritten' WHERE description='own'`);
  check('AUD-6 audit entries cannot be updated through the API (even by admin)', denied(r), show(r));
  r = await as(db, 'admin', `DELETE FROM audit_logs WHERE description='own'`);
  check('AUD-7 audit entries cannot be deleted through the API (even by admin)', denied(r) && (await cnt('own')) === 1, show(r));
  r = await as(db, 'emp', `SELECT id FROM audit_logs WHERE description='own'`);
  check('AUD-8 employees cannot read the audit log', r.n === 0, show(r));
  r = await as(db, 'hr', `SELECT id FROM audit_logs WHERE description='own'`);
  check('AUD-9 HR / admin can read the audit log', r.n === 1, show(r));
  await sys(db, ins(E.hr, 'server-side'));
  check('AUD-10 server-side writers (postgres / SECURITY DEFINER) still work', (await cnt('server-side')) === 1);
}

console.log('\n== notifications');
{
  const cnt = async (m) => (await one(db, `SELECT count(*)::int c FROM notifications WHERE message=$1`, [m])).c;
  let r = await as(db, 'emp', `INSERT INTO notifications (recipient_employee_id, notification_type, title, message) VALUES ('${E.emp2}','PAYROLL','Salary Paid','phish')`);
  check("NTF-1 employee cannot write into another employee's inbox", !!r.error && (await cnt('phish')) === 0, show(r));
  r = await as(db, 'emp', `INSERT INTO notifications (recipient_employee_id, notification_type, title, message) VALUES ('${E.emp}','SECURITY','Password changed','self')`);
  check('NTF-2 employee can notify themselves', r.n === 1, show(r));
  r = await as(db, 'emp', `SELECT public.notify_admins('LEAVE','New leave request','req-alert') AS n`);
  const rec = await sys(db, `SELECT recipient_employee_id, metadata->>'from_employee_id' AS f FROM notifications WHERE message='req-alert' ORDER BY 1`);
  const expected = (await sys(db, `SELECT e.id FROM employees e JOIN profiles p ON p.employee_id = e.id AND p.is_active JOIN roles r ON r.id = p.role_id
                                   WHERE r.name IN ('ADMIN','HR') AND upper(e.status)='ACTIVE' ORDER BY 1`)).map((x) => x.id);
  check('NTF-3 notify_admins reaches exactly the active ADMIN/HR accounts, sender stamped', !r.error && expected.length >= 3
        && JSON.stringify(rec.map((x) => x.recipient_employee_id)) === JSON.stringify(expected) && rec.every((x) => x.f === E.emp)
        && !rec.some((x) => [E.emp, E.emp2].includes(x.recipient_employee_id)), `${show(r)} ${JSON.stringify(rec)}`);
  const ev = 'ee000000-0000-0000-0000-000000000001';
  const d1 = await as(db, 'emp', `SELECT public.notify_admins('GEOFENCE','Employee Left Office','geo-alert','HIGH',NULL,'geofence_events','${ev}') AS n`);
  const d2 = await as(db, 'emp', `SELECT public.notify_admins('GEOFENCE','Employee Left Office','geo-alert','HIGH',NULL,'geofence_events','${ev}') AS n`);
  check('NTF-3b the same event is announced once (retry / second tab sends nothing)', d1.rows[0]?.n === expected.length && d2.rows[0]?.n === 0
        && (await cnt('geo-alert')) === expected.length, `${show(d1)} ${JSON.stringify(d1.rows)} / ${JSON.stringify(d2.rows)}`);
  r = await as(db, 'emp', `SELECT public.notify_admins('PAYROLL','Salary Paid','bad-type') AS n`);
  check('NTF-4 notify_admins refuses non-request notification types', !!r.error, show(r));
  r = await as(db, 'anon', `SELECT public.notify_admins('LEAVE','x','anon-alert') AS n`);
  check('NTF-5 anonymous caller cannot use notify_admins', !!r.error, show(r));
  const nid = (await one(db, `SELECT id FROM notifications WHERE message='self'`)).id;
  r = await as(db, 'emp', `UPDATE notifications SET message='edited' WHERE id='${nid}'`);
  check('NTF-6 employee cannot rewrite a notification', !!r.error, show(r));
  r = await as(db, 'emp', `UPDATE notifications SET is_read=true, read_at=now() WHERE id='${nid}'`);
  check('NTF-7 employee can mark own notification read', r.n === 1, show(r));
  r = await as(db, 'hr', `INSERT INTO notifications (recipient_employee_id, notification_type, title, message) VALUES ('${E.emp}','LEAVE','Leave approved','hr-to-emp')`);
  check('NTF-8 HR can notify an employee', r.n === 1, show(r));
  r = await as(db, 'emp2', `SELECT id FROM notifications WHERE recipient_employee_id='${E.emp}'`);
  check("NTF-9 employee cannot read another employee's notifications (also what realtime delivers)", r.n === 0, show(r));
}

console.log('\n== 2.4 admin provisioning / role escalation');
{
  let err = null;
  try { await db.exec(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('77777777-7777-7777-7777-777777777777','admin@gmail.com','{"role":"ADMIN"}')`); } catch (e) { err = e.message; }
  const links = await one(db, `SELECT count(*)::int c FROM profiles WHERE auth_user_id='77777777-7777-7777-7777-777777777777'`);
  check('ESC-1 a new admin@gmail.com account is created without any profile or role', !err && links.c === 0, err || '');
  const role = await as(db, 'emp', `SELECT public.get_auth_role() AS r`);
  check('ESC-2 role comes from the profile, not user metadata', role.rows[0]?.r === 'EMPLOYEE', show(role));
  await sys(db, `UPDATE auth.users SET raw_user_meta_data='{"role":"ADMIN"}' WHERE id='${U.emp}'`);
  const role2 = await as(db, 'emp', `SELECT public.get_auth_role() AS r`);
  check('ESC-3 user-editable metadata role=ADMIN does not grant ADMIN', role2.rows[0]?.r === 'EMPLOYEE', show(role2));
  const prof = await as(db, 'emp', `INSERT INTO profiles (auth_user_id, employee_id, role_id, is_active) VALUES ('77777777-7777-7777-7777-777777777777','${E.emp}',(SELECT id FROM roles WHERE name='ADMIN'),true)`);
  check('ESC-4 employee cannot insert an ADMIN profile', denied(prof), show(prof));
  const hrProf = await as(db, 'hr', `UPDATE profiles SET role_id=(SELECT id FROM roles WHERE name='ADMIN') WHERE auth_user_id='${U.hr}'`);
  check('ESC-5 HR cannot promote their own profile to ADMIN', denied(hrProf), show(hrProf));
  const roleIns = await as(db, 'emp', `INSERT INTO roles (name) VALUES ('SUPERADMIN')`);
  check('ESC-6 employee cannot create roles', denied(roleIns), show(roleIns));
  const hrNew = await as(db, 'hr', `INSERT INTO employees (employee_code, first_name, last_name, email, joining_date, role_id, status) VALUES ('SEC-X','X','Y','x@example.com','2026-01-01',(SELECT id FROM roles WHERE name='ADMIN'),'ACTIVE')`);
  check('ESC-7 HR cannot create an employee record with the ADMIN role', !!hrNew.error, show(hrNew));
  const trg = await one(db, `SELECT count(*)::int c FROM pg_trigger WHERE tgname='trg_admin_auth_sync'`);
  check('ESC-8 the e-mail-based admin trigger is gone', trg.c === 0);
}

console.log('\n== function hardening');
{
  const f = await one(db, `SELECT proconfig FROM pg_proc WHERE proname='trigger_push_notification_webhook'`);
  check('FN-1 trigger_push_notification_webhook has a fixed search_path', (f?.proconfig || []).some((c) => c.startsWith('search_path=')), JSON.stringify(f));
  const definer = await sys(db, `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                                 WHERE n.nspname='public' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')`);
  check('FN-2 every SECURITY DEFINER function in public pins search_path', definer.length === 0, definer.map((x) => x.proname).join(', '));
  const aco = await as(db, 'anon', `SELECT public.process_auto_clock_out()`);
  const aco2 = await as(db, 'emp', `SELECT public.process_auto_clock_out()`);
  check('FN-3 anon / employees cannot run process_auto_clock_out()', !!aco.error && !!aco2.error, `${show(aco)} / ${show(aco2)}`);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(fail ? 1 : 0);
