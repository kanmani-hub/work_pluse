/**
 * Mock Supabase backend for the responsive UI suite (synthetic data only).
 *
 * The app under test is started with VITE_SUPABASE_URL=https://mockproj.supabase.co (see
 * playwright.responsive.config.ts). Every request to that host is answered here, inside the
 * browser, by a small PostgREST emulator; every other non-localhost request is aborted and
 * recorded, so a misconfigured run can never reach a real Supabase project or any other service.
 */
import type { Page } from '@playwright/test';

export const MOCK_HOST = 'mockproj.supabase.co';
const STORAGE_KEY = 'sb-mockproj-auth-token';

export type Role = 'ADMIN' | 'HR' | 'EMPLOYEE' | 'ANON';
type Row = Record<string, any>;
type Db = Record<string, Row[]>;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const at = (date: Date, hh: number, mm: number) => new Date(`${ymd(date)}T${pad(hh)}:${pad(mm)}:00+05:30`).toISOString();
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const ROLE_IDS = { ADMIN: 'a0000000-0000-4000-8000-0000000000a1', HR: 'a0000000-0000-4000-8000-0000000000a2', EMPLOYEE: 'a0000000-0000-4000-8000-0000000000a3' };
export const USERS = {
  ADMIN: { authId: '11111111-1111-4111-8111-111111111111', empId: 'e1111111-1111-4111-8111-111111111111', email: 'admin.test@example.invalid' },
  HR: { authId: '22222222-2222-4222-8222-222222222222', empId: 'e2222222-2222-4222-8222-222222222222', email: 'hr.test@example.invalid' },
  EMPLOYEE: { authId: '33333333-3333-4333-8333-333333333333', empId: 'e3333333-3333-4333-8333-333333333333', email: 'employee.test@example.invalid' },
};

