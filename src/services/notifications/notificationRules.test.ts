import { describe, it, expect } from 'vitest';
import {
  leaveReviewed, wfhReviewed, permissionReviewed, payrollStatusChanged, salaryPaid, payslipAvailable,
  autoBreakStarted, autoBreakEnded, autoBreakClosedAtClockOut, geofenceTransition, shiftAssigned, shiftTimingChanged,
  profileChanged, changedProfileFields, passwordChanged, toNotificationItem, mergeNotificationRows, unreadCount,
  formatDay, formatClock, formatPeriod, NOTIFICATION_TYPES,
} from './notificationRules';

describe('formatting', () => {
  it('dates, times and periods', () => {
    expect(formatDay('2026-10-10')).toBe('10 Oct 2026');
    expect(formatClock('14:00:00')).toBe('2:00 PM');
    expect(formatClock('09:05')).toBe('9:05 AM');
    expect(formatPeriod(9, 2026)).toBe('September 2026');
  });
});

describe('request notifications (admin review)', () => {
  it('leave approved / rejected include date, type, status and remarks', () => {
    const a = leaveReviewed({ id: 'l1', status: 'APPROVED', startDate: '2026-10-10', endDate: '2026-10-10', leaveType: 'Casual' });
    expect(a.notification_type).toBe('LEAVE');
    expect(a.title).toBe('Leave Approved');
    expect(a.message).toBe('Your Casual leave request for 10 Oct 2026 has been approved.');
    const r = leaveReviewed({ id: 'l1', status: 'REJECTED', startDate: '2026-10-10', endDate: '2026-10-12', remarks: 'Busy week' });
    expect(r.message).toBe('Your leave request for 10 Oct 2026 to 12 Oct 2026 has been rejected. Remarks: Busy week');
    expect(r.dedupe_key).not.toBe(a.dedupe_key);
  });
  it('WFH approved / rejected', () => {
    expect(wfhReviewed({ id: 'w1', status: 'APPROVED', date: '2026-10-09' }).message).toBe('Your WFH request for 09 Oct 2026 has been approved.');
    expect(wfhReviewed({ id: 'w1', status: 'REJECTED', date: '2026-10-09' }).title).toBe('WFH Rejected');
  });
  it('permission includes the time window', () => {
    const p = permissionReviewed({ id: 'p1', status: 'APPROVED', date: '2026-10-08', start: '14:00:00', end: '16:00:00' });
    expect(p.message).toBe('Your permission request for 08 Oct 2026 from 2:00 PM to 4:00 PM has been approved.');
    expect(permissionReviewed({ id: 'p1', status: 'REJECTED', date: '2026-10-08' }).title).toBe('Permission Rejected');
  });
  it('cancellation by admin is announced too', () => {
    expect(leaveReviewed({ id: 'l2', status: 'CANCELLED', startDate: '2026-10-10' }).title).toBe('Leave Cancelled');
  });
});

describe('payroll / payslip', () => {
  it('approved and finalized are announced; internal steps are not', () => {
    expect(payrollStatusChanged({ id: 'p', status: 'APPROVED', month: 9, year: 2026 })?.message).toBe('Your payroll for September 2026 has been approved.');
    expect(payrollStatusChanged({ id: 'p', status: 'CLOSED', month: 9, year: 2026 })?.title).toBe('Payroll Finalized');
    expect(payrollStatusChanged({ id: 'p', status: 'UNDER_REVIEW', month: 9, year: 2026 })).toBe(null);
  });
  it('salary paid + payslip available, opening the right pages', () => {
    expect(salaryPaid({ id: 'p', month: 9, year: 2026 }).action_url).toBe('/employee/payroll');
    const ps = payslipAvailable({ payrollId: 'p', month: 9, year: 2026 });
    expect(ps.message).toBe('Your September 2026 payslip is now available.');
    expect(ps.action_url).toBe('/employee/payslip');
    expect(ps.dedupe_key).toBe('payslip:p'); // one payslip notification per payroll
  });
});

describe('automatic break / geofence', () => {
  it('start, end and clock-out messages', () => {
    expect(autoBreakStarted({ breakId: 'b' }).message).toBe('You have left the office geofence. Your working timer is paused.');
    expect(autoBreakEnded({ breakId: 'b', minutes: 30 }).title).toBe('Automatic Break Ended');
    expect(autoBreakClosedAtClockOut({ breakId: 'b', attendanceId: 'a' }).title).toBe('Attendance Closed');
  });
  it('one key per break per transition (jitter / tabs cannot repeat it)', () => {
    expect(autoBreakStarted({ breakId: 'b' }).dedupe_key).toBe('break:b:START');
    expect(autoBreakEnded({ breakId: 'b' }).dedupe_key).toBe('break:b:END');
    expect(geofenceTransition({ eventId: 'g', to: 'OUTSIDE' }).dedupe_key).toBe('geofence:g');
  });
});

