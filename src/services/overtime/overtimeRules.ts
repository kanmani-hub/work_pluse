/**
 * Overtime rules (pure, unit-tested).
 *
 *   Potential OT  = system estimate from attendance + shift (never payable by itself)
 *   Requested OT  = employee's request, ≤ potential
 *   Approved OT   = admin decision, ≤ requested and ≤ potential  ← the ONLY value payroll may use
 *
 * Potential OT reuses the existing attendance numbers (worked time = clock-in → clock-out
 * minus breaks, incl. automatic breaks; see clockRules/breakRules) and the employee's shift:
 *
 *   potential = worked − required − minutes late   (never below 0)
 *
 *   9:00–18:00 shift (8h required), worked 9:00→20:00, no break  → 11h − 8h − 0  = 3h
 *   8h shift, 10h span, 1h break                                → 9h − 8h       = 1h
 *   Late: 10:00→19:00 on a 9:00–18:00 shift (1h late)            → 9h − 8h − 1h  = 0  (late time is made up first)
 *   Overnight 22:00–06:00, out 08:00 next day                    → 10h − 8h      = 2h, same attendance date
 */
import { timeToMinutes } from '../../utils/shiftTime';
import { completedBreakMinutes, type BreakLike } from '../attendance/breakRules';

export const OVERTIME_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type OvertimeStatus = (typeof OVERTIME_STATUSES)[number];
/** Statuses that block a second request for the same attendance */
export const ACTIVE_OVERTIME_STATUSES: OvertimeStatus[] = ['PENDING', 'APPROVED'];

export interface OtAttendance {
  attendance_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  required_hours?: number | null;
  is_half_day?: boolean | null;
  status?: string | null;
}
export interface OtShift {
  start_time: string | null;
  end_time: string | null;
  crosses_midnight?: boolean | null;
  required_hours?: number | null;
}
export interface OtDayContext {
  fullDayLeave?: boolean;   // approved full-day leave covering the date
  halfDayLeave?: boolean;   // approved half-day leave on the date
}

export type OtIneligibleReason =
  | 'NOT_CLOCKED_OUT' | 'NO_SHIFT' | 'ON_LEAVE' | 'HALF_DAY' | 'NO_EXTRA_TIME';

export interface OtEstimate {
  eligible: boolean;
  reason: OtIneligibleReason | null;
  scheduledMinutes: number | null;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  afterShiftMinutes: number;
  potentialMinutes: number;
  potentialHours: number;   // 2 decimals, rounded DOWN (never more than worked)
}

const IST_OFFSET = '+05:30';
/** Shift start/end as instants for an attendance date (IST); end is next day for overnight shifts. */
export function shiftWindow(attendanceDate: string, shift: OtShift): { startMs: number; endMs: number } | null {
  const s = timeToMinutes(shift.start_time), e = timeToMinutes(shift.end_time);
  if (s === null || e === null) return null;
  const base = Date.parse(`${attendanceDate}T00:00:00${IST_OFFSET}`);
  const startMs = base + s * 60_000;
  let endMs = base + e * 60_000;
  if (shift.crosses_midnight || e <= s) endMs += 24 * 3_600_000;
  return { startMs, endMs };
}

export const minutesToHours = (m: number) => Math.floor((Math.max(0, m) / 60) * 100) / 100;

