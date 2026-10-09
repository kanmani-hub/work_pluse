import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollService } from './payrollService';
import { salaryService } from './salaryService';
import { payrollDataService } from './payrollDataService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { payrollSettingsService } from './payrollSettingsService';
import { supabase } from '../../lib/supabase';

vi.mock('./salaryService');
vi.mock('./payrollDataService');
vi.mock('../settings/globalSettingsService');
vi.mock('./payrollSettingsService');
vi.mock('../audit/auditService');
vi.mock('./payrollAuditService');
vi.mock('../notifications/notificationService');
// Stateful in-memory tables + an emulation of the PROPOSED record_payroll_payment database function
// (docs/proposals/PROPOSED_payroll_payment_safety.sql, PART 2). Each awaited query resolves on a later
// microtask so concurrent calls interleave like two tabs; the emulated function serialises per
// payroll like the real row lock (SELECT … FOR UPDATE) and is all-or-nothing like a transaction.
// NOTE: this tests the app's use of the function, NOT the SQL itself (that needs a real database).
vi.mock('../../lib/supabase', () => {
  const db: any = {
    tables: {}, role: 'ADMIN', employeeId: 'admin1', rpcMissing: false, failPaymentInsert: false,
    rpcCalls: 0, locks: {},
  };
  const run = (q: any) => {
    const rows = db.tables[q.t] || (db.tables[q.t] = []);
    const match = (r: any) => q.filters.every(([c, v]: any) => r[c] === v);
    if (q.op === 'insert') {
      const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p: any, i: number) => ({ id: q.t + (rows.length + i + 1), ...p }));
      rows.push(...list);
      return { data: q.one ? list[0] : list, error: null };
    }
    if (q.op === 'update') {
      const hit = rows.filter(match); hit.forEach((r: any) => Object.assign(r, q.payload));
      return { data: hit.map((r: any) => ({ id: r.id })), error: null };
    }
    if (q.op === 'delete') {
      db.tables[q.t] = rows.filter((r: any) => !match(r));
      return { data: null, error: null };
    }
    const hit = rows.filter(match).map((r: any) => ({ ...r }));
    if (q.one) return hit.length ? { data: hit[0], error: null } : { data: null, error: q.one === 'single' ? { message: 'no rows' } : null };
    return { data: hit, error: null };
  };
  const from = (t: string) => {
    const q: any = { t, op: 'select', filters: [], payload: null, one: null };
    const b: any = {
      select: () => b,
      insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      delete: () => { q.op = 'delete'; return b; },
      eq: (c: string, v: any) => { q.filters.push([c, v]); return b; },
      single: () => { q.one = 'single'; return b; },
      maybeSingle: () => { q.one = 'maybe'; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(() => run(q)).then(res, rej),
    };
    return b;
  };
  const fail = (code: string, message: string) => ({ data: null, error: { code, message } });
  const recordPayment = (a: any) => {
    if (String(db.role).toUpperCase() !== 'ADMIN') return fail('42501', 'Only an Admin can record payroll payments.');
    const p = (db.tables.payroll || []).find((r: any) => r.id === a.p_payroll_id);
    if (!p) return fail('P0002', 'Payroll not found.');
    if (['PAID', 'CLOSED'].includes(p.status)) return fail('P0001', 'This payroll has already been paid.');
    if (p.status !== 'PAYMENT_PENDING') return fail('P0001', `Payroll must be in PAYMENT_PENDING status to record a payment (current: ${p.status}).`);
    if ((db.tables.payroll_payments || []).some((r: any) => r.payroll_id === p.id)) return fail('P0001', 'A payment is already recorded for this payroll.');
    if (typeof a.p_amount !== 'number' || !Number.isFinite(a.p_amount) || a.p_amount < 0) return fail('22023', 'Enter a valid payment amount.');
    if (Math.round(a.p_amount * 100) !== Math.round(Number(p.net_salary) * 100)) return fail('22023', `Payment must equal the approved net salary of ${Number(p.net_salary).toFixed(2)}.`);
    if (db.failPaymentInsert) return fail('XX000', 'insert failed (simulated)'); // transaction rolls back: nothing changed
    const pay = { id: 'pay' + ((db.tables.payroll_payments || []).length + 1), payroll_id: p.id, amount: Math.round(a.p_amount * 100) / 100,
      payment_method: a.p_payment_method, transaction_reference: a.p_transaction_reference, remarks: a.p_remarks,
      paid_at: a.p_paid_at || new Date().toISOString(), paid_by: db.employeeId };
    (db.tables.payroll_payments ||= []).push(pay);
    p.status = 'PAID';
    return { data: pay.id, error: null };
  };
  const rpc = (name: string, args: any) => {
    db.rpcCalls++;
    if (db.rpcMissing || name !== 'record_payroll_payment') {
      return Promise.resolve(fail('PGRST202', `Could not find the function public.${name} in the schema cache`));
    }
    const prev = db.locks[args.p_payroll_id] || Promise.resolve();
    const next = prev.then(() => new Promise(r => setTimeout(r, 0))).then(() => recordPayment(args));
    db.locks[args.p_payroll_id] = next.catch(() => {});
    return next;
  };
  const auth = { getUser: async () => ({ data: { user: { id: 'auth-admin' } }, error: null }) };
  return { supabase: { from, rpc, auth, __db: db } };
});

