#!/usr/bin/env node
/**
 * Rollback validation for the 2026-10-28 migrations, on a THROWAWAY in-memory PostgreSQL (PGlite):
 *   apply every migration (+ the two proposals) → roll back 090300, 090200, 090100, 090000 in reverse order →
 *   check that what existed before still works and only the new objects are gone → re-apply the three
 *   migrations (re-runnable) → check the new behaviour is back. Synthetic data only.
 * Run: PGLITE_DIR=/path/to/node_modules node supabase/tests/rollback/run_rollback_tests.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MIG_DIR = path.join(ROOT, 'supabase/migrations');
const RB_DIR = path.join(ROOT, 'supabase/rollbacks');
const NEW = ['20261028090000_attendance_server_values', '20261028090100_payroll_lock_and_replace', '20261028090200_auto_clock_out_and_settings_hardening', '20261028090300_auto_break_tracking_off_immediate'];

async function loadPglite() {
  const dir = process.env.PGLITE_DIR;
  const base = dir ? path.join(dir, '@electric-sql/pglite/dist') : null;
  const { PGlite } = await import(base ? pathToFileURL(path.join(base, 'index.js')).href : '@electric-sql/pglite');
  const { uuid_ossp } = await import(base ? pathToFileURL(path.join(base, 'contrib/uuid_ossp.js')).href : '@electric-sql/pglite/contrib/uuid_ossp');
  return { PGlite, uuid_ossp };
}
const { PGlite, uuid_ossp } = await loadPglite();
const read = (p) => fs.readFileSync(p, 'utf8');
const mig = (f) => {
  let sql = read(path.join(MIG_DIR, f));
  if (f === '20261004120100_notification_push_trigger.sql') sql = sql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_net.*$/m, '-- pg_net stubbed');
  return sql;
};
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); } };
const t0 = Date.now();

const db = new PGlite({ extensions: { uuid_ossp } });
await db.exec(read(path.join(ROOT, 'supabase/tests/rls/00_supabase_shim.sql')));
for (const f of fs.readdirSync(MIG_DIR).filter((x) => x.endsWith('.sql')).sort()) await db.exec(mig(f));
for (const p of ['PROPOSED_overtime_requests.sql', 'PROPOSED_missing_clock_out_workflow.sql']) await db.exec(read(path.join(ROOT, 'docs/proposals', p)));
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const exists = async (kind, name) => (await q(kind === 'fn'
  ? `SELECT count(*)::int c FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace`
  : kind === 'trg' ? `SELECT count(*)::int c FROM pg_trigger WHERE tgname=$1` : `SELECT count(*)::int c FROM pg_class WHERE relname=$1 AND relnamespace='public'::regnamespace`, [name]))[0].c > 0;
const NEW_OBJECTS = [['trg', 'trg_aa_attendance_server_values'], ['fn', 'att_clock_in_values'], ['trg', 'trg_guard_payroll_lock'], ['trg', 'trg_guard_payroll_items_lock'],
  ['fn', 'replace_payroll_calculation'], ['trg', 'trg_validate_app_settings'], ['tbl', 'auto_clock_out_runs'], ['fn', 'wp_settings_numeric']];
const KEPT = [['fn', 'process_auto_clock_out'], ['fn', 'mco_settings'], ['fn', 'mco_flag_at'], ['trg', 'trg_guard_missing_clock_out_row'], ['trg', 'trg_ab_guard_attendance_totals'],
  ['fn', 'submit_missing_clock_out_request'], ['fn', 'review_missing_clock_out_request'], ['fn', 'approve_payroll_with_adjustments'], ['tbl', 'payroll_adjustments'], ['tbl', 'payroll'], ['tbl', 'attendance']];
const all = async (list) => { const r = []; for (const [k, n] of list) r.push([n, await exists(k, n)]); return r; };

let before = await all(NEW_OBJECTS);
check('RB-0 after applying everything, the new objects exist', before.every(([, e]) => e), JSON.stringify(before.filter(([, e]) => !e)));

const offRule = async () => (await q(`SELECT prosrc FROM pg_proc WHERE proname='report_tracking_event'`))[0]?.prosrc?.includes(`p_event <> 'LOCATION_DENIED'`);
check('RB-0b the "tracking OFF = immediate" rule is active', await offRule());
let err = null;
try { for (const n of [...NEW].reverse()) await db.exec(read(path.join(RB_DIR, `${n}.rollback.sql`))); } catch (e) { err = e.message; }
check('RB-1 the four rollbacks run in reverse order without error', !err, err || '');
const gone = await all(NEW_OBJECTS);
check('RB-2 every object added by the migrations is removed', gone.every(([, e]) => !e), JSON.stringify(gone.filter(([, e]) => e)));
const kept = await all(KEPT);
check('RB-3 unrelated functionality is kept (auto clock-out job + guard, automatic-break guard, missing clock-out workflow, payroll tables)', kept.every(([, e]) => e), JSON.stringify(kept.filter(([, e]) => !e)));
check('RB-3b report_tracking_event / process_stale_tracking restored to the 21 Oct version (functions kept, rule removed)',
  (await exists('fn', 'report_tracking_event')) && (await exists('fn', 'process_stale_tracking')) && !(await offRule()));
err = null; let n = null;
try { n = (await q(`SELECT public.process_auto_clock_out() AS n`))[0].n; } catch (e) { err = e.message; }
check('RB-4 the restored 22 Oct auto clock-out job runs', !err && Number.isInteger(n), err || String(n));
err = null; let c = null;
try { c = (await q(`SELECT * FROM public.mco_settings()`))[0]; } catch (e) { err = e.message; }
check('RB-5 the restored mco_settings() works for the proposal functions', !err && Number(c.limit_hours) === 3, err || JSON.stringify(c));

err = null;
try { for (const nme of NEW) await db.exec(mig(`${nme}.sql`)); } catch (e) { err = e.message; }
const back = await all(NEW_OBJECTS);
check('RB-6 the migrations can be applied again after a rollback', !err && back.every(([, e]) => e) && await offRule(), err || JSON.stringify(back.filter(([, e]) => !e)));
err = null;
try { for (const nme of NEW) await db.exec(mig(`${nme}.sql`)); } catch (e) { err = e.message; }
check('RB-7 applying them a second time is harmless (re-runnable)', !err, err || '');

console.log(`\nRESULT: ${pass} passed, ${fail} failed (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(fail ? 1 : 0);
