/**
 * Location-tracking status — ONE implementation for Admin → Break Management and Admin → Live Tracking
 * (pure, unit-tested). Nothing here creates, moves or re-times a location: it only words what the
 * database already holds.
 *
 * Data (written by locationService on the employee's device):
 *   employee_live_locations.last_seen_at  time of the last USABLE reading, from the employee's device clock
 *   employee_live_locations.updated_at    server time of the last write (BEFORE UPDATE trigger)
 *   location_verification_events          failed checks (permission denied, unavailable / timeout,
 *                                         low accuracy, error) with the browser's message in failure_reason
 *
 * Freshness ("is the location still updating?"):
 *   - Threshold: TRACKING_STALE_MINUTES (15, the existing Live Tracking value). An admin may change the
 *     DISPLAY threshold in Settings → Attendance (trackingStaleMinutes, clamped 5–120). The geofence /
 *     automatic-break timing in locationRules keeps its own fixed 15-minute value.
 *   - Measured from the EARLIER of the device time (last_seen_at) and the server time (updated_at), so a
 *     phone whose clock runs fast can never look "live" forever, and a reading delivered late (offline
 *     replay) is not shown as fresh. When the two differ by more than CLOCK_DIFFERENCE_NOTE_MINUTES the
 *     details say so; the cause (late delivery or a slow device clock) is not guessed.
 *   - Missing or unreadable timestamps are never treated as fresh.
 *   - A time more than FUTURE_TOLERANCE_MINUTES ahead of now is never treated as fresh either (a wrong
 *     clock on the employee's device, or on the computer viewing the page): state STALE with timeAhead.
 *
 * The app cannot see WHY a phone stopped reporting (closed app, locked screen, browser suspended,
 * no network, location switched off): a stale status says that the cause is not known.
 */
import { COMPANY_TIMEZONE, companyDateStr, previousDateStr } from '../../utils/companyDate';

/** Same value as LIVE_STALE_MINUTES (liveTrackingRules); a unit test keeps them equal. Defined here to
 *  avoid an import cycle (liveTrackingRules uses this module). */
export const TRACKING_STALE_MINUTES = 15;
export const MIN_STALE_MINUTES = 5;
export const MAX_STALE_MINUTES = 120;
export const CLOCK_DIFFERENCE_NOTE_MINUTES = 5;
/** Small clock differences between devices are normal; beyond this a future time is not trusted. */
export const FUTURE_TOLERANCE_MINUTES = 2;

/** The admin-configurable display threshold, clamped to a sane range (invalid → default 15). */
export function resolveStaleMinutes(setting: unknown): number {
  const n = typeof setting === 'number' ? setting : typeof setting === 'string' ? Number(setting) : NaN;
  if (!Number.isFinite(n)) return TRACKING_STALE_MINUTES;
  return Math.min(MAX_STALE_MINUTES, Math.max(MIN_STALE_MINUTES, Math.round(n)));
}

