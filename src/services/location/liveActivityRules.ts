/**
 * Live Activity Logs: converts REAL database rows into a normalized activity feed.
 * No events are invented: every log comes from one row in an existing table.
 *
 * Sources (schema verified against the live database):
 * - attendance_events        CLOCK_IN / CLOCK_OUT / AUTO_LOGOUT rows (event_at)
 * - attendance_breaks        started_at → BREAK_STARTED, ended_at → BREAK_ENDED (break_type AUTO_GPS / REGULAR)
 * - geofence_events          EXITED → GEOFENCE_EXIT, ENTERED → GEOFENCE_ENTER (occurred_at)
 * - location_verification_events
 *     result LOCATION_DENIED                  → GPS_PERMISSION_DENIED
 *     result LOCATION_UNAVAILABLE/LOW_ACCURACY → GPS_UNAVAILABLE
 *     LOCATION_CHECK with INSIDE/OUTSIDE/WFH  → LOCATION_UPDATE
 * Break START/END come only from attendance_breaks (written by the automatic-break service);
 * attendance_events BREAK_START/BREAK_END are skipped so a break is never shown twice.
 * GPS_STALE is not recorded by any table, so it is never shown (no synthetic events).
 */
import { COMPANY_TIMEZONE } from '../../utils/companyDate';

export type LiveActivityType =
  | 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_STARTED' | 'BREAK_ENDED'
  | 'GEOFENCE_ENTER' | 'GEOFENCE_EXIT' | 'LOCATION_UPDATE'
  | 'GPS_STALE' | 'GPS_PERMISSION_DENIED' | 'GPS_UNAVAILABLE';

export type LiveActivitySource = 'attendance' | 'break' | 'geofence' | 'location' | 'system';

export interface LiveActivityLog {
  id: string; // deterministic dedupe key (table + database row id [+ phase])
  employeeId: string;
  employeeName: string;
  employeeCode?: string;
  activityType: LiveActivityType;
  message: string;
  timestamp: string;
  source: LiveActivitySource;
  metadata?: Record<string, unknown>;
}

export const MAX_LOGS = 100;
export const GPS_STATUS_DEDUPE_MINUTES = 10;

export const ACTIVITY_LABELS: Record<LiveActivityType, string> = {
  CLOCK_IN: 'Clock In', CLOCK_OUT: 'Clock Out', BREAK_STARTED: 'Break Started', BREAK_ENDED: 'Break Ended',
  GEOFENCE_ENTER: 'Geofence Enter', GEOFENCE_EXIT: 'Geofence Exit', LOCATION_UPDATE: 'Location Update',
  GPS_STALE: 'GPS Stale', GPS_PERMISSION_DENIED: 'Permission Denied', GPS_UNAVAILABLE: 'GPS Unavailable',
};

const who = (row: any) => {
  const e = row.employee ?? row.employees ?? null;
  return {
    employeeId: row.employee_id as string,
    employeeName: e ? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || 'Employee' : 'Employee',
    employeeCode: e?.employee_code ?? undefined,
  };
};

export function fromAttendanceEvent(row: any): LiveActivityLog | null {
  const p = who(row);
  if (row.event_type === 'CLOCK_IN') {
    return { id: `attendance_events:${row.id}`, ...p, activityType: 'CLOCK_IN', message: `${p.employeeName} clocked in`, timestamp: row.event_at, source: 'attendance', metadata: { attendanceId: row.attendance_id, source: row.source } };
  }
  if (row.event_type === 'CLOCK_OUT' || row.event_type === 'AUTO_LOGOUT') {
    const auto = row.event_type === 'AUTO_LOGOUT';
    return { id: `attendance_events:${row.id}`, ...p, activityType: 'CLOCK_OUT', message: auto ? `${p.employeeName} was automatically clocked out` : `${p.employeeName} clocked out`, timestamp: row.event_at, source: 'attendance', metadata: { attendanceId: row.attendance_id, auto } };
  }
  return null; // BREAK_* come from attendance_breaks; other types are not activity-log events
}

export function fromBreak(row: any): LiveActivityLog[] {
  const p = who(row);
  const auto = row.break_type === 'AUTO_GPS';
  const out: LiveActivityLog[] = [];
  if (row.started_at) {
    out.push({ id: `attendance_breaks:${row.id}:start`, ...p, activityType: 'BREAK_STARTED', message: auto ? `${p.employeeName} started automatic break` : `${p.employeeName} started a break`, timestamp: row.started_at, source: 'break', metadata: { breakId: row.id, breakType: row.break_type, attendanceId: row.attendance_id } });
  }
  if (row.ended_at) {
    const mins = row.duration_minutes ?? null;
    const dur = mins !== null ? ` (${mins} min)` : '';
    out.push({ id: `attendance_breaks:${row.id}:end`, ...p, activityType: 'BREAK_ENDED', message: auto ? `${p.employeeName} returned to office — break ended${dur}` : `${p.employeeName} ended break${dur}`, timestamp: row.ended_at, source: 'break', metadata: { breakId: row.id, breakType: row.break_type, durationMinutes: mins } });
  }
  return out;
}

