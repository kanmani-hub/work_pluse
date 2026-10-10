/**
 * Breakdowns behind the five summary cards of the Payroll → Today / Custom date view (pure, unit-tested).
 *
 * Source: the rows of payrollService.getDailyDeductionReport(date) — one per employee with an
 * attendance record that date, each carrying the same calculation payroll uses (rawCalc =
 * calculatePayrollDetails for that single date). The cards and these breakdowns are computed from
 * the same rows by the same functions, so a breakdown's total always equals its card.
 * Nothing here calculates money: amounts are read from the calculation; formulas are explained
 * from the saved settings that calculation used.
 */

import { resolveAllowedBreakMinutes } from '../attendance/breakRules';
export type MetricKey = 'late' | 'break' | 'lop' | 'overtime' | 'total';

export interface MetricColumn { key: string; label: string; align?: 'left' | 'right'; money?: boolean }
export interface MetricDetail {
  key: MetricKey;
  title: string;
  total: number;
  /** Positive when the total is a deduction, false for earnings (overtime) */
  isDeduction: boolean;
  columns: MetricColumn[];
  rows: Record<string, any>[];
  /** How the amounts are calculated, from the saved settings */
  explanation: string[];
  /** Missing configuration, data gaps or scope notes */
  notes: string[];
  emptyMessage: string;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows: any[], f: (r: any) => number) => r2(rows.reduce((s, r) => s + (Number(f(r)) || 0), 0));
const inr = (n: number) => `₹${r2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : '—');
export const istTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—';
const minutesBetween = (a?: string | null, b?: string | null) =>
  a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null;
const dur = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`);

const who = (r: any) => ({
  employee: `${r?.employee?.first_name || ''} ${r?.employee?.last_name || ''}`.trim() || '—',
  code: r?.employee?.employee_code || '—',
  department: r?.employee?.departments?.name || '—',
  office: r?.employee?.office?.name || '—',
});
const calc = (r: any) => r?.rawCalc || {};
const pset = (r: any) => calc(r).settings || {};
const roundingNote = (s: any) => (s?.salaryRounding === 'round' ? 'Amounts are rounded to the nearest rupee (Salary Rounding: round).' : 'Amounts keep 2 decimals (Salary Rounding: exact).');

// ---------------------------------------------------------------- rules as text (from saved settings)
const rateText = (dailyRate: number | undefined, f: (d: number) => string, generic: string) =>
  dailyRate === undefined ? generic : f(dailyRate);

export function lateRuleText(s: any, dailyRate?: number): { enabled: boolean; text: string } {
  if (!s?.enableLateLoginDeduction) return { enabled: false, text: 'Late login deduction is turned off in Payroll Settings — nothing is deducted.' };
  switch (s.lateDeductionMethod) {
    case 'interval_based': return { enabled: true, text: `Interval based: floor(late minutes ÷ ${s.lateIntervalMinutes || 15}) × ${inr(s.lateIntervalAmount || 100)}` };
    case 'fixed': return { enabled: true, text: `Fixed: ${inr(s.lateFixedAmount || 0)} when there are any late minutes` };
    case 'per_minute': return { enabled: true, text: `Per minute: late minutes × ${inr(s.latePerMinuteRate || 0)}` };
    case 'half_day': return { enabled: true, text: s.halfDayMethod === 'fixed' ? `Half day (fixed): ${inr(s.lateHalfDayAmount || s.halfDayAmount || 0)}` : rateText(dailyRate, d => `Half day: 50% of the daily rate (${inr(d * 0.5)})`, "Half day: 50% of the employee's daily rate") };
    default: return { enabled: true, text: `Method "${s.lateDeductionMethod}" is not recognised — no amount is calculated.` };
  }
}