export function estimateOvertime(att: OtAttendance, shift: OtShift | null, breaks: BreakLike[] | null | undefined, ctx: OtDayContext = {}): OtEstimate {
  const empty = (reason: OtIneligibleReason, extra: Partial<OtEstimate> = {}): OtEstimate => ({
    eligible: false, reason, scheduledMinutes: null, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0,
    afterShiftMinutes: 0, potentialMinutes: 0, potentialHours: 0, ...extra,
  });

  if (!att.clock_in_at || !att.clock_out_at) return empty('NOT_CLOCKED_OUT');
  if (ctx.fullDayLeave) return empty('ON_LEAVE');
  if (!shift) return empty('NO_SHIFT');
  const win = shiftWindow(att.attendance_date, shift);
  if (!win) return empty('NO_SHIFT');

  const inMs = Date.parse(att.clock_in_at), outMs = Date.parse(att.clock_out_at);
  const breakMinutes = completedBreakMinutes(breaks || []);
  const workedMinutes = Math.max(0, Math.floor((outMs - inMs) / 60_000) - breakMinutes);
  const requiredHours = att.required_hours ?? shift.required_hours ?? null;
  const scheduledMinutes = requiredHours !== null && requiredHours > 0
    ? Math.round(requiredHours * 60)
    : Math.round((win.endMs - win.startMs) / 60_000);
  const lateMinutes = Math.max(0, Math.floor((inMs - win.startMs) / 60_000));
  const afterShiftMinutes = Math.max(0, Math.floor((outMs - win.endMs) / 60_000));

  const base = { scheduledMinutes, workedMinutes, breakMinutes, lateMinutes, afterShiftMinutes };
  // Half day (attendance flag or approved half-day leave): no OT until a half-day OT rule exists
  if (att.is_half_day || att.status === 'HALF_DAY' || ctx.halfDayLeave) return empty('HALF_DAY', base);

  // Late arrival is made up first: it never turns into overtime
  const potentialMinutes = Math.max(0, workedMinutes - scheduledMinutes - lateMinutes);
  if (potentialMinutes <= 0) return empty('NO_EXTRA_TIME', base);
  return { eligible: true, reason: null, ...base, potentialMinutes, potentialHours: minutesToHours(potentialMinutes) };
}

export const OT_REASON_TEXT: Record<OtIneligibleReason, string> = {
  NOT_CLOCKED_OUT: 'Overtime can be requested after you clock out.',
  NO_SHIFT: 'No shift was assigned for this day.',
  ON_LEAVE: 'You were on approved leave this day.',
  HALF_DAY: 'Overtime is not available on a half day.',
  NO_EXTRA_TIME: 'No work beyond your scheduled shift on this day.',
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Employee request validation. Returns an error message or null. */
export function validateOvertimeRequest(requestedHours: number, potentialHours: number, reason: string): string | null {
  if (!Number.isFinite(requestedHours)) return 'Enter the number of overtime hours.';
  if (requestedHours <= 0) return 'Requested overtime must be more than 0 hours.';
  if (Math.abs(requestedHours * 100 - Math.round(requestedHours * 100)) > 1e-6) return 'Use at most 2 decimal places.';
  if (potentialHours <= 0) return 'There is no overtime available for this day.';
  if (round2(requestedHours) > potentialHours) return `You can request at most ${potentialHours} hours for this day.`;
  if (!reason || reason.trim().length < 3) return 'Please give a reason for the overtime.';
  return null;
}

/** Admin approval validation: 0 < approved ≤ requested and ≤ potential. */
export function validateOvertimeApproval(approvedHours: number, requestedHours: number, potentialHours: number): string | null {
  if (!Number.isFinite(approvedHours)) return 'Enter the hours to approve.';
  if (approvedHours <= 0) return 'Approved overtime must be more than 0 hours. Reject the request instead.';
  const a = round2(approvedHours);
  if (a > round2(requestedHours)) return `Cannot approve more than the requested ${requestedHours} hours.`;
  if (a > round2(potentialHours)) return `Cannot approve more than the eligible ${potentialHours} hours.`;
  return null;
}

/**
 * Payroll integration boundary: the ONLY overtime payroll may use.
 * Sums approved_overtime_hours of APPROVED requests; requested / potential hours and
 * attendance extra time are never included.
 */
export function approvedOvertimeHours(requests: { status: string; approved_overtime_hours: number | null }[]): number {
  return round2(requests.filter(r => r.status === 'APPROVED').reduce((s, r) => s + (Number(r.approved_overtime_hours) || 0), 0));
}

export const formatHours = (h: number | null | undefined) =>
  h === null || h === undefined ? '—' : `${Number(h).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')} h`;
