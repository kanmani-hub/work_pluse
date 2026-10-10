import { describe, it, expect } from 'vitest';
import { departmentCards, officeCards, shiftCards } from './orgCardRules';
import { assignedEmployeesByShift, countAssignedEmployeesByShift } from '../shifts/shiftAssignmentRules';

const e = (id: string, status = 'ACTIVE') => ({ id, status, first_name: 'E', last_name: id, employee_code: 'C' + id });

describe('Departments cards', () => {
  const depts = [
    { id: 'd1', name: 'Ops', is_active: true, employees: [e('1'), e('2', 'INACTIVE')] },
    { id: 'd2', name: 'Old', is_active: false, employees: [e('3')] },
  ];
  it('counts reconcile with rows; employee rows carry the department name', () => {
    const c = departmentCards(depts, [e('9')]);
    expect(c.total.count).toBe(2); expect(c.active.count).toBe(1);
    expect(c.employees.count).toBe(3); expect(c.employees.rows.length).toBe(3);
    expect(c.employees.rows[0]).toMatchObject({ department: 'Ops', code: 'C1' });
    expect(c.total.rows[0]).toMatchObject({ department: 'Ops', status: 'Active', employees: 2 });
    expect(c.unassigned.count).toBe(1); expect(c.unassigned.rows[0].department).toBe('Unassigned');
  });
  it('empty input', () => {
    const c = departmentCards([], []);
    expect([c.total.count, c.employees.count, c.unassigned.count]).toEqual([0, 0, 0]);
  });
});

describe('Offices cards', () => {
  const offices = [
    { id: 'o1', name: 'HQ', status: 'Active', geofence: true, radius: 200, members: [e('1'), e('2')] },
    { id: 'o2', name: 'Branch', status: 'Inactive', geofence: false, radius: 200, members: [] },
  ];
  it('Employees Assigned equals the sum of member rows with the office name', () => {
    const c = officeCards(offices);
    expect(c.total.count).toBe(2); expect(c.active.count).toBe(1); expect(c.geofence.count).toBe(1);
    expect(c.employees.count).toBe(2); expect(c.employees.rows[1]).toMatchObject({ office: 'HQ', code: 'C2' });
    expect(c.geofence.rows[0].geofence).toBe('Enabled (200 m)');
  });
});

describe('Shifts cards', () => {
  const today = '2026-10-10';
  const employees = [e('1'), e('2'), e('3', 'INACTIVE')];
  const assignments = [
    { employee_id: '1', shift_template_id: 's1', effective_date: '2026-09-01', end_date: null },
    { employee_id: '2', shift_template_id: 's1', effective_date: '2026-09-01', end_date: '2026-09-30' }, // ended
    { employee_id: '2', shift_template_id: 's2', effective_date: '2026-10-01', end_date: null },
    { employee_id: '3', shift_template_id: 's1', effective_date: '2026-09-01', end_date: null }, // inactive
    { employee_id: '1', shift_template_id: 's2', effective_date: '2026-11-01', end_date: null }, // future
  ];
  it('assigned members follow the same rule as the counts', () => {
    const members = assignedEmployeesByShift(assignments, employees, today);
    const counts = countAssignedEmployeesByShift(assignments, employees, today);
    expect(Object.fromEntries(Object.entries(members).map(([k, v]) => [k, v.length]))).toEqual(counts);
    expect(members.s1.map(x => x.id)).toEqual(['1']);
  });
  it('cards reconcile; employees card is empty (not invented) when members failed to load', () => {
    const shifts = [
      { id: 's1', name: 'Morning', start: '09:00', end: '18:00', status: 'Active', overnight: false },
      { id: 's2', name: 'Night', start: '22:00', end: '06:00', status: 'Inactive', overnight: true },
    ];
    const c = shiftCards(shifts, assignedEmployeesByShift(assignments, employees, today));
    expect(c.total.count).toBe(2); expect(c.active.count).toBe(1); expect(c.overnight.count).toBe(1);
    expect(c.employees.count).toBe(2);
    expect(c.employees.rows.find(r => r.code === 'C2')).toMatchObject({ shift: 'Night', timing: '22:00 – 06:00' });
    expect(shiftCards(shifts, null).employees.count).toBe(0);
  });
});
