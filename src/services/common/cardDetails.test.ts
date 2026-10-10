import { describe, it, expect } from 'vitest';
import { filterRecords, employeeFields, istTime, elapsedMinutes, formatDuration, cardKeyHandler, clickableCardProps } from './cardDetails';

describe('shared card-detail helpers (synthetic data)', () => {
  it('search is case-insensitive across the chosen keys; empty search returns all rows', () => {
    const rows = [{ employee: 'Test One', code: 'EMP001' }, { employee: 'Test Two', code: 'EMP002' }];
    expect(filterRecords(rows, '', ['employee'])).toEqual(rows);
    expect(filterRecords(rows, 'two', ['employee', 'code'])).toEqual([rows[1]]);
    expect(filterRecords(rows, 'emp001', ['employee', 'code'])).toEqual([rows[0]]);
    expect(filterRecords(rows, 'emp001', ['employee'])).toEqual([]);
  });

  it('employee fields from the different row shapes used by the app', () => {
    expect(employeeFields({ first_name: 'Test', last_name: 'One', employee_code: 'EMP001', departments: { name: 'D' }, office: { name: 'O' } }))
      .toEqual({ employee: 'Test One', code: 'EMP001', department: 'D', office: 'O' });
    expect(employeeFields({ name: 'Test Two', empId: 'EMP002', dept: 'D2', office: 'O2' })).toEqual({ employee: 'Test Two', code: 'EMP002', department: 'D2', office: 'O2' });
    expect(employeeFields(null)).toEqual({ employee: '—', code: '—', department: '—', office: '—' });
  });

  it('missing clock-out never produces working hours', () => {
    expect(elapsedMinutes('2026-10-12T03:30:00Z', null)).toBeNull();
    expect(elapsedMinutes(null, '2026-10-12T12:30:00Z')).toBeNull();
    expect(elapsedMinutes('2026-10-12T03:30:00Z', '2026-10-12T12:30:00Z')).toBe(540);
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(545)).toBe('9h 05m');
  });

  it('times in IST', () => {
    expect(istTime('2026-10-12T03:30:00Z')).toBe('09:00');
    expect(istTime(undefined)).toBe('—');
  });

  it('cards activate with Enter and Space only, and are exposed as buttons', () => {
    let n = 0; const prevented: string[] = [];
    const h = cardKeyHandler(() => n++);
    for (const key of ['Enter', ' ', 'Tab', 'a', 'Escape']) h({ key, preventDefault: () => prevented.push(key) });
    expect(n).toBe(2);
    expect(prevented).toEqual(['Enter', ' ']);
    const p = clickableCardProps('Present', () => n++);
    expect([p.role, p.tabIndex, p['aria-label']]).toEqual(['button', 0, 'Present — show details']);
    p.onClick(); expect(n).toBe(3);
  });
});
