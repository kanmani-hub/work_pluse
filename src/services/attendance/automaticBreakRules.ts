/**
 * Automatic breaks — pure rules shared by the employee screens, Admin → Break Management and the
 * services (unit-tested, no database access).
 *
 * The decisions themselves are made by the database (migration 20261021120000_automatic_break_tracking):
 *   - report_tracking_event      the device reports what it observed (permission denied, GPS unavailable,
 *                                timeout, network reconnected); the server decides with its own time
 *   - process_stale_tracking     scheduled job: no fresh location reached the server → break
 *   - geofence_auto_break        office exit / return (AUTO_GPS)
 *   - a trigger on employee_live_locations ends a tracking break when a FRESH location arrives
 * This module only words and classifies what the database stored.
 */

export type AutomaticBreakType = 'AUTO_GPS' | 'AUTO_TRACKING';
export type BreakSource = 'EMPLOYEE' | 'SYSTEM' | 'ADMIN';
export type AutomaticBreakReason =
  | 'LOCATION_PERMISSION_DENIED' | 'GPS_UNAVAILABLE' | 'TRACKING_STALE' | 'NETWORK_DISCONNECTED'
  | 'GEOFENCE_EXIT' | 'TRACKING_LOST';
/** employee_tracking_state.state (server-maintained) */
export type ServerTrackingState =
  | 'TRACKING_OK' | 'TRACKING_RESTORED' | 'PERMISSION_DENIED' | 'GPS_UNAVAILABLE' | 'GPS_TIMEOUT'
  | 'LOCATION_ERROR' | 'WAITING_FOR_FIX' | 'STALE';

export interface BreakLikeWithSource {
  break_type?: string | null;
  source?: string | null;
  reason?: string | null;
  ended_reason?: string | null;
}

const AUTOMATIC_TYPES = ['AUTO_GPS', 'AUTO_TRACKING'];

/** A break started by the system (geofence or tracking). Employees cannot end it themselves. */
export function isAutomaticBreak(b: BreakLikeWithSource | null | undefined): boolean {
  if (!b) return false;
  return AUTOMATIC_TYPES.includes(String(b.break_type || '')) || b.source === 'SYSTEM';
}

/** A tracking-related automatic break (ends automatically when a fresh location arrives). */
export function isTrackingBreak(b: BreakLikeWithSource | null | undefined): boolean {
  return !!b && b.break_type === 'AUTO_TRACKING';
}

export function breakSourceLabel(b: BreakLikeWithSource | null | undefined): string {
  if (!b) return '—';
  if (b.source === 'ADMIN') return 'Admin';
  return isAutomaticBreak(b) ? 'Automatic' : 'Manual';
}

const REASON_LABEL: Record<string, string> = {
  LOCATION_PERMISSION_DENIED: 'Location permission denied',
  GPS_UNAVAILABLE: 'GPS / location unavailable',
  TRACKING_STALE: 'No location reached the server',
  NETWORK_DISCONNECTED: 'Network disconnected',
  GEOFENCE_EXIT: 'Left the office geofence',
  TRACKING_LOST: 'Location tracking lost',
};

/** Short label for an automatic break's reason ('' for manual breaks without a reason). */
export function autoBreakReasonLabel(b: BreakLikeWithSource | null | undefined): string {
  if (!b) return '';
  if (b.reason && REASON_LABEL[b.reason]) return REASON_LABEL[b.reason];
  if (b.break_type === 'AUTO_GPS') return REASON_LABEL.GEOFENCE_EXIT;
  if (b.break_type === 'AUTO_TRACKING') return REASON_LABEL.TRACKING_LOST;
  return '';
}

const ENDED_LABEL: Record<string, string> = {
  TRACKING_RESTORED: 'Tracking restored',
  GEOFENCE_RETURN: 'Returned to the office',
  CLOCK_OUT: 'Clocked out',
  SHIFT_END: 'Shift ended',
  EMPLOYEE: 'Ended by employee',
};
export function breakEndedReasonLabel(b: BreakLikeWithSource | null | undefined): string {
  return (b?.ended_reason && ENDED_LABEL[b.ended_reason]) || '';
}

/** What the employee should do to resume work during an automatic break. */
export function recoveryInstruction(b: BreakLikeWithSource | null | undefined): string {
  if (!b) return '';
  switch (b.reason) {
    case 'LOCATION_PERMISSION_DENIED':
      return 'Turn location permission for WorkPulse back on (browser / phone settings). Work resumes automatically as soon as a fresh location reaches the server.';
    case 'GPS_UNAVAILABLE':
      return 'Turn on location services / GPS and keep WorkPulse open. Work resumes automatically as soon as a fresh location reaches the server.';
    case 'TRACKING_STALE':
    case 'NETWORK_DISCONNECTED':
    case 'TRACKING_LOST':
      return 'Keep WorkPulse open with internet and location on. Work resumes automatically as soon as a fresh location reaches the server — reconnecting alone is not enough.';
    default:
      return b.break_type === 'AUTO_GPS'
        ? 'The break ends automatically when you are detected back inside the office.'
        : '';
  }
}

