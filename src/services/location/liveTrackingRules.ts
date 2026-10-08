/**
 * Admin Live Tracking rows and KPI rules (pure, unit-tested).
 *
 * Sources of truth (nothing is recalculated here):
 * - Geofence side: employee_live_locations.location_status, written by locationService (debounced).
 * - Work state: current attendance (today, or an open overnight session) + active break rows.
 * - WFH: approved wfh_requests for today's company date.
 * - Shift: the attendance's shift, otherwise the roster assignment for today.
 *
 * KPI definitions (card count == modal rows, same predicate):
 * - CURRENTLY_WORKING: clocked in to the current attendance and not clocked out (includes ON BREAK).
 * - IN_OFFICE:  currently working, office mode, last location INSIDE and fresh.
 * - OUTSIDE_GEOFENCE: currently working, office mode, last location OUTSIDE and fresh.
 * - WFH: approved WFH for today (clocked in or not).
 * A missing, denied or stale GPS reading is never counted as outside: those employees are only in
 * Currently Working, with location status "Stale" / "No location".
 */
import { deriveLiveWorkStatus, type LiveWorkStatus } from './liveStatusRules';
import { selectCurrentAttendance } from '../attendance/currentAttendance';
import { computeWorkTimer, findActiveBreak } from '../attendance/breakRules';
import { shiftForDate } from '../attendance/adminAttendanceRules';
import { normalizeRole } from '../../lib/roles';

export const LIVE_STALE_MINUTES = 15; // existing Live Tracking threshold for "STALE / LAST KNOWN"

export type LiveTrackingKpi = 'CURRENTLY_WORKING' | 'IN_OFFICE' | 'WFH' | 'OUTSIDE_GEOFENCE';

export interface LiveTrackingInput {
  today: string;
  yesterday: string;
  liveLocations: any[];   // employee_live_locations with employee:employees(...)
  employees: any[];       // employees with departments/offices/role
  attendance: any[];      // today's + yesterday's attendance rows with shift_template
  breaks: any[];          // attendance_breaks for those attendance rows
  wfhToday: any[];        // approved wfh_requests for today
  shiftAssignments: any[];
  geofenceEvents?: any[]; // today's geofence_events (ENTERED/EXITED), oldest first
}

const minutesSince = (iso: string | null | undefined, nowMs: number) => (iso ? (nowMs - new Date(iso).getTime()) / 60000 : null);

export function isLocationStale(row: { lastSeenAt: string | null }, nowMs: number): boolean {
  const m = minutesSince(row.lastSeenAt, nowMs);
  return m === null || m > LIVE_STALE_MINUTES;
}

