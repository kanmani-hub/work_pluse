import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePayrollSnapshot, approvalBlockReason, unresolvedReviewItems } from './payrollRules';
import { payrollMonthCards } from './payrollCardRules';
import { classifyPayrollDays, summarizeDays } from './attendanceClassification';
import { payrollService } from './payrollService';
import { salaryService } from './salaryService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { payrollDataService } from './payrollDataService';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/supabase', () => {
  return {
    supabase: {
      from: vi.fn(),
      auth: { getUser: vi.fn() },
      rpc: vi.fn(),
    },
  };
});

describe('Monthly Payroll and Attendance Reconciliation Fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Snapshot Parsing from remarks and notes', () => {
    it('parses valid snapshot from payroll.remarks', () => {
      const snap = {
        attendance: { workingDays: 26, presentDays: 22, absentDays: 1, lateLogins: 2, lopDays: 2 },
        leave: { approvedLeave: 2, lopLeave: 1, totalLeaveDays: 3 },
        settings: { workingDaysUsed: 26, dailyRate: 1000 },
      };
      const payroll = { remarks: JSON.stringify(snap) };
      const parsed = parsePayrollSnapshot(payroll.remarks);
      expect(parsed).toEqual(snap);
      expect(parsed.attendance.presentDays).toBe(22);
      expect(parsed.leave.approvedLeave).toBe(2);
      expect(parsed.leave.lopLeave).toBe(1);
    });

    it('falls back to payroll.notes if remarks is missing or empty', () => {
      const snap = { attendance: { presentDays: 18 }, leave: { approvedLeave: 1, lopLeave: 0 } };
      const payroll = { remarks: null, notes: JSON.stringify(snap) };
      const parsed = parsePayrollSnapshot(payroll.remarks) || parsePayrollSnapshot(payroll.notes);
      expect(parsed).toEqual(snap);
      expect(parsed.attendance.presentDays).toBe(18);
    });

    it('returns null when neither remarks nor notes contains valid JSON snapshot', () => {
      expect(parsePayrollSnapshot(null)).toBeNull();
      expect(parsePayrollSnapshot('')).toBeNull();
      expect(parsePayrollSnapshot('plain text remarks')).toBeNull();
      expect(parsePayrollSnapshot(undefined)).toBeNull();
    });
  });

  describe('2. Table Summary Extraction without False Zeroes', () => {
    const extractTableSummary = (p: any) => {
      const summary = parsePayrollSnapshot(p?.remarks) || parsePayrollSnapshot(p?.notes);
      const workingDays = summary?.settings?.workingDaysUsed ?? 26;
      const present = typeof summary?.attendance?.presentDays === 'number' ? summary.attendance.presentDays : null;
      const approvedLeave = typeof summary?.leave?.approvedLeave === 'number' ? summary.leave.approvedLeave : null;
      const lopLeave = typeof summary?.leave?.lopLeave === 'number' ? summary.leave.lopLeave : null;
      return { workingDays, present, approvedLeave, lopLeave };
    };

    it('extracts correct present, leave, and LOP days from remarks', () => {
      const payroll = {
        remarks: JSON.stringify({
          attendance: { presentDays: 21, lopDays: 3 },
          leave: { approvedLeave: 2, lopLeave: 1 },
          settings: { workingDaysUsed: 26 },
        }),
      };
      const ts = extractTableSummary(payroll);
      expect(ts.present).toBe(21);
      expect(ts.approvedLeave).toBe(2);
      expect(ts.lopLeave).toBe(1);
      expect(ts.workingDays).toBe(26);
    });

    it('returns null instead of 0 when snapshot is missing or failed', () => {
      const payroll = { remarks: null, notes: null };
      const ts = extractTableSummary(payroll);
      expect(ts.present).toBeNull();
      expect(ts.approvedLeave).toBeNull();
      expect(ts.lopLeave).toBeNull();
    });

    it('preserves legitimate zero present days when employee was indeed present 0 days', () => {
      const payroll = {
        remarks: JSON.stringify({
          attendance: { presentDays: 0, lopDays: 26 },
          leave: { approvedLeave: 0, lopLeave: 26 },
        }),
      };
      const ts = extractTableSummary(payroll);
      expect(ts.present).toBe(0);
      expect(ts.approvedLeave).toBe(0);
      expect(ts.lopLeave).toBe(26);
    });
  });

  describe('3. Salary Configuration & Zero Gross Protection', () => {
    it('blocks approval when gross_salary is 0', () => {
      const remarks = JSON.stringify({ attendance: { reviewItems: [] } });
      const zeroGrossPayroll = { gross_salary: 0, basic_salary: 0, net_salary: 0, total_deductions: 700 };
      const reason = approvalBlockReason(remarks, zeroGrossPayroll);
      expect(reason).toBe('Cannot approve payroll with ₹0 gross salary. Configure a valid salary structure and recalculate.');
    });

    it('blocks approval when unresolved review items exist', () => {
      const remarks = JSON.stringify({
        attendance: {
          reviewItems: [{ date: '2026-10-15', type: 'SHORT_DAY', reason: 'Short working day' }],
        },
      });
      const validPayroll = { gross_salary: 25000, basic_salary: 25000, net_salary: 24000 };
      const reason = approvalBlockReason(remarks, validPayroll);
      expect(reason).toContain('Cannot approve: 1 attendance review flag(s) are unresolved');
    });

    it('allows approval when gross salary is positive and review items are resolved', () => {
      const remarks = JSON.stringify({ attendance: { reviewItems: [] } });
      const validPayroll = { gross_salary: 25000, basic_salary: 25000, net_salary: 24000 };
      expect(approvalBlockReason(remarks, validPayroll)).toBeNull();
    });

    it('calculatePayrollDetails refuses calculation when gross salary is 0', async () => {
      vi.spyOn(salaryService, 'getCurrentEmployeeId').mockResolvedValue('admin-1');
      vi.spyOn(salaryService, 'getSalaryStructureForPeriod').mockResolvedValue({
        data: { basic_salary: 0, hra: 0, transport_allowance: 0, medical_allowance: 0, special_allowance: 0, other_allowances: 0 } as any,
        error: null,
      });
      vi.spyOn(globalSettingsService, 'loadSettings').mockResolvedValue({
        updated_at: '2026-10-28T00:00:00Z',
        payroll: { workingDaysBasis: 'configured', configuredWorkingDays: 26 } as any,
        app: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] } as any,
      } as any);

      const res = await payrollService.calculatePayrollDetails('emp-zero', 2026, 10, '2026-10-01', '2026-10-31');
      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('Salary configuration is invalid: gross salary must be greater than zero.');
    });
  });

  describe('4. Deductions Exceeding Earnings Handling', () => {
    it('flags review requirement when total deductions exceed eligible earnings', async () => {
      vi.spyOn(salaryService, 'getCurrentEmployeeId').mockResolvedValue('admin-1');
      vi.spyOn(salaryService, 'getSalaryStructureForPeriod').mockResolvedValue({
        data: { basic_salary: 1000, standard_deduction: 1500 } as any,
        error: null,
      });
      vi.spyOn(globalSettingsService, 'loadSettings').mockResolvedValue({
        updated_at: '2026-10-28T00:00:00Z',
        payroll: { workingDaysBasis: 'configured', configuredWorkingDays: 26, salaryRounding: 'round' } as any,
        app: { workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] } as any,
      } as any);

      vi.spyOn(payrollDataService, '_fetchPayrollDays').mockResolvedValue({
        attendance: { workingDays: 26, presentDays: 26, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0, totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0, lateRecords: [] },
        leave: { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 },
        days: [],
        error: null,
      });
      vi.spyOn(payrollDataService, '_fetchWfh').mockResolvedValue({ wfhDays: 0, error: null });
      vi.spyOn(payrollDataService, '_fetchPermissions').mockResolvedValue({ permissionCount: 0, totalMinutes: 0, error: null });
      vi.spyOn(payrollDataService, '_fetchApprovedOvertime').mockResolvedValue({ minutes: 0, error: null });
      vi.spyOn(payrollDataService, '_fetchPayrollAdjustments').mockResolvedValue({ data: [], error: null, notSetUp: false });

      const res = await payrollService.calculatePayrollDetails('emp-ded', 2026, 10, '2026-10-01', '2026-10-31');
      expect(res.data).not.toBeNull();
      expect(res.data?.grossSalary).toBe(1000);
      expect(res.data?.totalDeductions).toBe(1500);
      expect(res.data?.netSalary).toBe(0);
      // Ensure review item was added for admin attention
      const reviewItem = res.data?.empData.attendance.reviewItems?.find(i => i.type === 'DEDUCTIONS_EXCEED_EARNINGS');
      expect(reviewItem).toBeDefined();
      expect(reviewItem?.reason).toContain('exceed eligible earnings');
    });
  });

  describe('5. Attendance Classification for Current Month (October 2026)', () => {
    it('distinguishes completed workdays, today pending, and future dates', () => {
      const today = '2026-10-28';
      const days = classifyPayrollDays({
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        today,
        workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        holidays: ['2026-10-02'], // Gandhi Jayanti
        attendance: [
          { attendance_date: '2026-10-01', clock_in_at: '2026-10-01T09:00:00Z', status: 'PRESENT' },
          { attendance_date: '2026-10-03', clock_in_at: '2026-10-03T09:30:00Z', status: 'LATE', late_minutes: 30 },
          { attendance_date: '2026-10-05', clock_in_at: '2026-10-05T09:00:00Z', status: 'HALF_DAY', is_half_day: true },
        ],
        leaves: [
          { start_date: '2026-10-06', end_date: '2026-10-06', isLop: false }, // Paid leave
          { start_date: '2026-10-07', end_date: '2026-10-07', isLop: true },  // LOP leave
        ],
      });

      // Oct 1: Worked
      expect(days.find(d => d.date === '2026-10-01')?.kind).toBe('PRESENT');
      // Oct 2: Holiday
      expect(days.find(d => d.date === '2026-10-02')?.kind).toBe('HOLIDAY');
      // Oct 4: Sunday -> Weekly Off
      expect(days.find(d => d.date === '2026-10-04')?.kind).toBe('WEEKLY_OFF');
      // Oct 5: Half day
      expect(days.find(d => d.date === '2026-10-05')?.kind).toBe('HALF_DAY');
      // Oct 6: Paid leave
      expect(days.find(d => d.date === '2026-10-06')?.kind).toBe('PAID_LEAVE');
      // Oct 7: LOP leave
      expect(days.find(d => d.date === '2026-10-07')?.kind).toBe('LOP_LEAVE');
      // Oct 28 (today without clock-in): TODAY_PENDING, not ABSENT
      expect(days.find(d => d.date === '2026-10-28')?.kind).toBe('TODAY_PENDING');
      // Oct 29, 30, 31 (future): FUTURE, not ABSENT
      expect(days.find(d => d.date === '2026-10-29')?.kind).toBe('FUTURE');
      expect(days.find(d => d.date === '2026-10-30')?.kind).toBe('FUTURE');
      expect(days.find(d => d.date === '2026-10-31')?.kind).toBe('FUTURE');

      const sum = summarizeDays(days);
      // Future dates must not contribute to LOP or absence
      expect(days.filter(d => d.kind === 'FUTURE').every(d => d.lop === 0 && d.absentLop === 0)).toBe(true);
      // Today pending must not contribute to LOP or absence
      expect(days.find(d => d.kind === 'TODAY_PENDING')?.lop).toBe(0);
      expect(days.find(d => d.kind === 'TODAY_PENDING')?.absentLop).toBe(0);
    });
  });

  describe('6. Monthly Summary Cards Reconciliation', () => {
    it('accurately reconciles 15 employees, 12 payroll records, 12 under review, 0 approved/paid', () => {
      const employees = Array.from({ length: 15 }, (_, i) => ({
        id: `emp-${i + 1}`,
        first_name: `Emp`,
        last_name: `${i + 1}`,
        employee_code: `WP${String(i + 1).padStart(3, '0')}`,
        status: 'ACTIVE',
      }));

      // 12 employees have generated payrolls under review
      const monthPayrolls = Array.from({ length: 12 }, (_, i) => ({
        id: `pay-${i + 1}`,
        employee_id: `emp-${i + 1}`,
        payroll_year: 2026,
        payroll_month: 10,
        status: 'UNDER_REVIEW',
        gross_salary: 30000,
        total_deductions: 1000,
        lop_deduction: 500,
        overtime_amount: 0,
        net_salary: 29000,
      }));

      const cards = payrollMonthCards(employees, monthPayrolls);

      expect(cards.total.count).toBe(15);
      expect(cards.generated.count).toBe(12);
      expect(cards.underReview.count).toBe(12);
      expect(cards.approved.count).toBe(0);
      expect(cards.paymentPending.count).toBe(0);
      expect(cards.paid.count).toBe(0);

      // Amount checks
      expect(cards.gross.amount).toBe(12 * 30000);
      expect(cards.deductions.amount).toBe(12 * 1000);
      expect(cards.net.amount).toBe(12 * 29000);

      // Verify no double counting of missing payroll records
      const missingCount = employees.length - monthPayrolls.length;
      expect(missingCount).toBe(3);
    });
  });
});
