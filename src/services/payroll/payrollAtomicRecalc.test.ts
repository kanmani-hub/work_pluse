import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollService } from './payrollService';
import { salaryService } from './salaryService';
import { payrollDataService } from './payrollDataService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { payrollSettingsService } from './payrollSettingsService';
import { supabase } from '../../lib/supabase';

// Recalculation never removes a payroll before its replacement exists; approval re-checks the stored
// figures against the current inputs. Synthetic data only; an in-memory fake replaces the database and
// mirrors replace_payroll_calculation (supabase/migrations/20261028090100_payroll_lock_and_replace.sql,
// which has its own tests on a real database: supabase/tests/payroll/run_attendance_payroll_tests.mjs).
vi.mock('./salaryService', () => ({ salaryService: { getSalaryStructureForPeriod: vi.fn(), getCurrentEmployeeId: vi.fn() } }));
vi.mock('./payrollDataService', () => ({
  payrollDataService: {
    _fetchPayrollDays: vi.fn(), _fetchWfh: vi.fn(), _fetchPermissions: vi.fn(), _fetchApprovedOvertime: vi.fn(), _fetchPayrollAdjustments: vi.fn(),
  },
}));
vi.mock('../settings/globalSettingsService', () => ({ globalSettingsService: { loadSettings: vi.fn() } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({ data: null, error: null })) } }));
vi.mock('./payrollAuditService', () => ({ payrollAuditService: { logEvent: vi.fn(async () => ({ error: null })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn(async () => ({ data: null, error: null })), notifyAdmins: vi.fn() } }));

vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, ops: [], mode: 'ok', failItemsInsert: false };
  const LOCKED = ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'];
  const from = (t: string) => {
    const q: any = { op: 'select', filters: [], payload: null, one: false };
    const run = () => {
      const rows = db.tables[t] || (db.tables[t] = []);
      const match = (r: any) => q.filters.every(([c, v]: any) => r[c] === v);
      if (q.op !== 'select') db.ops.push(`${q.op}:${t}`);
      if (q.op === 'insert') {
        if (t === 'payroll_items' && db.failItemsInsert) return { data: null, error: { code: '23514', message: 'items insert failed (simulated)' } };
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p: any, i: number) => ({ id: `${t}${rows.length + i + 1}`, ...p }));
        rows.push(...list);
        return { data: q.one ? list[0] : list, error: null };
      }
      if (q.op === 'update') { const hit = rows.filter(match); hit.forEach((r: any) => Object.assign(r, q.payload)); return { data: hit.map((r: any) => ({ id: r.id })), error: null }; }
      if (q.op === 'delete') { db.tables[t] = rows.filter((r: any) => !match(r)); return { data: null, error: null }; }
      const hit = rows.filter(match).map((r: any) => ({ ...r }));
      return q.one ? { data: hit[0] ?? null, error: hit[0] ? null : { message: 'no rows' } } : { data: hit, error: null };
    };
    const b: any = {
      select: () => b, insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; }, delete: () => { q.op = 'delete'; return b; },
      eq: (c: string, v: any) => { q.filters.push([c, v]); return b; }, is: () => b,
      single: () => { q.one = true; return b; }, maybeSingle: () => { q.one = true; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  const rpc = async (name: string, args: any) => {
    if (name !== 'replace_payroll_calculation') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    db.ops.push('rpc:replace_payroll_calculation');
    if (db.mode === 'missing') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.replace_payroll_calculation(p_items, p_payroll) in the schema cache' } };
    if (db.mode === 'fail') return { data: null, error: { code: '23514', message: 'new row for relation "payroll_items" violates check constraint' } };
    const p = args.p_payroll; const rows = db.tables.payroll || (db.tables.payroll = []);
    let row = rows.find((r: any) => r.employee_id === p.employee_id && r.payroll_year === p.payroll_year && r.payroll_month === p.payroll_month);
    if (row && LOCKED.includes(row.status)) return { data: null, error: { code: '42501', message: `Payroll for ${p.payroll_month}/${p.payroll_year} is ${row.status} and locked; it cannot be recalculated` } };
    const status = row?.status === 'UNDER_REVIEW' ? 'UNDER_REVIEW' : 'CALCULATED';
    if (row) Object.assign(row, p, { status }); else { row = { id: `payroll${rows.length + 1}`, ...p, status }; rows.push(row); }
    db.tables.payroll_items = (db.tables.payroll_items || []).filter((i: any) => i.payroll_id !== row.id)
      .concat(args.p_items.map((it: any, i: number) => ({ id: `${row.id}-item${i + 1}`, payroll_id: row.id, ...it })));
    return { data: { id: row.id, status, replaced: true }, error: null };
  };
  return { supabase: { from, rpc, __db: db } };
});

