import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollService, settledAdjustmentIds } from './payrollService';
import { earningAdjustmentItems } from './payrollRules';
import { salaryService } from './salaryService';
import { payrollDataService } from './payrollDataService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { payrollSettingsService } from './payrollSettingsService';
import { supabase } from '../../lib/supabase';

// Payroll integration of missing clock-out adjustments. payrollSettingsService is real (rounding,
// 26-day divisor). Synthetic data only; no database is used.
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
  const db: any = { tables: { payroll: [], payroll_items: [] }, rpcCalls: [], rpcResult: null, updates: 0, replaceCalls: 0 };
  const from = (t: string) => {
    const q: any = { op: 'select', filters: [], payload: null, one: false };
    const run = () => {
      const rows = db.tables[t] || (db.tables[t] = []);
      const match = (r: any) => q.filters.every(([c, v]: any) => r[c] === v);
      if (q.op === 'insert') {
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p: any, i: number) => ({ id: `${t}${rows.length + i + 1}`, ...p }));
        rows.push(...list);
        return { data: q.one ? list[0] : list, error: null };
      }
      if (q.op === 'update') { db.updates++; const hit = rows.filter(match); hit.forEach((r: any) => Object.assign(r, q.payload)); return { data: hit.map((r: any) => ({ id: r.id })), error: null }; }
      const hit = rows.filter(match).map((r: any) => ({ ...r }));
      return q.one ? { data: hit[0] ?? null, error: hit[0] ? null : { message: 'no rows' } } : { data: hit, error: null };
    };
    const b: any = {
      select: () => b, insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: any) => { q.filters.push([c, v]); return b; },
      single: () => { q.one = true; return b; }, maybeSingle: () => { q.one = true; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  const rpc = async (name: string, args: any) => {
    if (name === 'replace_payroll_calculation') {
      // mirrors supabase/migrations/20261028090100: one row per employee + month, items replaced with it,
      // locked months refused, UNDER_REVIEW kept
      db.replaceCalls++;
      const p = args.p_payroll; const rows = db.tables.payroll;
      let row = rows.find((r: any) => r.employee_id === p.employee_id && r.payroll_year === p.payroll_year && r.payroll_month === p.payroll_month);
      if (row && ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'].includes(row.status)) return { data: null, error: { code: '42501', message: `Payroll is ${row.status} and locked` } };
      const status = row?.status === 'UNDER_REVIEW' ? 'UNDER_REVIEW' : 'CALCULATED';
      if (row) Object.assign(row, p, { status }); else { row = { id: `payroll${rows.length + 1}`, ...p, status }; rows.push(row); }
      db.tables.payroll_items = db.tables.payroll_items.filter((i: any) => i.payroll_id !== row.id)
        .concat(args.p_items.map((it: any, i: number) => ({ id: `${row.id}-item${i + 1}`, payroll_id: row.id, ...it })));
      return { data: { id: row.id, status, replaced: status !== 'CALCULATED' }, error: null };
    }
    db.rpcCalls.push({ name, args }); return db.rpcResult ?? { data: 0, error: null };
  };
  return { supabase: { from, rpc, __db: db } };
});

