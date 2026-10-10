import { describe, it, expect } from 'vitest';
import { employeeCards } from './employeeCardRules';

const today = '2026-10-10';
const emp = (id: string, status = 'ACTIVE') => ({ id, status, first_name: 'Emp', last_name: id, employee_code: 'C-' + id, department: { name: 'Ops' }, office: { name: 'HQ' } });
const employees = [emp('a'), emp('b'), emp('c', 'INACTIVE'), emp('d')];

describe('Admin Employees summary cards', () => {
  it('Total / Active / Inactive counts equal their detail rows and carry identity fields', () => {
    const c = employeeCards(employees, [], [], today);
    expect(c.total.count).toBe(4); expect(c.total.rows.length).toBe(4);
    expect(c.active.count).toBe(3); expect(c.active.rows.map(r => r.code)).toEqual(['C-a', 'C-b', 'C-d']);
    expect(c.inactive.count).toBe(1); expect(c.inactive.rows[0].employee).toBe('Emp c');
    expect(c.total.rows[0]).toMatchObject({ department: 'Ops', office: 'HQ', status: 'ACTIVE' });
  });

  it('On Leave counts approved leave covering today once per employee (no hardcoded 0)', () => {
    const leaves = [
      { employee_id: 'a', start_date: '2026-10-09', end_date: '2026-10-11', leave_types: { name: 'Casual' } },
      { employee_id: 'a', start_date: '2026-10-10', end_date: '2026-10-10' },
      { employee_id: 'b', start_date: '2026-10-12', end_date: '2026-10-13' }, // future
      { employee_id: 'zz', start_date: '2026-10-10', end_date: '2026-10-10' }, // not visible in directory
    ];
    const c = employeeCards(employees, leaves, [], today);
    expect(c.onLeave.count).toBe(1);
    expect(c.onLeave.rows[0]).toMatchObject({ code: 'C-a', leaveType: 'Casual', from: '2026-10-09', to: '2026-10-11' });
  });

  it('WFH Today counts approved WFH dated today only', () => {
    const wfh = [{ employee_id: 'b', request_date: today }, { employee_id: 'b', request_date: today }, { employee_id: 'd', request_date: '2026-10-09' }];
    const c = employeeCards(employees, [], wfh, today);
    expect(c.wfhToday.count).toBe(1); expect(c.wfhToday.rows[0].date).toBe(today);
  });

  it('empty inputs give empty cards', () => {
    const c = employeeCards([], [], [], today);
    expect([c.total.count, c.active.count, c.onLeave.count, c.wfhToday.count]).toEqual([0, 0, 0, 0]);
  });
});