export function breakRuleText(s: any, dailyRate?: number): { enabled: boolean; text: string } {
  if (!s?.enableBreakOverrunDetection || !s?.enableBreakOverrunDeduction) return { enabled: false, text: 'Break overrun deduction is turned off in Payroll Settings — nothing is deducted.' };
  switch (s.breakOverrunDeductionMethod) {
    case 'salary_based': return { enabled: true, text: rateText(dailyRate, d => `Salary based: excess hours × hourly rate (daily rate ÷ 8 = ${inr(d / 8)})`, "Salary based: excess hours × hourly rate (the employee's daily rate ÷ 8)") };
    case 'per_minute': return { enabled: true, text: `Per minute: excess minutes × ${inr(s.breakOverrunPerMinuteRate || 0)}` };
    case 'fixed': return { enabled: true, text: `Fixed: ${inr(s.breakOverrunFixedAmount || 0)} when there is any excess` };
    case 'half_day': return { enabled: true, text: s.halfDayMethod === 'fixed' ? `Half day (fixed): ${inr(s.breakOverrunHalfDayAmount || s.halfDayAmount || 0)}` : rateText(dailyRate, d => `Half day: 50% of the daily rate (${inr(d * 0.5)})`, "Half day: 50% of the employee's daily rate") };
    default: return { enabled: true, text: `Method "${s.breakOverrunDeductionMethod}" is not recognised — no amount is calculated.` };
  }
}

const BASIS_LABEL: Record<string, string> = { configured: 'Configured', calendar: 'Calendar days', actual: 'Actual (company working days)' };

export function overtimeRuleText(s: any, dailyRate?: number): { enabled: boolean; configured: boolean; text: string } {
  if (!s?.enableOvertimePay) return { enabled: false, configured: true, text: 'Overtime pay is turned off in Payroll Settings — ₹0 is paid, even for approved overtime.' };
  if (s.overtimeRateType === 'multiplier') {
    return { enabled: true, configured: true, text: rateText(dailyRate, d => `Approved hours × hourly rate (daily rate ÷ 8 = ${inr(d / 8)}) × ${s.overtimeMultiplier || 1}`, `Approved hours × hourly rate (the employee's daily rate ÷ 8) × ${s.overtimeMultiplier || 1}`) };
  }
  if (!(Number(s.overtimeFixedRate) > 0)) return { enabled: true, configured: false, text: 'Fixed overtime rate is not configured (₹0 per hour) — no amount is paid.' };
  return { enabled: true, configured: true, text: `Approved hours × ${inr(s.overtimeFixedRate)} per hour` };
}

// ---------------------------------------------------------------- per-employee calculation text
export function lateFormula(s: any, minutes: number, dailyRate: number): string {
  if (!s?.enableLateLoginDeduction) return 'Deduction off';
  if (!(minutes > 0)) return '—';
  switch (s.lateDeductionMethod) {
    case 'interval_based': { const iv = s.lateIntervalMinutes || 15; return `floor(${minutes} ÷ ${iv}) × ${inr(s.lateIntervalAmount || 100)}`; }
    case 'fixed': return `fixed ${inr(s.lateFixedAmount || 0)}`;
    case 'per_minute': return `${minutes} × ${inr(s.latePerMinuteRate || 0)}`;
    case 'half_day': return s.halfDayMethod === 'fixed' ? `fixed ${inr(s.lateHalfDayAmount || s.halfDayAmount || 0)}` : `50% × ${inr(dailyRate)}`;
    default: return '—';
  }
}

export function breakFormula(s: any, minutes: number, dailyRate: number): string {
  if (!s?.enableBreakOverrunDetection || !s?.enableBreakOverrunDeduction) return 'Deduction off';
  if (!(minutes > 0)) return '—';
  switch (s.breakOverrunDeductionMethod) {
    case 'salary_based': return `${r2(minutes / 60)}h × ${inr(dailyRate / 8)}/h`;
    case 'per_minute': return `${minutes} × ${inr(s.breakOverrunPerMinuteRate || 0)}`;
    case 'fixed': return `fixed ${inr(s.breakOverrunFixedAmount || 0)}`;
    case 'half_day': return s.halfDayMethod === 'fixed' ? `fixed ${inr(s.breakOverrunHalfDayAmount || s.halfDayAmount || 0)}` : `50% × ${inr(dailyRate)}`;
    default: return '—';
  }
}

export function overtimeFormula(s: any, approvedMinutes: number, dailyRate: number): string {
  if (!s?.enableOvertimePay) return 'Overtime pay off';
  if (!(approvedMinutes > 0)) return '—';
  const h = r2(approvedMinutes / 60);
  if (s.overtimeRateType === 'multiplier') return `${h}h × ${inr(dailyRate / 8)}/h × ${s.overtimeMultiplier || 1}`;
  return Number(s.overtimeFixedRate) > 0 ? `${h}h × ${inr(s.overtimeFixedRate)}/h` : 'Rate not configured';
}