export function fromGeofenceEvent(row: any): LiveActivityLog | null {
  const p = who(row);
  if (row.event_type !== 'ENTERED' && row.event_type !== 'EXITED') return null;
  const exit = row.event_type === 'EXITED';
  return {
    id: `geofence_events:${row.id}`, ...p,
    activityType: exit ? 'GEOFENCE_EXIT' : 'GEOFENCE_ENTER',
    message: exit ? `${p.employeeName} left the office geofence` : `${p.employeeName} entered the office geofence`,
    timestamp: row.occurred_at, source: 'geofence',
    metadata: { distanceMeters: row.distance_from_office_meters, radiusMeters: row.geofence_radius_meters, hasLocation: row.latitude != null && row.longitude != null },
  };
}

export function fromLocationEvent(row: any): LiveActivityLog | null {
  const p = who(row);
  const base = { id: `location_verification_events:${row.id}`, ...p, timestamp: row.verified_at, source: 'location' as const };
  if (row.result === 'LOCATION_DENIED') return { ...base, activityType: 'GPS_PERMISSION_DENIED', message: `${p.employeeName} location permission denied`, metadata: { check: row.verification_type } };
  if (row.result === 'LOCATION_UNAVAILABLE' || row.result === 'LOW_ACCURACY') {
    return { ...base, activityType: 'GPS_UNAVAILABLE', message: row.result === 'LOW_ACCURACY' ? `${p.employeeName} GPS accuracy too low` : `${p.employeeName} location unavailable`, metadata: { check: row.verification_type, result: row.result, accuracyMeters: row.accuracy_meters } };
  }
  if (row.verification_type === 'LOCATION_CHECK' && (row.result === 'INSIDE' || row.result === 'OUTSIDE' || row.result === 'WFH')) {
    const where = row.result === 'INSIDE' ? 'inside office' : row.result === 'OUTSIDE' ? 'outside office' : 'WFH';
    return { ...base, activityType: 'LOCATION_UPDATE', message: `${p.employeeName} location updated (${where})`, metadata: { result: row.result, distanceMeters: row.distance_from_office_meters, hasLocation: row.latitude != null } };
  }
  return null; // CLOCK_IN/CLOCK_OUT checks are covered by the clock events themselves
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Merge new logs into the feed: dedupe by id, newest first, keep at most MAX_LOGS.
 * - LOCATION_UPDATE: only the latest update per employee is kept (GPS sends one every ~10 s).
 * - GPS problems: an identical status for the same employee within GPS_STATUS_DEDUPE_MINUTES is shown once.
 */
export function mergeLogs(current: LiveActivityLog[], incoming: LiveActivityLog[]): LiveActivityLog[] {
  const byId = new Map<string, LiveActivityLog>();
  for (const l of [...current, ...incoming]) if (l && l.timestamp && !byId.has(l.id)) byId.set(l.id, l);
  const sortedAsc = [...byId.values()].sort((a, b) => ms(a.timestamp) - ms(b.timestamp) || a.id.localeCompare(b.id));

  const latestLocation = new Map<string, string>();
  for (const l of sortedAsc) if (l.activityType === 'LOCATION_UPDATE') latestLocation.set(l.employeeId, l.id);

  const lastGpsStatus = new Map<string, number>();
  const kept: LiveActivityLog[] = [];
  for (const l of sortedAsc) {
    if (l.activityType === 'LOCATION_UPDATE' && latestLocation.get(l.employeeId) !== l.id) continue;
    if (l.activityType === 'GPS_PERMISSION_DENIED' || l.activityType === 'GPS_UNAVAILABLE' || l.activityType === 'GPS_STALE') {
      const key = `${l.employeeId}:${l.activityType}`;
      const prev = lastGpsStatus.get(key);
      if (prev !== undefined && ms(l.timestamp) - prev < GPS_STATUS_DEDUPE_MINUTES * 60000) continue;
      lastGpsStatus.set(key, ms(l.timestamp));
    }
    kept.push(l);
  }
  return kept.reverse().slice(0, MAX_LOGS);
}

export function formatActivityTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TIMEZONE });
}

/** Panel filters: employee ('All' or employee id) and activity type ('All' or a type). */
export function filterLogs(logs: LiveActivityLog[], employeeId: string, activity: 'All' | LiveActivityType): LiveActivityLog[] {
  return logs.filter(l => (employeeId === 'All' || l.employeeId === employeeId) && (activity === 'All' || l.activityType === activity));
}
