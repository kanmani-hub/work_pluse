/**
 * Admin → Break Management report rows (pure, unit-tested).
 *
 * One row per attendance day for the selected company date (Asia/Kolkata), plus one row for every
 * other active, non-admin employee with NO attendance that day, so nobody is hidden just because
 * they have no break record. Each row keeps these situations apart:
 *
 *   NO_ATTENDANCE  no attendance row for the date (absent, leave, week-off, not clocked in yet)
 *   NO_BREAKS      attendance exists and its break list was returned empty
 *   ON_BREAK       a break is in progress (live minutes grow until it ends)
 *   WITHIN/EXCESS  completed breaks only, compared with the allowance
 *   UNVERIFIED     the break list was not returned, invalid break rows, or no allowance configured
 *
 * Break minutes shown are LIVE values computed from the break timestamps (breakSummaryRules).
 * "Stored" is attendance.break_minutes, the value payroll uses; it is only written when a break
 * ends / clock-out happens, so it is shown separately and never overwritten from this page.
 *
 * Tracking (today, while clocked in) comes from employee_live_locations.last_seen_at, which is only
 * refreshed by a usable GPS reading, and the latest failed location check (permission denied,
 * location unavailable, ...). A GPS problem is never shown as "outside".
 */
import { summarizeBreakDay, matchesBreakFilter, type BreakDaySummary, type BreakDayStatus } from './breakSummaryRules';
import { isLocationStale, LIVE_STALE_MINUTES } from '../location/liveTrackingRules';
import { normalizeRole } from '../../lib/roles';

export type BreakReportStatus = BreakDayStatus | 'NO_ATTENDANCE';
export type TrackingState = 'LIVE' | 'STALE' | 'LOCATION_PROBLEM' | 'NO_DATA' | 'UNKNOWN' | 'NOT_APPLICABLE';

