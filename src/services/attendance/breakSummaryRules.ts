/**
 * Admin → Break Management: one employee-day's break summary (pure, unit-tested).
 *
 * Source: the attendance row for the selected attendance_date (Asia/Kolkata company date) and
 * its attendance_breaks rows. A break belongs to the attendance day it was taken in, so a break
 * crossing midnight is counted once, in full, on that day.
 *
 *   Completed minutes = Σ floor((ended_at − started_at) / 60 s) over valid completed sessions
 *   Active minutes    = floor((now − started_at) / 60 s) for an open session while clocked in
 *   Total minutes     = completed + active
 *   Allowed minutes   = shift break_duration_minutes, else Admin → Settings break duration
 *                       (null = not configured: excess is not calculated)
 *   Excess minutes    = max(0, total − allowed)
 *
 * If the attendance row came back WITHOUT its break list (not an array), nothing is known about
 * its breaks: the day is UNVERIFIED with breaksUnavailable = true, never "No Breaks Recorded".
 *
 * Sessions with a missing/unparseable start, an end before the start, an open break after
 * clock-out, an open break on a past attendance day, or a second open break are INVALID: they
 * are listed but never counted (and never turned into a "0 min" completed break). A session id
 * seen twice is counted once.
 *
 * Past attendance day: attendance_date is before today's company date (Asia/Kolkata). An open
 * break there was never closed (e.g. no clock-out), so counting it "up to now" would grow without
 * limit. Exception: an overnight shift (crosses_midnight) that started yesterday is still running.
 */
import { breakDurationMinutes, resolveAllowedBreakMinutes } from './breakRules';
import { companyDateStr, previousDateStr } from '../../utils/companyDate';

export type BreakDayStatus = 'ON_BREAK' | 'EXCESS' | 'WITHIN' | 'NO_BREAKS' | 'UNVERIFIED';
export const BREAK_STATUS_LABEL: Record<BreakDayStatus, string> = {
  ON_BREAK: 'On Break', EXCESS: 'Excess Break', WITHIN: 'Within Limit', NO_BREAKS: 'No Breaks Recorded', UNVERIFIED: 'Unverified',
};

export interface BreakSession {
  id: string | null;
  break_type: string | null;
  /** EMPLOYEE / SYSTEM / ADMIN and the automatic-break reason (null on rows created before they existed) */
  source?: string | null;
  reason?: string | null;
  ended_reason?: string | null;
  started_at: string | null;
  ended_at: string | null;
  state: 'COMPLETED' | 'ACTIVE' | 'INVALID';
  minutes: number | null;          // null for invalid sessions
  invalidReason?: string;
  storedMinutes?: number | null;   // attendance_breaks.duration_minutes as stored (for reference)
}

export interface BreakDaySummary {
  allowedMins: number | null;
  completedMins: number;
  activeMins: number;
  totalMins: number;
  excessMins: number | null;       // null when the allowance is not configured
  sessions: BreakSession[];
  activeCount: number;
  invalidCount: number;
  duplicateCount: number;
  breaksUnavailable: boolean;      // the break list was not returned: totals are not verified
  status: BreakDayStatus;
  notes: string[];
}

const validTime = (iso: any) => typeof iso === 'string' && iso.length > 0 && Number.isFinite(new Date(iso).getTime());

/** Reason shown for an open break on a past attendance day (listed, never counted). */
export const PAST_DAY_OPEN_BREAK = 'Break still open on a past attendance day (never closed)';

/**
 * True when an open break on this attendance day can no longer be in progress: the day is before
 * today's company date, except yesterday's overnight (crosses_midnight) shift. Unknown date → false
 * (the clock-out rule still applies).
 */
export function isPastAttendanceDay(attendanceDate: string | null | undefined, crossesMidnight: boolean | null | undefined, nowMs: number): boolean {
  if (typeof attendanceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate.slice(0, 10))) return false;
  const day = attendanceDate.slice(0, 10);
  const today = companyDateStr(nowMs);
  if (day >= today) return false;
  if (crossesMidnight && day === previousDateStr(today)) return false;
  return true;
}