export type TrackingState = 'LIVE' | 'STALE' | 'LOCATION_PROBLEM' | 'NO_DATA' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type NotTrackedReason = 'NO_ATTENDANCE' | 'NOT_CLOCKED_IN' | 'CLOCKED_OUT' | 'PAST_DATE';
export const LOCATION_PROBLEM_RESULTS = ['LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'LOW_ACCURACY', 'ERROR'] as const;

export interface TrackingProblemInfo { result: string; at: string; reason?: string | null }

export interface TrackingInfo {
  state: TrackingState;
  /** Device time of the last usable reading (shown to the admin), or null. */
  lastSeenAt: string | null;
  /** Server time of the last write, when known. */
  receivedAt?: string | null;
  /** The time freshness is measured from (earlier of the two above), or null. */
  freshAt?: string | null;
  /** true when freshAt is more than FUTURE_TOLERANCE_MINUTES in the future (never shown as live). */
  timeAhead?: boolean;
  locationStatus: string | null;
  problem: TrackingProblemInfo | null;
  notTrackedReason?: NotTrackedReason | null;
}

const ms = (iso: unknown): number => (typeof iso === 'string' && iso ? new Date(iso).getTime() : NaN);
const validIso = (iso: unknown): string | null => (Number.isFinite(ms(iso)) ? (iso as string) : null);

/** Device time, server time, the earlier of the two, and their difference in whole minutes. */
export function freshnessTimes(live: { last_seen_at?: unknown; updated_at?: unknown } | null | undefined) {
  const deviceAt = validIso(live?.last_seen_at);
  const receivedAt = validIso(live?.updated_at);
  const freshAt = deviceAt && receivedAt ? (ms(deviceAt) <= ms(receivedAt) ? deviceAt : receivedAt) : (deviceAt ?? receivedAt);
  const differenceMins = deviceAt && receivedAt ? Math.round(Math.abs(ms(receivedAt) - ms(deviceAt)) / 60000) : null;
  return { deviceAt, receivedAt, freshAt, differenceMins };
}

/** Whether the location age (from `freshAt`) is within the threshold. Missing/invalid → not fresh. */
export function isFresh(freshAt: string | null | undefined, nowMs: number, staleMinutes = TRACKING_STALE_MINUTES): boolean {
  const t = ms(freshAt);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return false;
  if (t - nowMs > FUTURE_TOLERANCE_MINUTES * 60000) return false;   // a future time cannot prove the location is current
  return (nowMs - t) / 60000 <= staleMinutes;
}

/** Whole minutes an ISO time lies beyond the future tolerance ahead of `nowMs`; 0 when it does not (or is invalid). */
export function minutesAhead(iso: string | null | undefined, nowMs: number): number {
  const t = ms(iso);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs) || t - nowMs <= FUTURE_TOLERANCE_MINUTES * 60000) return 0;
  return Math.ceil((t - nowMs) / 60000);
}

/**
 * Is location tracking expected for this attendance day right now? Only for an open attendance
 * (clocked in, not clocked out) on the company's current day — or last night's overnight shift that is
 * still open after midnight. Otherwise the reason it is not tracked.
 */
export function trackingApplicability(attendance: any | null | undefined, date: string, today: string): true | NotTrackedReason {
  if (!attendance) return date < today ? 'PAST_DATE' : 'NO_ATTENDANCE';
  if (!attendance.clock_in_at) return date < today ? 'PAST_DATE' : 'NOT_CLOCKED_IN';
  if (attendance.clock_out_at) return 'CLOCKED_OUT';
  if (date === today) return true;
  if (date === previousDateStr(today) && attendance.shift_template?.crosses_midnight) return true;
  return 'PAST_DATE';
}

/** Latest failed location check per employee (only the problem results the status uses). */
export function latestProblemByEmployee(rows: any[] | null | undefined): Map<string, TrackingProblemInfo> {
  const out = new Map<string, TrackingProblemInfo>();
  (rows || []).forEach(p => {
    if (!p?.employee_id || !(LOCATION_PROBLEM_RESULTS as readonly string[]).includes(p.result)) return;
    const prev = out.get(p.employee_id);
    if (!prev || ms(p.verified_at) > ms(prev.at)) out.set(p.employee_id, { result: p.result, at: p.verified_at, reason: p.failure_reason ?? null });
  });
  return out;
}

/**
 * The tracking state of one employee.
 * - applicable: true when tracking is expected (see trackingApplicability), otherwise the reason.
 * - loaded: false when the live locations could not be loaded (state UNKNOWN, nothing invented).
 */
