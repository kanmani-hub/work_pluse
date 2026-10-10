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

import { dashboardCardDetails } from './dashboardRules';

describe('dashboard card details: each list is exactly what its card counts (synthetic data)', () => {
  const today = '2026-10-12';
  const emp = (id: string, extra: any = {}) => ({ id, status: 'ACTIVE', role: { name: 'EMPLOYEE' }, first_name: 'Test', last_name: id, employee_code: id.toUpperCase(), departments: { name: 'D' }, office: { name: 'O' }, ...extra });
  const input = {
    employees: [emp('e1'), emp('e2'), emp('e3'), emp('a1', { role: { name: 'ADMIN' } })],
    attendance: [
      { employee_id: 'e1', clock_in_at: '2026-10-12T03:30:00Z', clock_out_at: null, status: 'WORKING' },
      { employee_id: 'e2', clock_in_at: '2026-10-12T03:30:00Z', clock_out_at: '2026-10-12T12:30:00Z', status: 'COMPLETED' },
      { employee_id: 'a1', clock_in_at: '2026-10-12T03:30:00Z', clock_out_at: null, status: 'WORKING' },
    ],
    leaves: [{ employee_id: 'e3', start_date: '2026-10-10', end_date: '2026-10-14', leave_types: { name: 'Casual Leave' } }, { employee_id: 'e3', start_date: '2026-10-12', end_date: '2026-10-12' }],
    approvedWfhToday: [],
    today,
  };
  const pending = {
    leave: [{ id: 1, start_date: '2026-10-20', end_date: '2026-10-21', status: 'PENDING', employees: emp('e1') }],
    wfh: [{ id: 2, request_date: '2026-10-13', status: 'PENDING', employees: emp('e2') }],
    permission: [{ id: 3, permission_date: '2026-10-13', start_time: '10:00:00', end_time: '11:00:00', status: 'PENDING', employees: emp('e3') }],
  };

  it('lengths equal the KPI counts', () => {
    const s = computeDashboardStats(input);
    const d = dashboardCardDetails(input, pending);
    expect(d.employees.length).toBe(s.employees);
    expect(d.working.length).toBe(s.working);
    expect(d.onLeave.length).toBe(s.onLeave);
    expect(d.pending.length).toBe(pending.leave.length + pending.wfh.length + pending.permission.length);
  });

  it('rows carry identity, times and links; admins are not part of the workforce lists', () => {
    const d = dashboardCardDetails(input, pending);
    expect(d.employees.map(r => r.code)).toEqual(['E1', 'E2', 'E3']);
    expect(d.working).toEqual([{ __key: 'e1', employee: 'Test e1', code: 'E1', department: 'D', office: 'O', clockIn: '09:00', status: 'WORKING', clockOut: 'Not clocked out yet' }]);
    expect(d.onLeave).toEqual([{ __key: 'e3', employee: 'Test e3', code: 'E3', department: 'D', office: 'O', leaveType: 'Casual Leave', from: '2026-10-10', to: '2026-10-14' }]);
    expect(d.pending.map(r => [r.type, r.code, r.date, r.module])).toEqual([
      ['Leave', 'E1', '2026-10-20 → 2026-10-21', '/admin/leave'],
      ['WFH', 'E2', '2026-10-13', '/admin/wfh'],
      ['Permission', 'E3', '2026-10-13 10:00–11:00', '/admin/permission'],
    ]);
  });

  it('empty day → empty lists', () => {
    const d = dashboardCardDetails({ ...input, attendance: [], leaves: [] }, { leave: [], wfh: [], permission: [] });
    expect([d.working.length, d.onLeave.length, d.pending.length]).toEqual([0, 0, 0]);
  });
});
