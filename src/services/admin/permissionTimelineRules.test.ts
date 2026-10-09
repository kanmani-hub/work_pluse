import { describe, it, expect } from 'vitest';
import { shiftDateStr, permissionsOnDate, formatCompanyDateLabel } from './permissionTimelineRules';

describe('permission timeline date helpers', () => {
  it('moves by whole days across month ends', () => {
    expect(shiftDateStr('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDateStr('2026-10-31', 1)).toBe('2026-11-01');
  });
  it('labels the selected date (not a fixed date)', () => {
    expect(formatCompanyDateLabel('2026-10-09')).toBe('09 Oct 2026');
  });
  it('lists only requests on the selected date, ordered by start time', () => {
    const reqs = [
      { id: '1', dateISO: '2026-10-09', startRaw: '15:00:00' },
      { id: '2', dateISO: '2026-10-08', startRaw: '09:00:00' },
      { id: '3', dateISO: '2026-10-09', startRaw: '10:30:00' },
    ];
    expect(permissionsOnDate(reqs, '2026-10-09').map(r => r.id)).toEqual(['3', '1']);
    expect(permissionsOnDate(reqs, '2026-10-10')).toEqual([]);
  });
});