const db = (supabase as any).__db;
const PERIOD = ['2026-10-01', '2026-10-31'] as const;
const att = (a: any = {}) => ({
  workingDays: 26, presentDays: 26, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0,
  totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0, ...a,
});
const days = (a: any = {}) => (payrollDataService._fetchPayrollDays as any).mockResolvedValue({
  attendance: att(a), leave: { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 }, days: [], error: null,
});
const oldPayroll = (status: string) => {
  db.tables.payroll = [{ id: 'p-old', employee_id: 'e1', payroll_year: 2026, payroll_month: 10, period_start: PERIOD[0], period_end: PERIOD[1],
    basic_salary: 26000, gross_salary: 26000, total_allowances: 0, total_deductions: 1000, lop_deduction: 1000, overtime_amount: 0, net_salary: 25000, status, remarks: '{}' }];
  db.tables.payroll_items = [
    { id: 'i1', payroll_id: 'p-old', item_type: 'EARNING', item_name: 'Gross Salary', amount: 26000 },
    { id: 'i2', payroll_id: 'p-old', item_type: 'DEDUCTION', item_name: 'LOP Deduction (1 day)', amount: 1000 },
  ];
};
const snapshot = () => JSON.parse(JSON.stringify({ payroll: db.tables.payroll, items: db.tables.payroll_items }));
const recalc = () => payrollService.recalculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]) as Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  db.tables = { payroll: [], payroll_items: [] }; db.ops = []; db.mode = 'ok'; db.failItemsInsert = false;
  (globalSettingsService.loadSettings as any).mockResolvedValue({
    updated_at: '2026-10-01T00:00:00Z',
    app: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
    payroll: { ...payrollSettingsService.getDefaults() },
  });
  (salaryService.getSalaryStructureForPeriod as any).mockResolvedValue({ data: { basic_salary: 26000 }, error: null }); // ₹1,000 a day
  (salaryService.getCurrentEmployeeId as any).mockResolvedValue('admin1');
  days();
  (payrollDataService._fetchWfh as any).mockResolvedValue({ wfhDays: 0, error: null });
  (payrollDataService._fetchPermissions as any).mockResolvedValue({ permissionCount: 0, totalMinutes: 0, error: null });
  (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
  (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue({ data: [], error: null, notSetUp: false });
});

describe('recalculation: calculate first, then replace in one database call', () => {
  it('a calculation that fails leaves the previous payroll and its items untouched (nothing deleted)', async () => {
    oldPayroll('UNDER_REVIEW');
    const before = snapshot();
    (payrollDataService._fetchPayrollDays as any).mockResolvedValue({ attendance: att(), leave: {}, days: [], error: new Error('Attendance could not be loaded: offline') });
    const res = await recalc();
    expect(res.error?.message).toMatch('offline');
    expect(snapshot()).toEqual(before);
    expect(db.ops).toEqual([]); // no delete, no insert, no save call
  });

  it('a correction followed by recalculation replaces the figures in place: same row, UNDER_REVIEW kept, items replaced (no duplicates)', async () => {
    oldPayroll('UNDER_REVIEW');
    days(); // the absence was corrected: full month present
    const res = await recalc();
    expect(res.error).toBeNull();
    expect(db.ops).toEqual(['rpc:replace_payroll_calculation']); // no separate delete / insert
    expect(db.tables.payroll).toHaveLength(1);
    expect(db.tables.payroll[0]).toMatchObject({ id: 'p-old', status: 'UNDER_REVIEW', lop_deduction: 0, total_deductions: 0, net_salary: 26000 });
    expect(db.tables.payroll_items.filter((i: any) => i.payroll_id === 'p-old').map((i: any) => i.item_name)).toEqual(['Gross Salary']);
    // repeated recalculation: still one row, one set of items
    await recalc(); await recalc();
    expect(db.tables.payroll).toHaveLength(1);
    expect(db.tables.payroll_items).toHaveLength(1);
  });

  it('absence → LOP item; summary equals the sum of the item rows', async () => {
    days({ presentDays: 25, absentDays: 1, lopDays: 1 });
    const res = await payrollService.calculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]) as any;
    expect(res.error).toBeNull();
    const p = db.tables.payroll[0];
    const items = db.tables.payroll_items.filter((i: any) => i.payroll_id === p.id);
    const sum = (t: string) => items.filter((i: any) => i.item_type === t).reduce((s: number, i: any) => s + i.amount, 0);
    expect(p).toMatchObject({ status: 'CALCULATED', lop_deduction: 1000, total_deductions: 1000, net_salary: 25000 });
    expect(sum('DEDUCTION')).toBe(p.total_deductions);
    expect(sum('EARNING') - sum('DEDUCTION')).toBe(p.net_salary);
  });

  it('a locked month refused by the database is reported and nothing changes', async () => {
    oldPayroll('UNDER_REVIEW');
    db.tables.payroll[0].status = 'APPROVED'; // e.g. approved in another tab after this screen loaded
    const before = snapshot();
    // the browser check reads APPROVED and refuses before calculating
    expect((await recalc()).error?.message).toBe('Cannot recalculate payroll in APPROVED status.');
    // the database refuses too when the browser check is bypassed (status changed between read and save)
    const res = await payrollService._doCalculate('e1', 2026, 10, PERIOD[0], PERIOD[1], { existingId: 'p-old' }) as any;
    expect(res.error?.message).toMatch('locked');
    expect(snapshot()).toEqual(before);
  });

  it('a save rejected by the database (constraint) keeps the previous payroll', async () => {
    oldPayroll('CALCULATED');
    const before = snapshot();
    db.mode = 'fail';
    const res = await recalc();
    expect(res.error?.message).toMatch('violates check constraint');
    expect(snapshot()).toEqual(before);
  });
});

