/**
 * Payroll Data Service
 * 
 * Single source of truth for fetching actual attendance, leave, WFH, and permission data
 * for a given employee + payroll month. Both Admin and Employee views consume this.
 */

import { supabase } from '../../lib/supabase';
import { approvedOvertimeMinutes } from './payrollRules';
import { classifyPayrollDays, summarizeDays, isLopLeaveType } from './attendanceClassification';
import type { ClassifiedDay } from './attendanceClassification';
import { companyDateStr } from '../../utils/companyDate';
import { globalSettingsService } from '../settings/globalSettingsService';
import { resolveAllowedBreakMinutes } from '../attendance/breakRules';

export interface PayrollAttendanceSummary {
  workingDays: number;     // from settings or calculated
  presentDays: number;
  absentDays: number;
  lateLogins: number;
  totalLateMinutes: number;
  totalBreakExcessMinutes: number;
  totalBreakOverrunMinutes: number;
  /** APPROVED overtime only (overtime_requests.approved_overtime_hours) once set by payroll. */
  totalOvertimeMinutes: number;
  /** attendance.overtime_minutes as recorded (informational; never paid). */
  recordedOvertimeMinutes?: number;
  earlyLogouts: number;
  halfDays: number;
  lopDays: number;
  /** Day-classification detail (see attendanceClassification.ts). */
  paidLeaveDays?: number;
  sandwichLopDays?: number;
  holidayDays?: number;
  weeklyOffDays?: number;
  /** Days whose working-day / weekly-off status came from the employee's roster. */
  rosterDays?: number;
  /** Early logout is recorded for information only (no deduction under the current policy). */
  earlyLogoutMinutes?: number;
  /** Unresolved days an Admin must review before approval; nothing was deducted for the uncertain part. */
  reviewItems?: { date: string; type?: string; reason: string }[];
  /** Flags an Admin has resolved (APPLY / WAIVE). */
  resolvedReviews?: { date: string; type: string; decision: string }[];
}

export interface PayrollLeaveSummary {
  approvedLeave: number;
  lopLeave: number;
  totalLeaveDays: number;
}

export interface PayrollWfhSummary {
  wfhDays: number;
}

export interface PayrollPermissionSummary {
  permissionCount: number;
  totalMinutes: number;
}

export interface PayrollEmployeeData {
  attendance: PayrollAttendanceSummary;
  leave: PayrollLeaveSummary;
  wfh: PayrollWfhSummary;
  permission: PayrollPermissionSummary;
  /** Set when approved overtime could not be loaded: overtime is then UNKNOWN, not 0. */
  approvedOvertimeError?: string | null;
  /** Set when attendance / leave / WFH / permission data could not be loaded: the figures are then UNKNOWN. */
  dataError?: string | null;
}

export interface PayrollDaysResult {
  attendance: PayrollAttendanceSummary;
  leave: PayrollLeaveSummary;
  days: ClassifiedDay[];
  error: Error | null;
}

const EMPTY_ATTENDANCE: PayrollAttendanceSummary = {
  workingDays: 0, presentDays: 0, absentDays: 0, lateLogins: 0, totalLateMinutes: 0, totalBreakExcessMinutes: 0,
  totalBreakOverrunMinutes: 0, totalOvertimeMinutes: 0, earlyLogouts: 0, halfDays: 0, lopDays: 0,
};
const EMPTY_LEAVE: PayrollLeaveSummary = { approvedLeave: 0, lopLeave: 0, totalLeaveDays: 0 };
const day10 = (d: string) => String(d).slice(0, 10);
const fail = (what: string, e: any) => new Error(`${what} could not be loaded: ${e?.message || e}`);

/**
 * Allowed break minutes for one attendance day — the same rule as Break Management, the break
 * limit check and clock-out: the shift's break_duration_minutes, otherwise Admin → Settings.
 * null = not configured (no excess is counted for that day).
 */
