import { describe, it, expect } from 'vitest';
import { buildLiveTrackingRows, liveKpiCounts, liveKpiPredicate, locationStatusLabel, type LiveTrackingKpi } from './liveTrackingRules';

// In-memory fixtures shaped like the real tables (nothing is written to the database)
const TODAY = '2026-10-08', YDAY = '2026-10-07';
const at = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00+05:30`).toISOString();
const NOW = new Date(at(TODAY, '13:00')).getTime();
const office = { id: 'o1', name: 'Whitee Lotus', latitude: 13.052815, longitude: 80.200211, geofence_radius: 100 };
const emp = (id: string, code: string, role = 'EMPLOYEE') => ({ id, employee_code: code, first_name: code, last_name: '', status: 'ACTIVE', department_id: 'd1', departments: { name: 'CG' }, office_id: 'o1', offices: office, role: { name: role } });
const general = { name: 'General Shift', start_time: '10:00:00', end_time: '19:30:00', crosses_midnight: false };
const night = { name: 'Night', start_time: '21:00:00', end_time: '05:00:00', crosses_midnight: true };
const live = (employee_id: string, status: string, seenHHMM: string, extra: any = {}) => ({ id: `live-${employee_id}`, employee_id, location_status: status, location_context: 'OFFICE', last_seen_at: at(TODAY, seenHHMM), latitude: 13.0528, longitude: 80.2002, accuracy_meters: 10, distance_from_office_meters: status === 'INSIDE_GEOFENCE' ? 15 : 400, ...extra });
const att = (id: string, employee_id: string, inHHMM: string, extra: any = {}) => ({ id, employee_id, attendance_date: TODAY, status: 'WORKING', clock_in_at: at(TODAY, inHHMM), clock_out_at: null, shift_template: general, ...extra });

const input = () => ({
  today: TODAY, yesterday: YDAY,
  employees: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'].map((id, i) => emp(id, `EMP00${i + 1}`)).concat([emp('adm', 'ADMIN-001', 'ADMIN')]),
  liveLocations: [
    live('e1', 'INSIDE_GEOFENCE', '12:58'),                       // working, inside, fresh
    live('e2', 'OUTSIDE_GEOFENCE', '12:59'),                      // working, outside, on automatic break
    live('e3', 'OUTSIDE_GEOFENCE', '11:00'),                      // working, last known outside but STALE (GPS failure)
    live('e5', 'INSIDE_GEOFENCE', '12:50'),                       // has location, not clocked in today
    live('e6', 'INSIDE_GEOFENCE', '12:57'),                       // clocked out today
    live('adm', 'INSIDE_GEOFENCE', '12:59'),                      // admin account: never listed
  ],
  attendance: [
    att('a1', 'e1', '09:55'),
    att('a2', 'e2', '10:05', { status: 'ON_BREAK' }),
    att('a3', 'e3', '10:00'),
    att('a4', 'e4', '10:10'),                                      // working, no live-location row at all
    att('a6', 'e6', '09:50', { status: 'COMPLETED', clock_out_at: at(TODAY, '12:30') }),
    { id: 'a7', employee_id: 'e7', attendance_date: YDAY, status: 'WORKING', clock_in_at: at(YDAY, '21:00'), clock_out_at: null, shift_template: night }, // overnight in progress
  ],
  breaks: [{ id: 'b2', attendance_id: 'a2', employee_id: 'e2', break_type: 'AUTO_GPS', started_at: at(TODAY, '12:30'), ended_at: null }],
  wfhToday: [{ employee_id: 'e8', request_date: TODAY, status: 'APPROVED' }],
  shiftAssignments: [{ employee_id: 'e5', effective_date: '2026-10-01', end_date: null, shift_templates: { name: 'Morinig_shift_01', start_time: '10:30:00', end_time: '20:00:00', crosses_midnight: false } }],
  geofenceEvents: [{ employee_id: 'e2', event_type: 'EXITED', occurred_at: at(TODAY, '12:30') }],
});

const rows = buildLiveTrackingRows(input(), NOW);
const byCode = (c: string) => rows.find(r => r.empId === c)!;
const codes = (k: LiveTrackingKpi) => rows.filter(liveKpiPredicate(k, NOW)).map(r => r.empId).sort();

describe('live tracking KPI rules', () => {
  it('Currently Working = everyone clocked in and not out (incl. on break, stale GPS, no GPS row, overnight)', () => {
    expect(codes('CURRENTLY_WORKING')).toEqual(['EMP001', 'EMP002', 'EMP003', 'EMP004', 'EMP007']);
  });
  it('In Office = working + office mode + fresh INSIDE location', () => {
    expect(codes('IN_OFFICE')).toEqual(['EMP001']);
  });
  it('Outside Geofence = working + office mode + fresh OUTSIDE location (on-break employee included)', () => {
    expect(codes('OUTSIDE_GEOFENCE')).toEqual(['EMP002']);
  });
  it('WFH = approved WFH for today only', () => {
    expect(codes('WFH')).toEqual(['EMP008']);
  });
  it('card count equals modal rows for every KPI (same predicate)', () => {
    const counts = liveKpiCounts(rows, NOW);
    for (const k of ['CURRENTLY_WORKING', 'IN_OFFICE', 'WFH', 'OUTSIDE_GEOFENCE'] as LiveTrackingKpi[]) {
      expect(rows.filter(liveKpiPredicate(k, NOW)).length).toBe(counts[k]);
    }
    expect(counts).toEqual({ CURRENTLY_WORKING: 5, IN_OFFICE: 1, WFH: 1, OUTSIDE_GEOFENCE: 1 });
  });
});

describe('GPS failure, WFH, shifts, details', () => {
  it('stale last-known OUTSIDE is not counted as outside and status is not "Outside Geofence"', () => {
    const r = byCode('EMP003');
    expect(r.status).toBe('Working');
    expect(locationStatusLabel(r, NOW)).toBe('Stale (last known: outside office)');
  });
  it('working with no live-location row shows "No location", never outside', () => {
    expect(locationStatusLabel(byCode('EMP004'), NOW)).toBe('No location');
  });
  it('a location row alone (not clocked in) is not working; clocked out is not working; admin never listed', () => {
    expect(byCode('EMP005').status).toBe('Offline');
    expect(byCode('EMP006').status).toBe('Clocked Out');
    expect(rows.find(r => r.empId === 'ADMIN-001')).toBeUndefined();
  });
  it('approved WFH: mode WFH, geofence not applicable, not counted outside', () => {
    const r = byCode('EMP008');
    expect(r.workMode).toBe('WFH');
    expect(locationStatusLabel(r, NOW)).toBe('WFH');
  });
  it('shift comes from attendance, else today\'s roster assignment; overnight shift marked +1d', () => {
    expect(byCode('EMP001').shift).toBe('General Shift');
    expect(byCode('EMP005').shift).toBe('Morinig_shift_01');
    expect(byCode('EMP007').shiftTime).toBe('21:00 - 05:00 (+1d)');
  });
  it('overnight session from yesterday stays the current attendance after midnight', () => {
    expect(byCode('EMP007').attendance.attendance_date).toBe(YDAY);
    expect(byCode('EMP007').status).toBe('Working');
  });
  it('on automatic break: break shown, work timer paused, time since leaving from geofence_events', () => {
    const r = byCode('EMP002');
    expect(r.status).toBe('On Break');
    expect(r.activeBreak.break_type).toBe('AUTO_GPS');
    expect(r.workSeconds).toBe((150 - 0) * 60 - 5 * 60); // 10:05→12:30 worked = 145 min; break excluded
    expect(r.leftGeofenceAt).toBe(at(TODAY, '12:30'));
  });
  it('last activity is the most recent real timestamp', () => {
    expect(byCode('EMP001').lastActivity.label).toBe('Location update');
    expect(byCode('EMP006').lastActivity.label).toBe('Location update'); // 12:57 after clock-out 12:30
  });
});

describe('realtime updates (rebuild from new data)', () => {
  it('inside → outside on a new live-location row moves the employee from In Office to Outside Geofence', () => {
    const i = input();
    i.liveLocations = i.liveLocations.map(l => (l.employee_id === 'e1' ? live('e1', 'OUTSIDE_GEOFENCE', '13:00') : l));
    const c = liveKpiCounts(buildLiveTrackingRows(i, NOW), NOW);
    expect(c.IN_OFFICE).toBe(0);
    expect(c.OUTSIDE_GEOFENCE).toBe(2);
    expect(c.CURRENTLY_WORKING).toBe(5);
  });
  it('GPS becoming stale with time passing removes the employee from In Office (no DB call needed)', () => {
    const later = NOW + 20 * 60000;
    const c = liveKpiCounts(buildLiveTrackingRows(input(), later), later);
    expect(c.IN_OFFICE).toBe(0);
    expect(c.CURRENTLY_WORKING).toBe(5);
  });
  it('clock-out removes the employee from Currently Working', () => {
    const i = input();
    i.attendance = i.attendance.map(a => (a.id === 'a1' ? { ...a, status: 'COMPLETED', clock_out_at: at(TODAY, '12:59') } : a));
    expect(liveKpiCounts(buildLiveTrackingRows(i, NOW), NOW).CURRENTLY_WORKING).toBe(4);
  });
});
