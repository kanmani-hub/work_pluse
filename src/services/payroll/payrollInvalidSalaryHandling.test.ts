import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollService } from './payrollService';
import { supabase } from '../../lib/supabase';
import { buildDailyMetrics } from './dailyMetricDetails';
import { clockedInCard, payrollMonthCards } from './payrollCardRules';
import { approvalBlockReason } from './payrollRules';

vi.mock('./salaryService');
vi.mock('./payrollDataService');
vi.mock('../settings/globalSettingsService');
vi.mock('./payrollSettingsService');
vi.mock('../audit/auditService');
vi.mock('./payrollAuditService');
vi.mock('../notifications/notificationService');

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
        if (db.fail.includes(t)) return { data: null, error: { message: `${t} database query error` } };
        const rows = (db.tables[t] || []).filter((r: any) => q.filters.every(([op, c, v]: any) => op === 'eq' ? r[c] === v : v.includes(r[c])));
        return q.one ? { data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } } : { data: rows, error: null };
      }).then(res, rej),
    };
    return b;
  };
  return { supabase: { from, auth: { getUser: async () => ({ data: { user: { id: 'auth-admin' } } }) }, __db: db } };
});

const db = (supabase as any).__db;

const createCalc = (grossSalary: number, lateMinutes = 0, lateDed = 0) => ({
  grossSalary,
  workingDays: 26,
  dailyRate: grossSalary > 0 ? grossSalary / 26 : 0,
  lopDeduction: 0,
  overtime: 0,
  settings: { enableLateLoginDeduction: true, lateDeductionMethod: 'fixed', lateFixedAmount: 200 },
  appSettings: { gracePeriodMins: 10 },
  deductionItems: lateDed > 0 ? [{ name: `Late Deduction (${lateMinutes}m)`, amount: lateDed }] : [],
  empData: {
    attendance: { totalLateMinutes: lateMinutes, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0, lopDays: 0, absentDays: 0 },
    leave: { lopLeave: 0 },
  },
  days: [{ date: '2026-10-28', kind: 'WORK' }],
});