export function buildLiveTrackingRows(input: LiveTrackingInput, nowMs: number) {
  const empById = new Map(input.employees.map(e => [e.id, e]));
  const liveByEmp = new Map(input.liveLocations.map(l => [l.employee_id, l]));
  const wfhSet = new Set(input.wfhToday.filter(w => w.status === 'APPROVED' && w.request_date === input.today).map(w => w.employee_id));
  const attByEmp = new Map<string, any[]>();
  input.attendance.forEach(a => attByEmp.set(a.employee_id, [...(attByEmp.get(a.employee_id) || []), a]));
  const breaksByAtt = new Map<string, any[]>();
  input.breaks.forEach(b => breaksByAtt.set(b.attendance_id, [...(breaksByAtt.get(b.attendance_id) || []), b]));

  // Employees shown: anyone with a live-location row, plus anyone clocked in or on approved WFH today
  const ids = new Set<string>([...liveByEmp.keys()]);
  input.attendance.forEach(a => ids.add(a.employee_id));
  wfhSet.forEach(id => ids.add(id));

  // Latest EXITED with no later ENTERED = when the employee left the geofence (from geofence_events)
  const leftAt = new Map<string, string | null>();
  (input.geofenceEvents || []).forEach(g => {
    if (g.event_type === 'EXITED') leftAt.set(g.employee_id, g.occurred_at);
    else if (g.event_type === 'ENTERED') leftAt.set(g.employee_id, null);
  });

  const rows: any[] = [];
  for (const employeeId of ids) {
    const live = liveByEmp.get(employeeId) ?? null;
    const emp = empById.get(employeeId) ?? live?.employee ?? null;
    if (!emp || (emp.status && emp.status !== 'ACTIVE') || normalizeRole(emp.role?.name) === 'ADMIN') continue;

    const att = selectCurrentAttendance(attByEmp.get(employeeId) || [], input.today, input.yesterday);
    const attBreaks = att ? breaksByAtt.get(att.id) || [] : [];
    const activeBreak = att && !att.clock_out_at ? findActiveBreak(attBreaks) : null;
    const wfhApproved = wfhSet.has(employeeId);
    const lastSeenAtForStatus: string | null = live?.last_seen_at ?? null;
    // A stale reading is not used for the work status (GPS failure is not "outside")
    const freshLocationStatus = isLocationStale({ lastSeenAt: lastSeenAtForStatus }, nowMs) ? null : (live?.location_status ?? null);
    const status: LiveWorkStatus = deriveLiveWorkStatus(
      { location_status: freshLocationStatus, location_context: wfhApproved ? 'WFH' : 'OFFICE' },
      att, !!activeBreak,
    );
    const shift = att?.shift_template ?? shiftForDate(input.shiftAssignments, employeeId, input.today);
    const office = emp.offices ?? null;
    const lastSeenAt: string | null = live?.last_seen_at ?? null;
    const geofence: 'INSIDE' | 'OUTSIDE' | 'WFH' | null =
      live?.location_status === 'INSIDE_GEOFENCE' ? 'INSIDE' : live?.location_status === 'OUTSIDE_GEOFENCE' ? 'OUTSIDE' : live?.location_status === 'WFH' ? 'WFH' : null;
    const stale = isLocationStale({ lastSeenAt }, nowMs);
    const timer = att ? computeWorkTimer(att, attBreaks, nowMs) : null;

    // Last activity: the most recent real timestamp we hold for this employee
    const candidates: { label: string; at: string }[] = [];
    if (att?.clock_in_at) candidates.push({ label: 'Clocked in', at: att.clock_in_at });
    if (att?.clock_out_at) candidates.push({ label: 'Clocked out', at: att.clock_out_at });
    attBreaks.forEach(b => {
      candidates.push({ label: b.break_type === 'AUTO_GPS' ? 'Automatic break started' : 'Break started', at: b.started_at });
      if (b.ended_at) candidates.push({ label: 'Break ended', at: b.ended_at });
    });
    if (lastSeenAt) candidates.push({ label: 'Location update', at: lastSeenAt });
    const lastActivity = candidates.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0] ?? null;

    rows.push({
      // fields used by the existing list, drawer and map
      id: live?.id ?? `emp-${employeeId}`,
      employeeId,
      empId: emp.employee_code || '-',
      name: `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || 'Unknown',
      department: emp.departments?.name || '-',
      departmentId: emp.department_id ?? null,
      shift: shift?.name ?? 'No shift assigned',
      shiftTime: shift ? `${String(shift.start_time).slice(0, 5)} - ${String(shift.end_time).slice(0, 5)}${shift.crosses_midnight ? ' (+1d)' : ''}` : '',
      workMode: wfhApproved ? 'WFH' : 'Office',
      status,
      office: office?.name || '-',
      officeId: office?.id ?? null,
      officeRadius: office?.geofence_radius ?? null,
      lat: live?.latitude ?? null,
      lng: live?.longitude ?? null,
      // extra detail (real values only)
      wfhApproved,
      attendance: att,
      attendanceStatus: att?.status ?? null,
      clockInAt: att?.clock_in_at ?? null,
      clockOutAt: att?.clock_out_at ?? null,
      breaks: attBreaks,
      activeBreak,
      workSeconds: timer?.workSeconds ?? null,
      lastSeenAt,
      accuracy: live?.accuracy_meters ?? null,
      distanceMeters: live?.distance_from_office_meters ?? null,
      geofence,
      leftGeofenceAt: leftAt.get(employeeId) ?? null,
      lastActivity,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

const WORKING: LiveWorkStatus[] = ['Working', 'On Break', 'WFH', 'Outside Geofence'];
export const isCurrentlyWorking = (r: any) => WORKING.includes(r.status);

/** KPI predicates: used for BOTH the card count and the detail modal rows. */
export function liveKpiPredicate(kpi: LiveTrackingKpi, nowMs: number): (r: any) => boolean {
  switch (kpi) {
    case 'CURRENTLY_WORKING': return r => isCurrentlyWorking(r);
    case 'IN_OFFICE': return r => isCurrentlyWorking(r) && r.workMode === 'Office' && r.geofence === 'INSIDE' && !isLocationStale(r, nowMs);
    case 'OUTSIDE_GEOFENCE': return r => isCurrentlyWorking(r) && r.workMode === 'Office' && r.geofence === 'OUTSIDE' && !isLocationStale(r, nowMs);
    case 'WFH': return r => r.wfhApproved;
  }
}

export function liveKpiCounts(rows: any[], nowMs: number): Record<LiveTrackingKpi, number> {
  const c = (k: LiveTrackingKpi) => rows.filter(liveKpiPredicate(k, nowMs)).length;
  return { CURRENTLY_WORKING: c('CURRENTLY_WORKING'), IN_OFFICE: c('IN_OFFICE'), WFH: c('WFH'), OUTSIDE_GEOFENCE: c('OUTSIDE_GEOFENCE') };
}

/** Human-readable location status; GPS problems are never shown as "outside". */
export function locationStatusLabel(r: any, nowMs: number): string {
  if (r.workMode === 'WFH') return 'WFH';
  if (!r.lastSeenAt || !r.geofence) return 'No location';
  const side = r.geofence === 'INSIDE' ? 'Inside office' : r.geofence === 'OUTSIDE' ? 'Outside office' : 'WFH';
  return isLocationStale(r, nowMs) ? `Stale (last known: ${side.toLowerCase()})` : side;
}
