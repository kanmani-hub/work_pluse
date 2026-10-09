import { describe, it, expect } from 'vitest';
import { rosterToday, addDays, weekdayIndex, weekRange, monthRange, navigate, dayLabel, isRosterWeek, rangesOverlap } from './rosterDates';

// IST = UTC+05:30. These instants are written in UTC so the test does not depend on the machine's time zone.
const IST = (local: string) => new Date(`${local}+05:30`);

describe('company date around midnight IST', () => {
  it('uses the Asia/Kolkata date, not the UTC date', () => {
    expect(rosterToday(IST('2026-10-10T00:00:00'))).toBe('2026-10-10'); // 18:30 UTC on the 9th
    expect(rosterToday(IST('2026-10-10T03:00:00'))).toBe('2026-10-10'); // 21:30 UTC on the 9th
    expect(rosterToday(IST('2026-10-10T05:29:59'))).toBe('2026-10-10'); // 23:59 UTC on the 9th
    expect(rosterToday(IST('2026-10-10T05:30:00'))).toBe('2026-10-10');
    expect(rosterToday(IST('2026-10-09T23:59:59'))).toBe('2026-10-09');
  });

  it('the roster week is the same Monday → Sunday at every time of day (old page: Sun–Sat between 00:00 and 05:30)', () => {
    const times = ['00:00:00', '00:01:00', '03:00:00', '05:29:59', '05:30:00', '12:00:00', '23:59:59'];
    for (const t of times) {
      expect(weekRange(rosterToday(IST(`2026-10-10T${t}`)))).toMatchObject({ start: '2026-10-05', end: '2026-10-11' });
    }
  });

  it('Sunday 23:59 IST belongs to that week; Monday 00:00 IST starts the next', () => {
    expect(weekRange(rosterToday(IST('2026-10-11T23:59:59'))).start).toBe('2026-10-05');
    expect(weekRange(rosterToday(IST('2026-10-12T00:00:00'))).start).toBe('2026-10-12');
  });
});

describe('week start and end', () => {
  it('every day of a week maps to the same Monday → Sunday', () => {
    for (let i = 0; i < 7; i++) {
      const d = addDays('2026-10-05', i);
      expect(weekRange(d)).toEqual({ start: '2026-10-05', end: '2026-10-11',
        dates: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'] });
      expect(weekdayIndex(d)).toBe(i);
    }
  });

  it('weeks crossing month and year boundaries', () => {
    expect(weekRange('2026-10-01')).toMatchObject({ start: '2026-09-28', end: '2026-10-04' });
    expect(weekRange('2027-01-01')).toMatchObject({ start: '2026-12-28', end: '2027-01-03' });
    expect(weekRange('2028-02-29')).toMatchObject({ start: '2028-02-28', end: '2028-03-05' }); // leap day
  });

  it('labels do not depend on the browser time zone', () => {
    expect(dayLabel('2026-10-05')).toMatch(/^(Mon 5|5 Mon)$/); // same format as before; order depends on the ICU version
    expect(dayLabel('2026-10-11')).toMatch(/^(Sun 11|11 Sun)$/);
    expect(dayLabel('2026-10-10', { day: 'numeric', month: 'short', year: 'numeric' })).toMatch(/^(Oct 10, 2026|10 Oct 2026)$/);
  });

  it('month range and first weekday for the calendar grid', () => {
    expect(monthRange('2026-10-17')).toEqual({ start: '2026-10-01', end: '2026-10-31', year: 2026, month: 10, daysInMonth: 31, firstWeekdayIndex: 3 }); // Thu
    expect(monthRange('2028-02-10')).toMatchObject({ end: '2028-02-29', daysInMonth: 29 });
    expect(monthRange('2026-02-01')).toMatchObject({ daysInMonth: 28, firstWeekdayIndex: 6 }); // Sun
  });

  it('invalid dates are rejected instead of guessed', () => {
    let threw = false; try { weekRange('2026-02-30'); } catch { threw = true; } expect(threw).toBe(true);
    threw = false; try { addDays('10/10/2026', 1); } catch { threw = true; } expect(threw).toBe(true);
  });
});

describe('Previous / Next navigation', () => {
  it('week view moves by exactly 7 days and keeps Monday → Sunday boundaries', () => {
    let a = '2026-10-10';
    const starts: string[] = [];
    for (let i = 0; i < 6; i++) { a = navigate(a, 'Week', -1); starts.push(weekRange(a).start); }
    expect(starts).toEqual(['2026-09-28', '2026-09-21', '2026-09-14', '2026-09-07', '2026-08-31', '2026-08-24']);
    for (let i = 0; i < 6; i++) a = navigate(a, 'Week', 1);
    expect(weekRange(a)).toMatchObject({ start: '2026-10-05', end: '2026-10-11' }); // back to the same week
  });

  it('every navigated week is a valid roster week', () => {
    let a = '2026-12-31';
    for (let i = 0; i < 60; i++) { a = navigate(a, 'Week', 1); const w = weekRange(a); expect(isRosterWeek(w.start, w.end)).toBe(true); }
  });

  it('month view moves to the first day of the previous / next month, across years', () => {
    expect(navigate('2026-10-17', 'Month', -1)).toBe('2026-09-01');
    expect(navigate('2026-10-31', 'Month', 1)).toBe('2026-11-01');
    expect(navigate('2026-12-15', 'Month', 1)).toBe('2027-01-01');
    expect(navigate('2026-01-31', 'Month', -1)).toBe('2025-12-01');
  });
});

describe('roster periods and overlaps', () => {
  it('only Monday → Sunday weeks are valid roster periods', () => {
    expect(isRosterWeek('2026-10-05', '2026-10-11')).toBe(true);
    expect(isRosterWeek('2026-10-04', '2026-10-10')).toBe(false); // the old Sun–Sat period
    expect(isRosterWeek('2026-10-05', '2026-10-12')).toBe(false);
    expect(isRosterWeek('bad', '2026-10-11')).toBe(false);
  });

  it('inclusive overlap: sharing a single day overlaps, adjacent weeks do not', () => {
    expect(rangesOverlap('2026-10-05', '2026-10-11', '2026-10-04', '2026-10-10')).toBe(true);
    expect(rangesOverlap('2026-10-05', '2026-10-11', '2026-10-11', '2026-10-17')).toBe(true);
    expect(rangesOverlap('2026-10-05', '2026-10-11', '2026-10-12', '2026-10-18')).toBe(false);
  });
});
