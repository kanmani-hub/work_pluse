import { describe, it, expect } from 'vitest';
import { buildAdminAttendanceDay, companyDateTime, KPI_PREDICATES, type AttendanceKpiFilter } from './adminAttendanceRules';

// In-memory fixtures only (nothing is written to the database).
const general = { name: 'General Shift', start_time: '10:00:00', end_time: '19:30:00', crosses_midnight: false, break_duration_minutes: 80, required_hours: 9.5 };
const emp = (id: string, code: string, role = 'EMPLOYEE') => ({ id, employee_code: code, first_name: code, last_name: '', status: 'ACTIVE', department_id: 'd1', departments: { name: 'CG' }, offices: { name: 'HQ', geofence_radius: 100 }, role: { name: role } });
const base = (over: any = {}) => ({
  date: '2026-10-07', today: '2026-10-07', nowMs: companyDateTime('2026-10-07', '12:00'), graceMinutes: 15, requireFaceVerification: false,
  employees: [emp('admin', 'ADMIN-001', 'ADMIN'), emp('e1', 'EMP001'), emp('e2', 'EMP002'), emp('e3', 'EMP003'), emp('e4', 'EMP004'), emp('e5', 'EMP005')],
  attendance: [], shiftAssignments: ['e1', 'e2', 'e3', 'e4', 'e5'].map(id => ({ employee_id: id, effective_date: '2026-10-01', end_date: null, shift_templates: general })),
  leaves: [], wfh: [], liveLocations: [], clockInEvents: [], locationEvents: [], faceRegistrations: [], faceEvents: [], ...over,
});
const att = (id: string, employee_id: string, inT: string, outT: string | null, extra: any = {}) => ({
  id, employee_id, attendance_date: '2026-10-07', clock_in_at: new Date(companyDateTime('2026-10-07', inT)).toISOString(),
  clock_out_at: outT ? new Date(companyDateTime('2026-10-07', outT)).toISOString() : null, status: outT ? 'COMPLETED' : 'WORKING',
  late_minutes: 0, worked_hours: null, break_minutes: 0, is_half_day: false, is_auto_logged_out: false, required_hours: 9.5, shift_templates: general, ...extra,
});