/** Synthetic records with long names, long text and large amounts (the layouts' worst cases). */
export function buildFixtures(size: 'empty' | 'populated' = 'populated'): Db {
  seq = 0;
  const db: Db = {};
  const today = new Date();
  const populated = size === 'populated';
  db.roles = Object.entries(ROLE_IDS).map(([name, id]) => ({ id, name }));
  db.departments = [
    { id: 'd0000000-0000-4000-8000-000000000001', name: 'Engineering', code: 'ENG', is_active: true },
    { id: 'd0000000-0000-4000-8000-000000000002', name: 'Human Resources and Organisational Development Services', code: 'HR', is_active: true },
  ];
  db.offices = [{ id: 'f0000000-0000-4000-8000-000000000001', name: 'Chennai Head Office — Tower B, 14th Floor', address: '123 Long Example Road, Guindy Industrial Estate, Chennai 600032', latitude: 13.0108, longitude: 80.2123, radius_meters: 150, is_active: true, status: 'ACTIVE' }];
  db.shift_templates = [
    { id: 'c0000000-0000-4000-8000-000000000001', name: 'General Shift', code: 'GEN', shift_type: 'FIXED', start_time: '09:00:00', end_time: '18:00:00', required_hours: 8, break_duration_minutes: 60, crosses_midnight: false, is_active: true },
    { id: 'c0000000-0000-4000-8000-000000000002', name: 'Night Shift', code: 'NIGHT', shift_type: 'FIXED', start_time: '22:00:00', end_time: '06:00:00', required_hours: 8, break_duration_minutes: 45, crosses_midnight: true, is_active: true },
  ];
  const first = ['Venkatanarasimharajuvaripeta', 'Ana', 'Priyadharshini', 'Mohammed Abdul', 'Christopher-Alexander', 'Ravi'];
  const last = ['Subramaniam Krishnamoorthy', 'Lee', 'Ramachandran', 'Rahman Siddiqui', 'Montgomery-Wellington', 'K'];
  db.employees = [
    { id: USERS.ADMIN.empId, employee_code: 'ADM001', first_name: 'Asha', last_name: 'Admin', email: USERS.ADMIN.email, joining_date: '2024-01-01', department_id: db.departments[0].id, office_id: db.offices[0].id, role_id: ROLE_IDS.ADMIN, designation: 'System Administrator', status: 'ACTIVE' },
    { id: USERS.HR.empId, employee_code: 'HR001', first_name: 'Harini', last_name: 'Rao', email: USERS.HR.email, joining_date: '2024-01-01', department_id: db.departments[1].id, office_id: db.offices[0].id, role_id: ROLE_IDS.HR, designation: 'HR Manager', status: 'ACTIVE' },
    { id: USERS.EMPLOYEE.empId, employee_code: 'EMP001', first_name: first[0], last_name: last[0], email: USERS.EMPLOYEE.email, joining_date: '2024-02-01', department_id: db.departments[1].id, office_id: db.offices[0].id, role_id: ROLE_IDS.EMPLOYEE, designation: 'Senior Software Engineer (Platform Reliability)', status: 'ACTIVE' },
  ];
  for (let i = 0; populated && i < 18; i++) db.employees.push({ id: uid(), employee_code: `EMP${String(i + 2).padStart(3, '0')}`, first_name: first[i % 6], last_name: last[(i * 5) % 6], email: `test.user${i}@example.invalid`, joining_date: '2024-03-01', department_id: db.departments[i % 2].id, office_id: db.offices[0].id, role_id: ROLE_IDS.EMPLOYEE, designation: i % 3 ? 'Associate' : 'Principal Engineer, Payments Platform Infrastructure', status: 'ACTIVE' });
  db.profiles = (Object.keys(USERS) as (keyof typeof USERS)[]).map(r => ({ id: uid(), auth_user_id: USERS[r].authId, employee_id: USERS[r].empId, role_id: ROLE_IDS[r], is_active: true }));
  db.shift_assignments = db.employees.map(e => ({ id: uid(), employee_id: e.id, shift_template_id: db.shift_templates[0].id, effective_date: '2024-01-01', end_date: null, assignment_type: 'PERMANENT', is_active: true }));
  db.attendance = []; db.attendance_breaks = []; db.attendance_events = [];
  for (const [ei, e] of db.employees.entries()) for (let d = 1; populated && d <= 12; d++) {
    const date = daysAgo(d); if (date.getDay() === 0) continue;
    const id = uid(); const late = (ei + d) % 5 === 0 ? 35 : 0;
    db.attendance.push({ id, employee_id: e.id, attendance_date: ymd(date), clock_in_at: at(date, 9, late ? 35 : 2), clock_out_at: at(date, 18, 10), status: 'COMPLETED', required_hours: 8, worked_hours: 8.6, break_minutes: 55, late_minutes: late, early_logout_minutes: 0, overtime_minutes: 0, is_half_day: false, shift_template_id: db.shift_templates[0].id, work_mode: 'OFFICE' });
    db.attendance_breaks.push({ id: uid(), attendance_id: id, employee_id: e.id, break_type: 'LUNCH', started_at: at(date, 13, 0), ended_at: at(date, 13, 55), duration_minutes: 55 });
  }
  if (populated) db.attendance.push({ id: uid(), employee_id: USERS.EMPLOYEE.empId, attendance_date: ymd(today), clock_in_at: at(today, 9, 5), clock_out_at: null, status: 'WORKING', required_hours: 8, break_minutes: 0, late_minutes: 0, shift_template_id: db.shift_templates[0].id, work_mode: 'OFFICE' });
  db.leave_types = [{ id: 'b0000000-0000-4000-8000-000000000001', name: 'Casual Leave', code: 'CL', is_paid: true, is_active: true }];
  const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
  const n = populated ? 12 : 0;
  const pick = (i: number) => db.employees[i % db.employees.length];
  const longReason = 'Family function in the native village; travelling by overnight train and returning the following Monday morning.';
  db.leave_requests = Array.from({ length: n }, (_, i) => ({ id: uid(), employee_id: pick(i).id, leave_type_id: db.leave_types[0].id, start_date: ymd(daysAgo(-3 - i)), end_date: ymd(daysAgo(-4 - i)), total_days: 2, reason: longReason, status: statuses[i % 4], is_half_day: false, created_at: daysAgo(i).toISOString() }));
  db.leave_balances = db.employees.map(e => ({ id: uid(), employee_id: e.id, leave_type_id: db.leave_types[0].id, year: today.getFullYear(), total_days: 12, used_days: 3, pending_days: 1, remaining_days: 8 }));
  db.wfh_requests = Array.from({ length: n }, (_, i) => ({ id: uid(), employee_id: pick(i).id, request_date: ymd(daysAgo(-2 - i)), reason: longReason, status: statuses[i % 4], created_at: daysAgo(i).toISOString() }));
  db.permission_requests = Array.from({ length: n }, (_, i) => ({ id: uid(), employee_id: pick(i).id, permission_date: ymd(daysAgo(i)), start_time: '10:00:00', end_time: '11:30:00', duration_minutes: 90, reason: longReason, status: statuses[i % 4], created_at: daysAgo(i).toISOString() }));
  db.overtime_requests = Array.from({ length: n }, (_, i) => ({ id: uid(), employee_id: pick(i).id, attendance_id: db.attendance[i]?.id ?? null, shift_id: db.shift_templates[0].id, work_date: ymd(daysAgo(i + 1)), scheduled_hours: 8, actual_working_hours: 10.25, eligible_overtime_hours: 2.25, requested_overtime_hours: 2, approved_overtime_hours: statuses[i % 4] === 'APPROVED' ? 2 : statuses[i % 4] === 'REJECTED' ? 0 : null, employee_reason: longReason, status: statuses[i % 4], request_type: 'OVERTIME', created_at: daysAgo(i).toISOString() }));
  db.salary_structures = db.employees.map((e, i) => ({ id: uid(), employee_id: e.id, basic_salary: i === 2 ? 1234567.5 : 45000 + i * 1000, hra: 18000, transport_allowance: 1600, medical_allowance: 1250, special_allowance: 9000, other_allowances: 0, standard_deduction: 200, effective_from: '2024-01-01', effective_to: null, is_active: true }));
  db.payroll = []; db.payroll_items = []; db.payroll_payments = []; db.payslips = [];
  for (let m = 1; populated && m <= 2; m++) {
    const start = new Date(today.getFullYear(), today.getMonth() - m, 1); const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    for (const [i, e] of db.employees.entries()) {
      const id = uid(); const gross = i === 2 ? 12345678.9 : 75000 + i * 1000; const ded = i % 3 === 0 ? 2345.5 : 0;
      const status = m === 1 ? ['CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'PAID'][i % 4] : 'PAID';
      db.payroll.push({ id, employee_id: e.id, payroll_year: start.getFullYear(), payroll_month: start.getMonth() + 1, period_start: ymd(start), period_end: ymd(end), basic_salary: gross * 0.6, gross_salary: gross, total_allowances: gross * 0.4, total_deductions: ded, lop_deduction: ded ? 1000 : 0, overtime_amount: i % 5 === 0 ? 1875.25 : 0, net_salary: gross - ded, status, calculated_at: end.toISOString(), remarks: JSON.stringify({ attendance: { workingDays: 26, presentDays: 24, reviewItems: [] }, deductionBreakdown: ded ? [{ name: 'LOP Deduction (1d unauthorized absence)', amount: 1000 }] : [] }) });
      db.payroll_items.push({ id: uid(), payroll_id: id, item_type: 'EARNING', item_name: 'Gross Salary', amount: gross });
      if (status === 'PAID') {
        db.payroll_payments.push({ id: uid(), payroll_id: id, paid_at: end.toISOString(), amount: gross - ded, payment_method: 'BANK_TRANSFER', transaction_reference: `UTR${100000000000 + i}`, paid_by: USERS.ADMIN.empId });
        db.payslips.push({ id: uid(), payroll_id: id, employee_id: e.id, payslip_number: `PS-${start.getFullYear()}${pad(start.getMonth() + 1)}-${String(i).padStart(4, '0')}`, generated_at: end.toISOString() });
      }
    }
  }
  db.notifications = Array.from({ length: populated ? 8 : 0 }, (_, i) => ({ id: uid(), recipient_employee_id: i % 2 ? USERS.EMPLOYEE.empId : USERS.ADMIN.empId, notification_type: 'LEAVE', title: 'Payroll for September 2026 has been approved and is now awaiting payment processing', message: 'Your request for 2 days of casual leave has been approved.', is_read: i % 3 === 0, priority: 'NORMAL', created_at: daysAgo(i / 3).toISOString() }));
  db.audit_logs = Array.from({ length: populated ? 20 : 0 }, (_, i) => ({ id: uid(), actor_employee_id: USERS.ADMIN.empId, action: 'PAYROLL_APPROVED', module: 'PAYROLL', entity_type: 'payroll', entity_id: uid(), description: 'Payroll status changed from UNDER_REVIEW to APPROVED, net ₹12,345,678.90', old_values: { status: 'UNDER_REVIEW' }, new_values: { status: 'APPROVED' }, source: 'WEB', created_at: daysAgo(i / 4).toISOString() }));
  db.rosters = populated ? [{ id: 'c1000000-0000-4000-8000-000000000001', name: 'October Roster', start_date: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), end_date: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)), status: 'PUBLISHED', department_id: db.departments[0].id }] : [];
  db.roster_assignments = [];
  for (const e of populated ? db.employees.slice(0, 6) : []) for (let d = 0; d < 10; d++) db.roster_assignments.push({ id: uid(), roster_id: db.rosters[0].id, employee_id: e.id, assignment_date: ymd(daysAgo(-d)), shift_template_id: db.shift_templates[d % 2].id, day_type: d % 7 === 6 ? 'WEEK_OFF' : 'WORK' });
  db.employee_live_locations = (populated ? db.employees.slice(0, 8) : []).map((e, i) => ({ id: uid(), employee_id: e.id, latitude: 13.01 + i * 0.0004, longitude: 80.21 + i * 0.0004, accuracy_meters: 12, location_status: ['INSIDE', 'OUTSIDE', 'STALE', 'UNAVAILABLE'][i % 4], last_seen_at: new Date(Date.now() - i * 240000).toISOString(), office_id: db.offices[0].id }));
  for (const t of ['employee_location_history', 'geofence_events', 'location_verification_events', 'face_verification_events', 'payroll_adjustments', 'notification_devices']) db[t] = [];
  db.face_registrations = db.employees.slice(0, 3).map(e => ({ id: uid(), employee_id: e.id, status: 'ACTIVE', registered_at: daysAgo(30).toISOString() }));
  db.app_settings = [{ id: '00000000-0000-0000-0000-000000000001', settings: {}, updated_at: daysAgo(1).toISOString() }];
  if (populated) addBreakTrackingScenario(db);
  return db;
}