export const LOCATION_PROBLEM_RESULTS = ['LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'LOW_ACCURACY', 'ERROR'] as const;

export interface BreakReportInput {
  date: string;                      // selected company date (YYYY-MM-DD)
  today: string;                     // company today
  attendanceRows: any[];             // breakService.getBreakReport rows (with attendance_breaks)
  employees: any[] | null;           // null = the employee list could not be loaded
  liveLocations: any[] | null;       // null = not loaded (error, or not today)
  locationProblems: any[] | null;    // failed location checks for the date, any order
  breakEndEvents?: any[] | null;     // attendance_events BREAK_END (metadata.tracking_gap flags late returns)
  settingBreakMins: number | null | undefined;
  nowMs: number;
}

export interface BreakReportTracking {
  state: TrackingState;
  lastSeenAt: string | null;
  locationStatus: string | null;     // INSIDE_GEOFENCE / OUTSIDE_GEOFENCE / WFH (last usable reading)
  problem: { result: string; at: string } | null;
}

export interface BreakReportRow {
  key: string;
  employeeId: string;
  attendanceId: string | null;
  employee: any;
  shiftName: string | null;
  attendance: any | null;
  summary: BreakDaySummary | null;   // null for NO_ATTENDANCE
  status: BreakReportStatus;
  firstStartAt: string | null;
  lastEndAt: string | null;          // null while a break is open
  storedBreakMins: number | null;
  storedOverrunMins: number | null;
  storedDiffers: boolean;            // completed breaks ≠ stored value (only when nothing is open/invalid)
  tracking: BreakReportTracking;
  /** break id → last location time before a return that was only seen after a tracking gap */
  gapReturns: Record<string, string | null>;
}

/** Supabase's default maximum rows per request; a response this long may be truncated. */
export const API_ROW_LIMIT = 1000;

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

function latestProblemByEmployee(problems: any[] | null): Map<string, { result: string; at: string }> {
  const out = new Map<string, { result: string; at: string }>();
  (problems || []).forEach(p => {
    if (!p?.employee_id || !LOCATION_PROBLEM_RESULTS.includes(p.result)) return;
    const prev = out.get(p.employee_id);
    if (!prev || time(p.verified_at) > time(prev.at)) out.set(p.employee_id, { result: p.result, at: p.verified_at });
  });
  return out;
}

export function trackingFor(
  input: Pick<BreakReportInput, 'date' | 'today' | 'liveLocations' | 'nowMs'>,
  attendance: any | null,
  live: any | null,
  problem: { result: string; at: string } | null,
): BreakReportTracking {
  // An unreadable last_seen_at is treated as missing (never as a fresh fix)
  const rawSeen: string | null = live?.last_seen_at ?? null;
  const lastSeenAt: string | null = Number.isFinite(time(rawSeen)) ? rawSeen : null;
  const locationStatus: string | null = live?.location_status ?? null;
  // Freshness only matters for the current, still-open working day
  const applicable = input.date === input.today && !!attendance?.clock_in_at && !attendance?.clock_out_at;
  if (!applicable) return { state: 'NOT_APPLICABLE', lastSeenAt, locationStatus, problem: null };
  if (input.liveLocations === null) return { state: 'UNKNOWN', lastSeenAt: null, locationStatus: null, problem: null };
  const problemIsNewer = !!problem && (!lastSeenAt || time(problem.at) > time(lastSeenAt));
  if (problemIsNewer) return { state: 'LOCATION_PROBLEM', lastSeenAt, locationStatus, problem };
  if (!live) return { state: 'NO_DATA', lastSeenAt: null, locationStatus: null, problem: null };
  // A location row without a readable last_seen_at cannot prove the phone is reporting: it is
  // "not updating" with no time, never live (isLocationStale would treat an unparseable time as fresh).
  if (!lastSeenAt) return { state: 'STALE', lastSeenAt: null, locationStatus, problem: null };
  if (isLocationStale({ lastSeenAt }, input.nowMs)) return { state: 'STALE', lastSeenAt, locationStatus, problem: null };
  return { state: 'LIVE', lastSeenAt, locationStatus, problem: null };
}

export function buildBreakReportRows(input: BreakReportInput): BreakReportRow[] {
  const liveByEmp = new Map((input.liveLocations || []).map((l: any) => [l.employee_id, l]));
  const problems = latestProblemByEmployee(input.locationProblems);
  const gapByBreak = new Map<string, string | null>();
  (input.breakEndEvents || []).forEach((ev: any) => {
    const m = ev?.metadata;
    if (m?.tracking_gap && m?.break_id) gapByBreak.set(m.break_id, m.last_seen_before_return ?? null);
  });
  const rows: BreakReportRow[] = [];
  const withAttendance = new Set<string>();

  for (const att of input.attendanceRows || []) {
    withAttendance.add(att.employee_id);
    const summary = summarizeBreakDay(att, input.settingBreakMins, input.nowMs);
    const counted = summary.sessions.filter(s => s.state !== 'INVALID');
    const starts = counted.map(s => s.started_at).filter(Boolean) as string[];
    const ends = counted.map(s => s.ended_at).filter(Boolean) as string[];
    const storedBreakMins = typeof att.break_minutes === 'number' ? att.break_minutes : null;
    const settled = summary.activeCount === 0 && summary.invalidCount === 0 && !summary.breaksUnavailable;
    rows.push({
      key: `att:${att.id}`,
      employeeId: att.employee_id,
      attendanceId: att.id,
      employee: att.employees ?? null,
      shiftName: att.shift_template?.name ?? null,
      attendance: att,
      summary,
      status: summary.status,
      firstStartAt: starts.length ? starts.sort()[0] : null,
      lastEndAt: summary.activeCount > 0 ? null : (ends.length ? ends.sort()[ends.length - 1] : null),
      storedBreakMins,
      storedOverrunMins: typeof att.break_overrun_minutes === 'number' ? att.break_overrun_minutes : null,
      storedDiffers: settled && storedBreakMins !== null && storedBreakMins !== summary.completedMins,
      tracking: trackingFor(input, att, liveByEmp.get(att.employee_id) ?? null, problems.get(att.employee_id) ?? null),
      gapReturns: Object.fromEntries(summary.sessions.filter(se => se.id && gapByBreak.has(se.id)).map(se => [se.id as string, gapByBreak.get(se.id as string) ?? null])),
    });
  }

  // Everyone else who could have been at work that day
  const others = (input.employees || []).filter((e: any) =>
    e?.id && !withAttendance.has(e.id)
    && (!e.status || String(e.status).toUpperCase() === 'ACTIVE')
    && normalizeRole(e.role?.name) !== 'ADMIN'
    && (!e.joining_date || e.joining_date <= input.date));
  others
    .sort((a: any, b: any) => String(a.employee_code ?? '').localeCompare(String(b.employee_code ?? '')))
    .forEach((e: any) => rows.push({
      key: `emp:${e.id}`,
      employeeId: e.id,
      attendanceId: null,
      employee: e,
      shiftName: null,
      attendance: null,
      summary: null,
      status: 'NO_ATTENDANCE',
      firstStartAt: null,
      lastEndAt: null,
      storedBreakMins: null,
      storedOverrunMins: null,
      storedDiffers: false,
      tracking: { state: 'NOT_APPLICABLE', lastSeenAt: null, locationStatus: null, problem: null },
      gapReturns: {},
    }));
  return rows;
}

export const REPORT_STATUS_LABEL: Record<BreakReportStatus, string> = {
  ON_BREAK: 'On Break', EXCESS: 'Excess Break', WITHIN: 'Within Limit', NO_BREAKS: 'No Breaks Recorded',
  UNVERIFIED: 'Unverified', NO_ATTENDANCE: 'No Attendance',
};

/** Page filter: NO_ATTENDANCE rows only appear under "All" and "No Attendance". */
export function matchesReportFilter(status: BreakReportStatus, filter: string): boolean {
  if (status === 'NO_ATTENDANCE') return filter === 'ALL' || filter === 'NO_ATTENDANCE';
  if (filter === 'NO_ATTENDANCE') return false;
  return matchesBreakFilter(status, filter);
}

const PROBLEM_LABEL: Record<string, string> = {
  LOCATION_DENIED: 'Location permission denied',
  LOCATION_UNAVAILABLE: 'Location unavailable (GPS off or no signal)',
  LOW_ACCURACY: 'GPS accuracy too low',
  ERROR: 'Location could not be checked',
};

/** Short tracking text for the table; times are formatted by the caller. */
export function trackingLabel(t: BreakReportTracking, fmt: (iso: string | null) => string): string {
  const side = t.locationStatus === 'INSIDE_GEOFENCE' ? 'inside office' : t.locationStatus === 'OUTSIDE_GEOFENCE' ? 'outside office' : t.locationStatus === 'WFH' ? 'WFH' : 'no side yet';
  switch (t.state) {
    case 'LIVE': return `Live · ${side} (${fmt(t.lastSeenAt)})`;
    case 'STALE': return `No update since ${fmt(t.lastSeenAt)} (app closed, offline or GPS off) · last known: ${side}`;
    case 'LOCATION_PROBLEM': return `${PROBLEM_LABEL[t.problem?.result ?? ''] ?? 'Location problem'} at ${fmt(t.problem?.at ?? null)} · last valid location ${t.lastSeenAt ? fmt(t.lastSeenAt) : 'none'}`;
    case 'NO_DATA': return 'No location received today';
    case 'UNKNOWN': return 'Tracking status could not be loaded';
    case 'NOT_APPLICABLE': return '—';
  }
}

// ------------------------------------------------------------------ compact tracking status (UI)

/**
 * Staleness threshold used by the tracking status on this page: a location is "current" while its
 * last_seen_at is at most this many minutes before now. It is the same threshold Live Tracking
 * uses (LIVE_STALE_MINUTES), so the two pages never disagree about one employee.
 */
export const TRACKING_STALE_MINUTES = LIVE_STALE_MINUTES;

/**
 * Visual/semantic group of a tracking state. LOCATION_PROBLEM is split by its cause so that a
 * phone whose location PERMISSION is off is not presented like a GPS signal problem.
 */
export type TrackingTone = 'current' | 'stale' | 'permission' | 'unavailable' | 'no-data' | 'unknown' | 'not-applicable';

export interface TrackingSummary {
  tone: TrackingTone;
  /** Short state name for the compact chip, e.g. "Live", "Not updating", "Location off". */
  label: string;
  /** Time of the event the chip refers to (last fix, or the failed check), or null. */
  at: string | null;
  /** Whole minutes between `at` and now (never negative), or null when there is no readable time. */
  ageMins: number | null;
  /** Last known side from the last usable reading, in words ("Outside office", "Unknown"). */
  location: string;
  /** Full sentence for the expanded view and for screen readers. */
  detail: string;
}

const SIDE_TEXT: Record<string, string> = { INSIDE_GEOFENCE: 'Inside office', OUTSIDE_GEOFENCE: 'Outside office', WFH: 'Working from home' };

/** Minutes since an ISO time; null when missing/unparseable; a time ahead of `nowMs` counts as 0. */
export function minutesAgo(iso: string | null | undefined, nowMs: number): number | null {
  const t = time(iso);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 60000));
}

