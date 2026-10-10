import { describe, it, expect } from 'vitest';
import { summarizeBreakDay, matchesBreakFilter } from './breakSummaryRules';

// 9 Oct 2026, IST = UTC+05:30. 13:00 IST = 07:30Z.
const T = (hhmmZ: string, day = '2026-10-09') => `${day}T${hhmmZ}:00Z`;
const NOW = new Date(T('10:00')).getTime(); // 15:30 IST
const shift80 = { break_duration_minutes: 80 };
const brk = (id: string, start: string | null, end: string | null, extra: any = {}) => ({ id, started_at: start, ended_at: end, duration_minutes: null, break_type: 'REGULAR', ...extra });
const day = (breaks: any[], extra: any = {}) => ({ clock_out_at: null, shift_template: shift80, attendance_breaks: breaks, ...extra });

describe('Break Management day summary', () => {
  it('1. no break sessions → 0 min, "No Breaks Recorded" (not a fake session)', () => {
    const s = summarizeBreakDay(day([]), 60, NOW);
    expect(s.totalMins).toBe(0); expect(s.sessions.length).toBe(0); expect(s.status).toBe('NO_BREAKS'); expect(s.excessMins).toBe(0);
  });
  it('2. one completed session uses its start/end timestamps', () => {
    const s = summarizeBreakDay(day([brk('a', T('07:30'), T('08:15'))]), 60, NOW);
    expect(s.completedMins).toBe(45); expect(s.status).toBe('WITHIN'); expect(s.allowedMins).toBe(80);
  });
  it('3. multiple completed sessions are summed', () => {
    const s = summarizeBreakDay(day([brk('a', T('05:00'), T('05:20')), brk('b', T('07:30'), T('08:15')), brk('c', T('09:00'), T('09:10'))]), 60, NOW);
    expect(s.totalMins).toBe(75); expect(s.sessions.map(x => x.minutes)).toEqual([20, 45, 10]);
  });
  it('4. a break in progress counts elapsed time to now and is labelled On Break', () => {
    const s = summarizeBreakDay(day([brk('a', T('05:00'), T('05:20')), brk('b', T('09:30'), null)]), 60, NOW);
    expect(s.activeMins).toBe(30); expect(s.totalMins).toBe(50); expect(s.activeCount).toBe(1);
    expect(s.status).toBe('ON_BREAK'); expect(s.sessions[1].state).toBe('ACTIVE');
  });
  it('5–7. below, exactly at and above the allowance (Excess = max(0, total − allowed))', () => {
    const at = (m: number) => summarizeBreakDay(day([brk('a', T('06:00'), new Date(new Date(T('06:00')).getTime() + m * 60000).toISOString())]), 60, NOW);
    expect([at(45).excessMins, at(45).status]).toEqual([0, 'WITHIN']);
    expect([at(80).excessMins, at(80).status]).toEqual([0, 'WITHIN']);
    expect([at(95).excessMins, at(95).status]).toEqual([15, 'EXCESS']);
  });
  it('8. missing / invalid timestamps are not counted as 0-minute breaks and mark the day Unverified', () => {
    const s = summarizeBreakDay(day([brk('a', null, T('08:00')), brk('b', 'garbage', null), brk('c', T('07:00'), T('07:30'))]), 60, NOW);
    expect(s.totalMins).toBe(30); expect(s.invalidCount).toBe(2); expect(s.status).toBe('UNVERIFIED');
    expect(s.sessions.filter(x => x.state === 'INVALID').every(x => x.minutes === null)).toBe(true);
  });
  it('9. duplicate rows are counted once; end-before-start and open-after-clock-out are invalid', () => {
    const a = brk('a', T('07:00'), T('07:30'));
    expect(summarizeBreakDay(day([a, { ...a }]), 60, NOW)).toMatchObject({ totalMins: 30, duplicateCount: 1, status: 'WITHIN' });
    const bad = summarizeBreakDay(day([brk('x', T('08:00'), T('07:00'))]), 60, NOW);
    expect([bad.totalMins, bad.status]).toEqual([0, 'UNVERIFIED']);
    const afterOut = summarizeBreakDay(day([brk('y', T('09:00'), null)], { clock_out_at: T('09:30') }), 60, NOW);
    expect([afterOut.activeCount, afterOut.totalMins, afterOut.status]).toEqual([0, 0, 'UNVERIFIED']);
    const twoOpen = summarizeBreakDay(day([brk('p', T('09:00'), null), brk('q', T('09:40'), null)]), 60, NOW);
    expect([twoOpen.activeCount, twoOpen.invalidCount]).toEqual([1, 1]);
  });
  it('10. a session crossing midnight (IST) is counted in full, from timestamps', () => {
    // 23:40 IST on 9 Oct → 00:25 IST on 10 Oct = 45 min (night shift attendance dated 9 Oct)
    const s = summarizeBreakDay(day([brk('n', '2026-10-09T18:10:00Z', '2026-10-09T18:55:00Z')], { clock_out_at: '2026-10-10T00:30:00Z' }), 60, new Date('2026-10-10T01:00:00Z').getTime());
    expect(s.totalMins).toBe(45);
  });
  it('11. status filters', () => {
    expect(matchesBreakFilter('NO_BREAKS', 'WITHIN')).toBe(true);
    expect(matchesBreakFilter('EXCESS', 'WITHIN')).toBe(false);
    expect(matchesBreakFilter('ON_BREAK', 'ON_BREAK')).toBe(true);
    expect(matchesBreakFilter('UNVERIFIED', 'EXCESS')).toBe(false);
    expect(matchesBreakFilter('UNVERIFIED', 'ALL')).toBe(true);
  });
  it('12. allowance per shift, else the Settings value; unknown allowance → no excess, Unverified', () => {
    const b = [brk('a', T('06:00'), T('07:10'))]; // 70 min
    expect(summarizeBreakDay(day(b, { shift_template: { break_duration_minutes: 60 } }), 90, NOW)).toMatchObject({ allowedMins: 60, excessMins: 10, status: 'EXCESS' });
    expect(summarizeBreakDay(day(b, { shift_template: null }), 90, NOW)).toMatchObject({ allowedMins: 90, excessMins: 0 });
    const none = summarizeBreakDay(day(b, { shift_template: null }), null, NOW);
    expect([none.allowedMins, none.excessMins, none.status]).toEqual([null, null, 'UNVERIFIED']);
  });
  it('a stored duration that disagrees with the timestamps does not override them', () => {
    const s = summarizeBreakDay(day([brk('a', T('07:00'), T('07:40'), { duration_minutes: 0 })]), 60, NOW);
    expect(s.totalMins).toBe(40); expect(s.sessions[0].storedMinutes).toBe(0);
  });
});