// ---------------------------------------------------------------- the five metrics
export function lateMetric(rows: any[]): MetricDetail {
  const any = rows[0];
  const s = pset(any);
  const rule = lateRuleText(s);
  const grace = calc(any).appSettings?.gracePeriodMins;
  return {
    key: 'late', title: 'Late Deductions', isDeduction: true,
    total: sum(rows, r => r.lateDeduction),
    columns: [
      { key: 'employee', label: 'Employee' }, { key: 'code', label: 'ID' }, { key: 'department', label: 'Department' }, { key: 'office', label: 'Office' },
      { key: 'shiftStart', label: 'Shift start' }, { key: 'clockIn', label: 'Clock in' }, { key: 'lateMinutes', label: 'Late min', align: 'right' },
      { key: 'grace', label: 'Grace', align: 'right' }, { key: 'formula', label: 'Calculation' }, { key: 'amount', label: 'Deduction', align: 'right', money: true },
    ],
    rows: rows.filter(r => (r.lateMinutes || 0) > 0 || (r.lateDeduction || 0) > 0).map(r => ({
      ...who(r),
      shiftStart: hhmm(r.attendance?.shift_template?.start_time),
      clockIn: istTime(r.clockIn),
      lateMinutes: r.lateMinutes || 0,
      grace: grace === undefined || grace === null ? '—' : `${grace} min`,
      formula: lateFormula(pset(r), r.lateMinutes || 0, calc(r).dailyRate || 0),
      amount: r2(r.lateDeduction),
    })),
    explanation: rows.length ? [rule.text, 'Late minutes are recorded at clock-in: minutes after shift start beyond the grace period (Admin → Settings).', roundingNote(s)] : [],
    notes: [],
    emptyMessage: 'No late arrivals with a deduction were found for this date.',
  };
}

export function breakMetric(rows: any[]): MetricDetail {
  const any = rows[0];
  const s = pset(any);
  const rule = breakRuleText(s);
  // Same allowance rule payroll uses (payrollDataService.payrollBreakAllowance / breakRules): shift first, then Settings
  const allowedFor = (r: any) => resolveAllowedBreakMinutes(r.attendance?.shift_template?.break_duration_minutes, calc(r).appSettings?.breakDurationMins);
  const missing = rows.some(r => (Number(r.attendance?.break_minutes) || 0) > 0 && allowedFor(r) === null);
  return {
    key: 'break', title: 'Break Overrun Deductions', isDeduction: true,
    total: sum(rows, r => r.breakDeduction),
    columns: [
      { key: 'employee', label: 'Employee' }, { key: 'code', label: 'ID' }, { key: 'allowed', label: 'Allowed', align: 'right' },
      { key: 'actual', label: 'Actual break', align: 'right' }, { key: 'overrun', label: 'Overrun', align: 'right' }, { key: 'formula', label: 'Calculation' }, { key: 'amount', label: 'Deduction', align: 'right', money: true },
    ],
    rows: rows.filter(r => (r.breakOverrunMinutes || 0) > 0 || (r.breakDeduction || 0) > 0).map(r => ({
      ...who(r),
      allowed: allowedFor(r) === null ? 'Not configured' : `${allowedFor(r)} min`,
      actual: `${Number(r.attendance?.break_minutes) || 0} min`,
      overrun: `${r.breakOverrunMinutes || 0} min`,
      formula: breakFormula(pset(r), r.breakOverrunMinutes || 0, calc(r).dailyRate || 0),
      amount: r2(r.breakDeduction),
    })),
    explanation: rows.length ? [rule.text, 'Overrun = max(0, actual break minutes − allowed minutes). Allowed = the shift’s break duration, or Admin → Settings → Break duration when the shift has none (same rule as Break Management).', roundingNote(s)] : [],
    notes: missing ? ['Some employees have no break allowance configured (shift or Settings); no overrun is counted for them.'] : [],
    emptyMessage: 'No break overruns with a deduction were found for this date.',
  };
}

