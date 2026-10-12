import { describe, it, expect } from 'vitest';
import {
  getScopeDates,
  resolveScopedAssignmentDates,
  isWeeklyOffDay,
  type AssignmentScope,
} from './monthlyRosterRules';
import type { RosterCell } from './rosterRules';

describe('monthlyRosterRules', () => {
  const morningCell: RosterCell = {
    dayType: 'WORK',
    shiftTemplateId: 'shift-morning',
    workMode: 'OFFICE',
  };

  const nightCell: RosterCell = {
    dayType: 'WORK',
    shiftTemplateId: 'shift-night',
    workMode: 'OFFICE',
  };

  const weekOffCell: RosterCell = {
    dayType: 'WEEK_OFF',
    shiftTemplateId: null,
    workMode: 'OFFICE',
  };

  describe('getScopeDates', () => {
    it('returns single date for scope = DATE', () => {
      const res = getScopeDates('2026-10-12', 'DATE');
      expect(res.start).toBe('2026-10-12');
      expect(res.end).toBe('2026-10-12');
      expect(res.dates).toEqual(['2026-10-12']);
    });

    it('returns exact Monday-to-Sunday week for scope = WEEK', () => {
      // 2026-10-12 is Monday, week ends Sunday 2026-10-18
      const res = getScopeDates('2026-10-12', 'WEEK');
      expect(res.start).toBe('2026-10-12');
      expect(res.end).toBe('2026-10-18');
      expect(res.dates).toHaveLength(7);
      expect(res.dates[0]).toBe('2026-10-12');
      expect(res.dates[6]).toBe('2026-10-18');
    });

    it('returns all days in month strictly within boundaries for scope = MONTH', () => {
      const res = getScopeDates('2026-10-12', 'MONTH');
      expect(res.start).toBe('2026-10-01');
      expect(res.end).toBe('2026-10-31');
      expect(res.dates).toHaveLength(31);
      expect(res.dates[0]).toBe('2026-10-01');
      expect(res.dates[30]).toBe('2026-10-31');
    });

    it('handles February leap year vs non-leap year boundaries', () => {
      // 2024 is leap year (29 days)
      const leap = getScopeDates('2024-02-15', 'MONTH');
      expect(leap.dates).toHaveLength(29);
      expect(leap.end).toBe('2024-02-29');

      // 2026 is non-leap year (28 days)
      const nonLeap = getScopeDates('2026-02-15', 'MONTH');
      expect(nonLeap.dates).toHaveLength(28);
      expect(nonLeap.end).toBe('2026-02-28');
    });

    it('handles year-boundary cases cleanly (Dec 31 and Jan 1)', () => {
      const dec = getScopeDates('2026-12-31', 'MONTH');
      expect(dec.start).toBe('2026-12-01');
      expect(dec.end).toBe('2026-12-31');
      expect(dec.dates).toHaveLength(31);

      const jan = getScopeDates('2027-01-01', 'MONTH');
      expect(jan.start).toBe('2027-01-01');
      expect(jan.end).toBe('2027-01-31');
      expect(jan.dates).toHaveLength(31);
    });
  });

  describe('isWeeklyOffDay', () => {
    it('detects Sunday as weekly off by default', () => {
      expect(isWeeklyOffDay('2026-10-18')).toBe(true); // Sunday
      expect(isWeeklyOffDay('2026-10-12')).toBe(false); // Monday
    });

    it('respects configured weekly off days (e.g. Saturday & Sunday)', () => {
      const off = ['Saturday', 'Sunday'];
      expect(isWeeklyOffDay('2026-10-17', off)).toBe(true); // Saturday
      expect(isWeeklyOffDay('2026-10-18', off)).toBe(true); // Sunday
      expect(isWeeklyOffDay('2026-10-19', off)).toBe(false); // Monday
    });
  });

  describe('resolveScopedAssignmentDates', () => {
    it('scope = DATE updates only the targeted date', () => {
      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-12',
        scope: 'DATE',
        cell: morningCell,
      });

      expect(res.datesToUpdate).toEqual(['2026-10-12']);
      expect(res.skippedDates).toHaveLength(0);
    });

    it('scope = WEEK updates applicable days in the week, preserving Sunday weekly off', () => {
      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-12',
        scope: 'WEEK',
        cell: morningCell,
        weeklyOffDays: ['Sunday'],
      });

      // Oct 12 (Mon) to Oct 17 (Sat) = 6 working days
      expect(res.datesToUpdate).toHaveLength(6);
      expect(res.datesToUpdate).toContain('2026-10-12');
      expect(res.datesToUpdate).toContain('2026-10-17');
      expect(res.datesToUpdate).not.toContain('2026-10-18'); // Sunday skipped

      expect(res.skippedDates).toContainEqual({ date: '2026-10-18', reason: 'WEEK_OFF' });
    });

    it('scope = MONTH updates working days consistently throughout October, preserving weekly offs', () => {
      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-12',
        scope: 'MONTH',
        cell: morningCell,
        weeklyOffDays: ['Sunday'],
      });

      // October 2026 has 31 days, with 4 Sundays (4, 11, 18, 25)
      // 31 - 4 = 27 working days
      expect(res.datesToUpdate).toHaveLength(27);
      expect(res.skippedDates).toHaveLength(4);
      expect(res.skippedDates.map(s => s.date)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);

      // Never touches September or November
      res.datesToUpdate.forEach(d => {
        expect(d.startsWith('2026-10-')).toBe(true);
      });
    });

    it('preserves public holidays during monthly assignment', () => {
      const holidays = ['2026-10-02']; // Gandhi Jayanti (Friday)
      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-12',
        scope: 'MONTH',
        cell: morningCell,
        weeklyOffDays: ['Sunday'],
        holidays,
      });

      expect(res.datesToUpdate).not.toContain('2026-10-02');
      expect(res.skippedDates).toContainEqual({ date: '2026-10-02', reason: 'HOLIDAY' });
    });

    it('preserves approved employee leaves during monthly assignment', () => {
      const approvedLeaves = [
        { start_date: '2026-10-14', end_date: '2026-10-15' },
      ];
      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-12',
        scope: 'MONTH',
        cell: morningCell,
        weeklyOffDays: ['Sunday'],
        approvedLeaves,
      });

      expect(res.datesToUpdate).not.toContain('2026-10-14');
      expect(res.datesToUpdate).not.toContain('2026-10-15');
      expect(res.skippedDates).toContainEqual({ date: '2026-10-14', reason: 'LEAVE' });
      expect(res.skippedDates).toContainEqual({ date: '2026-10-15', reason: 'LEAVE' });
    });

    it('preserves intentional date-specific shift exceptions when preserveExceptions is true', () => {
      // Oct 13 was intentionally assigned Night Shift earlier (base shift was general)
      const existingAssignments: Record<string, any> = {
        '2026-10-13': { shiftTemplateId: 'shift-night', is_exception: true },
      };

      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-01',
        scope: 'MONTH',
        cell: morningCell,
        weeklyOffDays: ['Sunday'],
        existingAssignments,
        preserveExceptions: true,
      });

      expect(res.datesToUpdate).not.toContain('2026-10-13');
      expect(res.skippedDates).toContainEqual({ date: '2026-10-13', reason: 'EXCEPTION' });
    });

    it('overwrites exceptions when preserveExceptions is explicitly false', () => {
      const existingAssignments: Record<string, any> = {
        '2026-10-13': { shiftTemplateId: 'shift-night', is_exception: true },
      };

      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-01',
        scope: 'MONTH',
        cell: morningCell,
        weeklyOffDays: ['Sunday'],
        existingAssignments,
        preserveExceptions: false,
      });

      expect(res.datesToUpdate).toContain('2026-10-13');
    });

    it('allows changing a single date without affecting any other date in the month', () => {
      // Single date update
      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-13',
        scope: 'DATE',
        cell: nightCell,
      });

      expect(res.datesToUpdate).toEqual(['2026-10-13']);
    });

    it('allows changing a single week without affecting dates outside that week', () => {
      const res = resolveScopedAssignmentDates({
        targetDate: '2026-10-14', // Wednesday in week Oct 12 - Oct 18
        scope: 'WEEK',
        cell: nightCell,
        weeklyOffDays: ['Sunday'],
      });

      expect(res.datesToUpdate).toEqual([
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        '2026-10-17',
      ]);
      // Days outside this week (e.g. Oct 19) are not included
      expect(res.datesToUpdate).not.toContain('2026-10-19');
      expect(res.datesToUpdate).not.toContain('2026-10-11');
    });
  });
});
