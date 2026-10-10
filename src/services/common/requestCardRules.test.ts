import { describe, it, expect } from 'vitest';
import { wfhCards, leaveCards, permissionCards, hoursLabel } from './requestCardRules';

const today = '2026-10-10';
// 10 Oct 2026 09:00 IST = 03:30Z; 9 Oct 2026 23:00 IST = 17:30Z on 9 Oct; 10 Oct 01:00 IST = 9 Oct 19:30Z
const T_TODAY = '2026-10-10T03:30:00Z', T_YDAY = '2026-10-09T17:30:00Z', T_EARLY_TODAY_IST = '2026-10-09T19:30:00Z';

describe('WFH cards', () => {
  const reqs = [
    { id: 1, employee: 'A', employeeId: 'E1', department: 'Ops', status: 'APPROVED', requestDate: today, reviewed_at: T_TODAY, conflicts: [] },
    { id: 2, employee: 'B', employeeId: 'E2', department: 'Ops', status: 'APPROVED', requestDate: '2026-10-12', reviewed_at: T_EARLY_TODAY_IST, conflicts: [] },
    { id: 3, employee: 'C', employeeId: 'E3', department: 'HR', status: 'PENDING', requestDate: today, conflicts: [] },
    { id: 4, employee: 'D', employeeId: 'E4', department: 'HR', status: 'REJECTED', requestDate: today, reviewed_at: T_YDAY, rejectReason: 'Busy', conflicts: [] },
  ];
  const c = wfhCards(reqs, today);
  it('counts reconcile with rows', () => {
    for (const k of Object.keys(c) as (keyof typeof c)[]) expect(c[k].count).toBe(c[k].rows.length);
    expect(c.total.count).toBe(4); expect(c.pending.count).toBe(1); expect(c.rejected.count).toBe(1);
  });
  it('Approved Today uses the IST review date (01:00 IST counts as today, 23:00 IST yesterday does not)', () => {
    expect(c.approvedToday.rows.map(r => r.__key)).toEqual([1, 2]);
  });
  it('Active WFH Today = approved and dated today; pending is not active', () => {
    expect(c.activeToday.rows.map(r => r.code)).toEqual(['E1']);
  });
  it('no invented policy alerts', () => { expect(c.alerts.count).toBe(0); });
  it('rows carry identity, status and dates', () => {
    expect(c.rejected.rows[0]).toMatchObject({ employee: 'D', code: 'E4', department: 'HR', date: today, status: 'REJECTED', reviewed: '2026-10-09', remarks: 'Busy' });
  });
});

describe('Leave cards', () => {
  const reqs = [
    { id: 1, name: 'A', empId: 'E1', dept: 'Ops', type: 'Casual', status: 'APPROVED', start_date: '2026-10-08', end_date: '2026-10-12', reviewed_at: T_YDAY },
    { id: 2, name: 'B', empId: 'E2', dept: 'Ops', type: 'Sick', status: 'APPROVED', start_date: '2026-10-10', end_date: '2026-10-10', halfDay: true, half: 'FIRST_HALF', reviewed_at: T_TODAY },
    { id: 3, name: 'C', empId: 'E3', dept: 'HR', type: 'Casual', status: 'PENDING', start_date: '2026-10-10', end_date: '2026-10-10' },
    { id: 4, name: 'D', empId: 'E4', dept: 'HR', type: 'Casual', status: 'APPROVED', start_date: '2026-11-06', end_date: '2026-11-10', reviewed_at: T_TODAY },
  ];
  const c = leaveCards(reqs, today);
  it('On Leave Today covers the middle of a range (old string match missed it) and ignores pending / future', () => {
    expect(c.onLeaveToday.rows.map(r => r.code)).toEqual(['E1', 'E2']);
  });
  it('Approved Today = reviewed today', () => { expect(c.approvedToday.rows.map(r => r.code)).toEqual(['E2', 'E4']); });
  it('half-day and totals reconcile', () => {
    expect(c.halfDay.count).toBe(1); expect(c.halfDay.rows[0].halfDay).toBe('FIRST_HALF');
    for (const k of Object.keys(c) as (keyof typeof c)[]) expect(c[k].count).toBe(c[k].rows.length);
    expect(c.alerts.count).toBe(0);
  });
});

describe('Permission cards', () => {
  const reqs = [
    { id: 1, name: 'A', empId: 'E1', dept: 'Ops', status: 'APPROVED', dateISO: today, minutes: 90, reviewed_at: T_TODAY },
    { id: 2, name: 'B', empId: 'E2', dept: 'Ops', status: 'APPROVED', dateISO: '2026-10-01', minutes: 45, reviewed_at: T_YDAY },
    { id: 3, name: 'C', empId: 'E3', dept: 'HR', status: 'PENDING', dateISO: today, minutes: 60 },
    { id: 4, name: 'D', empId: 'E4', dept: 'HR', status: 'APPROVED', dateISO: today, minutes: null },
  ];
  const c = permissionCards(reqs, today);
  it('Total Hours = sum of the approved rows listed (pending excluded, missing minutes add 0)', () => {
    expect(c.totalHours.count).toBe(3);
    expect(c.approvedMinutes).toBe(135); expect(hoursLabel(c.approvedMinutes)).toBe('2h 15m');
  });
  it('Active today / approved today / no invented limit alerts', () => {
    expect(c.activeToday.rows.map(r => r.code)).toEqual(['E1', 'E4']);
    expect(c.approvedToday.rows.map(r => r.code)).toEqual(['E1']);
    expect(c.alerts.count).toBe(0); expect(c.pending.count).toBe(1);
  });
  it('empty input', () => {
    const e = permissionCards([], today);
    expect([e.total.count, e.approvedMinutes]).toEqual([0, 0]);
  });
});