export function deriveTracking(input: {
  applicable: true | NotTrackedReason;
  loaded: boolean;
  live: any | null | undefined;
  problem: TrackingProblemInfo | null | undefined;
  nowMs: number;
  staleMinutes?: number;
}): TrackingInfo {
  const { deviceAt, receivedAt, freshAt } = freshnessTimes(input.live);
  const locationStatus: string | null = input.live?.location_status ?? null;
  if (input.applicable !== true) return { state: 'NOT_APPLICABLE', lastSeenAt: deviceAt, receivedAt, freshAt, locationStatus, problem: null, notTrackedReason: input.applicable };
  if (!input.loaded) return { state: 'UNKNOWN', lastSeenAt: null, receivedAt: null, freshAt: null, locationStatus: null, problem: null };
  const problem = input.problem ?? null;
  // A failed check only matters when it is newer than the last usable reading (same device clock)
  const lastGood = deviceAt ?? freshAt;
  const problemIsNewer = !!problem && (!lastGood || ms(problem.at) > ms(lastGood));
  if (problemIsNewer) return { state: 'LOCATION_PROBLEM', lastSeenAt: deviceAt, receivedAt, freshAt, locationStatus, problem };
  if (!input.live) return { state: 'NO_DATA', lastSeenAt: null, receivedAt: null, freshAt: null, locationStatus: null, problem: null };
  if (!isFresh(freshAt, input.nowMs, input.staleMinutes)) {
    return { state: 'STALE', lastSeenAt: deviceAt, receivedAt, freshAt, locationStatus, problem: null, timeAhead: minutesAhead(freshAt, input.nowMs) > 0 };
  }
  return { state: 'LIVE', lastSeenAt: deviceAt, receivedAt, freshAt, locationStatus, problem: null };
}

// ------------------------------------------------------------------ wording for the admin UI

export type TrackingTone = 'current' | 'stale' | 'permission' | 'unavailable' | 'no-data' | 'unknown' | 'not-applicable';

export interface TrackingSummary {
  tone: TrackingTone;
  label: string;
  /** Time the chip refers to (last usable reading, or the failed check), or null. */
  at: string | null;
  ageMins: number | null;
  /** Minutes the time lies in the future (clock problem), otherwise absent. */
  aheadMins?: number;
  /** true when the location is current ("Location:"); false → "Last known location:". */
  current?: boolean;
  location: string;
  detail: string;
}

const SIDE_TEXT: Record<string, string> = { INSIDE_GEOFENCE: 'Inside office', OUTSIDE_GEOFENCE: 'Outside office', WFH: 'Working from home' };
const NOT_TRACKED_TEXT: Record<NotTrackedReason, { label: string; detail: string }> = {
  NO_ATTENDANCE: { label: 'Not clocked in', detail: 'No attendance for this day, so location is not tracked.' },
  NOT_CLOCKED_IN: { label: 'Not clocked in', detail: 'The employee has not clocked in, so location is not tracked.' },
  CLOCKED_OUT: { label: 'Clocked out', detail: 'The employee has clocked out; location is only tracked while clocked in.' },
  PAST_DATE: { label: 'Past date', detail: 'Tracking status is only shown for the current working day.' },
};

/** Minutes since an ISO time; null when missing/unparseable; a time ahead of `nowMs` counts as 0. */
export function minutesAgo(iso: string | null | undefined, nowMs: number): number | null {
  const t = ms(iso);
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
 * Time in the company time zone; the date is added when it is not the company's current day, so
 * "02:55 PM" can never silently mean yesterday. Missing/invalid → "—".
 */
export function formatTrackingTime(iso: string | null | undefined, nowMs: number): string {
  const t = ms(iso);
  if (!Number.isFinite(t)) return '—';
  const time = new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TIMEZONE });
  if (companyDateStr(t) === companyDateStr(nowMs)) return time;
  const day = new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: COMPANY_TIMEZONE });
  return `${day}, ${time}`;
}

const isTimeout = (reason: string | null | undefined) => !!reason && /time\s?out|timed out|timeout expired/i.test(reason);