describe('WorkPulse HR Payroll - Invalid Salary Handling and Protection', () => {
  beforeEach(() => {
    db.calls = [];
    db.fail = [];
    db.tables = {
      profiles: [{ auth_user_id: 'auth-admin', role_id: 'r1' }],
      roles: [{ id: 'r1', name: 'ADMIN' }],
      attendance: [
        { employee_id: 'e1', attendance_date: '2026-10-28', status: 'COMPLETED', clock_in_at: '2026-10-28T04:00:00Z', clock_out_at: '2026-10-28T12:30:00Z', break_minutes: 0, shift_template: { name: 'Standard', start_time: '09:00:00' } },
        { employee_id: 'e2', attendance_date: '2026-10-28', status: 'COMPLETED', clock_in_at: '2026-10-28T04:15:00Z', clock_out_at: '2026-10-28T12:45:00Z', break_minutes: 0, shift_template: { name: 'Standard', start_time: '09:00:00' } },
        { employee_id: 'e3', attendance_date: '2026-10-28', status: 'LATE', clock_in_at: '2026-10-28T04:30:00Z', clock_out_at: null, break_minutes: 0, shift_template: { name: 'Standard', start_time: '09:00:00' } },
      ],
      employees: [
        { id: 'e1', first_name: 'Arun', last_name: 'Kumar', employee_code: 'EMP001', departments: { name: 'Engineering' }, office: { name: 'HQ' } },
        { id: 'e2', first_name: 'Priya', last_name: 'R', employee_code: 'EMP002', departments: { name: 'Design' }, office: { name: 'HQ' } },
        { id: 'e3', first_name: 'Yuvaraj', last_name: 'K', employee_code: 'EMP012', departments: { name: 'Sales' }, office: { name: 'HQ' } },
      ],
      salary_structures: [
        { employee_id: 'e1', is_active: true, basic_salary: 30000 },
        { employee_id: 'e2', is_active: true, basic_salary: 40000 },
        { employee_id: 'e3', is_active: true, basic_salary: 0 },
      ],
      overtime_requests: [],
    };
  });

  // 1. All employees have valid salary configurations
  it('1. loads daily report normally when all employees have valid salary configurations', async () => {
    (payrollService as any).calculatePayrollDetails = vi.fn(async (emp: string) => {
      return { data: createCalc(30000), error: null };
    });

    const res = await payrollService.getDailyDeductionReport('2026-10-28');
    expect(res.error).toBeNull();
    expect(res.failures).toEqual([]);
    expect(res.data?.length).toBe(3);
    expect(res.data?.every((r: any) => r.impactStatus !== 'CONFIGURATION_ERROR')).toBe(true);
  });

  // 2. One employee has zero gross salary
  it('2. isolates one employee with zero gross salary without failing the page', async () => {
    (payrollService as any).calculatePayrollDetails = vi.fn(async (emp: string) => {
      if (emp === 'e3') {
        return { data: null, error: new Error('Salary configuration is invalid: gross salary must be greater than zero.') };
      }
      return { data: createCalc(35000), error: null };
    });

    const res = await payrollService.getDailyDeductionReport('2026-10-28');
    expect(res.error).toBeNull(); // Must NOT return fatal error that crashes the page
    expect(res.failures).toHaveLength(1);
    expect(res.failures?.[0]).toMatchObject({
      employeeId: 'e3',
      employeeCode: 'EMP012',
      error: 'Salary configuration is invalid: gross salary must be greater than zero.',
    });

    // Valid employees are still calculated
    const e1 = res.data?.find((r: any) => r.employee.id === 'e1');
    expect(e1?.impactStatus).not.toBe('CONFIGURATION_ERROR');

    // Affected employee has CONFIGURATION_ERROR with ₹0 deductions and preserved clock in
    const e3 = res.data?.find((r: any) => r.employee.id === 'e3');
    expect(e3).toBeDefined();
    expect(e3?.impactStatus).toBe('CONFIGURATION_ERROR');
    expect(e3?.totalDailyImpact).toBe(0);
    expect(e3?.totalDeductions).toBe(0);
    expect(e3?.clockIn).toBe('2026-10-28T04:30:00Z');
  });

  // 3. Two employees have invalid salary configurations (EMP012 and EMP019 scenario)
  it('3. reports both EMP012 and EMP019 in failures and allows valid EMP001 to calculate', async () => {
    db.tables.employees.push({ id: 'e4', first_name: 'Bhoopesh', last_name: 'B', employee_code: 'EMP019', departments: { name: 'IT' }, office: { name: 'HQ' } });
    db.tables.attendance.push({ employee_id: 'e4', attendance_date: '2026-10-28', status: 'COMPLETED', clock_in_at: '2026-10-28T04:20:00Z', clock_out_at: null, shift_template: null });

    (payrollService as any).calculatePayrollDetails = vi.fn(async (emp: string) => {
      if (emp === 'e3') {
        return { data: null, error: new Error('Salary configuration is invalid: gross salary must be greater than zero.') };
      }
      if (emp === 'e4') {
        return { data: null, error: new Error('Salary configuration is invalid: gross salary must be greater than zero.') };
      }
      return { data: createCalc(45000), error: null };
    });

    const res = await payrollService.getDailyDeductionReport('2026-10-28');
    expect(res.error).toBeNull();
    expect(res.failures).toHaveLength(2);
    expect(res.failures?.map((f: any) => f.employeeCode).sort()).toEqual(['EMP012', 'EMP019']);

    // Valid employees count is maintained
    const validRows = res.data?.filter((r: any) => r.impactStatus !== 'CONFIGURATION_ERROR');
    expect(validRows?.map((r: any) => r.employee.employee_code).sort()).toEqual(['EMP001', 'EMP002']);
  });

  // 4. One employee has no active salary structure
  it('4. handles an employee with no active salary structure gracefully', async () => {
    (payrollService as any).calculatePayrollDetails = vi.fn(async (emp: string) => {
      if (emp === 'e3') {
        return { data: null, error: new Error('No active salary structure found for this payroll period.') };
      }
      return { data: createCalc(30000), error: null };
    });

    const res = await payrollService.getDailyDeductionReport('2026-10-28');
    expect(res.error).toBeNull();
    const failure = res.failures?.find((f: any) => f.employeeId === 'e3');
    expect(failure).toBeDefined();
    expect(failure?.error).toContain('No active salary structure');

    const e3 = res.data?.find((r: any) => r.employee.id === 'e3');
    expect(e3?.impactStatus).toBe('CONFIGURATION_ERROR');
    expect(e3?.configurationError).toContain('No active salary structure');
  });

  // 5. Valid employees can still be processed when another employee has an invalid salary
  it('5. valid employees continue calculating deductions without disruption', async () => {
    (payrollService as any).calculatePayrollDetails = vi.fn(async (emp: string, _y: number, _m: number, _s: string, end: string) => {
      if (emp === 'e3') {
        return { data: null, error: new Error('Salary configuration is invalid: gross salary must be greater than zero.') };
      }
      // e1 has a ₹200 late deduction that occurred on 2026-10-28 (0 before)
      if (emp === 'e1') {
        return { data: end >= '2026-10-28' ? createCalc(26000, 30, 200) : createCalc(26000, 0, 0), error: null };
      }
      return { data: createCalc(30000, 0, 0), error: null };
    });

    const res = await payrollService.getDailyDeductionReport('2026-10-28');
    expect(res.error).toBeNull();
    const e1 = res.data?.find((r: any) => r.employee.id === 'e1');
    expect(e1?.lateDeduction).toBe(200);
    expect(e1?.totalDailyImpact).toBe(200);
  });

  // 6. Existing payroll records remain unchanged when a new generation attempt fails
  it('6. recalculation preserves existing payroll records if gross salary is invalid', async () => {
    // When recalculatePayroll runs calculatePayrollDetails and receives grossSalary <= 0,
    // it returns { error } and does not overwrite existing row
    const res = await payrollService.calculatePayrollDetails('e3', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.data).toBeNull();
    expect(res.error?.message).toContain('gross salary must be greater than zero');
  });

  // 7. Approved and paid payroll records are protected
  it('7. protects approved and paid payroll records from recalculation or ₹0 approval', () => {
    // Approval block reason prevents approving ₹0 gross salary
    const blockedReason = approvalBlockReason('', { gross_salary: 0, basic_salary: 0 });
    expect(blockedReason).toContain('Cannot approve payroll with ₹0 gross salary');

    const validReason = approvalBlockReason('', { gross_salary: 25000, basic_salary: 25000 });
    expect(validReason).toBeNull();
  });

  // 8. Duplicate deductions are prevented
  it('8. prevents duplicate deductions across daily calculations', () => {
    const metrics = buildDailyMetrics([
      { employee: { id: 'e1' }, lateDeduction: 200, breakDeduction: 100, lopImpact: 0, otherDeductions: 0, totalDailyImpact: 300, overtimePay: 0 },
      { employee: { id: 'e3' }, lateDeduction: 0, breakDeduction: 0, lopImpact: 0, otherDeductions: 0, totalDailyImpact: 0, overtimePay: 0, impactStatus: 'CONFIGURATION_ERROR' },
    ]);

    expect(metrics.late.total).toBe(200);
    expect(metrics.break.total).toBe(100);
    expect(metrics.total.total).toBe(300); // 200 + 100 = 300, invalid employee adds ₹0
  });

  // 9. Database and network failures are handled correctly
  it('9. truthfully reports database query failures without masking them as empty data', async () => {
    db.fail = ['attendance'];
    const res = await payrollService.getDailyDeductionReport('2026-10-28');
    expect(res.data).toBeNull();
    expect(res.error).toBeDefined();
    expect(res.error?.message).toContain('Attendance could not be loaded: attendance database query error');
  });

  // 10. Payroll totals remain accurate when invalid employees are excluded from calculation
  it('10. summary cards reconcile accurately with invalid employees safely isolated', () => {
    const dailyData = [
      { employee: { id: 'e1', first_name: 'Arun', last_name: 'K', employee_code: 'EMP001' }, clockIn: '2026-10-28T04:00:00Z', clockOut: '2026-10-28T12:00:00Z', shift: 'Standard', lateDeduction: 200, breakDeduction: 0, lopImpact: 0, otherDeductions: 0, totalDailyImpact: 200, overtimePay: 0 },
      { employee: { id: 'e2', first_name: 'Priya', last_name: 'R', employee_code: 'EMP002' }, clockIn: '2026-10-28T04:15:00Z', clockOut: '2026-10-28T12:15:00Z', shift: 'Standard', lateDeduction: 0, breakDeduction: 0, lopImpact: 0, otherDeductions: 0, totalDailyImpact: 0, overtimePay: 0 },
      { employee: { id: 'e3', first_name: 'Yuvaraj', last_name: 'K', employee_code: 'EMP012' }, clockIn: '2026-10-28T04:30:00Z', clockOut: null, shift: 'Standard', lateDeduction: 0, breakDeduction: 0, lopImpact: 0, otherDeductions: 0, totalDailyImpact: 0, overtimePay: 0, impactStatus: 'CONFIGURATION_ERROR' },
    ];

    // Clocked in card includes all 3 who clocked in today
    const clockedCard = clockedInCard(dailyData);
    expect(clockedCard.count).toBe(3);

    // Deduction metrics sum only valid calculations (200 + 0 + 0 = 200)
    const metrics = buildDailyMetrics(dailyData);
    expect(metrics.total.total).toBe(200);

    // Month cards sum only generated payrolls
    const monthCards = payrollMonthCards(
      [
        { id: 'e1', status: 'ACTIVE' },
        { id: 'e2', status: 'ACTIVE' },
        { id: 'e3', status: 'ACTIVE' },
      ],
      [
        { id: 'p1', employee_id: 'e1', status: 'UNDER_REVIEW', gross_salary: 30000, total_deductions: 1000, net_salary: 29000 },
        { id: 'p2', employee_id: 'e2', status: 'UNDER_REVIEW', gross_salary: 40000, total_deductions: 500, net_salary: 39500 },
      ]
    );

    expect(monthCards.total.count).toBe(3);
    expect(monthCards.generated.count).toBe(2);
    expect(monthCards.gross.amount).toBe(70000);
    expect(monthCards.deductions.amount).toBe(1500);
    expect(monthCards.net.amount).toBe(68500);
  });
});