const db = (supabase as any).__db;
const adj = (over: any) => ({ id: 'x', reference: 'r', kind: 'MISSING_CLOCK_OUT_DEDUCTION', status: 'PENDING', work_date: '2026-10-05', amount: 500, hours: null, ...over });
const setAdjustments = (data: any[], extra: any = {}) => (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue({ data, error: null, notSetUp: false, ...extra });
const calc = () => payrollService._doCalculate('e1', 2026, 10, '2026-10-01', '2026-10-31') as Promise<any>;
const snap = (res: any) => JSON.parse(res.data.remarks);

beforeEach(() => {
  vi.clearAllMocks();
  db.tables = { payroll: [], payroll_items: [] }; db.rpcCalls = []; db.rpcResult = null; db.updates = 0; db.replaceCalls = 0;
  (globalSettingsService.loadSettings as any).mockResolvedValue({
    updated_at: '2026-10-01T00:00:00Z',
    app: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
    payroll: { ...payrollSettingsService.getDefaults(), enableOvertimePay: true },
  });
  (salaryService.getSalaryStructureForPeriod as any).mockResolvedValue({ data: { basic_salary: 26000 }, error: null }); // ₹1,000 a day
  (salaryService.getCurrentEmployeeId as any).mockResolvedValue('admin1');
  (payrollDataService._fetchPayrollDays as any).mockResolvedValue({
    attendance: { workingDays: 26, presentDays: 26, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0, totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0 },
    leave: { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 }, days: [], error: null,
  });
  (payrollDataService._fetchWfh as any).mockResolvedValue({ wfhDays: 0, error: null });
  (payrollDataService._fetchPermissions as any).mockResolvedValue({ permissionCount: 0, totalMinutes: 0, error: null });
  (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
  setAdjustments([]);
});

describe('payroll calculation with missing clock-out adjustments', () => {
  it('case 9: a request still pending at the cutoff has no deduction yet: nothing is deducted', async () => {
    const res = await calc();
    expect(res.data).toMatchObject({ gross_salary: 26000, total_deductions: 0, net_salary: 26000 });
    expect(snap(res).missingClockOutAdjustments.ids).toEqual([]);
  });

  it('case 8: a rejected case\'s fixed deduction is its own line, separate from hours and gross', async () => {
    setAdjustments([adj({ id: 'd1', reference: 'MCO-DED:a1' })]);
    const res = await calc();
    expect(res.data).toMatchObject({ gross_salary: 26000, total_deductions: 500, net_salary: 25500, overtime_amount: 0, lop_deduction: 0 });
    expect(snap(res).deductionBreakdown).toEqual([{ name: 'Missing Clock-Out Deduction (1 case)', amount: 500 }]);
    expect(snap(res).missingClockOutAdjustments).toMatchObject({ ids: ['d1'], references: ['MCO-DED:a1'] });
    expect(db.tables.payroll_items).toContainEqual(expect.objectContaining({ item_type: 'DEDUCTION', item_name: 'Missing Clock-Out Deduction (1 case)', amount: 500 }));
  });

  it('case 7: a reversal of a deduction already paid out is an earning line; gross salary is unchanged', async () => {
    setAdjustments([adj({ id: 'v1', kind: 'MISSING_CLOCK_OUT_REVERSAL', reference: 'MCO-REV:a1' })]);
    const res = await calc();
    expect(res.data).toMatchObject({ gross_salary: 26000, total_deductions: 0, net_salary: 26500 });
    expect(snap(res).earningAdjustments).toEqual([{ name: 'Missing Clock-Out Deduction Reversal (1 case)', amount: 500 }]);
    expect(db.tables.payroll_items).toContainEqual(expect.objectContaining({ item_type: 'EARNING', item_name: 'Missing Clock-Out Deduction Reversal (1 case)', amount: 500 }));
  });

  it('case 15: overtime approved after its month was locked is paid at the overtime rate in a later payroll', async () => {
    setAdjustments([adj({ id: 'o1', kind: 'DEFERRED_OVERTIME', amount: null, hours: 1.5, work_date: '2026-09-29', reference: 'MCO-OT:r1' })]);
    const res = await calc();
    // 1.5 h × (1000 / 8) × 1.5 = 281.25 → 281 (rounded to the rupee)
    expect(res.data).toMatchObject({ overtime_amount: 281, net_salary: 26281 });
    expect(snap(res).missingClockOutAdjustments).toMatchObject({ ids: ['o1'], deferredOvertimeHours: 1.5 });
  });

  it('cases 11/15: recalculating reads the same pending rows: no duplicate deduction or reversal', async () => {
    setAdjustments([adj({ id: 'd1' })]);
    const first = await calc();
    const second = await calc();
    expect(second.data.total_deductions).toBe(first.data.total_deductions);
    expect(second.data.net_salary).toBe(25500);
    expect(db.rpcCalls).toHaveLength(0); // calculation never settles or creates adjustments
    // saved through the atomic function: still one payroll row and one set of items
    expect(db.replaceCalls).toBe(2);
    expect(db.tables.payroll).toHaveLength(1);
    expect(db.tables.payroll_items.filter((i: any) => i.item_type === 'DEDUCTION')).toHaveLength(1);
  });

  it('case 14: if the adjustments cannot be read, payroll is not calculated (no silent zero)', async () => {
    (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue({ data: [], error: new Error('Payroll adjustments could not be loaded: offline'), notSetUp: false });
    const res = await calc();
    expect(res.error?.message).toBe('Payroll adjustments could not be loaded: offline');
    expect(db.tables.payroll).toHaveLength(0);
    (payrollDataService._fetchPayrollAdjustments as any).mockResolvedValue(undefined);
    expect((await calc()).error?.message).toBe('Payroll adjustments could not be loaded. Payroll was not calculated.');
  });

  it('before the database proposal is applied, payroll calculates as before', async () => {
    setAdjustments([], { notSetUp: true });
    const res = await calc();
    expect(res.error).toBeNull();
    expect(res.data.net_salary).toBe(26000);
  });
});

describe('approval settles exactly the included adjustments, atomically', () => {
  const remarks = (ids: string[]) => JSON.stringify({ attendance: { reviewItems: [] }, missingClockOutAdjustments: { ids } });
  // the figures a fresh calculation gives for the fixture month (₹26,000, nothing deducted): approval re-checks them
  const AMOUNTS = { basic_salary: 26000, gross_salary: 26000, total_allowances: 0, total_deductions: 0, lop_deduction: 0, overtime_amount: 0, net_salary: 26000 };

  it('reads the stored ids safely', () => {
    expect(settledAdjustmentIds(remarks(['d1', 'v1']))).toEqual(['d1', 'v1']);
    expect(settledAdjustmentIds('not json')).toEqual([]);
    expect(settledAdjustmentIds(JSON.stringify({ missingClockOutAdjustments: { ids: [1, '', 'ok'] } }))).toEqual(['ok']);
  });

  it('a payroll with adjustments is approved only through the database function (no direct update)', async () => {
    db.tables.payroll = [{ id: 'p1', employee_id: 'e1', payroll_year: 2026, payroll_month: 10, status: 'UNDER_REVIEW', remarks: remarks(['d1']), ...AMOUNTS }];
    const r = await payrollService.updateStatus('p1', 'APPROVED', ['UNDER_REVIEW']);
    expect(r.error).toBeNull();
    expect(db.rpcCalls).toEqual([{ name: 'approve_payroll_with_adjustments', args: { p_payroll_id: 'p1', p_adjustment_ids: ['d1'] } }]);
    expect(db.updates).toBe(0);
  });

  it('cases 7/11: if an adjustment changed since the calculation (e.g. cancelled by an approval), nothing is approved', async () => {
    db.tables.payroll = [{ id: 'p1', employee_id: 'e1', payroll_year: 2026, payroll_month: 10, status: 'UNDER_REVIEW', remarks: remarks(['d1']), ...AMOUNTS }];
    db.rpcResult = { data: null, error: { code: '40001', message: 'Payroll adjustments changed since this payroll was calculated. Recalculate it, then approve.' } };
    const r = await payrollService.updateStatus('p1', 'APPROVED', ['UNDER_REVIEW']);
    expect(r.error?.message).toBe('Payroll adjustments changed since this payroll was calculated. Recalculate it, then approve.');
    expect(db.tables.payroll[0].status).toBe('UNDER_REVIEW');
  });

  it('a payroll calculated before a missing clock-out correction of its period was approved cannot be approved', async () => {
    db.tables.payroll = [{ id: 'p1', employee_id: 'e1', payroll_year: 2026, payroll_month: 10, status: 'UNDER_REVIEW', remarks: remarks([]), ...AMOUNTS,
      period_start: '2026-10-01', period_end: '2026-10-31', calculated_at: '2026-10-20T10:00:00Z' }];
    db.tables.overtime_requests = [{ employee_id: 'e1', request_type: 'MISSING_CLOCK_OUT', status: 'APPROVED', work_date: '2026-10-05', reviewed_at: '2026-10-21T09:00:00Z' }];
    const r = await payrollService.updateStatus('p1', 'APPROVED', ['UNDER_REVIEW']);
    expect(r.error?.message).toMatch('Recalculate the payroll, then approve.');
    expect(db.tables.payroll[0].status).toBe('UNDER_REVIEW');
    expect(db.rpcCalls).toHaveLength(0);
    // recalculated afterwards: approval proceeds
    db.tables.payroll[0].calculated_at = '2026-10-22T10:00:00Z';
    expect((await payrollService.updateStatus('p1', 'APPROVED', ['UNDER_REVIEW'])).error).toBeNull();
  });

  it('refund lines are shown on every payslip view (payroll_items first, then the snapshot)', () => {
    const items = [{ item_type: 'EARNING', item_name: 'Gross Salary', amount: 26000 }, { item_type: 'EARNING', item_name: 'Missing Clock-Out Deduction Reversal (1 case)', amount: 500 }, { item_type: 'DEDUCTION', item_name: 'LOP', amount: 100 }];
    expect(earningAdjustmentItems({ payroll_items: items })).toEqual([{ name: 'Missing Clock-Out Deduction Reversal (1 case)', amount: 500 }]);
    expect(earningAdjustmentItems({ remarks: JSON.stringify({ earningAdjustments: [{ name: 'Refund', amount: 250 }] }) })).toEqual([{ name: 'Refund', amount: 250 }]);
    expect(earningAdjustmentItems(null)).toEqual([]);
  });

  it('a payroll without adjustments keeps the existing approval path', async () => {
    db.tables.payroll = [{ id: 'p1', employee_id: 'e1', payroll_year: 2026, payroll_month: 10, status: 'UNDER_REVIEW', remarks: remarks([]), ...AMOUNTS }];
    const r = await payrollService.updateStatus('p1', 'APPROVED', ['UNDER_REVIEW']);
    expect(r.error).toBeNull();
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.tables.payroll[0].status).toBe('APPROVED');
  });
});
