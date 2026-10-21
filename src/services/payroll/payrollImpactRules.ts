/**
 * Attendance & Payroll Daily Impact Rules (Pure, unit-tested).
 *
 * Trace and evaluation engine for daily attendance impact on payroll:
 *  - Shift start, grace period, company timezone (Asia/Kolkata), late minutes.
 *  - Configured deduction methods (interval_based, salary_based, per_minute, fixed, half_day)
 *    and exempt thresholds / limits under company policy.
 *  - Break overrun detection and deductions (distinguishing in-progress / open breaks from completed).
 *  - Overtime eligibility, approval requirement, clock-out requirements.
 *  - LOP day classification (clock-in = worked day, no absence LOP).
 *  - Consistent states: FINAL, PENDING, UNAVAILABLE, DISABLED, ON_TIME, BELOW_THRESHOLD, EXEMPT.
 *    Never displays ₹0 when a calculation is actually pending or unavailable.
 *  - Total Impact combining applicable deductions and approved additions without double-counting.
 */

import { detectMissingClockOut } from '../attendance/missingClockOutRules';

export type ImpactCalculationStatus = 'FINAL' | 'PENDING' | 'UNAVAILABLE';
export type ClockOutStatus = 'COMPLETED' | 'IN_PROGRESS' | 'MISSING';
export type LateDeductionStatus = 'DISABLED' | 'ON_TIME' | 'BELOW_THRESHOLD' | 'EXEMPT' | 'FINAL' | 'ZERO';
export type BreakCalculationStatus = 'DISABLED' | 'PENDING' | 'NO_OVERRUN' | 'FINAL';
export type OvertimeCalculationStatus = 'DISABLED' | 'UNAVAILABLE' | 'PENDING' | 'APPROVED' | 'NONE';
export type LopCalculationStatus = 'DISABLED' | 'PRESENT' | 'FINAL' | 'NONE';

export interface EvaluateDailyImpactInput {
  attendance: {
    id?: string;
    employee_id?: string;
    attendance_date: string;
    clock_in_at: string | null;
    clock_out_at: string | null;
    status?: string | null;
    late_minutes?: number | null;
    break_minutes?: number | null;
    break_overrun_minutes?: number | null;
    overtime_minutes?: number | null;
    is_half_day?: boolean | null;
    is_auto_logged_out?: boolean | null;
    shift_template?: {
      id?: string;
      name?: string | null;
      start_time?: string | null;
      end_time?: string | null;
      grace_period_minutes?: number | null;
      break_duration_minutes?: number | null;
      required_hours?: number | null;
      crosses_midnight?: boolean | null;
    } | null;
  };
  calculation: {
    grossSalary?: number;
    workingDays?: number;
    dailyRate?: number;
    lopDeduction?: number;
    overtime?: number;
    deductionItems?: { name: string; amount: number }[];
    lateCalculation?: {
      chargeableMinutes?: number;
      exemptMinutes?: number;
      exemptOccurrences?: number;
      deductionAmount?: number;
      formula?: string;
    } | null;
    empData?: {
      attendance?: {
        totalLateMinutes?: number;
        totalBreakExcessMinutes?: number;
        totalBreakOverrunMinutes?: number;
        totalOvertimeMinutes?: number;
        lopDays?: number;
      };
      leave?: {
        lopLeave?: number;
      };
    };
    settings?: any;
    appSettings?: any;
  };
  overtimeRequests?: {
    employee_id?: string;
    work_date?: string;
    status: string;
    eligible_overtime_hours?: number;
    requested_overtime_hours?: number;
    approved_overtime_hours?: number;
  }[];
  overtimeRequestsError?: string | null;
  nowMs?: number;
}

export interface EvaluatedDailyImpact {
  clockIn: string | null;
  clockOut: string | null;
  clockOutStatus: ClockOutStatus;
  isShiftInProgress: boolean;

  lateMinutes: number;
  lateDeduction: number;
  lateStatus: LateDeductionStatus;

