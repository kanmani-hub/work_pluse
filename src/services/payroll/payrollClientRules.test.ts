import { describe, it, expect, vi, beforeEach } from 'vitest';
import { payrollService } from './payrollService';
import { salaryService } from './salaryService';
import { payrollDataService } from './payrollDataService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { payrollSettingsService } from './payrollSettingsService';
import { auditService } from '../audit/auditService';
import { payrollAuditService } from './payrollAuditService';
import { notificationService } from '../notifications/notificationService';

// Mock dependencies
vi.mock('./salaryService');
vi.mock('./payrollDataService');
vi.mock('../settings/globalSettingsService');
vi.mock('./payrollSettingsService');
vi.mock('../audit/auditService');
vi.mock('./payrollAuditService');
vi.mock('../notifications/notificationService');
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockImplementation((payload) => ({ 
        select: vi.fn().mockReturnValue({ 
          single: vi.fn().mockResolvedValue({ data: { id: 'mock-id', ...payload }, error: null }) 
        }) 
      })),
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null }) }),
    }))
  }
}));

/**
 * calculatePayrollDetails reads the module results through payrollDataService._fetchPayrollDays
 * (day classification + late/break minutes + leave), _fetchWfh, _fetchPermissions and
 * _fetchApprovedOvertime. The real functions always return complete objects plus `error`, so the
 * fixtures provide the same shape. Defaults: a full month worked (25 of 25 days present, 0 absent)
 * so no LOP is involved. `dataError` makes the named lookup fail.
 */
function mockEmployeeData(d: { attendance: any; permission: any; leave: any; wfh: any; approvedOvertimeMinutes?: number; overtimeError?: string; dataError?: 'days' | 'wfh' | 'permission' }) {
  // Approved overtime comes ONLY from overtime_requests (APPROVED); default none
  (payrollDataService._fetchApprovedOvertime as any).mockResolvedValue(
    d.overtimeError ? { minutes: 0, error: new Error(d.overtimeError) } : { minutes: d.approvedOvertimeMinutes || 0, error: null });
  (payrollDataService._fetchPayrollDays as any).mockResolvedValue({
    attendance: {
      workingDays: 25, presentDays: 25, absentDays: 0, lateLogins: 0, earlyLogouts: 0,
      totalBreakOverrunMinutes: 0, sandwichLopDays: 0, ...d.attendance,
    },
    leave: { approvedLeave: 0, totalLeaveDays: d.leave.lopLeave || 0, ...d.leave },
    days: [],
    error: d.dataError === 'days' ? new Error('Attendance could not be loaded: offline') : null,
  });
  (payrollDataService._fetchWfh as any).mockResolvedValue({ ...d.wfh, error: d.dataError === 'wfh' ? new Error('Approved WFH could not be loaded: offline') : null });
  (payrollDataService._fetchPermissions as any).mockResolvedValue({ permissionCount: 0, ...d.permission, error: d.dataError === 'permission' ? new Error('Approved permissions could not be loaded: offline') : null });
}

