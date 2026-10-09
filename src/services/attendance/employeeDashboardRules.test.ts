import { describe, it, expect } from 'vitest';
import {
  greetingFor, formatShiftClock, formatCompanyTime, scheduledWorkMinutes, remainingScheduledMinutes,
  resolveWorkMode, deriveLocationDisplay, summarizeLeaveAndWfh, attendanceActionMessage, formatMinutes,
} from './employeeDashboardRules';

const NOW = Date.parse('2026-10-08T06:30:00Z'); // 12:00 IST

describe('greeting and time formatting (company time, Asia/Kolkata)', () => {
  it('greets by IST hour, not the browser zone', () => {
    expect(greetingFor(new Date('2026-10-08T03:00:00Z'))).toBe('Good Morning');   // 08:30 IST
    expect(greetingFor(new Date('2026-10-08T08:00:00Z'))).toBe('Good Afternoon'); // 13:30 IST
    expect(greetingFor(new Date('2026-10-08T14:00:00Z'))).toBe('Good Evening');   // 19:30 IST
  });
  it('formats shift clock times as 12-hour', () => {
    expect(formatShiftClock('10:00:00')).toBe('10:00 AM');
    expect(formatShiftClock('19:30:00')).toBe('07:30 PM');
    expect(formatShiftClock('00:15')).toBe('12:15 AM');
    expect(formatShiftClock(null)).toBe('—');
  });
  it('formats clock-in time in IST', () => {
    expect(formatCompanyTime('2026-10-08T04:30:00Z')).toBe('10:00 AM');
    expect(formatCompanyTime(null)).toBe('—');
  });
});

describe('scheduled hours (no assumptions, no overtime)', () => {
  it('uses required_hours when configured', () => {
    expect(scheduledWorkMinutes({ required_hours: 8, start_time: '09:00', end_time: '18:00' })).toBe(480);
  });
  it('falls back to the shift length, including overnight shifts', () => {
    expect(scheduledWorkMinutes({ start_time: '21:00:00', end_time: '05:00:00', crosses_midnight: true })).toBe(480);
    expect(scheduledWorkMinutes({ start_time: '10:00:00', end_time: '19:30:00' })).toBe(570);
  });
  it('returns null when there is no shift (never a default 8h)', () => {
    expect(scheduledWorkMinutes(null)).toBe(null);
  });
  it('remaining time never goes negative (extra time is not overtime)', () => {
    expect(remainingScheduledMinutes(3 * 3600, 480)).toBe(300);
    expect(remainingScheduledMinutes(10 * 3600, 480)).toBe(0);
    expect(remainingScheduledMinutes(3600, null)).toBe(null);
    expect(formatMinutes(570)).toBe('9h 30m');
  });
});

describe('work mode', () => {
  const today = '2026-10-08';
  it('is WFH only from attendance status or an approved WFH request for today', () => {
    expect(resolveWorkMode({ status: 'WFH' }, [], today)).toBe('WFH');
    expect(resolveWorkMode(null, [{ request_date: today, status: 'APPROVED' }], today)).toBe('WFH');
  });
  it('pending / other-day WFH does not change the mode', () => {
    expect(resolveWorkMode(null, [{ request_date: today, status: 'PENDING' }], today)).toBe('OFFICE');
    expect(resolveWorkMode(null, [{ request_date: '2026-10-09', status: 'APPROVED' }], today)).toBe('OFFICE');
  });
});

describe('GPS / geofence display', () => {
  const fresh = { location_status: 'OUTSIDE_GEOFENCE', last_seen_at: new Date(NOW - 2 * 60000).toISOString() };
  const stale = { location_status: 'OUTSIDE_GEOFENCE', last_seen_at: new Date(NOW - 40 * 60000).toISOString() };
  it('fresh readings show the stored geofence state', () => {
    expect(deriveLocationDisplay({ permission: 'granted', liveRow: fresh, nowMs: NOW, workMode: 'OFFICE' }).geofence).toBe('OUTSIDE GEOFENCE');
    expect(deriveLocationDisplay({ permission: 'granted', liveRow: { ...fresh, location_status: 'INSIDE_GEOFENCE' }, nowMs: NOW, workMode: 'OFFICE' }).geofence).toBe('IN OFFICE');
  });
  it('GPS failure / denied / stale is LOCATION UNKNOWN, never OUTSIDE', () => {
    const denied = deriveLocationDisplay({ permission: 'denied', liveRow: stale, nowMs: NOW, workMode: 'OFFICE' });
    expect(denied.gps).toBe('Location Permission Denied');
    expect(denied.geofence).toBe('LOCATION UNKNOWN');
    expect(deriveLocationDisplay({ permission: 'granted', liveRow: stale, nowMs: NOW, workMode: 'OFFICE' }).geofence).toBe('LOCATION UNKNOWN');
    expect(deriveLocationDisplay({ permission: 'unsupported', liveRow: null, nowMs: NOW, workMode: 'OFFICE' }).gps).toBe('GPS Unavailable');
    expect(deriveLocationDisplay({ permission: 'prompt', liveRow: null, nowMs: NOW, workMode: 'OFFICE' }).gps).toBe('Location Permission Required');
  });
  it('GPS failure never turns an office employee into WFH', () => {
    expect(deriveLocationDisplay({ permission: 'denied', liveRow: null, nowMs: NOW, workMode: 'OFFICE' }).geofence).toBe('LOCATION UNKNOWN');
  });
  it('approved WFH shows WFH, not a geofence verdict', () => {
    expect(deriveLocationDisplay({ permission: 'granted', liveRow: fresh, nowMs: NOW, workMode: 'WFH' }).geofence).toBe('WFH');
  });
});

describe('leave / WFH summary', () => {
  it('counts only the signed-in employee rows it is given', () => {
    const s = summarizeLeaveAndWfh({
      today: '2026-10-08',
      leaveRequests: [
        { start_date: '2026-10-08', end_date: '2026-10-08', status: 'APPROVED', is_half_day: true },
        { start_date: '2026-10-20', end_date: '2026-10-21', status: 'APPROVED' },
        { start_date: '2026-10-25', end_date: '2026-10-25', status: 'PENDING' },
      ],
      leaveBalances: [{ remaining_days: 4 }, { remaining_days: 2.5 }],
      wfhRequests: [{ request_date: '2026-10-08', status: 'REJECTED' }, { request_date: '2026-10-10', status: 'PENDING' }],
    });
    expect(s.onLeaveToday).toBe(true);
    expect(s.onHalfDayLeaveToday).toBe(true);
    expect(s.pendingLeave).toBe(1);
    expect(s.upcomingApprovedLeave).toBe(1);
    expect(s.leaveBalanceDays).toBe(6.5);
    expect(s.wfhToday).toBe('REJECTED');
    expect(s.pendingWfh).toBe(1);
  });
  it('no data means null balance, not zero', () => {
    expect(summarizeLeaveAndWfh({ today: 'x', leaveRequests: null, leaveBalances: [], wfhRequests: null }).leaveBalanceDays).toBe(null);
  });
});

describe('attendanceActionMessage', () => {
  it('passes through known attendance messages', () => {
    expect(attendanceActionMessage({ message: 'Attendance already exists for today.' }, 'in')).toBe('Attendance already exists for today.');
  });
  it('hides raw database errors', () => {
    const out = attendanceActionMessage({ message: 'duplicate key value violates unique constraint "attendance_pkey"' }, 'in');
    expect(out).toBe('Your clock in could not be saved. Please try again.');
    expect(attendanceActionMessage({ message: 'Unauthorized' }, 'out')).toBe('Your session has expired. Please sign in again.');
  });
});
