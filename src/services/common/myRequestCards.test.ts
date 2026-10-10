import { describe, it, expect } from 'vitest';
import { myWfhCards, myPermissionCards, hm, myLeaveBalanceDetail, myOvertimeCards } from './myRequestCards';

describe('Employee WFH cards', () => {
  const h = (id: string, rawDate: string, status: string, type = 'Full Day') => ({ id, rawDate, status, type, reason: 'r' });
  const history = [h('1', '2026-10-02', 'Approved'), h('2', '2026-10-09', 'Approved', 'Half Day'), h('3', '2026-10-20', 'Approved'), // future: not used yet
    h('4', '2026-09-20', 'Approved'), h('5', '2026-10-21', 'Pending'), h('6', '2026-10-03', 'Rejected')];
  const r = myWfhCards(history, '2026-10-10', 2);
  it('used counts approved days this month up to today (half day = 0.5) and lists them', () => {
    expect(r.used).toBe(1.5); expect(r.cards.used.rows.map(x => x.__key)).toEqual(['1', '2']);
    expect(r.remaining).toBe(0.5);
  });
  it('remaining never goes below 0', () => { expect(myWfhCards(history, '2026-10-10', 1).remaining).toBe(0); });
  it('status cards list all own requests by status', () => {
    expect([r.cards.pending.count, r.cards.approved.count, r.cards.rejected.count]).toEqual([1, 4, 1]);
  });
});

describe('Employee Permission cards', () => {
  const p = (id: string, rawDate: string, status: string, duration: string) => ({ id, rawDate, status, duration, start: '10:00 AM', end: '11:00 AM' });
  const history = [p('1', '2026-10-02', 'Approved', '1h 0m'), p('2', '2026-10-06', 'Approved', '0h 45m'), p('3', '2026-10-07', 'Pending', '2h 0m'), p('4', '2026-09-30', 'Approved', '3h 0m')];
  const r = myPermissionCards(history, '2026-10');
  it('used = approved minutes this month; rows reconcile', () => {
    expect(r.usedMinutes).toBe(105); expect(hm(r.usedMinutes)).toBe('1h 45m');
    expect(r.cards.used.rows.reduce((s, x) => s + x.minutes, 0)).toBe(105);
    expect(r.cards.pending.count).toBe(1); expect(r.cards.approved.count).toBe(2);
  });
  it('empty history', () => {
    const e = myPermissionCards([], '2026-10');
    expect([e.usedMinutes, e.cards.pending.count]).toEqual([0, 0]);
  });
});

describe('Employee leave balance card', () => {
  const history = [
    { id: '1', type: 'Casual Leave', typeCode: 'CL', rawFrom: '2026-10-02', rawTo: '2026-10-02', totalDays: 1, status: 'Approved' },
    { id: '2', type: 'Sick Leave', typeCode: 'SL', rawFrom: '2026-10-05', rawTo: '2026-10-06', totalDays: 2, status: 'Pending' },
  ];
  it('shows the stored figures and only requests of that leave type', () => {
    const d = myLeaveBalanceDetail({ id: 'b1', leave_types: { name: 'Sick Leave', code: 'SL' }, total_allowance: 12, used_days: 3, remaining_days: 9 }, history);
    expect(d).toMatchObject({ name: 'Sick Leave', allowance: 12, used: 3, remaining: 9, monthly: false });
    expect(d.rows.map(r => r.__key)).toEqual(['2']);
  });
  it('missing figures stay null (not invented)', () => {
    const d = myLeaveBalanceDetail({ id: 'virtual-cl', leave_types: { name: 'Casual Leave', code: 'CL' }, remaining_days: 1 }, history);
    expect(d.allowance).toBe(null); expect(d.monthly).toBe(true); expect(d.rows.length).toBe(1);
  });
});

describe('Employee overtime cards', () => {
  const day = (id: string, date: string, eligible: boolean, request: any, out = true) => ({
    attendance: { id, attendance_date: date, clock_in_at: `${date}T03:30:00Z`, clock_out_at: out ? `${date}T14:30:00Z` : null },
    shift: { name: 'General' }, estimate: { eligible, potentialHours: eligible ? 1.5 : 0 }, request,
  });
  const days = [
    day('a', '2026-10-01', true, { status: 'APPROVED', work_date: '2026-10-01', requested_overtime_hours: 1.5, approved_overtime_hours: 1 }),
    day('b', '2026-10-02', true, { status: 'PENDING', work_date: '2026-10-02', requested_overtime_hours: 1.5, approved_overtime_hours: null }),
    day('c', '2026-10-03', true, null),
    day('d', '2026-09-29', true, { status: 'APPROVED', work_date: '2026-09-29', requested_overtime_hours: 2, approved_overtime_hours: 2 }),
    day('e', '2026-10-04', false, null, false),
  ];
  const r = myOvertimeCards(days, '2026-10');
  it('approved hours = admin-approved hours this month only', () => {
    expect(r.approvedHours).toBe(1); expect(r.cards.approved.rows.map(x => x.__key)).toEqual(['a']);
  });
  it('pending and requestable days', () => {
    expect(r.cards.pending.count).toBe(1); expect(r.cards.requestable.rows.map(x => x.__key)).toEqual(['c']);
    expect(r.cards.pending.rows[0]).toMatchObject({ requested: 1.5, approved: null, status: 'PENDING' });
  });
});