describe('admin attendance rules', () => {
  it('excludes the ADMIN account from Total Employees', () => {
    expect(buildAdminAttendanceDay(base()).kpis.total).toBe(5);
  });

  it('present / working / late / missing clock-out / absent at 12:00 today', () => {
    const d = buildAdminAttendanceDay(base({ attendance: [
      att('a1', 'e1', '09:55', null),
      att('a2', 'e2', '10:40', null, { status: 'LATE', late_minutes: 40 }),
      att('a3', 'e3', '09:50', '11:30', { worked_hours: 1.67 }),
    ] }));
    expect(d.kpis.present).toBe(3);
    expect(d.kpis.working).toBe(2);       // open records before shift end
    expect(d.kpis.late).toBe(1);
    expect(d.kpis.absent).toBe(2);        // e4, e5: no record, past 10:15
    expect(d.rows.find(r => r.empId === 'EMP003')!.workHours).toBe('1h 40m');
    expect(d.rows.find(r => r.empId === 'EMP001')!.workHours).toMatch(/so far$/);
    expect(d.exceptions.find(e => e.type === 'Missing Clock-out')).toBeUndefined();
  });

  it('before shift start + grace an employee without attendance is NOT CLOCKED IN, not absent', () => {
    const d = buildAdminAttendanceDay(base({ nowMs: companyDateTime('2026-10-07', '10:10') }));
    expect(d.kpis.absent).toBe(0);
    expect(d.kpis.notClockedIn).toBe(5);
  });

  it('after shift end an open record is Missing Clock-out, not Currently Working', () => {
    const d = buildAdminAttendanceDay(base({ nowMs: companyDateTime('2026-10-07', '21:00'), attendance: [att('a1', 'e1', '09:55', null)] }));
    expect(d.kpis.working).toBe(0);
    expect(d.rows.find(r => r.empId === 'EMP001')!.missingOut).toBe(true);
    expect(d.exceptions.find(e => e.type === 'Missing Clock-out')!.count).toBe(1);
  });

  it('a stale location does not stop an employee from counting as working', () => {
    const d = buildAdminAttendanceDay(base({ attendance: [att('a1', 'e1', '09:55', null)],
      liveLocations: [{ employee_id: 'e1', last_seen_at: new Date(companyDateTime('2026-10-07', '10:30')).toISOString(), location_status: 'INSIDE_GEOFENCE', accuracy_meters: 10 }] }));
    const r = d.rows.find(x => x.empId === 'EMP001')!;
    expect(r.currentlyWorking).toBe(true);
    expect(r.locationStale).toBe(true);
    expect(r.lastLocationMinutesAgo).toBe(90);
  });

  it('approved leave: status LEAVE, counted On Leave, not Absent', () => {
    const d = buildAdminAttendanceDay(base({ leaves: [{ employee_id: 'e4', start_date: '2026-10-06', end_date: '2026-10-08', status: 'APPROVED', is_half_day: false, leave_types: { name: 'Sick Leave' } }] }));
    const r = d.rows.find(x => x.empId === 'EMP004')!;
    expect(r.status).toBe('LEAVE');
    expect(r.mode).toBe('Leave');
    expect(d.kpis.onLeave).toBe(1);
    expect(d.kpis.absent).toBe(4);
  });

  it('approved WFH: mode WFH and counted in WFH', () => {
    const d = buildAdminAttendanceDay(base({ wfh: [{ employee_id: 'e5', request_date: '2026-10-07', status: 'APPROVED' }], attendance: [att('a5', 'e5', '09:58', null)] }));
    expect(d.rows.find(x => x.empId === 'EMP005')!.mode).toBe('WFH');
    expect(d.kpis.wfh).toBe(1);
  });

  it('location and face come from linked verification events, not defaults', () => {
    const d = buildAdminAttendanceDay(base({ attendance: [att('a1', 'e1', '09:55', null)],
      clockInEvents: [{ attendance_id: 'a1', source: 'WEB', metadata: { locationVerificationId: 'L1' } }],
      locationEvents: [{ id: 'L1', result: 'OUTSIDE', distance_from_office_meters: 240, geofence_radius_meters: 100, accuracy_meters: 8 }] }));
    const r = d.rows.find(x => x.empId === 'EMP001')!;
    expect(r.locationResult).toBe('OUTSIDE');
    expect(r.locationVerified).toBe(false);
    expect(r.locationDistance).toBe(240);
    expect(r.faceResult).toBe('NOT REQUIRED');
    expect(r.faceRegistered).toBe(false);
  });

  it('ignores duplicate attendance rows for the same employee', () => {
    const d = buildAdminAttendanceDay(base({ attendance: [att('a1', 'e1', '09:55', null), att('a1b', 'e1', '10:05', null)] }));
    expect(d.rows.filter(r => r.empId === 'EMP001').length).toBe(1);
    expect(d.duplicateAttendance).toEqual(['a1b']);
  });

  it('every KPI count equals the number of rows its card filter shows (mixed day)', () => {
    const d = buildAdminAttendanceDay(base({
      attendance: [
        att('a1', 'e1', '09:55', null),
        att('a2', 'e2', '10:40', null, { status: 'LATE', late_minutes: 40 }),
        att('a3', 'e3', '09:50', '11:30', { worked_hours: 1.5, is_half_day: true, status: 'HALF_DAY' }),
        att('a5', 'e5', '09:58', null),
        att('aA', 'admin', '09:00', null), // ADMIN clocked in: shown, but not in Total
      ],
      leaves: [{ employee_id: 'e4', start_date: '2026-10-07', end_date: '2026-10-07', status: 'APPROVED', is_half_day: false, leave_types: { name: 'Sick Leave' } }],
      wfh: [{ employee_id: 'e5', request_date: '2026-10-07', status: 'APPROVED' }],
    }));
    const keyOf: Record<AttendanceKpiFilter, keyof typeof d.kpis> = { ALL: 'total', PRESENT: 'present', ABSENT: 'absent', LATE: 'late', ON_LEAVE: 'onLeave', WFH: 'wfh', HALF_DAY: 'halfDay', CURRENTLY_WORKING: 'working' };
    for (const k of Object.keys(keyOf) as AttendanceKpiFilter[]) {
      expect(d.rows.filter(KPI_PREDICATES[k]).length).toBe(d.kpis[keyOf[k]]);
    }
    expect(d.kpis).toEqual({ total: 5, present: 5, absent: 0, late: 1, onLeave: 1, wfh: 1, halfDay: 1, working: 4, notClockedIn: 0 });
    expect(d.rows.filter(KPI_PREDICATES.ALL).map(r => r.empId).sort()).toEqual(['EMP001', 'EMP002', 'EMP003', 'EMP004', 'EMP005']);
  });
});
