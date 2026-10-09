/**
 * Pure display rules for the Employee Dashboard.
 *
 * Nothing here calculates attendance, breaks, geofence or overtime: those stay in
 * attendanceService / breakRules / locationService. These helpers only turn the
 * values those services already produce into what the dashboard shows.
 */
import { getShiftDurationMinutes, timeToMinutes, formatDurationMinutes } from '../../utils/shiftTime';
import { COMPANY_TIMEZONE } from '../../utils/companyDate';
import { isLocationStale } from '../location/liveTrackingRules';

// ---------- greeting / time formatting ----------

export function greetingFor(now: Date, timeZone = COMPANY_TIMEZONE): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now));
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/** '10:00:00' -> '10:00 AM'. Returns '—' for missing/invalid values. */
export function formatShiftClock(time: string | null | undefined): string {
  const mins = timeToMinutes(time);
  if (mins === null) return '—';
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

/** Clock-in/out timestamps always shown in company time. */
export function formatCompanyTime(iso: string | null | undefined, timeZone = COMPANY_TIMEZONE): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone });
}

// ---------- shift / scheduled hours ----------

export interface ShiftLike {
  name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  crosses_midnight?: boolean | null;
  required_hours?: number | null;
}

/** Scheduled working minutes: the shift's configured required_hours, else its start→end length. */
export function scheduledWorkMinutes(shift: ShiftLike | null | undefined): number | null {
  if (!shift) return null;
  if (typeof shift.required_hours === 'number' && shift.required_hours > 0) return Math.round(shift.required_hours * 60);
  if (!shift.start_time || !shift.end_time) return null;
  return getShiftDurationMinutes(shift.start_time, shift.end_time, !!shift.crosses_midnight);
}

export const formatMinutes = (mins: number | null | undefined): string =>
  mins === null || mins === undefined ? '—' : formatDurationMinutes(Math.max(0, Math.round(mins)));

/**
 * Remaining scheduled time. Work beyond the schedule is NOT overtime: overtime only
 * exists once an employee requests it and an admin approves it, so this never returns
 * a negative/"extra" value for display as overtime.
 */
export function remainingScheduledMinutes(workedSeconds: number, scheduledMinutes: number | null): number | null {
  if (scheduledMinutes === null) return null;
  return Math.max(0, scheduledMinutes - Math.floor(workedSeconds / 60));
}

// ---------- work mode ----------

export type WorkMode = 'WFH' | 'OFFICE';

/**
 * Work mode comes ONLY from the attendance record / an approved WFH request for today,
 * the same sources clock-in and locationService use. GPS state is never an input.
 */
export function resolveWorkMode(
  attendance: { status?: string | null } | null | undefined,
  wfhRequests: { request_date: string; status: string }[] | null | undefined,
  today: string,
): WorkMode {
  if (attendance?.status === 'WFH') return 'WFH';
  if ((wfhRequests || []).some(r => r.request_date === today && r.status === 'APPROVED')) return 'WFH';
  return 'OFFICE';
}

// ---------- GPS / geofence (display only) ----------

export type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unsupported' | 'unknown';

export interface LiveLocationLike {
  location_status?: string | null;
  last_seen_at?: string | null;
  accuracy_meters?: number | null;
}

export interface LocationDisplay {
  gps: 'GPS Active' | 'Location Updating' | 'Location Permission Required' | 'Location Permission Denied' | 'GPS Unavailable';
  geofence: 'IN OFFICE' | 'OUTSIDE GEOFENCE' | 'LOCATION UNKNOWN' | 'WFH';
  tone: 'success' | 'warning' | 'danger' | 'muted';
  lastSeenAt: string | null;
}

/**
 * Read-only view of the location state locationService already stored in
 * employee_live_locations. A failed / denied / stale GPS reading is shown as
 * "LOCATION UNKNOWN", never as "OUTSIDE GEOFENCE" (same rule as Live Tracking).
 */