export function lopMetric(rows: any[]): MetricDetail {
  const any = rows[0];
  const s = pset(any);
  return {
    key: 'lop', title: 'LOP Impact', isDeduction: true,
    total: sum(rows, r => r.lopImpact),
    columns: [
      { key: 'employee', label: 'Employee' }, { key: 'code', label: 'ID' }, { key: 'gross', label: 'Monthly gross', align: 'right', money: true },
      { key: 'basis', label: 'Basis / divisor' }, { key: 'dailyRate', label: 'Daily rate', align: 'right', money: true },
      { key: 'lopDays', label: 'LOP days', align: 'right' }, { key: 'reason', label: 'Reason' }, { key: 'formula', label: 'Calculation' },
      { key: 'amount', label: 'LOP amount', align: 'right', money: true },
    ],
    rows: rows.filter(r => (r.lopImpact || 0) > 0 || (calc(r).empData?.attendance?.lopDays || 0) > 0).map(r => {
      const c = calc(r); const a = c.empData?.attendance || {}; const lv = c.empData?.leave || {}; const st = c.settings || {};
      const reasons = [
        a.absentDays > 0 ? `${a.absentDays}d absent (no clock-in, no approved leave)` : '',
        lv.lopLeave > 0 ? `${lv.lopLeave}d approved Loss-of-Pay leave` : '',
        a.sandwichLopDays > 0 ? `${a.sandwichLopDays}d sandwich LOP` : '',
      ].filter(Boolean);
      const formula = !st.enableLopDeductions ? 'LOP deduction off'
        : st.lopMethod === 'fixed' ? `${a.lopDays || 0} × ${inr(st.lopAmount || 0)} (fixed)`
        : `${a.lopDays || 0} × ${inr(c.dailyRate || 0)}`;
      return {
        ...who(r),
        gross: r2(c.grossSalary),
        basis: `${BASIS_LABEL[st.workingDaysBasis] || st.workingDaysBasis || '—'} / ${c.workingDays ?? '—'}`,
        dailyRate: r2(c.dailyRate),
        lopDays: a.lopDays || 0,
        reason: reasons.join('; ') || '—',
        formula,
        amount: r2(r.lopImpact),
      };
    }),
    explanation: rows.length ? [
      !s.enableLopDeductions ? 'LOP deduction is turned off in Payroll Settings — nothing is deducted.'
        : s.lopMethod === 'fixed' ? `Fixed: LOP days × ${inr(s.lopAmount || 0)}` : 'Daily rate: LOP days × daily rate, where daily rate = monthly gross ÷ working-days divisor.',
      `Working-days basis: ${BASIS_LABEL[s.workingDaysBasis] || s.workingDaysBasis || '—'}${s.workingDaysBasis === 'configured' ? ` (${s.configuredWorkingDays} days)` : ''} — Admin → Settings → Payroll.`,
      roundingNote(s),
    ] : [],
    notes: ['Only employees with an attendance record for this date are listed (same scope as the summary cards); an employee with no record at all for the date is not included here.'],
    emptyMessage: 'No LOP was found for this date.',
  };
}

