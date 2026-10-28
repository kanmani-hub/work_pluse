import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollService } from './payrollService';
import { salaryService } from './salaryService';
import { payrollDataService } from './payrollDataService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { payrollSettingsService } from './payrollSettingsService';
import { supabase } from '../../lib/supabase';

// Payroll policy matrix: overtime pay on/off, unapproved overtime, missing clock-out adjustments,
// settings changes before approval, and row ↔ items reconciliation. Synthetic data only; an in-memory fake replaces the database and
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


const calcMonth = () => payrollService.calculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]) as Promise<any>;
const settingsWith = (over: any) => (globalSettingsService.loadSettings as any).mockResolvedValue({
  updated_at: '2026-10-01T00:00:00Z',
  app: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
  payroll: { ...payrollSettingsService.getDefaults(), ...over },
});
const reconciles = () => {
  const p = db.tables.payroll[0];
  const items = db.tables.payroll_items.filter((i: any) => i.payroll_id === p.id);
  const sum = (t: string) => items.filter((i: any) => i.item_type === t).reduce((s: number, i: any) => s + Number(i.amount), 0);
  return Math.abs(sum('DEDUCTION') - p.total_deductions) < 0.005 && Math.abs(sum('EARNING') - sum('DEDUCTION') - p.net_salary) < 0.005;
};
const adj = (o: any) => ({ id: 'a1', reference: 'MCO-DED:att1', kind: 'MISSING_CLOCK_OUT_DEDUCTION', status: 'PENDING', work_date: '2026-10-05', amount: 200, hours: null, ...o });

describe('Enable Overtime Pay and approval rules', () => {
  it('approved overtime is paid when overtime pay is on (2 h × ₹125/h × 1.5 = ₹375), with its own item', async () => {
    settingsWith({ enableOvertimePay: true, overtimeRateType: 'multiplier', overtimeMultiplier: 1.5 });
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 120, error: null });
    await calcMonth();
    expect(db.tables.payroll[0]).toMatchObject({ overtime_amount: 375, net_salary: 26375 });
    expect(db.tables.payroll_items.map((i: any) => i.item_name)).toContain('Approved Overtime');
    expect(reconciles()).toBe(true);
  });

  it('switched off: the same approved overtime pays ₹0, no overtime item, net unchanged', async () => {
    settingsWith({ enableOvertimePay: false });
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 120, error: null });
    await calcMonth();
    expect(db.tables.payroll[0]).toMatchObject({ overtime_amount: 0, net_salary: 26000 });
    expect(db.tables.payroll_items.map((i: any) => i.item_name)).not.toContain('Approved Overtime');
    expect(reconciles()).toBe(true);
  });

  it('unapproved overtime (extra time recorded on attendance, no approved request) never increases pay', async () => {
    settingsWith({ enableOvertimePay: true });
    days({ totalOvertimeMinutes: 240 });     // recorded on attendance
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
    await calcMonth();
    expect(db.tables.payroll[0].overtime_amount).toBe(0);
    expect(db.tables.payroll[0].net_salary).toBe(26000);
  });

  it('approved overtime that cannot be loaded stops the calculation (never paid as ₹0 silently)', async () => {
    settingsWith({ enableOvertimePay: true });
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: new Error('Approved overtime could not be loaded: offline') });
    const res = await calcMonth();
    expect(res.error?.message).toMatch('offline');
    expect(db.tables.payroll).toHaveLength(0);
  });
});

describe('missing clock-out adjustments in payroll', () => {
  it('a rejected case (PENDING adjustment) is one ₹200 deduction line; it reconciles with the totals', async () => {
    (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue({ data: [adj({})], error: null, notSetUp: false });
    await calcMonth();
    expect(db.tables.payroll[0]).toMatchObject({ total_deductions: 200, net_salary: 25800 });
    expect(db.tables.payroll_items.filter((i: any) => i.item_name.startsWith('Missing Clock-Out Deduction'))).toHaveLength(1);
    expect(JSON.parse(db.tables.payroll[0].remarks).missingClockOutAdjustments.ids).toEqual(['a1']);
    expect(reconciles()).toBe(true);
  });

  it('pending correction (no adjustment), cancelled or already settled deductions are not deducted', async () => {
    (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue({ data: [adj({ id: 'c', status: 'CANCELLED' }), adj({ id: 's', status: 'SETTLED' })], error: null, notSetUp: false });
    await calcMonth();
    expect(db.tables.payroll[0]).toMatchObject({ total_deductions: 0, net_salary: 26000 });
  });

  it('recalculating twice with the same pending case: still one deduction line (no duplicate)', async () => {
    (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue({ data: [adj({})], error: null, notSetUp: false });
    await calcMonth();
    await payrollService.recalculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]);
    await payrollService.recalculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]);
    expect(db.tables.payroll).toHaveLength(1);
    expect(db.tables.payroll_items.filter((i: any) => i.item_type === 'DEDUCTION')).toHaveLength(1);
  });

  it('a correction approved after calculation (deduction cancelled) blocks approval until recalculated', async () => {
    (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue({ data: [adj({})], error: null, notSetUp: false });
    const id = (await calcMonth()).data.id;
    db.tables.payroll[0].status = 'UNDER_REVIEW';
    (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue({ data: [adj({ status: 'CANCELLED' })], error: null, notSetUp: false });
    const r = await payrollService.updateStatus(id, 'APPROVED', ['UNDER_REVIEW']);
    expect(r.error?.message).toMatch(/changed after this payroll was calculated \(deductions, net salary differ\)/);
    await payrollService.recalculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]);
    expect(db.tables.payroll[0]).toMatchObject({ total_deductions: 0, net_salary: 26000, status: 'UNDER_REVIEW' });
  });
});

describe('settings changes and unlocked / locked payroll', () => {
  it('a payroll-settings change after calculation blocks approval; recalculation applies the new setting', async () => {
    settingsWith({ lateDeductionMethod: 'interval_based', lateIntervalMinutes: 15, lateIntervalAmount: 100 });
    days({ lateLogins: 1, totalLateMinutes: 30, lateRecords: [{ date: '2026-10-05', lateMinutes: 30 }] });
    const id = (await calcMonth()).data.id;
    expect(db.tables.payroll[0].total_deductions).toBe(200);
    db.tables.payroll[0].status = 'UNDER_REVIEW';
    settingsWith({ lateDeductionMethod: 'interval_based', lateIntervalMinutes: 15, lateIntervalAmount: 150 });
    expect((await payrollService.updateStatus(id, 'APPROVED', ['UNDER_REVIEW'])).error?.message).toMatch('Recalculate the payroll before approving');
    await payrollService.recalculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1]);
    expect(db.tables.payroll[0].total_deductions).toBe(300);
    expect((await payrollService.updateStatus(id, 'APPROVED', ['UNDER_REVIEW'])).error).toBeNull();
  });

  it('a settings change never touches an approved payroll (recalculation refused, figures kept)', async () => {
    const id = (await calcMonth()).data.id;
    db.tables.payroll[0].status = 'APPROVED';
    const before = JSON.stringify(db.tables);
    settingsWith({ lopMethod: 'fixed', lopAmount: 5000 });
    expect((await payrollService.recalculatePayroll('e1', 2026, 10, PERIOD[0], PERIOD[1])).error?.message).toBe('Cannot recalculate payroll in APPROVED status.');
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(id).toBeTruthy();
  });
});