export interface TrackingStateView {
  tone: 'ok' | 'restored' | 'problem' | 'waiting' | 'stale' | 'unknown';
  label: string;
  detail: string;
}

/**
 * Wording for the server tracking state. Kept separate from the break status: an employee can have
 * "No breaks recorded" and still have a tracking problem, and the other way round.
 */
export function trackingStateView(state: string | null | undefined): TrackingStateView {
  switch (state) {
    case 'TRACKING_OK': return { tone: 'ok', label: 'Tracking normally', detail: 'Fresh locations are reaching the server.' };
    case 'TRACKING_RESTORED': return { tone: 'restored', label: 'Tracking restored', detail: 'A fresh location arrived after a tracking problem.' };
    case 'PERMISSION_DENIED': return { tone: 'problem', label: 'Location permission denied', detail: 'The device reported that location permission is off.' };
    case 'GPS_UNAVAILABLE': return { tone: 'problem', label: 'GPS unavailable', detail: 'The device reported that it cannot determine a location.' };
    case 'GPS_TIMEOUT': return { tone: 'waiting', label: 'GPS timed out', detail: 'The device did not get a location in time. A timeout alone does not start a break.' };
    case 'LOCATION_ERROR': return { tone: 'waiting', label: 'Location error', detail: 'The device reported a location error.' };
    case 'WAITING_FOR_FIX': return { tone: 'waiting', label: 'Waiting for fresh location', detail: 'The device is back online; tracking counts as restored only when a fresh location arrives.' };
    case 'STALE': return { tone: 'stale', label: 'No location reaching server', detail: 'No fresh location reached the server for the configured interval (network off, app closed or device asleep).' };
    default: return { tone: 'unknown', label: 'No tracking data', detail: 'No tracking state has been recorded for this attendance yet.' };
  }
}

/** Return value of breakService.handleAutoBreakTransition (unchanged shape for existing callers). */
export type AutoBreakTransitionResult =
  | { action: 'STARTED'; breakId: string; startedAt?: string; complete: true; reason?: string }
  | { action: 'ENDED'; breakId: string; durationMinutes: number; complete: true; totalsUpdated: true; statusUpdated: true; eventLogged: true;
      actual?: number; allowed?: number | null; overrun?: number; trackingGap?: true }
  | { action: 'NONE'; reason: string; breakId?: string }
  | { action: 'ERROR'; reason: string };

/** Map the geofence_auto_break / close_auto_break_for_clock_out JSON result to the service shape. */
export function mapAutoBreakResult(data: any): AutoBreakTransitionResult {
  if (!data || typeof data !== 'object') return { action: 'ERROR', reason: 'NO_RESULT_FROM_SERVER' };
  if (data.action === 'STARTED' && data.break_id) {
    return { action: 'STARTED', breakId: data.break_id, startedAt: data.started_at, complete: true };
  }
  if (data.action === 'ENDED' && data.break_id) {
    return {
      action: 'ENDED', breakId: data.break_id, durationMinutes: Number(data.duration_minutes) || 0,
      complete: true, totalsUpdated: true, statusUpdated: true, eventLogged: true,
      actual: typeof data.actual === 'number' ? data.actual : undefined,
      allowed: typeof data.allowed === 'number' ? data.allowed : null,
      overrun: typeof data.overrun === 'number' ? data.overrun : undefined,
      ...(data.tracking_gap ? { trackingGap: true as const } : {}),
    };
  }
  if (data.action === 'NONE') return { action: 'NONE', reason: String(data.reason || 'NONE'), ...(data.break_id ? { breakId: data.break_id } : {}) };
  return { action: 'ERROR', reason: `UNEXPECTED_RESULT: ${JSON.stringify(data).slice(0, 200)}` };
}

/** Device observations sent to report_tracking_event. */
export type TrackingEvent = 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN_ERROR' | 'NETWORK_RECONNECTED';

/** Map a GPS watcher problem to the event the server understands. */
export function trackingEventFor(problem: string): TrackingEvent {
  if (problem === 'LOCATION_DENIED') return 'LOCATION_DENIED';
  if (problem === 'LOCATION_UNAVAILABLE') return 'LOCATION_UNAVAILABLE';
  if (problem === 'TIMEOUT') return 'TIMEOUT';
  return 'UNKNOWN_ERROR';
}

/** While a GPS problem persists the device re-reports it at most this often (keeps "device in contact"). */
export const TRACKING_EVENT_REPEAT_MS = 60_000;

/** Send a tracking event now? Always when the problem changes; otherwise at most every TRACKING_EVENT_REPEAT_MS. */
export function shouldSendTrackingEvent(last: { event: string; sentAtMs: number } | null, event: string, nowMs: number): boolean {
  if (!last || last.event !== event) return true;
  return nowMs - last.sentAtMs >= TRACKING_EVENT_REPEAT_MS;
}
