import { describe, it, expect } from 'vitest';
import { fromAttendanceEvent, fromBreak, fromGeofenceEvent, fromLocationEvent, mergeLogs, MAX_LOGS, formatActivityTime, filterLogs } from './liveActivityRules';

// Row shapes match the real tables (attendance_events, attendance_breaks, geofence_events, location_verification_events)
const employee = { first_name: 'Rahul', last_name: 'Kumar', employee_code: 'EMP001' };
const T = (hhmm: string) => `2026-10-08T${hhmm}:00+05:30`;

describe('row → activity conversion (real rows only)', () => {
  it('attendance_events CLOCK_IN / CLOCK_OUT / AUTO_LOGOUT; BREAK_* skipped (come from attendance_breaks)', () => {
    expect(fromAttendanceEvent({ id: 'e1', employee_id: 'u1', event_type: 'CLOCK_IN', event_at: T('10:00'), employee })!.message).toBe('Rahul Kumar clocked in');
    expect(fromAttendanceEvent({ id: 'e2', employee_id: 'u1', event_type: 'CLOCK_OUT', event_at: T('19:00'), employee })!.activityType).toBe('CLOCK_OUT');
    expect(fromAttendanceEvent({ id: 'e3', employee_id: 'u1', event_type: 'AUTO_LOGOUT', event_at: T('23:30'), employee })!.message).toBe('Rahul Kumar was automatically clocked out');
    expect(fromAttendanceEvent({ id: 'e4', employee_id: 'u1', event_type: 'BREAK_START', event_at: T('12:00'), employee })).toBeNull();
  });

  it('attendance_breaks AUTO_GPS → started automatic break / returned to office — break ended', () => {
    const logs = fromBreak({ id: 'b1', employee_id: 'u1', break_type: 'AUTO_GPS', started_at: T('12:00'), ended_at: T('12:30'), duration_minutes: 30, employee });
    expect(logs.map(l => l.activityType)).toEqual(['BREAK_STARTED', 'BREAK_ENDED']);
    expect(logs[0].message).toBe('Rahul Kumar started automatic break');
    expect(logs[1].message).toBe('Rahul Kumar returned to office — break ended (30 min)');
    expect(logs.map(l => l.id)).toEqual(['attendance_breaks:b1:start', 'attendance_breaks:b1:end']);
  });

  it('an active break produces only the start event', () => {
    expect(fromBreak({ id: 'b2', employee_id: 'u1', break_type: 'AUTO_GPS', started_at: T('15:00'), ended_at: null, employee }).length).toBe(1);
  });

  it('geofence_events EXITED / ENTERED', () => {
    expect(fromGeofenceEvent({ id: 'g1', employee_id: 'u1', event_type: 'EXITED', occurred_at: T('12:00'), employee })!.message).toBe('Rahul Kumar left the office geofence');
    expect(fromGeofenceEvent({ id: 'g2', employee_id: 'u1', event_type: 'ENTERED', occurred_at: T('12:30'), employee })!.activityType).toBe('GEOFENCE_ENTER');
  });

  it('location_verification_events: denied / unavailable / low accuracy / location update; clock checks ignored', () => {
    expect(fromLocationEvent({ id: 'l1', employee_id: 'u1', verification_type: 'LOCATION_CHECK', result: 'LOCATION_DENIED', verified_at: T('10:05'), employee })!.activityType).toBe('GPS_PERMISSION_DENIED');
    expect(fromLocationEvent({ id: 'l2', employee_id: 'u1', verification_type: 'LOCATION_CHECK', result: 'LOW_ACCURACY', verified_at: T('10:06'), employee })!.message).toBe('Rahul Kumar GPS accuracy too low');
    expect(fromLocationEvent({ id: 'l3', employee_id: 'u1', verification_type: 'LOCATION_CHECK', result: 'INSIDE', verified_at: T('10:07'), employee })!.activityType).toBe('LOCATION_UPDATE');
    expect(fromLocationEvent({ id: 'l4', employee_id: 'u1', verification_type: 'CLOCK_IN', result: 'INSIDE', verified_at: T('10:00'), employee })).toBeNull();
  });
});

