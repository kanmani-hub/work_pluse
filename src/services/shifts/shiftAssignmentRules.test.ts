import { describe, it, expect } from 'vitest';
import { countAssignedEmployeesByShift, currentShiftByEmployee } from './shiftAssignmentRules';

const today = '2026-10-09';
const A = (employee_id: string, shift_template_id: string, effective_date: string, end_date: string | null = null) => ({ employee_id, shift_template_id, effective_date, end_date });

describe('Employees Assigned per shift (current assignment rule)', () => {
  it('counts each active employee once, by their latest current assignment', () => {
    const assignments = [
      A('e1', 'GEN', '2026-09-01'), A('e1', 'NIGHT', '2026-10-01'), // e1 moved to NIGHT
      A('e2', 'GEN', '2026-09-15'),
      A('e3', 'GEN', '2026-09-01', '2026-09-30'),                   // ended
      A('e4', 'GEN', '2026-10-20'),                                  // future
      A('e5', 'GEN', '2026-09-01'),                                  // inactive employee
      A('e6', 'GEN', '2026-10-01', today),                           // ends today → still current
    ];
    const employees = ['e1', 'e2', 'e3', 'e4', 'e6'].map(id => ({ id, status: 'ACTIVE' })).concat([{ id: 'e5', status: 'INACTIVE' }]);
    expect(countAssignedEmployeesByShift(assignments, employees, today)).toEqual({ NIGHT: 1, GEN: 2 });
  });
  it('a shift with no current assignments has no entry (shown as 0)', () => {
    expect(countAssignedEmployeesByShift([], [{ id: 'e1', status: 'ACTIVE' }], today)).toEqual({});
  });
  it('ignores malformed rows', () => {
    expect(currentShiftByEmployee([{ employee_id: 'e1' }, null as any], today).size).toBe(0);
  });
});
