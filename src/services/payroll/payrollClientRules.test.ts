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
      (payrollDataService.getEmployeePayrollData as any).mockResolvedValue({
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
    (payrollDataService.getEmployeePayrollData as any).mockResolvedValue({
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
    (payrollDataService.getEmployeePayrollData as any).mockResolvedValue({
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
    (payrollDataService.getEmployeePayrollData as any).mockResolvedValue({
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