/**
 * Today's Break Management cases, all relative to the real clock so staleness is computed from
 * actual timestamps (threshold: 15 minutes, LIVE_STALE_MINUTES):
 *   live (fix 2 min ago, on break) · stale (fix 40 min ago, on break, over the allowance)
 *   permission denied (newer than the last fix) · location unavailable (no fix today)
 *   no location row at all · location row without a timestamp · clocked out with excess
 */
export const BREAK_SCENARIO = ['LIVE', 'STALE', 'PERMISSION', 'UNAVAILABLE', 'NO_DATA', 'NO_TIMESTAMP', 'CLOCKED_OUT_EXCESS'] as const;
function addBreakTrackingScenario(db: Db) {
  const now = Date.now();
  const ago = (m: number) => new Date(now - m * 60000).toISOString();
  const istToday = new Date(now + 330 * 60000).toISOString().slice(0, 10);
  const people = db.employees.slice(3, 3 + BREAK_SCENARIO.length);
  const ids = new Set(people.map(e => e.id));
  db.employee_live_locations = db.employee_live_locations.filter(l => !ids.has(l.employee_id));
  people.forEach((e, i) => {
    const kind = BREAK_SCENARIO[i];
    const attId = uid();
    const clockedOut = kind === 'CLOCKED_OUT_EXCESS';
    db.attendance.push({ id: attId, employee_id: e.id, attendance_date: istToday, clock_in_at: ago(170), clock_out_at: clockedOut ? ago(5) : null, status: clockedOut ? 'COMPLETED' : 'WORKING', required_hours: 8, break_minutes: clockedOut ? 75 : kind === 'PERMISSION' ? 45 : 0, break_overrun_minutes: clockedOut ? 15 : 0, late_minutes: 0, shift_template_id: db.shift_templates[0].id, work_mode: 'OFFICE' });
    const brk = (start: number, end: number | null, type = 'REGULAR') => db.attendance_breaks.push({ id: uid(), attendance_id: attId, employee_id: e.id, break_type: type, started_at: ago(start), ended_at: end === null ? null : ago(end), duration_minutes: end === null ? null : start - end });
    const live = (lastSeen: string | null, side: string) => db.employee_live_locations.push({ id: uid(), employee_id: e.id, latitude: 13.0108, longitude: 80.2123, accuracy_meters: 15, location_status: side, location_context: 'OFFICE', last_seen_at: lastSeen, office_id: db.offices[0].id });
    if (kind === 'LIVE') { brk(25, null); live(ago(2), 'INSIDE_GEOFENCE'); }
    if (kind === 'STALE') { brk(70, null, 'AUTO_GPS'); live(ago(40), 'OUTSIDE_GEOFENCE'); }
    if (kind === 'PERMISSION') { brk(120, 75); live(ago(30), 'INSIDE_GEOFENCE'); db.location_verification_events.push({ id: uid(), employee_id: e.id, result: 'LOCATION_DENIED', verified_at: ago(5) }); }
    if (kind === 'UNAVAILABLE') { db.location_verification_events.push({ id: uid(), employee_id: e.id, result: 'LOCATION_UNAVAILABLE', verified_at: ago(3) }); }
    if (kind === 'NO_TIMESTAMP') { live(null, 'INSIDE_GEOFENCE'); }
    if (clockedOut) { brk(150, 110); brk(60, 25); }
  });
}