describe('feed merging', () => {
  const ev = (id: string, hhmm: string) => fromAttendanceEvent({ id, employee_id: 'u1', event_type: 'CLOCK_IN', event_at: T(hhmm), employee })!;
  const loc = (id: string, hhmm: string, emp = 'u1') => fromLocationEvent({ id, employee_id: emp, verification_type: 'LOCATION_CHECK', result: 'INSIDE', verified_at: T(hhmm), employee })!;
  const denied = (id: string, hhmm: string) => fromLocationEvent({ id, employee_id: 'u1', verification_type: 'LOCATION_CHECK', result: 'LOCATION_DENIED', verified_at: T(hhmm), employee })!;

  it('newest first', () => {
    expect(mergeLogs([], [ev('a', '09:00'), ev('b', '11:00'), ev('c', '10:00')]).map(l => l.id)).toEqual(['attendance_events:b', 'attendance_events:c', 'attendance_events:a']);
  });

  it('the same event from initial load and Realtime (or a reconnect) is shown once', () => {
    const first = mergeLogs([], [ev('a', '09:00')]);
    const again = mergeLogs(first, [ev('a', '09:00'), ev('a', '09:00')]);
    expect(again.length).toBe(1);
  });

  it('only the latest location update per employee is kept', () => {
    const merged = mergeLogs([], [loc('1', '10:00'), loc('2', '10:01'), loc('3', '10:02'), loc('4', '10:01', 'u2')]);
    expect(merged.filter(l => l.employeeId === 'u1').map(l => l.id)).toEqual(['location_verification_events:3']);
    expect(merged.length).toBe(2);
  });

  it('repeated identical GPS problems within 10 minutes are shown once', () => {
    const merged = mergeLogs([], [denied('1', '10:00'), denied('2', '10:01'), denied('3', '10:05'), denied('4', '10:15')]);
    expect(merged.map(l => l.id)).toEqual(['location_verification_events:4', 'location_verification_events:1']);
  });

  it('keeps at most MAX_LOGS entries', () => {
    const many = Array.from({ length: 150 }, (_, i) => fromAttendanceEvent({ id: `x${i}`, employee_id: `u${i}`, event_type: 'CLOCK_IN', event_at: new Date(Date.parse(T('09:00')) + i * 60000).toISOString(), employee })!);
    expect(mergeLogs([], many).length).toBe(MAX_LOGS);
  });

  it('times are shown in company time (IST), not UTC', () => {
    expect(formatActivityTime('2026-10-08T04:30:00Z')).toBe('10:00 AM');
  });
});

describe('panel filters', () => {
  const e = (id: string, emp: string, type: string, hhmm: string) => fromAttendanceEvent({ id, employee_id: emp, event_type: type, event_at: T(hhmm), employee })!;
  const g = fromGeofenceEvent({ id: 'gx', employee_id: 'u2', event_type: 'EXITED', occurred_at: T('12:00'), employee })!;
  const feed = mergeLogs([], [e('1', 'u1', 'CLOCK_IN', '09:00'), e('2', 'u2', 'CLOCK_IN', '09:30'), e('3', 'u1', 'CLOCK_OUT', '18:00'), g]);
  it('employee filter shows only that employee', () => {
    expect(filterLogs(feed, 'u1', 'All').map(l => l.id)).toEqual(['attendance_events:3', 'attendance_events:1']);
  });
  it('activity filter shows only that type', () => {
    expect(filterLogs(feed, 'All', 'CLOCK_IN').length).toBe(2);
    expect(filterLogs(feed, 'All', 'GEOFENCE_EXIT').map(l => l.id)).toEqual(['geofence_events:gx']);
  });
  it('both filters combine; All/All returns everything', () => {
    expect(filterLogs(feed, 'u2', 'GEOFENCE_EXIT').length).toBe(1);
    expect(filterLogs(feed, 'All', 'All').length).toBe(4);
  });
});