export function payrollBreakAllowance(row: any, appSettings?: any): number | null {
  return resolveAllowedBreakMinutes(row?.shift_template?.break_duration_minutes, appSettings?.breakDurationMins);
}

/** Minute-based figures (late, break, overtime, early logout). These feed their own penalties, never LOP. */
export function summarizeAttendanceMinutes(rows: any[], appSettings?: any) {
  const n = (v: any) => Number(v) || 0;
  const breakExcess = (a: any) => {
    const allowed = payrollBreakAllowance(a, appSettings);
    return allowed === null ? 0 : Math.max(0, n(a.break_minutes) - allowed);
  };
  return {
    lateLogins: rows.filter(a => n(a.late_minutes) > 0).length,
    totalLateMinutes: rows.reduce((s, a) => s + n(a.late_minutes), 0),
    totalBreakOverrunMinutes: rows.reduce((s, a) => s + n(a.break_overrun_minutes), 0),
    totalOvertimeMinutes: rows.reduce((s, a) => s + n(a.overtime_minutes), 0),
    // Excess per day = max(0, stored break minutes − that day's allowance), summed
    totalBreakExcessMinutes: rows.reduce((s, a) => s + breakExcess(a), 0),
    earlyLogouts: rows.filter(a => n(a.early_logout_minutes) > 0).length,
  };
}

/** Roster statuses that define an employee's schedule. DRAFT and ARCHIVED rosters are ignored. */
export const VALID_ROSTER_STATUSES = ['PUBLISHED'];

/**
 * Employee schedule from SAVED, PUBLISHED roster entries only (owner decision 2026-10-09: weekly
 * offs are stored per date in the roster). roster_assignments.day_type = 'WEEK_OFF' → OFF; any other
 * saved entry (day_type 'WORK', or rows saved before the day_type column existed) → WORK.
 * Dates without a saved published entry are absent from the map: the company working days apply —
 * nothing is inferred from gaps in a roster.
 */
export function rosterDaysFromAssignments(rows: any[], start: string, end: string): Record<string, 'WORK' | 'OFF'> {
  const out: Record<string, 'WORK' | 'OFF'> = {};
  const valid = (rows || []).filter(r => VALID_ROSTER_STATUSES.includes(String(r?.rosters?.status || '').toUpperCase()));
  for (const r of valid) {
    const d = day10(r.assignment_date || '');
    if (d < start || d > end) continue;
    const off = String(r.day_type || 'WORK').toUpperCase() === 'WEEK_OFF';
    // Two published entries for the same date: a working day wins (never hide a possible absence)
    if (!off) out[d] = 'WORK'; else if (!out[d]) out[d] = 'OFF';
  }
  return out;
}

/** Holiday dates (YYYY-MM-DD) from Admin → Settings → Public Holidays. */
export const holidayDates = (appSettings?: any): string[] =>
  (Array.isArray(appSettings?.publicHolidays) ? appSettings.publicHolidays : [])
    .map((h: any) => day10(typeof h === 'string' ? h : h?.date || ''))
    .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d));