/** "just now", "12 min ago", "2 h 5 min ago"; "time not recorded" when there is no readable time. */
export function formatAge(mins: number | null): string {
  if (mins === null) return 'time not recorded';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

/**
 * Compact status for one row. Pure: the state comes from trackingFor(); this only words it.
 * `fmt` formats an ISO time for display (company time zone); it receives null for a missing time.
 */
export function trackingSummary(t: BreakReportTracking, nowMs: number, fmt: (iso: string | null) => string): TrackingSummary {
  const location = (t.locationStatus && SIDE_TEXT[t.locationStatus]) || 'Unknown';
  const seen = t.lastSeenAt && Number.isFinite(time(t.lastSeenAt)) ? t.lastSeenAt : null;
  const seenText = seen ? `${fmt(seen)} (${formatAge(minutesAgo(seen, nowMs))})` : 'no time recorded';
  switch (t.state) {
    case 'LIVE':
      return { tone: 'current', label: 'Live', at: seen, ageMins: minutesAgo(seen, nowMs), location,
        detail: `Location is updating. Last update ${seenText}. Last known location: ${location.toLowerCase()}.` };
    case 'STALE':
      return { tone: 'stale', label: 'Not updating', at: seen, ageMins: minutesAgo(seen, nowMs), location,
        detail: seen
          ? `No location update for more than ${TRACKING_STALE_MINUTES} minutes. Last update ${seenText}. Last known location: ${location.toLowerCase()}. The app may be closed, offline or without GPS; the cause is not known.`
          : `A location record exists but it has no readable update time, so it cannot be shown as current. Last known location: ${location.toLowerCase()}.` };
    case 'LOCATION_PROBLEM': {
      const result = t.problem?.result ?? '';
      const problemAt = t.problem?.at && Number.isFinite(time(t.problem.at)) ? t.problem.at : null;
      const when = problemAt ? `${fmt(problemAt)} (${formatAge(minutesAgo(problemAt, nowMs))})` : 'an unrecorded time';
      const lastFix = seen ? `Last valid location ${seenText}` : 'No valid location before that';
      if (result === 'LOCATION_DENIED') {
        return { tone: 'permission', label: 'Location off', at: problemAt, ageMins: minutesAgo(problemAt, nowMs), location,
          detail: `Location permission was denied on the employee's device at ${when}. ${lastFix}. Last known location: ${location.toLowerCase()}.` };
      }
      return { tone: 'unavailable', label: result === 'LOW_ACCURACY' ? 'Low accuracy' : 'Unavailable', at: problemAt, ageMins: minutesAgo(problemAt, nowMs), location,
        detail: `${PROBLEM_LABEL[result] ?? 'Location could not be checked'} at ${when}. ${lastFix}. Last known location: ${location.toLowerCase()}.` };
    }
    case 'NO_DATA':
      return { tone: 'no-data', label: 'No location', at: null, ageMins: null, location: 'Unknown',
        detail: 'No location has been received from this employee today.' };
    case 'UNKNOWN':
      return { tone: 'unknown', label: 'Not loaded', at: null, ageMins: null, location: 'Unknown',
        detail: 'Tracking status could not be loaded. Reload the page to try again.' };
    case 'NOT_APPLICABLE':
    default:
      return { tone: 'not-applicable', label: 'Not tracked', at: null, ageMins: null, location: 'Unknown',
        detail: 'Tracking only applies to today while the employee is clocked in.' };
  }
}
