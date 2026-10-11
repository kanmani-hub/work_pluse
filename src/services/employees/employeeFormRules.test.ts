import { describe, it, expect } from 'vitest';
import { normalizeEmployeeStatus, isInactiveEmployee, salaryNeedsUpdate, assignShiftDefaults, assignOfficeDefaults } from './employeeFormRules';

describe('Employee status', () => {
  it('older "Inactive" rows count as INACTIVE; ACTIVE unchanged', () => {
    expect(normalizeEmployeeStatus('Inactive')).toBe('INACTIVE');
    expect(isInactiveEmployee('Inactive')).toBe(true);
    expect(isInactiveEmployee('INACTIVE')).toBe(true);
    expect(isInactiveEmployee('ACTIVE')).toBe(false);
    expect(normalizeEmployeeStatus(null)).toBe('');
  });
});

describe('Salary is only re-saved when it changes', () => {
  it('unchanged salary → no new salary record', () => {
    expect(salaryNeedsUpdate(50000, '50000')).toBe(false);
    expect(salaryNeedsUpdate(50000, 50000)).toBe(false);
  });
  it('changed or first salary → saved', () => {
    expect(salaryNeedsUpdate(50000, '52000')).toBe(true);
    expect(salaryNeedsUpdate(null, '30000')).toBe(true);
  });
  it('empty or invalid entries are never saved', () => {
    expect(salaryNeedsUpdate(50000, '')).toBe(false);
    expect(salaryNeedsUpdate(50000, undefined)).toBe(false);
    expect(salaryNeedsUpdate(null, 'abc')).toBe(false);
    expect(salaryNeedsUpdate(null, '-5')).toBe(false);
  });
});

describe('Assign windows start fresh', () => {
  it('shift: no shift pre-selected; effective date is the India date (not UTC)', () => {
    // 9 Oct 2026 20:00 UTC = 10 Oct 01:30 IST
    expect(assignShiftDefaults(new Date('2026-10-09T20:00:00Z'))).toEqual({ shift_id: '', effective_date: '2026-10-10' });
  });
  it("office: the employee's own office, never another employee's", () => {
    expect(assignOfficeDefaults({ office_id: 'o2' })).toEqual({ office_id: 'o2' });
    expect(assignOfficeDefaults({ office_id: null })).toEqual({ office_id: '' });
  });
});