describe('shift / profile / security', () => {
  it('shift assignment and timing', () => {
    expect(shiftAssigned({ assignmentId: 'a', shiftId: 's', shiftName: 'General Shift', start: '09:00:00', end: '18:00:00', effectiveDate: '2026-10-09' }).message)
      .toBe('Your shift has been updated to General Shift (9:00 AM – 6:00 PM) from 09 Oct 2026.');
    expect(shiftTimingChanged({ shiftId: 's', shiftName: 'General Shift', start: '10:00:00', end: '19:00:00' }).message)
      .toBe('General Shift timing has been updated to 10:00 AM – 7:00 PM.');
  });
  it('only real changes notify', () => {
    expect(changedProfileFields({ office_id: 'o1', department_id: 'd1' }, { office_id: 'o2', department_id: 'd1', phone: 'x' })).toEqual(['office']);
    expect(changedProfileFields({ office_id: 'o1' }, { office_id: 'o1' })).toEqual([]);
    expect(changedProfileFields(null, { office_id: 'o1' })).toEqual([]);
    expect(profileChanged({ employeeId: 'e', field: 'office', newValue: 'Whitee Lotus', newId: 'o2' }).message).toBe('Your office assignment has been updated to Whitee Lotus.');
    expect(profileChanged({ employeeId: 'e', field: 'role', newValue: 'HR', newId: 'r' }).notification_type).toBe('SECURITY');
  });
  it('password notification never contains the password', () => {
    const n = passwordChanged({ employeeId: 'e', atIso: '2026-10-08T10:00:00Z' });
    expect(n.notification_type).toBe('SECURITY');
    expect(/password was changed/.test(n.message)).toBe(true);
  });
  it('every builder uses a known type', () => {
    const all = [leaveReviewed({ id: 'x', status: 'APPROVED', startDate: '2026-10-10' }), payslipAvailable({ payrollId: 'x', month: 1, year: 2026 }), autoBreakStarted({ breakId: 'x' }), geofenceTransition({ eventId: 'x', to: 'INSIDE' }), passwordChanged({ employeeId: 'x', atIso: '2026-10-08T10:00:00Z' })];
    for (const n of all) expect((NOTIFICATION_TYPES as readonly string[]).includes(n.notification_type)).toBe(true);
  });
});

describe('employee UI list', () => {
  const now = Date.parse('2026-10-08T12:00:00+05:30');
  const row = (id: string, created: string, is_read = false) => ({ id, notification_type: 'LEAVE', title: 't', message: 'm', priority: 'NORMAL', is_read, action_url: '/employee/leave', created_at: created });
  it('maps rows to items with IST grouping', () => {
    expect(toNotificationItem(row('1', '2026-10-08T09:00:00+05:30'), now).date).toBe('Today');
    expect(toNotificationItem(row('2', '2026-10-05T09:00:00+05:30'), now).date).toBe('This Week');
    expect(toNotificationItem(row('3', '2026-09-01T09:00:00+05:30'), now).date).toBe('Earlier');
    const it1 = toNotificationItem(row('1', '2026-10-08T09:00:00+05:30'), now);
    expect(it1.category).toBe('Leave');
    expect(it1.read).toBe(false);
    expect(it1.actionRoute).toBe('/employee/leave');
  });
  it('realtime + refetch after reconnect never duplicates; newest first', () => {
    const a = row('a', '2026-10-08T09:00:00Z'), b = row('b', '2026-10-08T10:00:00Z');
    let list = mergeNotificationRows([], [a]);
    list = mergeNotificationRows(list, [b]);            // realtime INSERT
    list = mergeNotificationRows(list, [a, b]);         // refetch after reconnect / refresh
    expect(list.map(r => r.id)).toEqual(['b', 'a']);
    list = mergeNotificationRows(list, [{ ...a, is_read: true }]); // UPDATE (marked read)
    expect(unreadCount(list)).toBe(1);
  });
});

import { overtimeReviewed } from './notificationRules';
describe('overtime notifications', () => {
  it('approved message states the APPROVED hours, not the requested ones', () => {
    const n = overtimeReviewed({ id: 'o1', status: 'APPROVED', workDate: '2026-10-10', approvedHours: 1.5, requestedHours: 2 });
    expect(n.message).toBe('Your overtime request for 10 Oct 2026 has been approved for 1.5 hours (requested 2 hours).');
    expect(n.notification_type).toBe('OVERTIME');
    expect(n.dedupe_key).toBe('overtime:o1:APPROVED');
  });
  it('rejected message includes remarks', () => {
    expect(overtimeReviewed({ id: 'o1', status: 'REJECTED', workDate: '2026-10-10', remarks: 'Project work was not approved.' }).message)
      .toBe('Your overtime request for 10 Oct 2026 has been rejected. Remarks: Project work was not approved.');
  });
});