/** Compact, honest wording for one tracking state. `fmt` formats an ISO time (null → placeholder). */
export function trackingSummary(t: TrackingInfo, nowMs: number, fmt: (iso: string | null) => string, staleMinutes = TRACKING_STALE_MINUTES): TrackingSummary {
  const location = (t.locationStatus && SIDE_TEXT[t.locationStatus]) || 'Unknown';
  const seen = validIso(t.lastSeenAt);
  const seenText = seen ? `${fmt(seen)} (${formatAge(minutesAgo(seen, nowMs))})` : 'no time recorded';
  const { differenceMins, receivedAt } = freshnessTimes({ last_seen_at: t.lastSeenAt, updated_at: t.receivedAt });
  const clockNote = differenceMins !== null && differenceMins > CLOCK_DIFFERENCE_NOTE_MINUTES && receivedAt
    ? ` The device time of this reading and the time the server received it differ by about ${differenceMins} min (sent late, or the device clock is off); the earlier time is used.`
    : '';
  switch (t.state) {
    case 'LIVE':
      return { tone: 'current', label: 'Live', at: seen, ageMins: minutesAgo(seen, nowMs), location, current: true,
        detail: `Location is updating. Last update ${seenText}. Current location: ${location.toLowerCase()}.${clockNote}` };
    case 'STALE':
      if (t.timeAhead) {
        const ahead = minutesAhead(t.freshAt ?? seen, nowMs);
        return { tone: 'stale', label: 'Time ahead', at: seen, ageMins: null, aheadMins: ahead, location,
          detail: `The recorded update time${seen ? ` (${fmt(seen)})` : ''} is about ${ahead} min ahead of the current time, so it cannot be confirmed as current. The employee's device clock (or this computer's clock) may be wrong. Last known location: ${location.toLowerCase()}.` };
      }
      return { tone: 'stale', label: 'Not updating', at: seen, ageMins: minutesAgo(seen, nowMs), location,
        detail: seen
          ? `No location update for more than ${staleMinutes} minutes. Last update ${seenText}. Last known location: ${location.toLowerCase()}. The device has not reported since then; the reason is not known (for example the app or browser was closed or in the background, the device was offline, or location was switched off).${clockNote}`
          : `A location record exists but it has no readable update time, so it cannot be shown as current. Last known location: ${location.toLowerCase()}.` };
    case 'LOCATION_PROBLEM': {
      const result = t.problem?.result ?? '';
      const problemAt = validIso(t.problem?.at);
      const when = problemAt ? `${fmt(problemAt)} (${formatAge(minutesAgo(problemAt, nowMs))})` : 'an unrecorded time';
      const lastFix = seen ? `Last valid location ${seenText}` : 'No valid location before that';
      const browser = t.problem?.reason ? ` Device message: "${t.problem.reason}".` : '';
      if (result === 'LOCATION_DENIED') {
        return { tone: 'permission', label: 'Location off', at: problemAt, ageMins: minutesAgo(problemAt, nowMs), location,
          detail: `Location permission was denied on the employee's device at ${when}. ${lastFix}. Last known location: ${location.toLowerCase()}.${browser}` };
      }
      if (result === 'LOCATION_UNAVAILABLE' && isTimeout(t.problem?.reason)) {
        return { tone: 'unavailable', label: 'Timed out', at: problemAt, ageMins: minutesAgo(problemAt, nowMs), location,
          detail: `The device did not return a location in time at ${when}. This does not by itself mean location is switched off. ${lastFix}. Last known location: ${location.toLowerCase()}.${browser}` };
      }
      const text = result === 'LOW_ACCURACY' ? 'GPS accuracy was too low to use'
        : result === 'LOCATION_UNAVAILABLE' ? 'The device could not determine a location'
        : 'The location could not be checked';
      return { tone: 'unavailable', label: result === 'LOW_ACCURACY' ? 'Low accuracy' : 'Unavailable', at: problemAt, ageMins: minutesAgo(problemAt, nowMs), location,
        detail: `${text} at ${when}. ${lastFix}. Last known location: ${location.toLowerCase()}.${browser}` };
    }
    case 'NO_DATA':
      return { tone: 'no-data', label: 'No location', at: null, ageMins: null, location: 'Unknown',
        detail: 'No location has been received from this employee yet.' };
    case 'UNKNOWN':
      return { tone: 'unknown', label: 'Not loaded', at: null, ageMins: null, location: 'Unknown',
        detail: 'Tracking status could not be loaded. Reload the page to try again.' };
    case 'NOT_APPLICABLE':
    default: {
      const nt = NOT_TRACKED_TEXT[t.notTrackedReason ?? 'NO_ATTENDANCE'];
      return { tone: 'not-applicable', label: nt.label, at: null, ageMins: null, location: (t.locationStatus && SIDE_TEXT[t.locationStatus]) || 'Unknown', detail: nt.detail };
    }
  }
}
