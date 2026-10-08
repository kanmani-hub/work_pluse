/**
 * Admin Attendance: rules that turn raw Supabase records into the rows and KPIs shown on
 * Admin → Attendance. Pure functions (no database access) so every rule can be unit-tested.
 *
 * Definitions (all for one selected attendance date, company timezone Asia/Kolkata):
 * - Workforce (Total Employees): ACTIVE employees whose role is not ADMIN (the system admin
 *   account is not scheduled for attendance). Same rule as the Employees page list.
 * - Present: has an attendance record with a clock-in.
 * - Currently Working: selected date is today, record has clock-in and no clock-out, and the
 *   scheduled shift end has not passed yet. A stale location does NOT change this.
 * - Missing Clock-out: record has clock-in, no clock-out, and the scheduled shift end has passed.
 * - Late: late_minutes > 0 on the attendance record (kept even after clock-out).
 * - Absent: workforce employee, no attendance, no approved leave, and either the date is in the
 *   past or the shift start + grace period has passed today. Before that: NOT CLOCKED IN.
 * - On Leave: approved leave request covering the date.
 * - WFH: approved WFH request for the date, or clock-in location verification result = WFH.
 * - Half Day: attendance is_half_day / status HALF_DAY, or approved half-day leave.
 */
import { normalizeRole } from '../../lib/roles';

export const COMPANY_TIMEZONE = 'Asia/Kolkata';
const COMPANY_UTC_OFFSET = '+05:30'; // Asia/Kolkata has no daylight saving
export const LOCATION_STALE_MINUTES = 5;
export const LOW_ACCURACY_METERS = 150; // same threshold as locationService.verifyCurrentLocation

export interface AdminAttendanceInput {
  date: string; // YYYY-MM-DD (company timezone)
  today: string; // YYYY-MM-DD (company timezone)
  nowMs: number;
  graceMinutes: number;
  requireFaceVerification: boolean;
  employees: any[];
  attendance: any[];
  shiftAssignments: any[];
  leaves: any[];
  wfh: any[];
  liveLocations: any[];
  clockInEvents: any[];
  locationEvents: any[];
  faceRegistrations: any[];
  faceEvents: any[];
}

/** Absolute instant for a company-local date + TIME value, optionally on the next day. */
export function companyDateTime(date: string, time: string, addDays = 0): number {
  const base = new Date(`${date}T${time.length === 5 ? time + ':00' : time}${COMPANY_UTC_OFFSET}`).getTime();
  return base + addDays * 86400000;
}

export function formatMinutes(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || !isFinite(totalMinutes) || totalMinutes < 0) return '-';
  const m = Math.round(totalMinutes);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: COMPANY_TIMEZONE });
}

const isWorkforce = (e: any) => e.status === 'ACTIVE' && normalizeRole(e.role?.name) !== 'ADMIN';

/** The employee's shift for a date: latest assignment effective on/before the date and not ended. */
export function shiftForDate(assignments: any[], employeeId: string, date: string): any | null {
  const candidates = assignments
    .filter(a => a.employee_id === employeeId && a.effective_date <= date && (!a.end_date || a.end_date >= date) && a.shift_templates)
    .sort((a, b) => (a.effective_date < b.effective_date ? 1 : a.effective_date > b.effective_date ? -1 : 0));
  return candidates[0]?.shift_templates ?? null;
}