// ---------------------------------------------------------------- tiny PostgREST emulator
const FK_TABLE: Record<string, string> = { employee_id: 'employees', shift_template_id: 'shift_templates', shift_id: 'shift_templates', department_id: 'departments', office_id: 'offices', role_id: 'roles', attendance_id: 'attendance', leave_type_id: 'leave_types', payroll_id: 'payroll', roster_id: 'rosters', reviewed_by: 'employees', approved_by: 'employees', actor_employee_id: 'employees', paid_by: 'employees', recipient_employee_id: 'employees' };
const SINGULAR: Record<string, string> = { employees: 'employee', shift_templates: 'shift_template', departments: 'department', offices: 'office', roles: 'role', attendance: 'attendance', payroll: 'payroll', leave_types: 'leave_type', rosters: 'roster' };
type Embed = { alias: string; target: string; hint?: string; inner: string };

function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function parseSelect(sel: string): Embed[] {
  return splitTop(sel || '*').flatMap(it => {
    const m = /^(?:([a-zA-Z_]+):)?([a-zA-Z_]+)(?:!([a-zA-Z_]+))?(?:!inner)?\((.*)\)$/s.exec(it.replace(/\s+/g, ' '));
    return m ? [{ alias: m[1] || m[2], target: m[2], hint: m[3], inner: m[4] }] : [];
  });
}
function resolveEmbed(db: Db, row: Row, table: string, e: Embed): Row | Row[] | null {
  let fkCol: string | null = null; let tgt = e.target;
  if (FK_TABLE[e.target]) { fkCol = e.target; tgt = FK_TABLE[e.target]; }
  else if (e.hint) { const h = e.hint.replace(new RegExp(`^${table}_`), '').replace(/_fkey$/, ''); if (row[h] !== undefined || FK_TABLE[h]) fkCol = h; }
  if (!fkCol && SINGULAR[tgt] && row[`${SINGULAR[tgt]}_id`] !== undefined) fkCol = `${SINGULAR[tgt]}_id`;
  const rows = db[tgt] || [];
  if (fkCol) { const hit = rows.find(r => r.id === row[fkCol!]); return hit ? shape(db, hit, tgt, e.inner) : null; }
  const back = `${SINGULAR[table] || table.replace(/s$/, '')}_id`;
  return rows.filter(r => r[back] === row.id).map(r => shape(db, r, tgt, e.inner));
}
function shape(db: Db, row: Row, table: string, sel: string): Row {
  const out: Row = { ...row };
  for (const e of parseSelect(sel)) out[e.alias] = resolveEmbed(db, row, table, e);
  return out;
}
function compare(v: unknown, op: string, raw: string): boolean {
  const s = v === null || v === undefined ? null : String(v);
  switch (op) {
    case 'eq': return s === raw;
    case 'neq': return s !== raw;
    case 'gt': return s !== null && s > raw;
    case 'gte': return s !== null && s >= raw;
    case 'lt': return s !== null && s < raw;
    case 'lte': return s !== null && s <= raw;
    case 'is': return raw === 'null' ? s === null : raw === 'true' ? v === true : raw === 'false' ? v === false : true;
    case 'in': return raw.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')).includes(s ?? '');
    case 'like': case 'ilike': {
      const re = new RegExp(`^${raw.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*')}$`, op === 'ilike' ? 'i' : '');
      return s !== null && re.test(s);
    }
    default: return true;
  }
}
function matchCond(row: Row, col: string, expr: string): boolean {
  if (col.includes('.')) return true; // filters on embedded resources are not emulated
  let neg = false; if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf('.');
  const r = compare(row[col], expr.slice(0, i), decodeURIComponent(expr.slice(i + 1)));
  return neg ? !r : r;
}
const IGNORED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'and']);
function filterRows(rows: Row[], params: [string, string][]): Row[] {
  return rows.filter(row => params.every(([k, v]) => {
    if (IGNORED.has(k)) return true;
    if (k === 'or') return splitTop(v.replace(/^\(|\)$/g, '')).some(p => { const i = p.indexOf('.'); return matchCond(row, p.slice(0, i), p.slice(i + 1)); });
    return matchCond(row, k, v);
  }));
}
function orderRows(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(',').map(o => { const [c, dir] = o.split('.'); return [c, dir === 'desc' ? -1 : 1] as const; });
  return [...rows].sort((a, b) => { for (const [c, d] of keys) { const x = a[c] ?? ''; const y = b[c] ?? ''; if (x < y) return -d; if (x > y) return d; } return 0; });
}