export function summarizeBreakDay(
  attendance: {
    attendance_date?: string | null;
    clock_in_at?: string | null;
    clock_out_at?: string | null;
    shift_template?: {
      break_duration_minutes?: number | null;
      end_time?: string | null;
      start_time?: string | null;
      crosses_midnight?: boolean | null;
    } | null;
    attendance_breaks?: any[] | null;
  },
  settingBreakMins: number | null | undefined,
  nowMs: number,
): BreakDaySummary {
  const allowedMins = resolveAllowedBreakMinutes(attendance?.shift_template?.break_duration_minutes, settingBreakMins);
  if (!Array.isArray(attendance?.attendance_breaks)) {
    return {
      allowedMins, completedMins: 0, activeMins: 0, totalMins: 0, excessMins: null, sessions: [],
      activeCount: 0, invalidCount: 0, duplicateCount: 0, breaksUnavailable: true, status: 'UNVERIFIED',
      notes: ['Break records were not returned for this attendance day, so its break time is not verified. Refresh the page; if it persists, check the database access for attendance_breaks.'],
    };
  }
  const seen = new Set<string>();
  let duplicateCount = 0;
  const unique = (attendance?.attendance_breaks || []).filter(b => {
    if (!b) return false;
    if (b.break_type === 'CANCELLED') return false;
    if (b.id) {
      if (seen.has(b.id)) { duplicateCount++; return false; }
      seen.add(b.id);
    }
    return true;
  }).sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')));

  const clockedOut = !!attendance?.clock_out_at;
  const todayDate = companyDateStr(nowMs);
  const attDate = attendance?.attendance_date
    || (attendance?.clock_in_at ? companyDateStr(attendance.clock_in_at) : null);

  let openSeen = 0;
  const sessions: BreakSession[] = unique.map(b => {
    const base = { id: b.id ?? null, break_type: b.break_type ?? null, source: b.source ?? null, reason: b.reason ?? null, ended_reason: b.ended_reason ?? null, started_at: b.started_at ?? null, ended_at: b.ended_at ?? null, storedMinutes: b.duration_minutes ?? null };
    const invalid = (invalidReason: string): BreakSession => ({ ...base, state: 'INVALID', minutes: null, invalidReason });
    if (!validTime(b.started_at)) return invalid('Missing or invalid start time');
    if (b.ended_at !== null && b.ended_at !== undefined) {
      if (!validTime(b.ended_at)) return invalid('Invalid end time');
      if (new Date(b.ended_at).getTime() < new Date(b.started_at).getTime()) return invalid('End time is before the start time');
      return { ...base, state: 'COMPLETED', minutes: breakDurationMinutes(b.started_at, b.ended_at) };
    }
    // Open session
    if (clockedOut) return invalid('Break still open after clock-out');
    // Bound open breaks: a break on a past attendance day must not accumulate days of minutes.
    // Day rule (isPastAttendanceDay, from the attendance date, else the clock-in / break-start date),
    // plus: yesterday's overnight shift is past once its shift end has passed, or (no end time
    // configured: none is invented) once the break has been open for more than 24 hours.
    const startMs = new Date(b.started_at).getTime();
    const sessionDate = attDate || companyDateStr(b.started_at);
    const overnight = !!attendance?.shift_template?.crosses_midnight;
    let pastDay = isPastAttendanceDay(sessionDate, overnight, nowMs);
    if (!pastDay && overnight && sessionDate === previousDateStr(todayDate)) {
      const end = attendance?.shift_template?.end_time;
      if (end) {
        const timeStr = end.length === 5 ? `${end}:00` : end;
        pastDay = nowMs > new Date(`${sessionDate}T${timeStr}+05:30`).getTime() + 86400000;
      } else {
        pastDay = nowMs - startMs > 86400000;
      }
    }
    if (pastDay) return invalid(PAST_DAY_OPEN_BREAK);
    openSeen++;
    if (openSeen > 1) return invalid('More than one open break');
    if (startMs > nowMs) return invalid('Start time is in the future');

    return { ...base, state: 'ACTIVE', minutes: Math.floor((nowMs - startMs) / 60000) };
  });

  const completedMins = sessions.filter(s => s.state === 'COMPLETED').reduce((t, s) => t + (s.minutes || 0), 0);
  const activeMins = sessions.filter(s => s.state === 'ACTIVE').reduce((t, s) => t + (s.minutes || 0), 0);
  const totalMins = completedMins + activeMins;
  const activeCount = sessions.filter(s => s.state === 'ACTIVE').length;
  const invalidCount = sessions.filter(s => s.state === 'INVALID').length;
  const excessMins = allowedMins === null ? null : Math.max(0, totalMins - allowedMins);

  const notes: string[] = [];
  if (allowedMins === null) notes.push('No break allowance is configured (neither on the shift nor in Settings), so excess cannot be calculated.');
  if (invalidCount > 0) notes.push(`${invalidCount} break record(s) are invalid and were not counted.`);
  if (duplicateCount > 0) notes.push(`${duplicateCount} duplicate break record(s) were ignored.`);
  if (activeCount > 0) notes.push('A break is in progress: its time is counted up to now and will change.');

  let status: BreakDayStatus;
  if (activeCount > 0) status = 'ON_BREAK';
  else if (invalidCount > 0) status = 'UNVERIFIED';
  else if (sessions.length === 0) status = 'NO_BREAKS';
  else if (allowedMins === null) status = 'UNVERIFIED';
  else if ((excessMins || 0) > 0) status = 'EXCESS';
  else status = 'WITHIN';

  return { allowedMins, completedMins, activeMins, totalMins, excessMins, sessions, activeCount, invalidCount, duplicateCount, breaksUnavailable: false, status, notes };
}

/** Status filter used by the page: WITHIN also covers days with no breaks (0 ≤ allowance). */
export function matchesBreakFilter(status: BreakDayStatus, filter: string): boolean {
  switch (filter) {
    case 'ALL': return true;
    case 'WITHIN': return status === 'WITHIN' || status === 'NO_BREAKS';
    case 'EXCESS': return status === 'EXCESS';
    case 'ON_BREAK': return status === 'ON_BREAK';
    case 'UNVERIFIED': return status === 'UNVERIFIED';
    case 'NO_BREAKS': return status === 'NO_BREAKS';
    default: return true;
  }
}
