import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollService } from './payrollService';
import { supabase } from '../../lib/supabase';
import { buildDailyMetrics } from './dailyMetricDetails';

vi.mock('./salaryService');
vi.mock('./payrollDataService');
vi.mock('../settings/globalSettingsService');
vi.mock('./payrollSettingsService');
vi.mock('../audit/auditService');
vi.mock('./payrollAuditService');
vi.mock('../notifications/notificationService');
// In-memory tables; every query is recorded so the date filter can be checked. Synthetic data only.
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, calls: [], fail: [] };
  const from = (t: string) => {
    const q: any = { t, filters: [], one: false };
    const b: any = {
      select: (cols: string) => { q.cols = cols; return b; },
      eq: (c: string, v: any) => { q.filters.push(['eq', c, v]); return b; },
      in: (c: string, v: any[]) => { q.filters.push(['in', c, v]); return b; },
      single: () => { q.one = true; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(() => {
        db.calls.push(q);
        if (db.fail.includes(t)) return { data: null, error: { message: `${t} unavailable` } };
        const rows = (db.tables[t] || []).filter((r: any) => q.filters.every(([op, c, v]: any) => op === 'eq' ? r[c] === v : v.includes(r[c])));
        return q.one ? { data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } } : { data: rows, error: null };
      }).then(res, rej),
    };
    return b;
  };
  return { supabase: { from, auth: { getUser: async () => ({ data: { user: { id: 'auth-admin' } } }) }, __db: db } };
});

const db = (supabase as any).__db;
const calcFor = (lateMins: number, lateDed: number) => ({
  grossSalary: 26000, workingDays: 26, dailyRate: 1000, lopDeduction: 0, overtime: 0, settings: {}, appSettings: { gracePeriodMins: 10 },
  deductionItems: lateDed ? [{ name: `Late Deduction (${lateMins}m)`, amount: lateDed }] : [],
  empData: { attendance: { totalLateMinutes: lateMins, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0 }, leave: { lopLeave: 0 } },
});

beforeEach(() => {
  db.calls = []; db.fail = [];
  db.tables = {
    profiles: [{ auth_user_id: 'auth-admin', role_id: 'r1' }],
    roles: [{ id: 'r1', name: 'ADMIN' }],
    attendance: [
      { employee_id: 'e1', attendance_date: '2026-10-12', status: 'LATE', clock_in_at: '2026-10-12T04:00:00Z', clock_out_at: null, break_minutes: 0, shift_template: { name: 'General', start_time: '09:00:00' } },
      { employee_id: 'e2', attendance_date: '2026-10-12', status: 'COMPLETED', clock_in_at: '2026-10-12T03:30:00Z', clock_out_at: '2026-10-12T12:30:00Z', break_minutes: 0, shift_template: { name: 'General', start_time: '09:00:00' } },
      { employee_id: 'e1', attendance_date: '2026-10-13', status: 'COMPLETED', clock_in_at: '2026-10-13T03:30:00Z', clock_out_at: null, shift_template: null },
    ],
    employees: [
      { id: 'e1', first_name: 'Test', last_name: 'One', employee_code: 'EMP001', departments: { name: 'D' }, office: { name: 'O' } },
      { id: 'e2', first_name: 'Test', last_name: 'Two', employee_code: 'EMP002', departments: { name: 'D' }, office: { name: 'O' } },
    ],
    overtime_requests: [{ employee_id: 'e2', work_date: '2026-10-12', status: 'PENDING', eligible_overtime_hours: 1 }],
  };
  // month-to-date: e1's 30 late minutes (₹200) fall on 12 Oct; nothing before
  (payrollService as any).calculatePayrollDetails = vi.fn(async (emp: string, _y: number, _m: number, _start: string, end: string) =>
    ({ data: emp === 'e1' && end >= '2026-10-12' ? calcFor(30, 200) : calcFor(0, 0), error: null }));
});

