import { describe, it, expect } from 'vitest';
import { countAssignedEmployeesByShift, currentShiftByEmployee, resolveEmployeeShiftForDate } from './shiftAssignmentRules';

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

describe('resolveEmployeeShiftForDate (Roster vs Permanent Resolution)', () => {
  const empHemanth = 'emp-016';
  const empOther = 'emp-999';

  const generalShift = { id: 'shift-gen', name: 'General', start_time: '09:00', end_time: '18:00' };
  const morningShift = { id: 'shift-morn', name: 'Morning', start_time: '06:00', end_time: '14:00' };
  const nightShift = { id: 'shift-night', name: 'Night', start_time: '22:00', end_time: '06:00' };

  it('resolves published roster assignment for Monday 12th and Tuesday 13th', () => {
    const rosterAssignments = [
      {
        id: 'ra-12',
        employee_id: empHemanth,
        assignment_date: '2026-10-12',
        day_type: 'WORK',
        work_mode: 'OFFICE',
        shift_templates: morningShift,
        rosters: { status: 'PUBLISHED' },
      },
      {
        id: 'ra-13',
        employee_id: empHemanth,
        assignment_date: '2026-10-13',
        day_type: 'WORK',
        work_mode: 'WFH',
        shift_templates: generalShift,
        rosters: { status: 'PUBLISHED' },
      },
    ];

    const res12 = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments,
      defaultAssignments: [],
    });
    expect(res12.source).toBe('ROSTER');
    expect(res12.isWeekOff).toBe(false);
    expect(res12.shift?.id).toBe('shift-morn');
    expect(res12.workMode).toBe('OFFICE');
    expect(res12.rosterAssignmentId).toBe('ra-12');

    const res13 = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-13',
      rosterAssignments,
      defaultAssignments: [],
    });
    expect(res13.source).toBe('ROSTER');
    expect(res13.isWeekOff).toBe(false);
    expect(res13.shift?.id).toBe('shift-gen');
    expect(res13.workMode).toBe('WFH');
    expect(res13.rosterAssignmentId).toBe('ra-13');
  });

  it('DRAFT roster assignment does NOT take effect and falls back to permanent shift', () => {
    const rosterAssignments = [
      {
        id: 'ra-draft',
        employee_id: empHemanth,
        assignment_date: '2026-10-12',
        day_type: 'WORK',
        shift_templates: nightShift,
        rosters: { status: 'DRAFT' },
      },
    ];
    const defaultAssignments = [
      {
        id: 'sa-perm',
        employee_id: empHemanth,
        effective_date: '2026-09-01',
        end_date: null,
        shift_templates: generalShift,
      },
    ];

    const result = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments,
      defaultAssignments,
    });

    expect(result.source).toBe('PERMANENT');
    expect(result.shift?.id).toBe('shift-gen');
    expect(result.isWeekOff).toBe(false);
  });

  it('DRAFT roster with no permanent shift returns source: NONE', () => {
    const rosterAssignments = [
      {
        id: 'ra-draft',
        employee_id: empHemanth,
        assignment_date: '2026-10-12',
        day_type: 'WORK',
        shift_templates: nightShift,
        rosters: { status: 'DRAFT' },
      },
    ];

    const result = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments,
      defaultAssignments: [],
    });

    expect(result.source).toBe('NONE');
    expect(result.shift).toBeNull();
    expect(result.isWeekOff).toBe(false);
  });

  it('published roster overrides permanent shift', () => {
    const rosterAssignments = [
      {
        id: 'ra-pub',
        employee_id: empHemanth,
        assignment_date: '2026-10-12',
        day_type: 'WORK',
        shift_templates: morningShift,
        rosters: { status: 'PUBLISHED' },
      },
    ];
    const defaultAssignments = [
      {
        id: 'sa-perm',
        employee_id: empHemanth,
        effective_date: '2026-01-01',
        end_date: null,
        shift_templates: generalShift,
      },
    ];

    const result = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments,
      defaultAssignments,
    });

    expect(result.source).toBe('ROSTER');
    expect(result.shift?.id).toBe('shift-morn');
  });

  it('published WEEK_OFF roster returns isWeekOff: true and shift: null even if permanent shift exists', () => {
    const rosterAssignments = [
      {
        id: 'ra-off',
        employee_id: empHemanth,
        assignment_date: '2026-10-12',
        day_type: 'WEEK_OFF',
        shift_templates: null,
        rosters: { status: 'PUBLISHED' },
      },
    ];
    const defaultAssignments = [
      {
        id: 'sa-perm',
        employee_id: empHemanth,
        effective_date: '2026-01-01',
        end_date: null,
        shift_templates: generalShift,
      },
    ];

    const result = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments,
      defaultAssignments,
    });

    expect(result.source).toBe('ROSTER');
    expect(result.isWeekOff).toBe(true);
    expect(result.shift).toBeNull();
  });

  it('maintains employee isolation: assignment for employee A does not affect employee B', () => {
    const rosterAssignments = [
      {
        id: 'ra-other',
        employee_id: empOther,
        assignment_date: '2026-10-12',
        day_type: 'WORK',
        shift_templates: morningShift,
        rosters: { status: 'PUBLISHED' },
      },
    ];

    const result = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments,
      defaultAssignments: [],
    });

    expect(result.source).toBe('NONE');
    expect(result.shift).toBeNull();
  });

  it('ignores permanent shift that ended before the target date', () => {
    const defaultAssignments = [
      {
        id: 'sa-old',
        employee_id: empHemanth,
        effective_date: '2026-08-01',
        end_date: '2026-09-30', // ended before 2026-10-12
        shift_templates: generalShift,
      },
    ];

    const result = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments: [],
      defaultAssignments,
    });

    expect(result.source).toBe('NONE');
    expect(result.shift).toBeNull();
  });

  it('ignores future permanent shift not yet effective', () => {
    const defaultAssignments = [
      {
        id: 'sa-future',
        employee_id: empHemanth,
        effective_date: '2026-11-01', // future
        end_date: null,
        shift_templates: generalShift,
      },
    ];

    const result = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments: [],
      defaultAssignments,
    });

    expect(result.source).toBe('NONE');
    expect(result.shift).toBeNull();
  });

  it('handles null, empty, or undefined input gracefully', () => {
    const result = resolveEmployeeShiftForDate({
      employeeId: empHemanth,
      date: '2026-10-12',
      rosterAssignments: null,
      defaultAssignments: undefined,
    });

    expect(result.source).toBe('NONE');
    expect(result.shift).toBeNull();
    expect(result.isWeekOff).toBe(false);
  });
});
