import { describe, it, expect } from 'vitest';
import { myAttendanceCards } from './employeeAttendanceCards';

const row = (id: string, rawDate: string, extra: any = {}) => ({ id, rawDate, shift: 'General', mode: 'OFFICE', in: '09:05 AM', out: '06:00 PM', hours: '8h 30m', status: 'COMPLETED', originalStatus: 'COMPLETED', lateMin: 0, clock_in_at: `${rawDate}T03:35:00Z`, clock_out_at: `${rawDate}T12:30:00Z`, ...extra });

describe('Employee My Attendance cards', () => {
  const history = [
    row('1', '2026-10-01', { lateMin: 10, status: 'LATE' }),
    row('2', '2026-10-02', { is_half_day: true, hours: '4h 15m' }),
    row('3', '2026-10-05', { mode: 'WFH', lateMin: 5, status: 'LATE' }),
    row('4', '2026-10-06', { status: 'WORKING', originalStatus: 'WORKING', clock_out_at: null, out: '--:--', hours: '--:--' }), // open day
    row('5', '2026-10-07', { status: 'LEAVE', originalStatus: 'LEAVE', clock_in_at: null, clock_out_at: null, in: '--:--', out: '--:--', hours: '--:--' }),
    row('6', '2026-09-30', { lateMin: 30 }), // other month
  ];
  const r = myAttendanceCards(history, '2026-10');
  it('month filter and counts reconcile with rows', () => {
    for (const c of Object.values(r.cards)) expect(c.count).toBe(c.rows.length);
    expect(r.cards.workingDays.count).toBe(5);
    expect(r.cards.present.count).toBe(4); expect(r.cards.late.count).toBe(2);
    expect(r.totalLateMinutes).toBe(15); expect(r.cards.halfDay.count).toBe(1);
    expect(r.cards.leave.count).toBe(1); expect(r.cards.wfh.count).toBe(1);
  });
  it('WFH card has a real count (was blank before)', () => { expect(r.cards.wfh.rows[0].date).toBe('2026-10-05'); });
  it('total hours never includes a day without clock-out', () => {
    expect(r.totalMinutes).toBe(8 * 60 + 30 + 4 * 60 + 15 + 8 * 60 + 30);
    expect(r.totalHoursLabel).toBe('21h 15m');
    expect(r.cards.totalHours.rows.map(x => x.__key)).toEqual(['1', '2', '3']);
    const open = r.cards.workingDays.rows.find(x => x.__key === '4')!;
    expect(open).toMatchObject({ clockOut: 'Not clocked out', hours: 'Not calculated (no clock-out)' });
  });
});