describe('daily deduction report behind the summary cards', () => {
  it('only the selected date is loaded; each employee is calculated month-to-date through the date and through the day before', async () => {
    const r = await payrollService.getDailyDeductionReport('2026-10-12');
    expect(r.error).toBeNull();
    expect(r.data?.map((x: any) => x.employee.employee_code)).toEqual(['EMP001', 'EMP002']);
    const att = db.calls.find((c: any) => c.t === 'attendance');
    expect(att.filters).toEqual([['eq', 'attendance_date', '2026-10-12']]);
    expect(db.calls.find((c: any) => c.t === 'overtime_requests').filters).toEqual([['eq', 'work_date', '2026-10-12']]);
    expect(((payrollService as any).calculatePayrollDetails as any).mock.calls.map((c: any[]) => c.slice(0, 5).join(' ')).sort())
      .toEqual(['e1 2026 10 2026-10-01 2026-10-11', 'e1 2026 10 2026-10-01 2026-10-12', 'e2 2026 10 2026-10-01 2026-10-11', 'e2 2026 10 2026-10-01 2026-10-12']);
  });

  it('rows carry attendance, office and overtime requests for the breakdowns; amounts unchanged', async () => {
    const r: any = await payrollService.getDailyDeductionReport('2026-10-12');
    const [one, two] = r.data;
    expect(one).toMatchObject({ lateMinutes: 30, lateDeduction: 200, totalDailyImpact: 200, overtimeRequestsError: null });
    expect(one.attendance.shift_template.start_time).toBe('09:00:00');
    expect(one.employee.office.name).toBe('O');
    expect(two.overtimeRequests).toEqual([{ employee_id: 'e2', work_date: '2026-10-12', status: 'PENDING', eligible_overtime_hours: 1 }]);
    const m = buildDailyMetrics(r.data);
    expect(m.late.total).toBe(200);
    expect(m.total.total).toBe(200);
    expect(m.late.rows.map((x: any) => [x.code, x.shiftStart, x.clockIn, x.grace])).toEqual([['EMP001', '09:00', '09:30', '10 min']]);
  });

  it('another date gives a different set (13 Oct: one employee, missing clock-out, no shift)', async () => {
    const r: any = await payrollService.getDailyDeductionReport('2026-10-13');
    expect(r.data.map((x: any) => [x.employee.employee_code, x.clockOut, x.shift])).toEqual([['EMP001', null, 'Standard']]);
  });

  it('a failed overtime-request lookup does not fail the report; rows are marked unavailable', async () => {
    db.fail = ['overtime_requests'];
    const r: any = await payrollService.getDailyDeductionReport('2026-10-12');
    expect(r.error).toBeNull();
    expect(r.data[0].overtimeRequestsError).toBe('overtime_requests unavailable');
  });

  it('a failed attendance lookup is an error (never an empty ₹0 report)', async () => {
    db.fail = ['attendance'];
    const r = await payrollService.getDailyDeductionReport('2026-10-12');
    expect(r.data).toBeNull();
    expect(r.error?.message).toBe('Attendance could not be loaded: attendance unavailable');
  });
});