export function buildAdminAttendanceDay(input: AdminAttendanceInput) {
  const { date, today, nowMs } = input;
  const isToday = date === today;
  const empById = new Map(input.employees.map(e => [e.id, e]));
  const workforce = input.employees.filter(isWorkforce);

  // One attendance row per employee (the earliest clock-in wins if duplicates ever exist)
  const attByEmp = new Map<string, any>();
  const duplicateAttendance: string[] = [];
  for (const a of [...input.attendance].sort((x, y) => String(x.clock_in_at).localeCompare(String(y.clock_in_at)))) {
    if (attByEmp.has(a.employee_id)) duplicateAttendance.push(a.id);
    else attByEmp.set(a.employee_id, a);
  }

  const leaveByEmp = new Map(input.leaves.filter(l => l.status === 'APPROVED' && l.start_date <= date && l.end_date >= date).map(l => [l.employee_id, l]));
  const wfhByEmp = new Map(input.wfh.filter(w => w.status === 'APPROVED' && w.request_date === date).map(w => [w.employee_id, w]));
  const liveByEmp = new Map<string, any>();
  for (const l of input.liveLocations) {
    const prev = liveByEmp.get(l.employee_id);
    if (!prev || String(l.last_seen_at) > String(prev.last_seen_at)) liveByEmp.set(l.employee_id, l);
  }
  const clockInEventByAtt = new Map(input.clockInEvents.map(ev => [ev.attendance_id, ev]));
  const locEventById = new Map(input.locationEvents.map(ev => [ev.id, ev]));
  const faceEventById = new Map(input.faceEvents.map(ev => [ev.id, ev]));
  const faceEventByAtt = new Map(input.faceEvents.filter(ev => ev.attendance_id && ev.verification_type === 'CLOCK_IN').map(ev => [ev.attendance_id, ev]));
  const faceRegByEmp = new Map(input.faceRegistrations.filter(f => f.is_active && f.registration_status === 'REGISTERED').map(f => [f.employee_id, f]));

  const employeeIds = new Set<string>([...workforce.map(e => e.id), ...attByEmp.keys()]);
  const rows: any[] = [];

  for (const empId of employeeIds) {
    const emp = empById.get(empId);
    const att = attByEmp.get(empId) ?? null;
    const leave = leaveByEmp.get(empId) ?? null;
    const wfh = wfhByEmp.get(empId) ?? null;
    const shift = att?.shift_templates ?? shiftForDate(input.shiftAssignments, empId, date);
    const office = emp?.offices ?? null;

    // Shift window (absolute instants)
    const shiftStartMs = shift ? companyDateTime(date, shift.start_time) : null;
    const shiftEndMs = shift ? companyDateTime(date, shift.end_time, shift.crosses_midnight ? 1 : 0) : null;

    // Clock-in verification links (attendance_events.metadata holds the verification ids)
    const clockInEvent = att ? clockInEventByAtt.get(att.id) : null;
    const locEvent = clockInEvent?.metadata?.locationVerificationId ? locEventById.get(clockInEvent.metadata.locationVerificationId) ?? null : null;
    const faceEvent = att ? (faceEventByAtt.get(att.id) ?? (clockInEvent?.metadata?.faceVerificationEventId ? faceEventById.get(clockInEvent.metadata.faceVerificationEventId) ?? null : null)) : null;
    const faceRegistration = faceRegByEmp.get(empId) ?? null;

    const clockedIn = !!att?.clock_in_at;
    const open = clockedIn && !att.clock_out_at;
    const shiftEnded = shiftEndMs !== null && nowMs > shiftEndMs;
    const missingOut = open && (shiftEnded || (shiftEndMs === null && date < today));
    const currentlyWorking = open && isToday && !missingOut;

    // Working hours: DB value when closed; live (so far) when working today
    let workedMinutes: number | null = null;
    let workHoursLabel = '-';
    if (att?.clock_out_at) {
      workedMinutes = att.worked_hours !== null && att.worked_hours !== undefined
        ? Number(att.worked_hours) * 60
        : (new Date(att.clock_out_at).getTime() - new Date(att.clock_in_at).getTime()) / 60000 - (att.break_minutes || 0);
      workHoursLabel = formatMinutes(workedMinutes);
    } else if (currentlyWorking) {
      workedMinutes = (nowMs - new Date(att.clock_in_at).getTime()) / 60000 - (att.break_minutes || 0);
      workHoursLabel = `${formatMinutes(workedMinutes)} so far`;
    }

    // Status
    let status: string;
    if (att) status = att.status || 'PRESENT';
    else if (leave) status = 'LEAVE';
    else if (date < today) status = 'ABSENT';
    else if (date > today) status = 'NOT CLOCKED IN';
    else if (shiftStartMs !== null && nowMs >= shiftStartMs + input.graceMinutes * 60000) status = 'ABSENT';
    else status = 'NOT CLOCKED IN';

    const locResult: string | null = locEvent?.result ?? null;
    const mode = leave && !att ? 'Leave' : (wfh || locResult === 'WFH') ? 'WFH' : att ? 'Office' : '-';

    // Last location (live row), only if it was seen on the selected date
    const live = liveByEmp.get(empId) ?? null;
    const liveDate = live?.last_seen_at ? new Date(live.last_seen_at).toLocaleDateString('en-CA', { timeZone: COMPANY_TIMEZONE }) : null;
    const liveOnDate = live && liveDate === date ? live : null;
    const lastSeenMinutesAgo = liveOnDate ? Math.floor((nowMs - new Date(liveOnDate.last_seen_at).getTime()) / 60000) : null;
    const lowAccuracy = !!liveOnDate && Number(liveOnDate.accuracy_meters) > LOW_ACCURACY_METERS;

    rows.push({
      id: att?.id ?? `no-attendance-${empId}`,
      attendanceId: att?.id ?? null,
      employee_uuid: empId,
      empId: emp?.employee_code ?? '-',
      name: emp ? `${emp.first_name} ${emp.last_name}`.trim() : 'Unknown employee',
      dept: emp?.departments?.name ?? '-',
      department_id: emp?.department_id ?? null,
      office: office?.name ?? '-',
      officeRadius: office?.geofence_radius ?? null,
      shift: shift?.name ?? 'No shift assigned',
      shiftTime: shift ? `${shift.start_time.substring(0, 5)} - ${shift.end_time.substring(0, 5)}` : '- - -',
      overnight: !!shift?.crosses_midnight,
      breakRuleMins: shift?.break_duration_minutes ?? null,
      requiredHours: att?.required_hours ?? shift?.required_hours ?? null,
      mode,
      clockIn: formatTime(att?.clock_in_at),
      clockOut: formatTime(att?.clock_out_at),
      clockInAt: att?.clock_in_at ?? null,
      clockOutAt: att?.clock_out_at ?? null,
      clockOutSource: att?.clock_out_at ? (att.is_auto_logged_out ? 'AUTO' : 'MANUAL') : null,
      clockInSource: clockInEvent?.source ?? null,
      workedMinutes,
      workHours: workHoursLabel,
      breakMins: att?.break_minutes ?? 0,
      late_minutes: att?.late_minutes ?? 0,
      late: att?.late_minutes ? `${att.late_minutes} min` : '-',
      early: att?.early_logout_minutes ? `${att.early_logout_minutes} min` : '-',
      early_minutes: att?.early_logout_minutes ?? 0,
      status,
      present: clockedIn,
      currentlyWorking,
      missingOut,
      autoLogout: !!att?.is_auto_logged_out,
      is_half_day: !!att?.is_half_day || att?.status === 'HALF_DAY' || !!leave?.is_half_day,
      leave: leave ? { type: leave.leave_types?.name ?? 'Leave', isHalfDay: !!leave.is_half_day, halfDayType: leave.half_day_type ?? null } : null,
      wfhApproved: !!wfh,
      // Location verification at clock-in (from location_verification_events)
      locationResult: att ? (locResult ?? 'NOT RECORDED') : null,
      locationVerified: locResult === null ? null : (locResult === 'INSIDE' || locResult === 'WFH'),
      locationDistance: locEvent?.distance_from_office_meters ?? null,
      locationRadius: locEvent?.geofence_radius_meters ?? office?.geofence_radius ?? null,
      locationAccuracy: locEvent?.accuracy_meters ?? null,
      locationVerifiedAt: locEvent?.verified_at ?? null,
      locationFailureReason: locEvent?.failure_reason ?? null,
      // Face (from face_registrations / face_verification_events)
      faceRegistered: !!faceRegistration,
      faceResult: att ? (faceEvent?.result ?? (input.requireFaceVerification ? 'NOT VERIFIED' : 'NOT REQUIRED')) : null,
      faceVerified: faceEvent ? faceEvent.result === 'SUCCESS' : null,
      faceVerifiedAt: faceEvent?.verified_at ?? null,
      // Last known location (employee_live_locations)
      lastLocationAt: liveOnDate?.last_seen_at ?? null,
      lastLocationMinutesAgo: lastSeenMinutesAgo,
      lastLocationStatus: liveOnDate ? (lowAccuracy ? 'LOW_ACCURACY' : liveOnDate.location_status) : null,
      lastLocationDistance: liveOnDate?.distance_from_office_meters ?? null,
      lastLocationAccuracy: liveOnDate?.accuracy_meters ?? null,
      // Staleness only means something for today; on past dates it is just the last known point
      locationStale: isToday && lastSeenMinutesAgo !== null ? lastSeenMinutesAgo > LOCATION_STALE_MINUTES : null,
      timeline: [],
      history: [],
    });
  }

  rows.sort((a, b) => (a.clockInAt && b.clockInAt ? a.clockInAt.localeCompare(b.clockInAt) : a.clockInAt ? -1 : b.clockInAt ? 1 : a.empId.localeCompare(b.empId)));

  const workforceIds = new Set(workforce.map(e => e.id));
  const inWorkforce = (r: any) => workforceIds.has(r.employee_uuid);
  const kpis = {
    total: workforce.length,
    present: rows.filter(r => r.present).length,
    absent: rows.filter(r => r.status === 'ABSENT' && inWorkforce(r)).length,
    late: rows.filter(r => r.late_minutes > 0).length,
    onLeave: rows.filter(r => r.leave).length,
    wfh: rows.filter(r => r.mode === 'WFH').length,
    halfDay: rows.filter(r => r.is_half_day).length,
    working: rows.filter(r => r.currentlyWorking).length,
    notClockedIn: rows.filter(r => r.status === 'NOT CLOCKED IN').length,
  };

  const exceptions: { type: string; count: number }[] = [];
  if (kpis.late) exceptions.push({ type: 'Late Arrival', count: kpis.late });
  const missing = rows.filter(r => r.missingOut).length;
  if (missing) exceptions.push({ type: 'Missing Clock-out', count: missing });
  if (kpis.halfDay) exceptions.push({ type: 'Half Day', count: kpis.halfDay });
  const locFailed = rows.filter(r => r.locationVerified === false).length;
  if (locFailed) exceptions.push({ type: 'Location Check Failed', count: locFailed });

  return { rows, kpis, exceptions, duplicateAttendance };
}