const db = (supabase as any).__db;
const payroll = (status: string, extra: any = {}) => ({ id: 'p1', employee_id: 'e1', payroll_month: 10, payroll_year: 2026, net_salary: 5000, status, ...extra });
const payments = () => (db.tables.payroll_payments || []).filter((r: any) => r.payroll_id === 'p1');
const statusOf = () => db.tables.payroll.find((r: any) => r.id === 'p1').status;
const setRole = (role: string) => {
  db.role = role;
  db.tables.profiles = [{ auth_user_id: 'auth-admin', role_id: 'r1', employee_id: 'admin1' }];
  db.tables.roles = [{ id: 'r1', name: role }];
};

beforeEach(() => {
  vi.clearAllMocks();
  (salaryService.getCurrentEmployeeId as any).mockResolvedValue('admin1');
  db.tables = { payroll: [], payroll_payments: [] };
  db.rpcMissing = false; db.failPaymentInsert = false; db.rpcCalls = 0; db.locks = {};
  setRole('ADMIN');
});

describe('markPayrollPaid: one exact payment per payroll, through the database function', () => {
  it('PAYMENT_PENDING → PAID with exactly one payment of the net salary', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    const r: any = await payrollService.markPayrollPaid('p1', 5000, 'Bank Transfer', 'UTR1');
    expect(r.error).toBeNull();
    expect(r.paymentId).toBe('pay1');
    expect(statusOf()).toBe('PAID');
    expect(payments().length).toBe(1);
    expect(payments()[0].amount).toBe(5000);
    expect(db.rpcCalls).toBe(1);
  });

  it('a second attempt after payment is refused and adds no payment', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A');
    const again = await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'B');
    expect(again.error?.message).toBe('This payroll has already been paid.');
    expect(payments().length).toBe(1);
  });

  it('two simultaneous attempts (double click / two tabs / two admins): one succeeds, one payment row', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    const [a, b] = await Promise.all([
      payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A'),
      payrollService.markPayrollPaid('p1', 5000, 'UPI', 'B'),
    ]);
    expect([a, b].filter(x => !x.error).length).toBe(1);
    expect([a, b].filter(x => x.error).map(x => x.error?.message)).toEqual(['Payment was not recorded: This payroll has already been paid.']);
    expect(payments().length).toBe(1);
    expect(statusOf()).toBe('PAID');
  });

  it('refuses when not PAYMENT_PENDING (status unchanged, no payment, function not called)', async () => {
    db.tables.payroll = [payroll('APPROVED')];
    const r = await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A');
    expect(r.error?.message).toMatch('must be in PAYMENT_PENDING');
    expect(statusOf()).toBe('APPROVED');
    expect(payments().length).toBe(0);
    expect(db.rpcCalls).toBe(0);
  });

  it('the database refuses when a payment row already exists even if the status says PAYMENT_PENDING', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    db.tables.payroll_payments = [{ id: 'old', payroll_id: 'p1', amount: 5000 }];
    const r = await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A');
    expect(r.error?.message).toBe('Payment was not recorded: A payment is already recorded for this payroll.');
    expect(payments().length).toBe(1);
    expect(statusOf()).toBe('PAYMENT_PENDING');
  });

  it('a failed insert inside the transaction leaves nothing changed and never reports success', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    db.failPaymentInsert = true;
    const r: any = await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A');
    expect(r.error?.message).toBe('Payment was not recorded: insert failed (simulated)');
    expect(r.paymentId).toBeUndefined();
    expect(statusOf()).toBe('PAYMENT_PENDING');
    expect(payments().length).toBe(0);
  });

  it('if the database function is not installed, nothing is recorded and the reason is clear', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    db.rpcMissing = true;
    const r = await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A');
    expect(r.error?.message).toBe('Payment recording is not set up in the database yet (function record_payroll_payment is missing). No payment was recorded.');
    expect(statusOf()).toBe('PAYMENT_PENDING');
    expect(payments().length).toBe(0);
  });

  it('refuses invalid amounts before calling the database', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    for (const bad of [-5, NaN, Infinity, '5000' as any, undefined as any]) {
      const r = await payrollService.markPayrollPaid('p1', bad, 'UPI', 'A');
      expect(!!r.error).toBe(true);
    }
    expect((await payrollService.markPayrollPaid('p1', -5, 'UPI', 'A')).error?.message).toBe('Payment amount cannot be negative.');
    expect(db.rpcCalls).toBe(0);
    expect(payments().length).toBe(0);
  });

  it('refuses partial and over-payments (exact net salary policy)', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    expect((await payrollService.markPayrollPaid('p1', 4999.99, 'UPI', 'A')).error?.message).toBe('Payment must equal the approved net salary of ₹5000.00.');
    expect((await payrollService.markPayrollPaid('p1', 5000.01, 'UPI', 'A')).error?.message).toBe('Payment must equal the approved net salary of ₹5000.00.');
    expect(payments().length).toBe(0);
    expect((await payrollService.markPayrollPaid('p1', 5000.0, 'UPI', 'A')).error).toBeNull();
  });

  it('only ADMIN may record payments (HR refused, function not called)', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    setRole('HR');
    const r = await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A');
    expect(r.error?.message).toBe('Only an Admin can record payroll payments.');
    expect(db.rpcCalls).toBe(0);
    expect(statusOf()).toBe('PAYMENT_PENDING');
  });

  it('the chosen payment date is stored (midday IST); a future date is refused', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    expect((await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A', '', '2999-01-01')).error?.message).toBe('Payment date cannot be in the future.');
    expect((await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A', '', '2026-10-01')).error).toBeNull();
    expect(payments()[0].paid_at).toBe('2026-10-01T12:00:00+05:30');
  });
});

describe('payroll status transitions', () => {
  it('valid path: CALCULATED → UNDER_REVIEW → APPROVED → PAYMENT_PENDING → (payment) PAID → CLOSED', async () => {
    db.tables.payroll = [payroll('CALCULATED')];
    expect((await payrollService.submitPayrollForReview('p1')).error).toBeNull();
    expect(statusOf()).toBe('UNDER_REVIEW');
    expect((await payrollService.approvePayroll('p1')).error).toBeNull();
    expect(statusOf()).toBe('APPROVED');
    expect((await payrollService.movePayrollToPaymentPending('p1')).error).toBeNull();
    expect(statusOf()).toBe('PAYMENT_PENDING');
    expect((await payrollService.markPayrollPaid('p1', 5000, 'UPI', 'A')).error).toBeNull();
    expect((await payrollService.closePayroll('p1')).error).toBeNull();
    expect(statusOf()).toBe('CLOSED');
  });

  it('skips and repeats are refused', async () => {
    db.tables.payroll = [payroll('UNDER_REVIEW')];
    expect((await payrollService.movePayrollToPaymentPending('p1')).error?.message).toBe('Cannot transition from UNDER_REVIEW to PAYMENT_PENDING');
    expect(statusOf()).toBe('UNDER_REVIEW');
    db.tables.payroll = [payroll('APPROVED')];
    expect((await payrollService.approvePayroll('p1')).error?.message).toBe('Cannot transition from APPROVED to APPROVED');
  });

  it('PAID can never be set through a generic status change', async () => {
    db.tables.payroll = [payroll('PAYMENT_PENDING')];
    const r = await payrollService.updateStatus('p1', 'PAID');
    expect(r.error?.message).toBe('Use "Record payment" to mark a payroll as paid.');
    expect(statusOf()).toBe('PAYMENT_PENDING');
    expect(payments().length).toBe(0);
  });

  it('nothing changes a CLOSED payroll', async () => {
    db.tables.payroll = [payroll('CLOSED')];
    expect((await payrollService.updateStatus('p1', 'PAYMENT_PENDING')).error?.message).toBe('Cannot change payroll status from CLOSED to PAYMENT_PENDING.');
    expect(statusOf()).toBe('CLOSED');
  });
});

describe('generatePayroll never silently skips an employee', () => {
  beforeEach(() => {
    (globalSettingsService.loadSettings as any).mockResolvedValue({
      updated_at: '2026-10-01T00:00:00Z',
      app: { permissionMaxHoursPerMonth: 3, breakDurationMins: 75 },
      payroll: { enableOvertimePay: true, overtimeRateType: 'multiplier', overtimeMultiplier: 1.5 },
    });
    (payrollSettingsService.getWorkingDaysForMonth as any).mockReturnValue(25);
    (payrollSettingsService.applyRounding as any).mockImplementation((v: number) => Math.round(v * 100) / 100);
    (salaryService.getSalaryStructureForPeriod as any).mockResolvedValue({ data: { basic_salary: 5000 }, error: null });
    (payrollDataService._fetchPayrollDays as any).mockResolvedValue({
      attendance: { workingDays: 25, presentDays: 25, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0, totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0 },
      leave: { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 }, days: [], error: null,
    });
    (payrollDataService._fetchWfh as any).mockResolvedValue({ wfhDays: 0, error: null });
    (payrollDataService._fetchPermissions as any).mockResolvedValue({ permissionCount: 0, totalMinutes: 0, error: null });
    db.tables.salary_structures = [{ employee_id: 'e1', is_active: true }, { employee_id: 'e2', is_active: true }];
  });

  it('an employee whose approved overtime cannot be loaded is reported, not skipped or paid ₹0 overtime', async () => {
    (payrollDataService._fetchApprovedOvertime as any).mockImplementation(async (emp: string) =>
      emp === 'e2' ? { minutes: 0, error: new Error('Approved overtime could not be loaded: offline') } : { minutes: 60, error: null });
    const r: any = await payrollService.generatePayroll(2026, 10);
    expect(r.success).toBe(false);
    expect(r.count).toBe(1);
    expect(r.failures).toEqual([{ employee_id: 'e2', error: 'Approved overtime could not be loaded: offline' }]);
    expect(db.tables.payroll.map((p: any) => p.employee_id)).toEqual(['e1']);
    expect(db.tables.payroll[0].overtime_amount).toBe(37.5);
  });

  it('an employee whose attendance cannot be loaded is reported and gets no payroll (no zero-LOP payroll)', async () => {
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
    const ok = { attendance: { workingDays: 25, presentDays: 25, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0, totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0 }, leave: { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 }, days: [], error: null };
    (payrollDataService._fetchPayrollDays as any).mockImplementation(async (emp: string) =>
      emp === 'e2' ? { ...ok, error: new Error('Attendance could not be loaded: offline') } : ok);
    const r: any = await payrollService.generatePayroll(2026, 10);
    expect(r.success).toBe(false);
    expect(r.count).toBe(1);
    expect(r.failures).toEqual([{ employee_id: 'e2', error: 'Attendance could not be loaded: offline' }]);
    expect(db.tables.payroll.map((p: any) => p.employee_id)).toEqual(['e1']);
  });

  it('APPROVED and PAID payrolls are not recalculated, deleted or changed', async () => {
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
    const approved = { id: 'pa', employee_id: 'e1', payroll_year: 2026, payroll_month: 10, status: 'APPROVED', net_salary: 4800 };
    const paid = { id: 'pp', employee_id: 'e2', payroll_year: 2026, payroll_month: 10, status: 'PAID', net_salary: 5000 };
    db.tables.payroll = [{ ...approved }, { ...paid }];
    db.tables.payroll_items = [{ id: 'i1', payroll_id: 'pa', amount: 200 }, { id: 'i2', payroll_id: 'pp', amount: 0 }];
    const r: any = await payrollService.generatePayroll(2026, 10);
    expect(r).toMatchObject({ count: 0, skippedLocked: 2, failures: [] });
    expect(db.tables.payroll).toEqual([approved, paid]);
    expect(db.tables.payroll_items.length).toBe(2);
    for (const [emp, status] of [['e1', 'APPROVED'], ['e2', 'PAID']]) {
      const direct = await payrollService.recalculatePayroll(emp, 2026, 10, '2026-10-01', '2026-10-31');
      expect(direct.error?.message).toBe(`Cannot recalculate payroll in ${status} status.`);
    }
    expect(db.tables.payroll).toEqual([approved, paid]);
    expect(db.tables.payroll_items.length).toBe(2);
  });

  it('days flagged for Admin review are reported by generatePayroll and stored with the calculation', async () => {
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
    const flagged = [{ date: '2026-10-09', reason: 'Approved half-day leave, but no attendance or other approved leave covers the other half. Not deducted — Admin review needed.' }];
    const base = { workingDays: 25, presentDays: 25, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0, totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0 };
    (payrollDataService._fetchPayrollDays as any).mockImplementation(async (emp: string) => ({
      attendance: { ...base, reviewItems: emp === 'e2' ? flagged : [] }, leave: { approvedLeave: 0.5, lopLeave: 0, totalLeaveDays: 0.5 }, days: [], error: null,
    }));
    const r: any = await payrollService.generatePayroll(2026, 10);
    expect(r).toMatchObject({ success: true, count: 2, failures: [] });
    expect(r.reviews).toEqual([{ employee_id: 'e2', items: flagged }]);
    const stored = JSON.parse(db.tables.payroll.find((p: any) => p.employee_id === 'e2').remarks);
    expect(stored.attendance.reviewItems).toEqual(flagged);
    expect(db.tables.payroll.find((p: any) => p.employee_id === 'e2').net_salary).toBe(5000); // nothing deducted for the flagged half
  });

  it('locked payrolls are left unchanged and counted, not silently ignored', async () => {
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
    db.tables.payroll = [{ id: 'locked', employee_id: 'e2', payroll_year: 2026, payroll_month: 10, status: 'PAID', net_salary: 5000 }];
    const r: any = await payrollService.generatePayroll(2026, 10);
    expect(r.success).toBe(true);
    expect(r.count).toBe(1);
    expect(r.skippedLocked).toBe(1);
    expect(r.failures).toEqual([]);
    expect(db.tables.payroll.find((p: any) => p.id === 'locked').status).toBe('PAID');
  });
});

describe('Policy 2026-10-09: unresolved review flags block approval; Admins resolve them (Apply / Waive)', () => {
  const FLAG = { date: '2026-10-06', type: 'SHORT_DAY', reason: 'Short working day (under half the required hours). Half-day deduction not applied — Admin review needed.' };
  const base = { workingDays: 25, presentDays: 25, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0, totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0 };
  const current = () => db.tables.payroll.find((p: any) => p.employee_id === 'e1');
  const snapshot = () => JSON.parse(current().remarks);

  beforeEach(async () => {
    (globalSettingsService.loadSettings as any).mockResolvedValue({
      updated_at: '2026-10-01T00:00:00Z',
      app: { permissionMaxHoursPerMonth: 3, breakDurationMins: 75, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
      payroll: { enableHalfDayDeductions: true, halfDayMethod: '50_percent', enableLopDeductions: true, lopMethod: 'daily_rate' },
    });
    (payrollSettingsService.getWorkingDaysForMonth as any).mockReturnValue(25); // ₹5,000 / 25 = ₹200 a day
    (payrollSettingsService.applyRounding as any).mockImplementation((v: number) => Math.round(v * 100) / 100);
    (salaryService.getSalaryStructureForPeriod as any).mockResolvedValue({ data: { basic_salary: 5000 }, error: null });
    (payrollDataService._fetchWfh as any).mockResolvedValue({ wfhDays: 0, error: null });
    (payrollDataService._fetchPermissions as any).mockResolvedValue({ permissionCount: 0, totalMinutes: 0, error: null });
    (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue({ minutes: 0, error: null });
    // Emulates the classification: the short day is flagged until a decision is passed in
    (payrollDataService._fetchPayrollDays as any).mockImplementation(async (_e: string, _s: string, _x: string, _a: any, _t: string, res: any = {}) => {
      const d = res['2026-10-06|SHORT_DAY'];
      return { attendance: { ...base, halfDays: d === 'APPLY' ? 1 : 0, reviewItems: d ? [] : [FLAG] }, leave: { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 }, days: [], error: null };
    });
    db.tables.salary_structures = [{ employee_id: 'e1', is_active: true }];
    await payrollService.generatePayroll(2026, 10);
  });

  it('a flagged payroll is calculated with no half-day deduction and cannot be approved', async () => {
    expect(current()).toMatchObject({ status: 'UNDER_REVIEW', net_salary: 5000 });
    expect(snapshot().attendance.reviewItems).toEqual([FLAG]);
    const r = await payrollService.approvePayroll(current().id);
    expect(r.error?.message).toBe('Cannot approve: 1 attendance review flag(s) are unresolved. Resolve each flag (Apply or Waive) in the payroll details first.');
    expect(current().status).toBe('UNDER_REVIEW');
  });

  it('bulk approval (each payroll through approvePayroll): clean payroll approved, flagged payroll blocked', async () => {
    db.tables.payroll.push({ id: 'clean', employee_id: 'e9', payroll_year: 2026, payroll_month: 10, status: 'UNDER_REVIEW', net_salary: 5000, remarks: JSON.stringify({ attendance: { reviewItems: [] } }) });
    const results = [];
    for (const p of db.tables.payroll.filter((x: any) => x.status === 'UNDER_REVIEW')) results.push([p.employee_id, (await payrollService.approvePayroll(p.id)).error?.message || 'OK']);
    expect(results).toEqual([['e1', 'Cannot approve: 1 attendance review flag(s) are unresolved. Resolve each flag (Apply or Waive) in the payroll details first.'], ['e9', 'OK']]);
    expect(db.tables.payroll.find((p: any) => p.id === 'clean').status).toBe('APPROVED');
    expect(current().status).toBe('UNDER_REVIEW');
  });

  it('APPLY: payroll recalculated with the half-day deduction (₹100), decision recorded, approval then allowed', async () => {
    const r: any = await payrollService.resolveReviewFlag(current().id, '2026-10-06', 'SHORT_DAY', 'APPLY', 'Left at 1 pm without permission');
    expect(r.error).toBeNull();
    expect(current()).toMatchObject({ status: 'UNDER_REVIEW', net_salary: 4900, total_deductions: 100 });
    expect(snapshot().attendance.reviewItems).toEqual([]);
    expect(snapshot().reviewResolutions.length).toBe(1);
    expect(snapshot().reviewResolutions[0]).toMatchObject({ date: '2026-10-06', type: 'SHORT_DAY', decision: 'APPLY', note: 'Left at 1 pm without permission', by: 'admin1' });
    expect((await payrollService.approvePayroll(current().id)).error).toBeNull();
    expect(current().status).toBe('APPROVED');
  });

  it('WAIVE: no deduction, decision recorded, approval allowed', async () => {
    const r: any = await payrollService.resolveReviewFlag(current().id, '2026-10-06', 'SHORT_DAY', 'WAIVE', 'Approved doctor visit');
    expect(r.error).toBeNull();
    expect(current()).toMatchObject({ status: 'UNDER_REVIEW', net_salary: 5000, total_deductions: 0 });
    expect(snapshot().reviewResolutions[0]).toMatchObject({ decision: 'WAIVE', note: 'Approved doctor visit' });
    expect((await payrollService.approvePayroll(current().id)).error).toBeNull();
  });

  it('decisions survive a later recalculation (Generate Payroll again)', async () => {
    await payrollService.resolveReviewFlag(current().id, '2026-10-06', 'SHORT_DAY', 'APPLY', 'Confirmed');
    await payrollService.generatePayroll(2026, 10);
    expect(current()).toMatchObject({ status: 'UNDER_REVIEW', net_salary: 4900 });
    expect(snapshot().attendance.reviewItems).toEqual([]);
    expect(snapshot().reviewResolutions.length).toBe(1);
  });

  it('only an Admin can resolve; a note is required; nothing changes on refusal', async () => {
    const before = { ...current() };
    setRole('EMPLOYEE');
    expect((await payrollService.resolveReviewFlag(before.id, '2026-10-06', 'SHORT_DAY', 'WAIVE', 'x')).error?.message).toBe('Only an Admin can resolve payroll review flags.');
    setRole('ADMIN');
    expect((await payrollService.resolveReviewFlag(before.id, '2026-10-06', 'SHORT_DAY', 'WAIVE', '  ')).error?.message).toBe('Enter a note explaining the decision.');
    expect((await payrollService.resolveReviewFlag(before.id, '2026-10-07', 'SHORT_DAY', 'WAIVE', 'x')).error?.message).toMatch('not open on this payroll');
    expect(current()).toEqual(before);
  });

  it('a locked (APPROVED / PAID) payroll cannot have flags resolved and is unchanged', async () => {
    for (const status of ['APPROVED', 'PAID']) {
      current().status = status;
      const before = { ...current() };
      const r = await payrollService.resolveReviewFlag(before.id, '2026-10-06', 'SHORT_DAY', 'APPLY', 'x');
      expect(r.error?.message).toBe(`Review flags can only be resolved before approval (current status: ${status}).`);
      expect(current()).toEqual(before);
    }
  });
});