describe('daily view = what the date adds to the monthly payroll', () => {
  // Synthetic month-to-date calculations by employee and end date (what calculatePayrollDetails returns).
  const mtd = (o: any = {}) => ({
    grossSalary: 26000, workingDays: 26, dailyRate: 1000, lopDeduction: 0, overtime: 0,
    settings: o.settings || {}, appSettings: {}, deductionItems: o.items || [], lateCalculation: o.late || null,
    empData: { attendance: { totalLateMinutes: 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0, lopDays: 0, absentDays: 0, ...(o.att || {}) }, leave: { lopLeave: 0, ...(o.leave || {}) } },
    days: o.days || [], ...(o.top || {}),
  });
  const useCalcs = (table: Record<string, Record<string, any>>) => {
    (payrollService as any).calculatePayrollDetails = vi.fn(async (emp: string, _y: number, _m: number, _s: string, end: string) =>
      ({ data: table[emp]?.[end] ?? mtd(), error: null }));
  };

  it('an absent employee (no attendance row) is listed with the day\'s LOP; not counted as clocked in', async () => {
    db.tables.salary_structures = [{ employee_id: 'e1', is_active: true }, { employee_id: 'e3', is_active: true }];
    db.tables.employees.push({ id: 'e3', first_name: 'Test', last_name: 'Three', employee_code: 'EMP003', departments: { name: 'D' }, office: { name: 'O' } });
    useCalcs({ e3: {
      '2026-10-11': mtd(),
      '2026-10-12': mtd({ top: { lopDeduction: 1000 }, items: [{ name: 'LOP Deduction (1 day)', amount: 1000 }], att: { lopDays: 1, absentDays: 1 }, days: [{ date: '2026-10-12', kind: 'ABSENT' }] }),
    } });
    const r: any = await payrollService.getDailyDeductionReport('2026-10-12');
    const absent = r.data.find((x: any) => x.employee.id === 'e3');
    expect(absent).toMatchObject({ hasAttendance: false, dayKind: 'ABSENT', clockIn: null, lopImpact: 1000, totalDailyImpact: 1000, impactStatus: 'FINAL' });
    const m = buildDailyMetrics(r.data);
    expect(m.lop.total).toBe(1000);
    expect(m.lop.rows.map((x: any) => [x.code, x.lopDays, x.amount])).toEqual([['EMP003', 1, 1000]]);
    const { clockedInCard } = await import('./payrollCardRules');
    expect(clockedInCard(r.data).rows.map((x: any) => x.code)).toEqual(['EMP001', 'EMP002']);
  });

  it('paid leave is listed at ₹0; a week off without attendance is not listed', async () => {
    db.tables.salary_structures = [{ employee_id: 'e3', is_active: true }, { employee_id: 'e4', is_active: true }];
    db.tables.employees.push(
      { id: 'e3', first_name: 'Paid', last_name: 'Leave', employee_code: 'EMP003' },
      { id: 'e4', first_name: 'Week', last_name: 'Off', employee_code: 'EMP004' });
    useCalcs({
      e3: { '2026-10-12': mtd({ days: [{ date: '2026-10-12', kind: 'PAID_LEAVE' }] }) },
      e4: { '2026-10-12': mtd({ days: [{ date: '2026-10-12', kind: 'WEEKLY_OFF' }] }) },
    });
    const r: any = await payrollService.getDailyDeductionReport('2026-10-12');
    expect(r.data.find((x: any) => x.employee.id === 'e3')).toMatchObject({ dayKind: 'PAID_LEAVE', lopImpact: 0, totalDailyImpact: 0 });
    expect(r.data.find((x: any) => x.employee.id === 'e4')).toBeUndefined();
  });

  it('today without a clock-in is pending, never ₹0 final; the cards say so', async () => {
    db.tables.salary_structures = [{ employee_id: 'e3', is_active: true }];
    db.tables.employees.push({ id: 'e3', first_name: 'Not', last_name: 'Yet', employee_code: 'EMP003' });
    useCalcs({ e3: { '2026-10-12': mtd({ days: [{ date: '2026-10-12', kind: 'TODAY_PENDING' }] }) } });
    const r: any = await payrollService.getDailyDeductionReport('2026-10-12');
    const row = r.data.find((x: any) => x.employee.id === 'e3');
    expect(row).toMatchObject({ dayKind: 'TODAY_PENDING', lopStatus: 'PENDING', impactStatus: 'PENDING' });
    const m = buildDailyMetrics(r.data);
    expect(m.total.pendingCount).toBeGreaterThanOrEqual(1);
    expect(m.total.notes.join(' ')).toMatch('still pending');
  });

  it('salary-based late within the monthly limit: exempt that day (₹0), as in the monthly payroll', async () => {
    const s = { enableLateLoginDeduction: true, lateDeductionMethod: 'salary_based', monthlyLateLoginLimit: 2 };
    useCalcs({ e1: {
      '2026-10-11': mtd({ settings: s, late: { exemptOccurrences: 1, deductionAmount: 0 }, att: { totalLateMinutes: 10 } }),
      '2026-10-12': mtd({ settings: s, late: { exemptOccurrences: 2, deductionAmount: 0 }, att: { totalLateMinutes: 40 } }),
    } });
    const r: any = await payrollService.getDailyDeductionReport('2026-10-12');
    const one = r.data.find((x: any) => x.employee.id === 'e1');
    expect(one).toMatchObject({ lateMinutes: 30, lateDeduction: 0, lateStatus: 'EXEMPT' });
    expect(buildDailyMetrics(r.data).late.rows[0].formula).toBe('exempt (within the monthly late-login limit of 2)');
  });

  it('fixed late deduction is charged once per month: a second late day adds ₹0', async () => {
    const s = { enableLateLoginDeduction: true, lateDeductionMethod: 'fixed', lateFixedAmount: 300 };
    const charged = mtd({ settings: s, items: [{ name: 'Late Deduction', amount: 300 }], late: { deductionAmount: 300 } });
    useCalcs({ e1: { '2026-10-11': { ...charged, empData: { ...charged.empData, attendance: { ...charged.empData.attendance, totalLateMinutes: 15 } } },
                     '2026-10-12': { ...charged, empData: { ...charged.empData, attendance: { ...charged.empData.attendance, totalLateMinutes: 45 } } } } });
    const r: any = await payrollService.getDailyDeductionReport('2026-10-12');
    const one = r.data.find((x: any) => x.employee.id === 'e1');
    expect(one).toMatchObject({ lateMinutes: 30, lateDeduction: 0 });
    expect(buildDailyMetrics(r.data).late.rows[0].formula).toBe('already charged this month (once per month)');
  });

  it('a missing clock-out deduction for an earlier date is not shown again on later days', async () => {
    const mco = { items: [{ name: 'Missing Clock-Out Deduction (1 case)', amount: 500 }] };
    useCalcs({ e1: { '2026-10-11': mtd(mco), '2026-10-12': mtd(mco) } });
    const r: any = await payrollService.getDailyDeductionReport('2026-10-12');
    expect(r.data.find((x: any) => x.employee.id === 'e1')).toMatchObject({ otherDeductions: 0, totalDailyImpact: 0 });
  });

  it('the first of the month is calculated without a previous day', async () => {
    db.tables.attendance.push({ employee_id: 'e1', attendance_date: '2026-10-01', status: 'LATE', clock_in_at: '2026-10-01T04:00:00Z', clock_out_at: '2026-10-01T12:30:00Z', shift_template: null });
    useCalcs({ e1: { '2026-10-01': mtd({ items: [{ name: 'Late Deduction', amount: 100 }], att: { totalLateMinutes: 20 } }) } });
    const r: any = await payrollService.getDailyDeductionReport('2026-10-01');
    expect(((payrollService as any).calculatePayrollDetails as any).mock.calls.map((c: any[]) => c[4])).toEqual(['2026-10-01']);
    expect(r.data[0]).toMatchObject({ lateDeduction: 100, lateMinutes: 20 });
  });
});