export const payrollDataService = {
  /**
   * Fetch all payroll-relevant data for a specific employee and month (display: payroll detail drawer).
   * Uses exactly the same classification as the payroll calculation. A failed lookup is reported in
   * `dataError` (the figures are then unknown) — never shown as zero.
   */
  async getEmployeePayrollData(
    employeeId: string,
    year: number,
    month: number,
    appSettings?: any
  ): Promise<PayrollEmployeeData> {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    let app = appSettings;
    let settingsError: string | null = null;
    if (!app) {
      const g = await globalSettingsService.loadSettings();
      if (!g?.updated_at) settingsError = 'Company settings could not be loaded.';
      app = g?.app;
    }

    const [days, wfh, permission, ot] = await Promise.all([
      this._fetchPayrollDays(employeeId, startDate, endDate, app),
      this._fetchWfh(employeeId, startDate, endDate),
      this._fetchPermissions(employeeId, startDate, endDate),
      this._fetchApprovedOvertime(employeeId, startDate, endDate),
    ]);

    const attendance = { ...days.attendance };
    attendance.recordedOvertimeMinutes = attendance.totalOvertimeMinutes;
    // On a failed lookup the minutes are unknown: keep 0 in the number field but flag it so the UI
    // shows "Unavailable" instead of a misleading 0.
    attendance.totalOvertimeMinutes = ot.error ? 0 : ot.minutes;

    const dataError = [settingsError, days.error?.message, wfh.error?.message, permission.error?.message].filter(Boolean).join(' ') || null;
    return {
      attendance,
      leave: days.leave,
      wfh: { wfhDays: wfh.wfhDays },
      permission: { permissionCount: permission.permissionCount, totalMinutes: permission.totalMinutes },
      approvedOvertimeError: ot.error ? ot.error.message : null,
      dataError,
    };
  },

  /**
   * Approved overtime for the period: overtime_requests with status APPROVED and their
   * approved_overtime_hours, by work_date. Pending / rejected / cancelled are excluded.
   * Errors are returned (not hidden) so payroll can refuse to calculate instead of silently paying 0.
   */
  async _fetchApprovedOvertime(employeeId: string, startDate: string, endDate: string): Promise<{ minutes: number; error: Error | null }> {
    try {
      const { data, error } = await (supabase.from('overtime_requests' as any) as any)
        .select('status, approved_overtime_hours')
        .eq('employee_id', employeeId)
        .eq('status', 'APPROVED')
        .gte('work_date', String(startDate).slice(0, 10))
        .lte('work_date', String(endDate).slice(0, 10));
      if (error) return { minutes: 0, error: new Error(`Approved overtime could not be loaded: ${error.message}`) };
      return { minutes: approvedOvertimeMinutes(data || []), error: null };
    } catch (err: any) {
      return { minutes: 0, error: new Error(`Approved overtime could not be loaded: ${err?.message || err}`) };
    }
  },

  /**
   * Day-by-day attendance classification for the payroll period (present / half day / absent /
   * paid leave / LOP leave / sandwich LOP / weekly off / holiday / not yet employed), plus the
   * minute-based late, break and overtime figures. Each date is classified once, so no day is
   * deducted twice. Any failed lookup returns `error` and zero figures that MUST NOT be used.
   */
  async _fetchPayrollDays(
    employeeId: string,
    startDate: string,
    endDate: string,
    appSettings?: any,
    today: string = companyDateStr(),
    resolutions: Record<string, 'APPLY' | 'WAIVE'> = {}
  ): Promise<PayrollDaysResult> {
    const empty = (error: Error): PayrollDaysResult => ({ attendance: { ...EMPTY_ATTENDANCE }, leave: { ...EMPTY_LEAVE }, days: [], error });
    const workingDays: string[] = Array.isArray(appSettings?.workingDays) ? appSettings.workingDays : [];
    if (workingDays.length === 0) return empty(new Error('Company working days are not configured (Admin → Settings → Working Days).'));
    const start = day10(startDate);
    const end = day10(endDate);
    try {
      const [att, lv, emp, ros] = await Promise.all([
        supabase.from('attendance').select('*, shift_template:shift_template_id(break_duration_minutes)')
          .eq('employee_id', employeeId).gte('attendance_date', start).lte('attendance_date', end) as any,
        supabase.from('leave_requests').select('start_date, end_date, is_half_day, half_day_type, status, leave_types(name, code)')
          .eq('employee_id', employeeId).eq('status', 'APPROVED').lte('start_date', end).gte('end_date', start) as any,
        supabase.from('employees').select('joining_date').eq('id', employeeId).maybeSingle() as any,
        supabase.from('roster_assignments').select('*, rosters(status, start_date, end_date)')
          .eq('employee_id', employeeId).gte('assignment_date', start).lte('assignment_date', end) as any,
      ]);
      if (att?.error || !Array.isArray(att?.data)) return empty(fail('Attendance', att?.error || 'no data returned'));
      if (lv?.error || !Array.isArray(lv?.data)) return empty(fail('Approved leave', lv?.error || 'no data returned'));
      if (emp?.error) return empty(fail('Employee joining date', emp.error));
      if (!emp?.data) return empty(new Error('Employee record could not be loaded for payroll.'));
      // Never assume the company schedule (and so absences) when the roster could not be read
      if (ros?.error || !Array.isArray(ros?.data)) return empty(fail('Roster', ros?.error || 'no data returned'));

      const rows: any[] = att.data;
      const days = classifyPayrollDays({
        periodStart: start,
        periodEnd: end,
        today,
        joiningDate: emp.data.joining_date || null,
        workingDays,
        holidays: holidayDates(appSettings),
        rosterDays: rosterDaysFromAssignments(ros.data, start, end),
        resolutions,
        attendance: rows,
        leaves: (lv.data as any[]).filter(r => r.status === 'APPROVED').map(r => ({
          start_date: day10(r.start_date), end_date: day10(r.end_date), is_half_day: r.is_half_day, half_day_type: r.half_day_type, isLop: isLopLeaveType(r.leave_types),
        })),
      });
      const sum = summarizeDays(days);
      return {
        attendance: {
          ...summarizeAttendanceMinutes(rows, appSettings),
          workingDays: sum.scheduledDays,
          presentDays: sum.presentDays,
          absentDays: sum.absentDays,
          halfDays: sum.halfDays,
          lopDays: sum.lopDays,
          paidLeaveDays: sum.paidLeaveDays,
          sandwichLopDays: sum.sandwichLopDays,
          holidayDays: sum.holidayDays,
          weeklyOffDays: sum.weeklyOffDays,
          rosterDays: sum.rosterDays,
          earlyLogoutMinutes: sum.earlyLogoutMinutes,
          reviewItems: sum.reviewItems,
          resolvedReviews: sum.resolvedReviews,
        },
        leave: { approvedLeave: sum.paidLeaveDays, lopLeave: sum.lopLeaveDays, totalLeaveDays: Math.round((sum.paidLeaveDays + sum.lopLeaveDays) * 100) / 100 },
        days,
        error: null,
      };
    } catch (err: any) {
      return empty(fail('Attendance', err));
    }
  },

  /** Approved WFH days in the period (wfh_requests.request_date). WFH does not excuse a missing clock-in. */
  async _fetchWfh(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<PayrollWfhSummary & { error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('wfh_requests')
        .select('request_date, status')
        .eq('employee_id', employeeId)
        .eq('status', 'APPROVED')
        .gte('request_date', day10(startDate))
        .lte('request_date', day10(endDate));
      if (error || !Array.isArray(data)) return { wfhDays: 0, error: fail('Approved WFH', error || 'no data returned') };
      return { wfhDays: new Set(data.map((r: any) => day10(r.request_date))).size, error: null };
    } catch (err) {
      return { wfhDays: 0, error: fail('Approved WFH', err) };
    }
  },

  async _fetchPermissions(
    employeeId: string,
    startDate: string,
    endDate: string
  ): Promise<PayrollPermissionSummary & { error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('permission_requests')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('status', 'APPROVED')
        .gte('permission_date', day10(startDate))
        .lte('permission_date', day10(endDate));
      if (error || !Array.isArray(data)) return { permissionCount: 0, totalMinutes: 0, error: fail('Approved permissions', error || 'no data returned') };
      const totalMinutes = data.reduce((sum: number, r: any) => sum + Number(r.duration_minutes || 0), 0);
      return { permissionCount: data.length, totalMinutes, error: null };
    } catch (err) {
      return { permissionCount: 0, totalMinutes: 0, error: fail('Approved permissions', err) };
    }
  },
};