describe('Client Salary Deduction Rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock global settings (app)
    // Limit: 3h, Break Limit: 75m
    (globalSettingsService.loadSettings as any).mockResolvedValue({
      app: {
        permissionMaxHoursPerMonth: 3,
        breakDurationMins: 75,
      }
    });

    // Mock global settings (payroll)
    // Monthly Salary: ₹5,000, Working days: 25 -> dailyRate = ₹200 -> hourly = ₹25
    (globalSettingsService.loadSettings as any).mockResolvedValue({
      updated_at: '2026-10-01T00:00:00Z',
      app: {
        permissionMaxHoursPerMonth: 3,
        breakDurationMins: 75,
      },
      payroll: {
        enableLateLoginDeduction: true,
        lateDeductionMethod: 'interval_based',
        lateIntervalMinutes: 15,
        lateIntervalAmount: 100,
        enablePermissionDeduction: true,
        enableBreakOverrunDetection: true,
        enableBreakOverrunDeduction: true,
        breakOverrunDeductionMethod: 'salary_based',
        permissionDeductionMethod: 'salary_based',
        permissionPerMinuteRate: 1, // rate = 1 multiplier
        roundingMethod: 'nearest',
        roundingPrecision: 2
      }
    });

    (payrollSettingsService.getWorkingDaysForMonth as any).mockReturnValue(25);
    (payrollSettingsService.applyRounding as any).mockImplementation((val: number) => Math.round(val * 100) / 100);

    // Basic Salary = ₹5,000
    (salaryService.getSalaryStructureForPeriod as any).mockResolvedValue({
      data: {
        basic_salary: 5000,
        hra: 0,
        transport_allowance: 0,
        medical_allowance: 0,
        special_allowance: 0,
        other_allowances: 0,
        standard_deduction: 0
      },
      error: null
    });
  });

  it('Late: 15 min -> ₹100, 30 min -> ₹200, 45 min -> ₹300', async () => {
    const testCases = [
      { mins: 15, expectedDeduction: 100 },
      { mins: 30, expectedDeduction: 200 },
      { mins: 45, expectedDeduction: 300 },
      { mins: 14, expectedDeduction: 0 }
    ];

    for (const tc of testCases) {
      mockEmployeeData({
        attendance: { totalLateMinutes: tc.mins, halfDays: 0, lopDays: 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0 },
        permission: { totalMinutes: 0 },
        leave: { lopLeave: 0 },
        wfh: { wfhDays: 0 }
      });

      const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
      expect(res.error).toBeNull();
      
      const expectedNet = 5000 - tc.expectedDeduction;
      expect(res.data.net_salary).toBe(expectedNet);
      expect(res.data.total_deductions).toBe(tc.expectedDeduction);
    }
  });

  it('Permission: Limit 3h, used 5h -> 2h salary-based deduction (2 * ₹25 = ₹50)', async () => {
    mockEmployeeData({
      attendance: { totalLateMinutes: 0, halfDays: 0, lopDays: 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0 },
      permission: { totalMinutes: 5 * 60 }, // 5 hours
      leave: { lopLeave: 0 },
      wfh: { wfhDays: 0 }
    });

    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();

    // 5h - 3h limit = 2h excess
    // 2h * ₹25/h = ₹50 deduction
    expect(res.data.total_deductions).toBe(50);
    expect(res.data.net_salary).toBe(4950);
  });

  it('Break: Allowed 75 min, actual 105 min (30 min excess) -> ₹12.50 deduction', async () => {
    mockEmployeeData({
      attendance: { totalLateMinutes: 0, halfDays: 0, lopDays: 0, totalBreakExcessMinutes: 30, totalOvertimeMinutes: 0 },
      permission: { totalMinutes: 0 },
      leave: { lopLeave: 0 },
      wfh: { wfhDays: 0 }
    });

    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();

    // 30 mins = 0.5 hours. 0.5 * ₹25/h = ₹12.50 deduction
    expect(res.data.total_deductions).toBe(12.50);
    expect(res.data.net_salary).toBe(4987.50);
  });

  it('Permission: Limit 3h, used 3h -> ₹0', async () => {
    mockEmployeeData({
      attendance: { totalLateMinutes: 0, halfDays: 0, lopDays: 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0 },
      permission: { totalMinutes: 3 * 60 }, // exactly 3 hours
      leave: { lopLeave: 0 },
      wfh: { wfhDays: 0 }
    });

    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();
    expect(res.data.total_deductions).toBe(0);
  });
});

describe('Overtime pay: approved overtime requests only', () => {
  const settingsWithOvertime = () => (globalSettingsService.loadSettings as any).mockResolvedValue({
    updated_at: '2026-10-01T00:00:00Z',
    app: { permissionMaxHoursPerMonth: 3, breakDurationMins: 75 },
    payroll: {
      enableOvertimePay: true, overtimeRateType: 'multiplier', overtimeMultiplier: 1.5,
      roundingMethod: 'nearest', roundingPrecision: 2,
    },
  });
  const baseData = { permission: { totalMinutes: 0 }, leave: { lopLeave: 0 }, wfh: { wfhDays: 0 } };

  beforeEach(() => {
    vi.clearAllMocks();
    settingsWithOvertime();
    (payrollSettingsService.getWorkingDaysForMonth as any).mockReturnValue(25);
    (payrollSettingsService.applyRounding as any).mockImplementation((val: number) => Math.round(val * 100) / 100);
    (salaryService.getSalaryStructureForPeriod as any).mockResolvedValue({ data: { basic_salary: 5000 }, error: null });
  });

  it('attendance extra time without an approved request is NOT paid (₹0 overtime)', async () => {
    mockEmployeeData({ ...baseData, attendance: { totalLateMinutes: 0, halfDays: 0, lopDays: 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 120 }, approvedOvertimeMinutes: 0 });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();
    expect(res.data.overtime_amount).toBe(0);
    expect(res.data.net_salary).toBe(5000);
  });

  it('approved overtime is paid on approved hours only: 60 min × ₹25/h × 1.5 = ₹37.50', async () => {
    // 120 recorded minutes, but only 60 approved → only 60 are paid
    mockEmployeeData({ ...baseData, attendance: { totalLateMinutes: 0, halfDays: 0, lopDays: 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 120 }, approvedOvertimeMinutes: 60 });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();
    expect(res.data.overtime_amount).toBe(37.5);
    expect(res.data.net_salary).toBe(5037.5);
  });

  it('if approved overtime cannot be loaded, payroll is not calculated (no silent ₹0)', async () => {
    mockEmployeeData({ ...baseData, attendance: { totalLateMinutes: 0, halfDays: 0, lopDays: 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0 }, overtimeError: 'Approved overtime could not be loaded: offline' });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.data).toBeNull();
    expect(res.error?.message).toMatch('Approved overtime could not be loaded');
  });
});

