import { describe, it, expect } from 'vitest';
import { addHoliday, removeHoliday } from './holidayRules';

describe('public holiday list (Settings)', () => {
  it('adds a holiday and keeps the list sorted by date', () => {
    const a = addHoliday([{ date: '2026-12-25', name: 'Year-end' }], '2026-11-02', ' Synthetic Holiday ');
    expect(a).toEqual({ list: [{ date: '2026-11-02', name: 'Synthetic Holiday' }, { date: '2026-12-25', name: 'Year-end' }], error: null });
  });

  it('rejects an invalid date, an empty name and a duplicate date', () => {
    expect(addHoliday([], '', 'X').error).toBe('Choose a valid holiday date.');
    expect(addHoliday([], '2026-11-02', '  ').error).toBe('Enter the holiday name.');
    expect(addHoliday([{ date: '2026-11-02', name: 'A' }], '2026-11-02', 'B')).toEqual({ list: [{ date: '2026-11-02', name: 'A' }], error: 'That date is already in the holiday list.' });
  });

  it('removes a holiday by date and tolerates a missing list', () => {
    expect(removeHoliday([{ date: '2026-11-02', name: 'A' }, { date: '2026-12-25', name: 'B' }], '2026-11-02')).toEqual([{ date: '2026-12-25', name: 'B' }]);
    expect(addHoliday(undefined, '2026-11-02', 'A').list).toEqual([{ date: '2026-11-02', name: 'A' }]);
    expect(removeHoliday(undefined, '2026-11-02')).toEqual([]);
  });
});
