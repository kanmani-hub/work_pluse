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
  (payrollService as any).calculatePayrollDetails = vi.fn(async (emp: string) => ({ data: emp === 'e1' ? calcFor(30, 200) : calcFor(0, 0), error: null }));
});

describe('daily deduction report behind the summary cards', () => {
  it('only the selected date is loaded and calculated (date filter)', async () => {
    const r = await payrollService.getDailyDeductionReport('2026-10-12');
    expect(r.error).toBeNull();
    expect(r.data?.map((x: any) => x.employee.employee_code)).toEqual(['EMP001', 'EMP002']);
    const att = db.calls.find((c: any) => c.t === 'attendance');
    expect(att.filters).toEqual([['eq', 'attendance_date', '2026-10-12']]);
    expect(db.calls.find((c: any) => c.t === 'overtime_requests').filters).toEqual([['eq', 'work_date', '2026-10-12']]);
    expect(((payrollService as any).calculatePayrollDetails as any).mock.calls.map((c: any[]) => c.slice(0, 5)))
      .toEqual([['e1', 2026, 10, '2026-10-12', '2026-10-12'], ['e2', 2026, 10, '2026-10-12', '2026-10-12']]);
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
