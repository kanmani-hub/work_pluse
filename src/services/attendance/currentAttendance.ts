/**
 * Which attendance record is the employee's CURRENT attendance.
 *
 * Rule: employee_id + current company calendar date — never simply "the latest record".
 *   1. Today's record (attendance_date = today), whatever its state.
 *   2. Otherwise, yesterday's record ONLY if it is an overnight session still in progress
 *      (shift crosses midnight, clocked in, not clocked out).
 *   3. Otherwise none → NOT CLOCKED IN.
 * A completed overnight session (e.g. 21:00 Oct 7 → 05:00 Oct 8) stays one Oct 7 record in history;
 * it does not become an Oct 8 "clock-out-only" state.
 */
export type CurrentAttendanceState = 'NOT_CLOCKED_IN' | 'WORKING' | 'ON_BREAK' | 'CLOCKED_OUT';

export interface AttendanceLike {
  attendance_date?: string;
  rawDate?: string; // employee page history rows use rawDate
  clock_in_at: string | null;
  clock_out_at: string | null;
  status?: string | null;
  shift_template?: { crosses_midnight?: boolean | null } | null;
}

const dateOf = (r: AttendanceLike) => r.attendance_date ?? r.rawDate;

export function selectCurrentAttendance<T extends AttendanceLike>(rows: T[] | null | undefined, today: string, yesterday: string): T | null {
  const list = rows || [];
  const todays = list.find(r => dateOf(r) === today);
  if (todays) return todays;
  const overnight = list.find(r => dateOf(r) === yesterday && !!r.clock_in_at && !r.clock_out_at && !!r.shift_template?.crosses_midnight);
  return overnight ?? null;
}

export function currentAttendanceState(current: AttendanceLike | null, hasActiveBreak: boolean): CurrentAttendanceState {
  if (!current || !current.clock_in_at) return 'NOT_CLOCKED_IN';
  if (current.clock_out_at) return 'CLOCKED_OUT';
  if (hasActiveBreak || current.status === 'ON_BREAK') return 'ON_BREAK';
  return 'WORKING';
}
