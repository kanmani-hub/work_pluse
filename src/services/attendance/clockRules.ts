/**
 * Pure clock-in / clock-out rules used by attendanceService.
 *
 * These are the SAME calculations attendanceService already did inline, moved here so
 * they can be unit-tested, with two corrections:
 *  - an overnight shift clocked into after midnight belongs to the shift that started
 *    the previous day (correct attendance date + correct late minutes);
 *  - extra time beyond the scheduled hours is NOT overtime. Overtime only exists after
 *    an employee request is approved by an admin, so clock-out never writes it.
 */
import { COMPANY_TIMEZONE, previousDateStr } from '../../utils/companyDate';
import { timeToMinutes } from '../../utils/shiftTime';

/** Seconds since midnight in the company time zone. */
export function companySecondsOfDay(nowMs: number, timeZone = COMPANY_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return get('hour') * 3600 + get('minute') * 60 + get('second');
}

export interface ClockInShift {
  start_time: string | null;
  end_time?: string | null;
  crosses_midnight?: boolean | null;
}

/**
 * Which attendance date a clock-in belongs to, and how late it is.
 *
 * Late = minutes after the shift start, counted only once the grace period is exceeded
 * (existing rule: grace from Admin Settings; 09:17 for a 09:00 shift with 10 min grace
 * = 17 minutes late).
 * For an overnight shift (e.g. 22:00 → 06:00), a clock-in between midnight and the shift
 * end belongs to the shift that started YESTERDAY: attendance date = yesterday, and late
 * is measured from yesterday 22:00 (00:30 → 150 minutes late), not from tonight's 22:00.
 */
export function resolveClockInSession(input: {
  nowMs: number;
  today: string;
  shift: ClockInShift;
  graceMinutes: number;
  timeZone?: string;
}): { attendanceDate: string; lateMinutes: number } {
  const nowSec = companySecondsOfDay(input.nowMs, input.timeZone);
  const startMin = timeToMinutes(input.shift.start_time) ?? 0;
  const endMin = timeToMinutes(input.shift.end_time ?? null);

  let attendanceDate = input.today;
  let secondsSinceStart = nowSec - startMin * 60;

  if (input.shift.crosses_midnight && endMin !== null && nowSec < endMin * 60) {
    attendanceDate = previousDateStr(input.today);
    secondsSinceStart = nowSec + 24 * 3600 - startMin * 60;
  }

  const lateMinutes = secondsSinceStart > Math.max(0, input.graceMinutes) * 60
    ? Math.floor(secondsSinceStart / 60)
    : 0;

  return { attendanceDate, lateMinutes };
}

/**
 * Clock-out totals: worked = (clock out - clock in) - completed break minutes.
 * Half day = worked < 50% of required hours (existing rule). Extra time is reported as
 * extraMinutes for information only; it is never stored as overtime.
 */
export function computeClockOutTotals(input: {
  clockInMs: number;
  clockOutMs: number;
  breakMinutes: number;
  requiredHours: number;
}) {
  const totalDurationHrs = Math.max(0, input.clockOutMs - input.clockInMs) / 3_600_000;
  const workedHours = Math.max(0, totalDurationHrs - input.breakMinutes / 60);
  const workedMinutes = Math.floor(workedHours * 60);
  const requiredMinutes = Math.floor(input.requiredHours * 60);

  const earlyLogoutMinutes = workedMinutes < requiredMinutes ? requiredMinutes - workedMinutes : 0;
  const extraMinutes = workedMinutes > requiredMinutes ? workedMinutes - requiredMinutes : 0;
  const isHalfDay = workedMinutes < requiredMinutes * 0.5;

  return {
    workedHours: Number(workedHours.toFixed(2)),
    workedMinutes,
    earlyLogoutMinutes,
    extraMinutes,          // informational only — NOT overtime
    overtimeMinutes: 0,    // overtime requires an approved request (not implemented yet)
    isHalfDay,
    status: isHalfDay ? 'HALF_DAY' : 'COMPLETED',
  };
}
