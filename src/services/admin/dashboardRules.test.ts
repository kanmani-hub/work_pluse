import { describe, it, expect } from 'vitest';
import { computeDashboardStats } from './dashboardRules';

const today = '2026-10-09';
const emp = (id: string, role = 'EMPLOYEE', extra: any = {}) => ({ id, status: 'ACTIVE', role: { name: role }, employment_type: null, office_id: 'o1', ...extra });

describe('Admin Dashboard stats (same eligibility as Attendance / Reports)', () => {
  const employees = [emp('adm', 'ADMIN'), ...Array.from({ length: 14 }, (_, i) => emp('e' + i))];

  it('excludes ADMIN accounts from the employee count (15 active → 14 workforce)', () => {
    const s = computeDashboardStats({ employees, attendance: [], leaves: [], approvedWfhToday: [], today });
    expect(s.employees).toBe(14);
  });

  it('On Leave = approved leave covering today, not pending requests or future leave', () => {
    const leaves = [
      { employee_id: 'e1', start_date: '2026-10-08', end_date: '2026-10-10' }, // covers today
      { employee_id: 'e1', start_date: '2026-10-09', end_date: '2026-10-09' }, // same employee twice → once
      { employee_id: 'e2', start_date: '2026-11-06', end_date: '2026-11-10' }, // future (like the pending Diwali leave)
      { employee_id: 'adm', start_date: '2026-10-09', end_date: '2026-10-09' }, // admin not in workforce
    ];
    const s = computeDashboardStats({ employees, attendance: [], leaves, approvedWfhToday: [], today });
    expect(s.onLeave).toBe(1);
  });

  it('attendance rate = present (clock-in) / workforce: 5 of 14 → 36%', () => {
    const attendance: any[] = ['e0', 'e1', 'e2', 'e3', 'e4'].map(id => ({ employee_id: id, clock_in_at: 'x' as string | null, clock_out_at: null }))
      .concat([{ employee_id: 'adm', clock_in_at: 'x', clock_out_at: null }, { employee_id: 'e5', clock_in_at: null, clock_out_at: null }]);
    const s = computeDashboardStats({ employees, attendance, leaves: [], approvedWfhToday: [], today });
    expect(s.present).toBe(5);
    expect(s.working).toBe(5);
    expect(s.attendanceRate).toBe(36); // was 33% (5 / 15 including the admin)
  });

  it('working excludes clocked-out; inactive employees are not counted', () => {
    const s = computeDashboardStats({
      employees: [emp('a'), emp('b'), emp('x', 'EMPLOYEE', { status: 'INACTIVE' })],
      attendance: [{ employee_id: 'a', clock_in_at: 'x', clock_out_at: 'y' }, { employee_id: 'b', clock_in_at: 'x', clock_out_at: null }],
      leaves: [], approvedWfhToday: [{ employee_id: 'b' }], today,
    });
    expect(s.employees).toBe(2);
    expect(s.present).toBe(2);
    expect(s.working).toBe(1);
    expect(s.activeWfh).toBe(1);
    expect(s.onsite).toBe(1);
  });

  it('no workforce → rate null (no division by zero)', () => {
    expect(computeDashboardStats({ employees: [emp('adm', 'ADMIN')], attendance: [], leaves: [], approvedWfhToday: [], today }).attendanceRate).toBeNull();
  });
});