  breakOverrunMinutes: number;
  breakDeduction: number;
  breakStatus: BreakCalculationStatus;

  overtimeMinutes: number;
  overtimePay: number;
  pendingOvertimeHours: number;
  overtimeStatus: OvertimeCalculationStatus;

  lopImpact: number;
  lopStatus: LopCalculationStatus;

  otherDeductions: number;
  totalDeductions: number;
  totalAdditions: number;
  netDailyImpact: number;
  totalDailyImpact: number;
  impactStatus: ImpactCalculationStatus;
}

const n = (val: unknown): number => {
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
};

export function evaluateDailyImpact(input: EvaluateDailyImpactInput): EvaluatedDailyImpact {
  const att = input.attendance;
  const calc = input.calculation;
  const settings = calc.settings || {};
  const appSettings = calc.appSettings || {};
  const nowMs = input.nowMs ?? Date.now();

  const clockIn = att.clock_in_at;
  const clockOut = att.clock_out_at;
  const statusStr = String(att.status || '').toUpperCase();

  // 1. Clock-out and shift progress
  let clockOutStatus: ClockOutStatus = 'COMPLETED';
  if (!clockOut) {
    if (statusStr === 'COMPLETED') {
      clockOutStatus = 'COMPLETED';
    } else {
      const graceHours = appSettings.autoClockOutGraceHours ?? 2;
      const shiftObj = att.shift_template ? {
        start_time: att.shift_template.start_time ?? null,
        end_time: att.shift_template.end_time ?? null,
        crosses_midnight: att.shift_template.crosses_midnight ?? false,
      } : null;
      const detected = detectMissingClockOut(att, shiftObj, nowMs, graceHours);
      if (detected.state === 'MISSING_CLOCK_OUT' || att.is_auto_logged_out || statusStr === 'AUTO_LOGOUT') {
        clockOutStatus = 'MISSING';
      } else {
        clockOutStatus = 'IN_PROGRESS';
      }
    }
  }

  const isShiftInProgress = !clockOut && clockOutStatus === 'IN_PROGRESS';

  // 2. Late Minutes and Deduction
  const lateMinutes = Math.max(
    0,
    n(att.late_minutes) || n(calc.empData?.attendance?.totalLateMinutes)
  );

  const lateDedItem = (calc.deductionItems || []).find((d: any) => d.name.includes('Late Deduction'));
  const lateDeduction = lateDedItem?.amount || 0;

  let lateStatus: LateDeductionStatus = 'FINAL';
  if (settings.enableLateLoginDeduction === false) {
    lateStatus = 'DISABLED';
  } else if (!clockIn) {
    lateStatus = 'DISABLED'; // Absence; LOP applies instead
  } else if (lateMinutes === 0) {
    lateStatus = 'ON_TIME';
  } else if (lateDeduction > 0) {
    lateStatus = 'FINAL';
  } else {
    // Late minutes > 0 but late deduction is 0
    if (settings.lateDeductionMethod === 'interval_based' && lateMinutes < (settings.lateIntervalMinutes || 15)) {
      lateStatus = 'BELOW_THRESHOLD';
    } else if (calc.lateCalculation?.exemptOccurrences && calc.lateCalculation.exemptOccurrences > 0) {
      lateStatus = 'EXEMPT';
    } else {
      lateStatus = 'ZERO';
    }
  }

  // 3. Break Overrun and Deduction
  const breakOverrunMinutes = Math.max(
    0,
    n(att.break_overrun_minutes) || n(calc.empData?.attendance?.totalBreakExcessMinutes)
  );
  const breakDedItem = (calc.deductionItems || []).find((d: any) => d.name.includes('Break Excess Deduction'));
  const breakDeduction = breakDedItem?.amount || 0;

  const breakDetectionEnabled = settings.enableBreakOverrunDetection !== false;
  const breakDeductionEnabled = breakDetectionEnabled && settings.enableBreakOverrunDeduction !== false;

  let breakStatus: BreakCalculationStatus = 'FINAL';
  if (!breakDetectionEnabled || !breakDeductionEnabled) {
    breakStatus = 'DISABLED';
  } else if (statusStr === 'ON_BREAK' || (isShiftInProgress && breakOverrunMinutes === 0)) {
    breakStatus = 'PENDING';
  } else if (breakDeduction > 0 || breakOverrunMinutes > 0) {
    breakStatus = 'FINAL';
  } else {
    breakStatus = 'NO_OVERRUN';
  }

  // 4. Overtime
  const otRequests = input.overtimeRequests || [];
  const pendingOtReq = otRequests.find(r => String(r.status).toUpperCase() === 'PENDING');
  const pendingOvertimeHours = pendingOtReq
    ? n(pendingOtReq.approved_overtime_hours ?? pendingOtReq.requested_overtime_hours ?? pendingOtReq.eligible_overtime_hours)
    : 0;

  const overtimeMinutes = Math.max(
    0,
    n(calc.empData?.attendance?.totalOvertimeMinutes)
  );
  const overtimePay = Math.max(0, n(calc.overtime));

  let overtimeStatus: OvertimeCalculationStatus = 'NONE';
  if (settings.enableOvertimePay === false) {
    overtimeStatus = 'DISABLED';
  } else if (input.overtimeRequestsError) {
    overtimeStatus = 'UNAVAILABLE';
  } else if (isShiftInProgress) {
    overtimeStatus = 'PENDING';
  } else if (pendingOtReq) {
    overtimeStatus = 'PENDING';
  } else if (overtimePay > 0 || overtimeMinutes > 0) {
    overtimeStatus = 'APPROVED';
  } else {
    overtimeStatus = 'NONE';
  }

  // 5. LOP Impact
  const lopImpact = Math.max(0, n(calc.lopDeduction));
  let lopStatus: LopCalculationStatus = 'NONE';
  if (settings.enableLopDeductions === false) {
    lopStatus = 'DISABLED';
  } else if (lopImpact > 0) {
    lopStatus = 'FINAL';
  } else if (clockIn) {
    lopStatus = 'PRESENT'; // Worked day, no unexcused absence
  } else {
    lopStatus = 'NONE';
  }

  // 6. Other deductions (Half-day, Excess Permission, Missing clock-out adjustment)
  const otherDeductions = (calc.deductionItems || [])
    .filter((d: any) =>
      !d.name.includes('Late Deduction') &&
      !d.name.includes('Break Excess') &&
      !d.name.includes('LOP Deduction')
    )
    .reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0);

  // 7. Total Deductions and Additions
  const totalDeductions = lateDeduction + breakDeduction + lopImpact + otherDeductions;
  const totalAdditions = overtimePay;
  const netDailyImpact = totalAdditions - totalDeductions;
  const totalDailyImpact = totalDeductions; // For backward compatibility with deduction breakdown cards

  // 8. Overall Impact Status
  let impactStatus: ImpactCalculationStatus = 'FINAL';
  if (overtimeStatus === 'UNAVAILABLE') {
    impactStatus = 'UNAVAILABLE';
  } else if (
    isShiftInProgress ||
    clockOutStatus === 'MISSING' ||
    breakStatus === 'PENDING' ||
    overtimeStatus === 'PENDING'
  ) {
    impactStatus = 'PENDING';
  } else {
    impactStatus = 'FINAL';
  }

  return {
    clockIn,
    clockOut,
    clockOutStatus,
    isShiftInProgress,

    lateMinutes,
    lateDeduction,
    lateStatus,

    breakOverrunMinutes,
    breakDeduction,
    breakStatus,

    overtimeMinutes,
    overtimePay,
    pendingOvertimeHours,
    overtimeStatus,

    lopImpact,
    lopStatus,

    otherDeductions,
    totalDeductions,
    totalAdditions,
    netDailyImpact,
    totalDailyImpact,
    impactStatus,
  };
}