export interface MockHandle { db: Db; blockedHosts: Set<string> }

/** Signs the page in as `role` (or not at all for ANON) and answers every Supabase call from fixtures. */
export async function installMockSupabase(page: Page, role: Role = 'ADMIN', size: 'empty' | 'populated' = 'populated'): Promise<MockHandle> {
  const db = buildFixtures(size);
  const blockedHosts = new Set<string>();
  const user = role === 'ANON' ? { authId: '00000000-0000-4000-8000-000000000000', email: 'anon@example.invalid' } : USERS[role];
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const authUser = { id: user.authId, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2024-01-01T00:00:00Z' };
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.authId, role: 'authenticated', exp: now + 7200 })}.mock`, token_type: 'bearer', expires_in: 7200, expires_at: now + 7200, refresh_token: 'mock-refresh', user: authUser };
  if (role !== 'ANON') await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } }, [STORAGE_KEY, JSON.stringify(session)]);
  // GPS is reported as unavailable: tests never produce a location or a clock-in from it
  await page.addInitScript(() => {
    const denied = (_ok: unknown, err?: (e: { code: number; message: string }) => void) => { err?.({ code: 1, message: 'denied (test)' }); return 1; };
    try { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: denied, watchPosition: denied, clearWatch: () => {} } }); } catch { /* read-only in this browser */ }
  });
  await page.routeWebSocket(/.*/, ws => {
    ws.onMessage(msg => {
      try {
        const m = JSON.parse(String(msg));
        if (Array.isArray(m)) { if (m[3] === 'phx_join' || m[3] === 'heartbeat') ws.send(JSON.stringify([m[0], m[1], m[2], 'phx_reply', { status: 'ok', response: {} }])); }
        else if (m.event === 'phx_join' || m.event === 'heartbeat') ws.send(JSON.stringify({ topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref }));
      } catch { /* not a realtime frame */ }
    });
  });
  await page.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    if (url.hostname !== MOCK_HOST) { blockedHosts.add(url.hostname); return route.abort(); }
    const headersOut = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...headersOut, ...extra }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: headersOut });
    const p = url.pathname;
    if (p.startsWith('/auth/v1/')) {
      if (role === 'ANON') return json(401, { message: 'not signed in' });
      if (p.endsWith('/user')) return json(200, authUser);
      if (p.endsWith('/logout')) return route.fulfill({ status: 204, headers: headersOut });
      return json(200, session);
    }
    if (p.startsWith('/functions/v1/')) return json(200, { success: false, status: 'FACE_NOT_MATCHED', failureReason: 'Not available in tests' });
    if (p.startsWith('/rest/v1/rpc/')) return json(200, null);
    const m = /^\/rest\/v1\/([a-z_]+)/.exec(p);
    if (!m) return json(404, { message: 'not mocked' });
    const table = m[1]; db[table] ||= [];
    const params = [...url.searchParams.entries()];
    const sel = url.searchParams.get('select') || '*';
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    const prefer = req.headers()['prefer'] || '';
    const finish = (rows: Row[], status = 200) => {
      const shaped = rows.map(r => shape(db, r, table, sel));
      if (wantsObject) return shaped.length === 1 ? json(status, shaped[0]) : json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
      const extra: Record<string, string> = prefer.includes('count=') ? { 'content-range': `0-${Math.max(0, shaped.length - 1)}/${shaped.length}` } : {};
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headersOut, ...extra } });
      return json(status, shaped, extra);
    };
    const method = req.method();
    if (method === 'GET' || method === 'HEAD') {
      const off = Number(url.searchParams.get('offset') || 0); const lim = url.searchParams.get('limit');
      return finish(orderRows(filterRows(db[table], params), url.searchParams.get('order')).slice(off, lim ? off + Number(lim) : undefined));
    }
    let body: any = null; try { body = req.postDataJSON(); } catch { body = null; }
    if (method === 'POST') { const list = (Array.isArray(body) ? body : [body || {}]).map((r: Row) => ({ id: uid(), created_at: new Date().toISOString(), ...r })); db[table].push(...list); return finish(list, 201); }
    if (method === 'PATCH') { const hit = filterRows(db[table], params); hit.forEach(r => Object.assign(r, body || {})); return finish(hit); }
    if (method === 'DELETE') { const hit = filterRows(db[table], params); db[table] = db[table].filter(r => !hit.includes(r)); return finish(hit); }
    return json(405, {});
  });
  return { db, blockedHosts };
}