describe('Loss of Pay (LOP): classification result → deduction', () => {
  const lopSettings = (over: any = {}) => (globalSettingsService.loadSettings as any).mockResolvedValue({
    updated_at: '2026-10-01T00:00:00Z',
    app: { permissionMaxHoursPerMonth: 3, breakDurationMins: 75, workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
    payroll: {
      enableLopDeductions: true, lopMethod: 'daily_rate',
      enableHalfDayDeductions: true, halfDayMethod: 'daily_rate',
      enableLateLoginDeduction: true, lateDeductionMethod: 'interval_based', lateIntervalMinutes: 15, lateIntervalAmount: 100,
      roundingMethod: 'nearest', roundingPrecision: 2, ...over,
    },
  });
  const none = { permission: { totalMinutes: 0 }, wfh: { wfhDays: 0 } };
  const att = (a: any) => ({ totalLateMinutes: 0, halfDays: 0, lopDays: 0, absentDays: 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0, ...a });

  beforeEach(() => {
    vi.clearAllMocks();
    lopSettings();
    (payrollSettingsService.getWorkingDaysForMonth as any).mockReturnValue(25); // daily rate ₹200
    (payrollSettingsService.applyRounding as any).mockImplementation((val: number) => Math.round(val * 100) / 100);
    (salaryService.getSalaryStructureForPeriod as any).mockResolvedValue({ data: { basic_salary: 5000 }, error: null });
  });

  it('LATE 30 min on a worked day → ₹200 late deduction only, no LOP', async () => {
    mockEmployeeData({ ...none, attendance: att({ totalLateMinutes: 30 }), leave: { lopLeave: 0 } });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();
    expect(res.data.lop_deduction).toBe(0);
    expect(res.data.total_deductions).toBe(200);
    expect(res.data.net_salary).toBe(4800);
  });

  it('2 unexcused absences → 2 × ₹200 LOP = ₹400', async () => {
    mockEmployeeData({ ...none, attendance: att({ absentDays: 2, lopDays: 2, presentDays: 23 }), leave: { lopLeave: 0 } });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();
    expect(res.data.lop_deduction).toBe(400);
    expect(res.data.net_salary).toBe(4600);
  });

  it('absence + LOP leave + sandwich: LOP days used exactly once (no subtraction of paid leave or WFH)', async () => {
    // Classification already excluded paid leave; it must not be subtracted again (old bug)
    mockEmployeeData({ ...none, wfh: { wfhDays: 3 }, attendance: att({ absentDays: 1, sandwichLopDays: 1, lopDays: 3 }), leave: { approvedLeave: 2, lopLeave: 1 } });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();
    expect(res.data.lop_deduction).toBe(600);
    expect(res.data.total_deductions).toBe(600);
  });

  it('half day + late minutes: half-day ₹100 and late ₹100 are separate items, LOP ₹0', async () => {
    mockEmployeeData({ ...none, attendance: att({ halfDays: 1, totalLateMinutes: 15 }), leave: { lopLeave: 0 } });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();
    expect(res.data.lop_deduction).toBe(0);
    expect(res.data.total_deductions).toBe(200);
  });

  it('LOP deductions disabled in Settings → no LOP even with absences', async () => {
    lopSettings({ enableLopDeductions: false });
    mockEmployeeData({ ...none, attendance: att({ absentDays: 2, lopDays: 2 }), leave: { lopLeave: 0 } });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.error).toBeNull();
    expect(res.data.lop_deduction).toBe(0);
    expect(res.data.net_salary).toBe(5000);
  });

  for (const which of ['days', 'wfh', 'permission'] as const) {
    it(`a failed ${which} lookup stops the calculation (never treated as zero)`, async () => {
      mockEmployeeData({ ...none, attendance: att({}), leave: { lopLeave: 0 }, dataError: which });
      const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
      expect(res.data).toBeNull();
      expect(res.error?.message).toMatch('could not be loaded: offline');
    });
  }

  it('if the settings row could not be loaded (defaults only), payroll is not calculated', async () => {
    (globalSettingsService.loadSettings as any).mockResolvedValue({ app: {}, payroll: { enableLopDeductions: true } });
    mockEmployeeData({ ...none, attendance: att({}), leave: { lopLeave: 0 } });
    const res = await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('Company settings could not be loaded. Payroll was not calculated.');
  });

  it('the classification is asked for the configured period and today (company date)', async () => {
    mockEmployeeData({ ...none, attendance: att({}), leave: { lopLeave: 0 } });
    await payrollService._doCalculate('emp1', 2026, 10, '2026-10-01', '2026-10-31');
    const call = (payrollDataService._fetchPayrollDays as any).mock.calls[0];
    expect(call.slice(0, 3)).toEqual(['emp1', '2026-10-01', '2026-10-31']);
    expect(call[3].workingDays.length).toBe(6);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(call[4])).toBe(true);
  });
});
