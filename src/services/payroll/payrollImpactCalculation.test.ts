import { describe, it, expect } from 'vitest';
import { resolveClockInSession } from '../attendance/clockRules';
import { calculateLateDeduction } from './payrollLateDeductionRules';
import { evaluateDailyImpact } from './payrollImpactRules';
import { detectMissingClockOut } from '../attendance/missingClockOutRules';
import { overtimePayAmount } from './payrollRules';

// Helper to construct UTC ms from Asia/Kolkata date and time
const ist = (dateStr: string, timeStr: string) => new Date(`${dateStr}T${timeStr}:00+05:30`).getTime();

describe('Attendance & Payroll Impact Calculation Engine', () => {

  describe('1. On-time and late clock-ins', () => {
    const shift = { start_time: '10:00:00', end_time: '19:00:00', crosses_midnight: false };

    it('clock-in before shift start is on-time (0 late minutes)', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-21', '09:55'),
        today: '2026-10-21',
        shift,
        graceMinutes: 5,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.lateMinutes).toBe(0);
      expect(res.attendanceDate).toBe('2026-10-21');
    });

    it('clock-in exactly at shift start is on-time (0 late minutes)', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-21', '10:00'),
        today: '2026-10-21',
        shift,
        graceMinutes: 5,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.lateMinutes).toBe(0);
    });

    it('clock-in after shift start exceeding grace period produces late minutes from shift start', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-21', '10:18'),
        today: '2026-10-21',
        shift,
        graceMinutes: 10,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.lateMinutes).toBe(18);
    });
  });

  describe('2. Grace-period boundaries', () => {
    const shift = { start_time: '10:00:00', end_time: '19:00:00', crosses_midnight: false };

    it('arrival within grace period produces 0 late minutes', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-21', '10:08'),
        today: '2026-10-21',
        shift,
        graceMinutes: 10,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.lateMinutes).toBe(0);
    });

    it('arrival exactly at grace-period boundary (10:10 with 10m grace) produces 0 late minutes', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-21', '10:10'),
        today: '2026-10-21',
        shift,
        graceMinutes: 10,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.lateMinutes).toBe(0);
    });

    it('arrival 1 minute past grace period (10:11 with 10m grace) produces 11 late minutes', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-21', '10:11'),
        today: '2026-10-21',
        shift,
        graceMinutes: 10,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.lateMinutes).toBe(11);
    });

    it('arrival with 0 grace period: 10:03 is 3 late minutes', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-21', '10:03'),
        today: '2026-10-21',
        shift,
        graceMinutes: 0,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.lateMinutes).toBe(3);
    });
  });

  describe('3. Three late minutes with configured and disabled deductions', () => {
    const baseInput = {
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'interval_based' as const,
      monthlySalary: 26000,
      workingDays: 26,
      totalLateMinutes: 3,
      lateIntervalMinutes: 15,
      lateIntervalAmount: 100,
      latePerMinuteRate: 10,
      lateFixedAmount: 100,
      salaryRounding: 'round' as const,
    };

    it('interval_based: 3 late minutes is below 15-minute threshold → ₹0 deduction', () => {
      const res = calculateLateDeduction({
        ...baseInput,
        lateDeductionMethod: 'interval_based',
      });
      expect(res.deductionAmount).toBe(0);
      expect(res.formulaDescription).toContain('floor(3m ÷ 15m) × ₹100');
    });

    it('disabled: enableLateLoginDeduction = false → ₹0 deduction', () => {
      const res = calculateLateDeduction({
        ...baseInput,
        enableLateLoginDeduction: false,
      });
      expect(res.deductionAmount).toBe(0);
      expect(res.formulaDescription).toBe('Late deduction disabled or 0 late minutes');
    });

    it('per_minute: 3 late minutes @ ₹10/min → ₹30 deduction', () => {
      const res = calculateLateDeduction({
        ...baseInput,
        lateDeductionMethod: 'per_minute',
      });
      expect(res.deductionAmount).toBe(30);
    });

    it('fixed: 3 late minutes with fixed method → ₹100 deduction', () => {
      const res = calculateLateDeduction({
        ...baseInput,
        lateDeductionMethod: 'fixed',
      });
      expect(res.deductionAmount).toBe(100);
    });

    it('salary_based: 3 late minutes (₹26,000 / 26 days / 480 mins = ₹2.0833/min) → ₹6 deduction', () => {
      const res = calculateLateDeduction({
        ...baseInput,
        lateDeductionMethod: 'salary_based',
        defaultRequiredHours: 8,
      });
      expect(res.deductionAmount).toBe(6);
    });

    it('monthlyLateLoginLimit: first occurrence exempt → ₹0 deduction', () => {
      const res = calculateLateDeduction({
        ...baseInput,
        lateDeductionMethod: 'salary_based',
        monthlyLateLoginLimit: 1,
        lateLogins: 1,
      });
      expect(res.deductionAmount).toBe(0);
      expect(res.exemptOccurrences).toBe(1);
    });
  });

  describe('4. Missing clock-out and incomplete shifts (Yuvaraj scenario)', () => {
    const shift = { name: 'Morning', start_time: '10:00:00', end_time: '19:00:00', required_hours: 8, break_duration_minutes: 60 };

    it('Yuvaraj clocked in at 10:03 AM with missing clock-out: calculation is PENDING, never prematurely ₹0', () => {
      const impact = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:33:00.000Z', // 10:03 IST
          clock_out_at: null,
          status: 'LATE',
          late_minutes: 3,
          break_minutes: 0,
          break_overrun_minutes: 0,
          shift_template: shift,
        },
        calculation: {
          grossSalary: 30000,
          workingDays: 26,
          dailyRate: 1153.85,
          lopDeduction: 0,
          overtime: 0,
          deductionItems: [], // 0 deduction under interval threshold
          lateCalculation: { deductionAmount: 0 },
          empData: {
            attendance: { totalLateMinutes: 3, totalBreakExcessMinutes: 0, totalOvertimeMinutes: 0, lopDays: 0 },
          },
          settings: {
            enableLateLoginDeduction: true,
            lateDeductionMethod: 'interval_based',
            lateIntervalMinutes: 15,
            lateIntervalAmount: 100,
            enableBreakOverrunDetection: true,
            enableBreakOverrunDeduction: true,
            enableOvertimePay: true,
            enableLopDeductions: true,
          },
        },
        nowMs: ist('2026-10-21', '14:30'), // During shift
      });

      expect(impact.clockOutStatus).toBe('IN_PROGRESS');
      expect(impact.isShiftInProgress).toBe(true);
      expect(impact.lateMinutes).toBe(3);
      expect(impact.lateDeduction).toBe(0);
      expect(impact.lateStatus).toBe('BELOW_THRESHOLD');
      expect(impact.breakStatus).toBe('PENDING');
      expect(impact.overtimeStatus).toBe('PENDING');
      expect(impact.lopStatus).toBe('PRESENT');
      expect(impact.impactStatus).toBe('PENDING');
    });

    it('past shift exceeding grace hours flags MISSING clock-out state', () => {
      const detection = detectMissingClockOut(
        { attendance_date: '2026-10-21', clock_in_at: '2026-10-21T04:30:00.000Z', clock_out_at: null },
        { start_time: '10:00:00', end_time: '19:00:00' },
        ist('2026-10-21', '22:30'), // 3.5h after 19:00 end
        2 // 2h grace
      );
      expect(detection.state).toBe('MISSING_CLOCK_OUT');
    });
  });

  describe('5. Normal and approved overtime', () => {
    it('unrequested / unapproved extra hours are NOT paid as overtime', () => {
      const pay = overtimePayAmount({
        enableOvertimePay: true,
        approvedOvertimeMinutes: 0,
        dailyRate: 1000,
        overtimeRateType: 'multiplier',
        overtimeMultiplier: 1.5,
      });
      expect(pay).toBe(0);
    });

    it('approved overtime of 120 minutes @ 1.5x of daily rate / 8 pays correctly', () => {
      const dailyRate = 1000;
      const hourlyRate = dailyRate / 8; // 125
      const pay = overtimePayAmount({
        enableOvertimePay: true,
        approvedOvertimeMinutes: 120, // 2h
        dailyRate,
        overtimeRateType: 'multiplier',
        overtimeMultiplier: 1.5,
      });
      // 2h * 125 * 1.5 = 375
      expect(pay).toBe(375);
    });

    it('overtime pay disabled in settings yields ₹0', () => {
      const pay = overtimePayAmount({
        enableOvertimePay: false,
        approvedOvertimeMinutes: 120,
        dailyRate: 1000,
        overtimeRateType: 'multiplier',
        overtimeMultiplier: 1.5,
      });
      expect(pay).toBe(0);
    });
  });

  describe('6. Break overrun and LOP', () => {
    it('clocked-in day is a worked day, not an absence (LOP = 0)', () => {
      const impact = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: '2026-10-21T13:30:00.000Z',
          status: 'COMPLETED',
        },
        calculation: {
          lopDeduction: 0,
          deductionItems: [],
          empData: { attendance: { lopDays: 0 } },
          settings: { enableLopDeductions: true },
        },
      });
      expect(impact.lopImpact).toBe(0);
      expect(impact.lopStatus).toBe('PRESENT');
    });

    it('break overrun exceeding allowance is evaluated and deducted', () => {
      const impact = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: '2026-10-21T13:30:00.000Z',
          status: 'COMPLETED',
          break_minutes: 90,
          break_overrun_minutes: 30,
        },
        calculation: {
          deductionItems: [{ name: 'Break Excess Deduction (0.5h)', amount: 63 }],
          empData: { attendance: { totalBreakExcessMinutes: 30 } },
          settings: { enableBreakOverrunDetection: true, enableBreakOverrunDeduction: true },
        },
      });
      expect(impact.breakOverrunMinutes).toBe(30);
      expect(impact.breakDeduction).toBe(63);
      expect(impact.breakStatus).toBe('FINAL');
    });

    it('active break (status ON_BREAK) marks break status PENDING', () => {
      const impact = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: null,
          status: 'ON_BREAK',
        },
        calculation: {
          deductionItems: [],
          settings: { enableBreakOverrunDetection: true, enableBreakOverrunDeduction: true },
        },
      });
      expect(impact.breakStatus).toBe('PENDING');
      expect(impact.impactStatus).toBe('PENDING');
    });
  });

  describe('7. Total impact calculation and rounding', () => {
    it('correctly combines deductions and approved additions without double-counting', () => {
      const impact = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: '2026-10-21T13:30:00.000Z',
          status: 'COMPLETED',
        },
        calculation: {
          overtime: 375, // approved addition
          deductionItems: [
            { name: 'Late Deduction (20m)', amount: 100 },
            { name: 'Break Excess Deduction (30m)', amount: 50 },
          ],
          empData: { attendance: { totalOvertimeMinutes: 120 } },
          settings: { enableLateLoginDeduction: true, enableBreakOverrunDeduction: true, enableOvertimePay: true },
        },
      });

      expect(impact.totalDeductions).toBe(150);
      expect(impact.totalAdditions).toBe(375);
      expect(impact.netDailyImpact).toBe(225); // +225 net addition
      expect(impact.totalDailyImpact).toBe(150); // total deductions
      expect(impact.impactStatus).toBe('FINAL');
    });

    it('net negative impact when deductions exceed additions', () => {
      const impact = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: '2026-10-21T13:30:00.000Z',
          status: 'COMPLETED',
        },
        calculation: {
          overtime: 50,
          deductionItems: [
            { name: 'Late Deduction (30m)', amount: 200 },
          ],
          settings: { enableLateLoginDeduction: true, enableOvertimePay: true },
        },
      });

      expect(impact.totalDeductions).toBe(200);
      expect(impact.totalAdditions).toBe(50);
      expect(impact.netDailyImpact).toBe(-150); // -150 net deduction
    });
  });

  describe('8. Recalculation after record updates', () => {
    it('clock-out update transitions shift from IN_PROGRESS/PENDING to FINAL impact', () => {
      const openShift = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: null,
          status: 'WORKING',
        },
        calculation: {
          overtime: 0,
          deductionItems: [],
          settings: { enableLateLoginDeduction: true, enableOvertimePay: true },
        },
      });
      expect(openShift.impactStatus).toBe('PENDING');

      // Now clocked out
      const closedShift = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: '2026-10-21T13:30:00.000Z',
          status: 'COMPLETED',
        },
        calculation: {
          overtime: 0,
          deductionItems: [],
          settings: { enableLateLoginDeduction: true, enableOvertimePay: true },
        },
      });
      expect(closedShift.impactStatus).toBe('FINAL');
      expect(closedShift.netDailyImpact).toBe(0);
    });

    it('overtime approval update transitions overtimeStatus from PENDING to APPROVED', () => {
      const withPendingOt = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: '2026-10-21T15:30:00.000Z',
          status: 'COMPLETED',
        },
        overtimeRequests: [{ status: 'PENDING', eligible_overtime_hours: 2 }],
        calculation: {
          overtime: 0,
          deductionItems: [],
          settings: { enableOvertimePay: true },
        },
      });
      expect(withPendingOt.overtimeStatus).toBe('PENDING');
      expect(withPendingOt.impactStatus).toBe('PENDING');

      // Approved
      const withApprovedOt = evaluateDailyImpact({
        attendance: {
          attendance_date: '2026-10-21',
          clock_in_at: '2026-10-21T04:30:00.000Z',
          clock_out_at: '2026-10-21T15:30:00.000Z',
          status: 'COMPLETED',
        },
        overtimeRequests: [{ status: 'APPROVED', approved_overtime_hours: 2 }],
        calculation: {
          overtime: 300,
          deductionItems: [],
          empData: { attendance: { totalOvertimeMinutes: 120 } },
          settings: { enableOvertimePay: true },
        },
      });
      expect(withApprovedOt.overtimeStatus).toBe('APPROVED');
      expect(withApprovedOt.overtimePay).toBe(300);
      expect(withApprovedOt.netDailyImpact).toBe(300);
      expect(withApprovedOt.impactStatus).toBe('FINAL');
    });
  });

  describe('9. Timezone and overnight shifts', () => {
    const overnightShift = {
      start_time: '22:00:00',
      end_time: '06:00:00',
      crosses_midnight: true,
    };

    it('clock-in before midnight on overnight shift belongs to today', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-21', '21:55'),
        today: '2026-10-21',
        shift: overnightShift,
        graceMinutes: 10,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.attendanceDate).toBe('2026-10-21');
      expect(res.lateMinutes).toBe(0);
    });

    it('clock-in after midnight (00:30) belongs to yesterday with 150 late minutes', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-22', '00:30'),
        today: '2026-10-22',
        shift: overnightShift,
        graceMinutes: 10,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.attendanceDate).toBe('2026-10-21');
      expect(res.lateMinutes).toBe(150);
    });

    it('clock-in at 05:00 on overnight shift belongs to yesterday with 420 late minutes', () => {
      const res = resolveClockInSession({
        nowMs: ist('2026-10-22', '05:00'),
        today: '2026-10-22',
        shift: overnightShift,
        graceMinutes: 10,
        timeZone: 'Asia/Kolkata',
      });
      expect(res.attendanceDate).toBe('2026-10-21');
      expect(res.lateMinutes).toBe(420);
    });
  });

});
