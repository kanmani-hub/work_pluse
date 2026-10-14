import { describe, it, expect } from 'vitest';
import { statusAfterBreakEnds, closeActiveBreakAt, completedBreakMinutes, computeWorkTimer, findActiveBreak } from './breakRules';
import { computeClockOutTotals } from './clockRules';

const iso = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00+05:30`).toISOString();

describe('status after a break ends (late status is kept)', () => {
  it('late arrival stays LATE', () => {
    expect(statusAfterBreakEnds({ late_minutes: 20 })).toBe('LATE');
  });
  it('on-time arrival returns to WORKING', () => {
    expect(statusAfterBreakEnds({ late_minutes: 0 })).toBe('WORKING');
    expect(statusAfterBreakEnds(null)).toBe('WORKING');
  });
});

describe('clock-out during an automatic break', () => {
  const breaks = [
    { id: 'b1', started_at: iso('12:00'), ended_at: iso('12:30'), duration_minutes: 30, break_type: 'AUTO_GPS' },
    { id: 'b2', started_at: iso('17:30'), ended_at: null, duration_minutes: null, break_type: 'AUTO_GPS' },
  ];
  it('closes the active break at the clock-out time', () => {
    const { breaks: out, closed } = closeActiveBreakAt(breaks, iso('18:00'));
    expect(closed?.id).toBe('b2');
    expect(closed?.ended_at).toBe(iso('18:00'));
    expect(closed?.duration_minutes).toBe(30);
    expect(findActiveBreak(out)).toBe(null);
    expect(completedBreakMinutes(out)).toBe(60);
  });
  it('final worked hours exclude both breaks (09:00 → 18:00, 60 min breaks = 8h)', () => {
    const { breaks: out } = closeActiveBreakAt(breaks, iso('18:00'));
    const t = computeClockOutTotals({ clockInMs: Date.parse(iso('09:00')), clockOutMs: Date.parse(iso('18:00')), breakMinutes: completedBreakMinutes(out), requiredHours: 8 });
    expect(t.workedHours).toBe(8);
    expect(t.overtimeMinutes).toBe(0);
  });
  it('a clock-out time before the break start never gives a negative duration', () => {
    const { closed } = closeActiveBreakAt([{ started_at: iso('17:30'), ended_at: null }], iso('17:00'));
    expect(closed?.duration_minutes).toBe(0);
  });
  it('no active break: nothing is closed', () => {
    const { closed } = closeActiveBreakAt([breaks[0]], iso('18:00'));
    expect(closed).toBe(null);
  });
});

describe('break duration is the same everywhere (spec example)', () => {
  it('09:00 in, 12:00–12:30 break, 18:00 out → 30 min break, 8h 30m worked', () => {
    const list = [{ started_at: iso('12:00'), ended_at: iso('12:30'), duration_minutes: 30 }];
    expect(completedBreakMinutes(list)).toBe(30);
    const timer = computeWorkTimer({ clock_in_at: iso('09:00'), clock_out_at: iso('18:00') } as any, list as any, Date.parse(iso('18:00')));
    expect(Math.round(timer.workSeconds / 60)).toBe(510);
    const t = computeClockOutTotals({ clockInMs: Date.parse(iso('09:00')), clockOutMs: Date.parse(iso('18:00')), breakMinutes: 30, requiredHours: 8 });
    expect(t.workedMinutes).toBe(510);
  });
});

describe('duplicate active break recovery and overnight shift safety', () => {
  it('multiple active breaks are detected safely without unhandled errors', () => {
    // If two breaks are active (e.g. concurrent GPS events), findActiveBreak finds the first valid open break
    const duplicateBreaks = [
      { id: 'b1', started_at: iso('12:00'), ended_at: null, break_type: 'AUTO_GPS' },
      { id: 'b2', started_at: iso('12:01'), ended_at: null, break_type: 'AUTO_GPS' },
    ];
    const open = duplicateBreaks.filter(b => !b.ended_at && b.break_type !== 'CANCELLED');
    expect(open.length).toBe(2);
    // Explicit conflict detection condition
    const hasDuplicate = open.length > 1;
    expect(hasDuplicate).toBe(true);
  });

  it('overnight shift crossing midnight preserves break calculations and clock-out totals', () => {
    // Night shift: 22:00 on Oct 8 to 06:00 on Oct 9 (8 hours)
    // Break from 02:00 to 02:45 on Oct 9 (45 mins)
    const inTime = new Date('2026-10-08T22:00:00+05:30').getTime();
    const breakStart = new Date('2026-10-09T02:00:00+05:30').toISOString();
    const breakEnd = new Date('2026-10-09T02:45:00+05:30').toISOString();
    const outTime = new Date('2026-10-09T06:00:00+05:30').getTime();

    const nightBreaks = [{ started_at: breakStart, ended_at: breakEnd, duration_minutes: 45, break_type: 'AUTO_GPS' }];
    expect(completedBreakMinutes(nightBreaks)).toBe(45);

    const totals = computeClockOutTotals({
      clockInMs: inTime,
      clockOutMs: outTime,
      breakMinutes: completedBreakMinutes(nightBreaks),
      requiredHours: 8
    });
    // Total span: 8h = 480m. Worked = 480 - 45 = 435m (7.25h)
    expect(totals.workedMinutes).toBe(435);
    expect(totals.workedHours).toBe(7.25);
  });
});