export function deriveLocationDisplay(input: {
  permission: GeoPermission;
  liveRow: LiveLocationLike | null | undefined;
  nowMs: number;
  workMode: WorkMode;
}): LocationDisplay {
  const { permission, liveRow, nowMs, workMode } = input;
  const lastSeenAt = liveRow?.last_seen_at ?? null;
  const fresh = !!liveRow && !isLocationStale({ lastSeenAt }, nowMs);

  let gps: LocationDisplay['gps'];
  if (permission === 'unsupported') gps = 'GPS Unavailable';
  else if (permission === 'denied') gps = 'Location Permission Denied';
  else if (permission === 'prompt') gps = 'Location Permission Required';
  else gps = fresh ? 'GPS Active' : 'Location Updating';

  let geofence: LocationDisplay['geofence'];
  if (workMode === 'WFH') geofence = 'WFH';
  else if (!fresh) geofence = 'LOCATION UNKNOWN';
  else if (liveRow?.location_status === 'INSIDE_GEOFENCE') geofence = 'IN OFFICE';
  else if (liveRow?.location_status === 'OUTSIDE_GEOFENCE') geofence = 'OUTSIDE GEOFENCE';
  else geofence = 'LOCATION UNKNOWN';

  const tone: LocationDisplay['tone'] =
    gps === 'Location Permission Denied' || gps === 'GPS Unavailable' ? 'danger'
    : geofence === 'OUTSIDE GEOFENCE' ? 'warning'
    : gps === 'GPS Active' ? 'success'
    : 'muted';

  return { gps, geofence, tone, lastSeenAt };
}

// ---------- leave / WFH summary ----------

export function summarizeLeaveAndWfh(input: {
  leaveRequests: { start_date: string; end_date: string; status: string; is_half_day?: boolean | null }[] | null | undefined;
  leaveBalances: { remaining_days: number | null }[] | null | undefined;
  wfhRequests: { request_date: string; status: string }[] | null | undefined;
  today: string;
}) {
  const leaves = input.leaveRequests || [];
  const wfh = input.wfhRequests || [];
  const onLeaveToday = leaves.find(l => l.status === 'APPROVED' && l.start_date <= input.today && l.end_date >= input.today) || null;
  const balances = input.leaveBalances || [];
  return {
    pendingLeave: leaves.filter(l => l.status === 'PENDING').length,
    upcomingApprovedLeave: leaves.filter(l => l.status === 'APPROVED' && l.start_date > input.today).length,
    onLeaveToday: !!onLeaveToday,
    onHalfDayLeaveToday: !!onLeaveToday?.is_half_day,
    leaveBalanceDays: balances.length ? balances.reduce((s, b) => s + (Number(b.remaining_days) || 0), 0) : null,
    wfhToday: (wfh.find(r => r.request_date === input.today)?.status ?? null) as string | null,
    pendingWfh: wfh.filter(r => r.status === 'PENDING').length,
  };
}

// ---------- clock in/out error messages ----------

// Messages attendanceService writes itself for expected situations; safe to show as-is.
const KNOWN_ATTENDANCE_MESSAGES = [
  'You are still clocked in to your overnight shift. Clock out of it first.',
  'Attendance already exists for today.',
  'No shift assigned for today.',
  'No active attendance exists.',
  'Attendance is already completed.',
  'Please end your active break before clocking out.',
];

/** Never show raw database / Supabase errors on the dashboard. */
export function attendanceActionMessage(err: { message?: string } | null | undefined, action: 'in' | 'out'): string {
  const msg = err?.message?.trim() || '';
  if (KNOWN_ATTENDANCE_MESSAGES.includes(msg)) return msg;
  if (msg === 'Unauthorized') return 'Your session has expired. Please sign in again.';
  if (/failed to fetch|network/i.test(msg)) return 'Unable to reach the server. Check your internet connection and try again.';
  return action === 'in'
    ? 'Your clock in could not be saved. Please try again.'
    : 'Your clock out could not be saved. Please try again.';
}