export function overtimeMetric(rows: any[]): MetricDetail {
  const any = rows[0];
  const s = pset(any);
  const rule = overtimeRuleText(s);
  const lookupFailed = rows.some(r => r.overtimeRequestsError);
  const listed = rows.filter(r => (r.overtimeRequests || []).length > 0 || (r.overtimeMinutes || 0) > 0 || (r.overtimePay || 0) > 0
    || (Number(r.rawCalc?.empData?.attendance?.recordedOvertimeMinutes) || 0) > 0);
  return {
    key: 'overtime', title: 'Overtime Pay', isDeduction: false,
    total: sum(rows, r => r.overtimePay),
    columns: [
      { key: 'employee', label: 'Employee' }, { key: 'code', label: 'ID' }, { key: 'shift', label: 'Shift' }, { key: 'clock', label: 'Clock in – out' },
      { key: 'scheduled', label: 'Scheduled', align: 'right' }, { key: 'elapsed', label: 'Elapsed', align: 'right' },
      { key: 'eligible', label: 'Eligible OT', align: 'right' }, { key: 'status', label: 'Approval' }, { key: 'approved', label: 'Approved OT', align: 'right' },
      { key: 'formula', label: 'Calculation' }, { key: 'amount', label: 'OT pay', align: 'right', money: true },
    ],
    rows: listed.map(r => {
      const at = r.attendance || {}; const st = at.shift_template || {};
      const req = (r.overtimeRequests || [])[0];
      const scheduledMin = at.required_hours !== null && at.required_hours !== undefined ? Number(at.required_hours) * 60
        : st.required_hours !== null && st.required_hours !== undefined ? Number(st.required_hours) * 60 : null;
      return {
        ...who(r),
        shift: st.start_time ? `${hhmm(st.start_time)} – ${hhmm(st.end_time)}` : '—',
        clock: `${istTime(r.clockIn)} – ${r.clockOut ? istTime(r.clockOut) : 'not clocked out'}`,
        scheduled: dur(scheduledMin),
        elapsed: r.clockOut ? dur(minutesBetween(r.clockIn, r.clockOut)) : '—',
        eligible: r.overtimeRequestsError ? 'Unavailable' : req ? dur(Math.round(Number(req.eligible_overtime_hours || 0) * 60)) : 'No request',
        status: r.overtimeRequestsError ? 'Unavailable' : req ? String(req.status) : 'No request',
        approved: dur(r.overtimeMinutes || 0),
        formula: overtimeFormula(pset(r), r.overtimeMinutes || 0, calc(r).dailyRate || 0),
        amount: r2(r.overtimePay),
      };
    }),
    explanation: rows.length ? [
      rule.text,
      'Only APPROVED overtime requests are paid, on the approved hours. Time after the shift end is not paid automatically.',
      'Elapsed = clock-out − clock-in (breaks included); eligibility is calculated when the employee submits the overtime request.',
      roundingNote(s),
    ] : [],
    notes: [
      ...(lookupFailed ? ['Overtime requests could not be loaded, so approval status is shown as unavailable (amounts come from the payroll calculation).'] : []),
      ...(!rule.configured ? [rule.text] : []),
    ],
    emptyMessage: 'No overtime requests or approved overtime were found for this date.',
  };
}

export function totalMetric(rows: any[]): MetricDetail {
  const s = pset(rows[0]);
  const mismatches = rows.filter(r => r2(r.lateDeduction + r.breakDeduction + r.lopImpact + r.otherDeductions) !== r2(r.totalDailyImpact));
  return {
    key: 'total', title: 'Total Daily Deduction Impact', isDeduction: true,
    total: sum(rows, r => r.totalDailyImpact),
    columns: [
      { key: 'employee', label: 'Employee' }, { key: 'code', label: 'ID' },
      { key: 'late', label: 'Late', align: 'right', money: true }, { key: 'break', label: 'Break overrun', align: 'right', money: true },
      { key: 'lop', label: 'LOP', align: 'right', money: true }, { key: 'other', label: 'Other', align: 'right', money: true },
      { key: 'otherNames', label: 'Other deductions' }, { key: 'amount', label: 'Total', align: 'right', money: true },
    ],
    rows: rows.map(r => {
      const others = (calc(r).deductionItems || []).filter((d: any) => !/Late Deduction|Break Excess|LOP Deduction/.test(String(d.name)));
      return {
        ...who(r),
        late: r2(r.lateDeduction), break: r2(r.breakDeduction), lop: r2(r.lopImpact), other: r2(r.otherDeductions),
        otherNames: others.map((d: any) => d.name).join(', ') || '—',
        amount: r2(r.totalDailyImpact),
      };
    }),
    explanation: rows.length ? [
      'Total = late + break overrun + LOP + other deductions (half-day, excess permission). Each comes from its own line in the payroll calculation, so nothing is counted twice.',
      'Overtime pay is an earning and is not part of this total. The monthly standard deduction is not part of a daily figure.',
      roundingNote(s),
    ] : [],
    notes: mismatches.length ? [`${mismatches.length} employee row(s) do not add up — please report this.`] : [],
    emptyMessage: 'No attendance records were found for this date.',
  };
}

/** All five, from the same rows the cards use. */
export function buildDailyMetrics(rows: any[] | null | undefined): Record<MetricKey, MetricDetail> {
  const list = Array.isArray(rows) ? rows : [];
  return { late: lateMetric(list), break: breakMetric(list), lop: lopMetric(list), overtime: overtimeMetric(list), total: totalMetric(list) };
}