describe('before migration 20261028090100 is applied (function missing)', () => {
  it('falls back to the previous save, but only after the new figures exist; UNDER_REVIEW is restored', async () => {
    oldPayroll('UNDER_REVIEW');
    db.mode = 'missing';
    const res = await recalc();
    expect(res.error).toBeNull();
    expect(db.ops.slice(0, 5)).toEqual(['rpc:replace_payroll_calculation', 'delete:payroll_items', 'delete:payroll', 'insert:payroll', 'insert:payroll_items']);
    expect(db.tables.payroll).toHaveLength(1);
    expect(db.tables.payroll[0]).toMatchObject({ net_salary: 26000, status: 'UNDER_REVIEW' });
  });

  it('a payroll is never left without its items: an items failure removes the new row and reports it', async () => {
    db.mode = 'missing'; db.failItemsInsert = true;
    const res = await payrollService.calculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]) as any;
    expect(res.error?.message).toMatch('Payroll items could not be saved');
    expect(db.tables.payroll).toHaveLength(0);
  });
});

describe('approval re-checks the stored payroll against the current inputs', () => {
  const calculated = async () => {
    const res = await payrollService.calculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]) as any;
    db.tables.payroll[0].status = 'UNDER_REVIEW';
    return res.data.id as string;
  };

  it('unchanged inputs: approved', async () => {
    const id = await calculated();
    expect((await payrollService.updateStatus(id, 'APPROVED', ['UNDER_REVIEW'])).error).toBeNull();
    expect(db.tables.payroll[0].status).toBe('APPROVED');
  });

  it('an absence recorded after calculation blocks approval until recalculated', async () => {
    const id = await calculated();
    days({ presentDays: 25, absentDays: 1, lopDays: 1 });
    const r = await payrollService.updateStatus(id, 'APPROVED', ['UNDER_REVIEW']);
    expect(r.error?.message).toMatch(/changed after this payroll was calculated \(deductions, LOP deduction, net salary differ\)/);
    expect(db.tables.payroll[0].status).toBe('UNDER_REVIEW');
    await recalc();
    expect((await payrollService.updateStatus(id, 'APPROVED', ['UNDER_REVIEW'])).error).toBeNull();
    expect(db.tables.payroll[0]).toMatchObject({ status: 'APPROVED', lop_deduction: 1000, net_salary: 25000 });
  });

  it('overtime approved after calculation blocks approval', async () => {
    const id = await calculated();
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 120, error: null });
    const r = await payrollService.updateStatus(id, 'APPROVED', ['UNDER_REVIEW']);
    expect(r.error?.message).toMatch(/overtime, net salary differ/);
  });

  it('if the inputs cannot be read, nothing is approved', async () => {
    const id = await calculated();
    (payrollDataService._fetchWfh as any).mockResolvedValue({ wfhDays: 0, error: new Error('WFH could not be loaded') });
    const r = await payrollService.updateStatus(id, 'APPROVED', ['UNDER_REVIEW']);
    expect(r.error?.message).toMatch('could not be re-checked');
    expect(db.tables.payroll[0].status).toBe('UNDER_REVIEW');
  });
});
