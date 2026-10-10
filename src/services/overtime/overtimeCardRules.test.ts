import { describe, it, expect } from 'vitest';
import { overtimeCards } from './overtimeCardRules';

const r = (id: string, status: string, work_date: string, requested: number, eligible: number, approved: number | null) => ({
  id, status, work_date, requested_overtime_hours: requested, eligible_overtime_hours: eligible, approved_overtime_hours: approved,
  employee: { first_name: 'E', last_name: id, employee_code: 'C' + id }, shift: { name: 'General', start_time: '09:00:00', end_time: '18:00:00' },
});

describe('Admin Overtime cards', () => {
  const rows = [
    r('1', 'APPROVED', '2026-10-03', 3, 2.5, 2), r('2', 'APPROVED', '2026-10-07', 1.5, 1.5, 1.25),
    r('3', 'APPROVED', '2026-09-30', 4, 4, 4), // previous month
    r('4', 'PENDING', '2026-09-29', 2, 2, null), r('5', 'REJECTED', '2026-10-08', 1, 1, null), r('6', 'REJECTED', '2026-09-08', 1, 1, null),
  ];
  const c = overtimeCards(rows, '2026-10');
  it('approved hours = sum of approved (not requested/eligible) hours in the month; rows reconcile', () => {
    expect(c.approved.count).toBe(2); expect(c.approved.hours).toBe(3.25);
    expect(c.approved.rows.reduce((s, x) => s + Number(x.approved), 0)).toBe(3.25);
  });
  it('pending includes every pending request; rejected is month-scoped', () => {
    expect(c.pending.rows.map(x => x.code)).toEqual(['C4']); expect(c.pending.hours).toBe(0);
    expect(c.rejected.rows.map(x => x.code)).toEqual(['C5']);
  });
  it('rows carry shift and the three hour figures separately', () => {
    expect(c.approved.rows[0]).toMatchObject({ workDate: '2026-10-03', shift: 'General (09:00 – 18:00)', requested: 3, eligible: 2.5, approved: 2 });
    expect(c.pending.rows[0].approved).toBe(null);
  });
});
