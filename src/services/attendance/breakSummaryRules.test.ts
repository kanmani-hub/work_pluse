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
  it('13. cancelled breaks are completely omitted from the day summary and totals', () => {
    const cancelled = brk('c1', T('07:00'), T('07:30'), { break_type: 'CANCELLED' });
    const s = summarizeBreakDay(day([cancelled]), 60, NOW);
    expect(s.totalMins).toBe(0);
    expect(s.sessions.length).toBe(0);
    expect(s.status).toBe('NO_BREAKS');
  });
  it('14. multi-employee roster summary correctly handles no break, active break, completed break, cancelled break, and auto GPS break', () => {
    const employees = [
      // Emp 1: Ragupathi - No break recorded
      { id: 'emp-1', name: 'Ragupathi K', att: day([]) },
      // Emp 2: Anish - Auto GPS break in progress (started 45m ago)
      { id: 'emp-2', name: 'Anish K', att: day([brk('b-anish', T('09:15'), null, { break_type: 'AUTO_GPS' })]) },
      // Emp 3: Elcon - Completed manual break (30m)
      { id: 'emp-3', name: 'Elcon R', att: day([brk('b-elcon', T('07:00'), T('07:30'), { break_type: 'REGULAR' })]) },
      // Emp 4: Yuvaraj - Cancelled break (should not count)
      { id: 'emp-4', name: 'Yuvaraj K', att: day([brk('b-yuvaraj', T('06:00'), T('06:45'), { break_type: 'CANCELLED' })]) },
      // Emp 5: Vignesh - Completed Auto GPS break with overrun (100m, allowed 80m)
      { id: 'emp-5', name: 'Vigneshmoorthy R', att: day([brk('b-vignesh', T('06:00'), T('07:40'), { break_type: 'AUTO_GPS' })]) }
    ];

    const summaries = employees.map(e => ({
      name: e.name,
      ...summarizeBreakDay(e.att, 80, NOW)
    }));

    // Verify Emp 1: Ragupathi
    expect(summaries[0].totalMins).toBe(0);
    expect(summaries[0].status).toBe('NO_BREAKS');
    expect(summaries[0].sessions.length).toBe(0);

    // Verify Emp 2: Anish (active auto GPS break)
    expect(summaries[1].activeCount).toBe(1);
    expect(summaries[1].activeMins).toBe(45);
    expect(summaries[1].status).toBe('ON_BREAK');
    expect(summaries[1].sessions[0].break_type).toBe('AUTO_GPS');
    expect(summaries[1].sessions[0].state).toBe('ACTIVE');

    // Verify Emp 3: Elcon (completed manual break)
    expect(summaries[2].completedMins).toBe(30);
    expect(summaries[2].totalMins).toBe(30);
    expect(summaries[2].status).toBe('WITHIN');
    expect(summaries[2].excessMins).toBe(0);

    // Verify Emp 4: Yuvaraj (cancelled break ignored)
    expect(summaries[3].totalMins).toBe(0);
    expect(summaries[3].status).toBe('NO_BREAKS');
    expect(summaries[3].sessions.length).toBe(0);

    // Verify Emp 5: Vignesh (auto GPS with excess)
    expect(summaries[4].completedMins).toBe(100);
    expect(summaries[4].totalMins).toBe(100);
    expect(summaries[4].excessMins).toBe(20);
    expect(summaries[4].status).toBe('EXCESS');
    expect(summaries[4].sessions[0].break_type).toBe('AUTO_GPS');
  });

  it('15. an open break on a past attendance date does NOT accumulate days of minutes', () => {
    // Break started on 2026-10-07 at 16:00 IST (10:30 UTC), now is 2026-10-09 at 15:30 IST (NOW)
    // Elapsed raw time would be ~2,850 minutes without the fix!
    const pastBreak = brk('past-1', '2026-10-07T10:30:00Z', null, { break_type: 'AUTO_GPS' });
    const pastAttendance = day([pastBreak], { attendance_date: '2026-10-07' });
    const s = summarizeBreakDay(pastAttendance, 60, NOW);

    expect(s.sessions.length).toBe(1);
    expect(s.sessions[0].state).toBe('INVALID');
    expect(s.sessions[0].invalidReason).toBe('Unclosed break on past attendance date');
    expect(s.sessions[0].minutes).toBeNull();
    expect(s.activeMins).toBe(0);
    expect(s.totalMins).toBe(0);
    expect(s.excessMins).toBe(0); // Protected: zero excess break calculated!
    expect(s.invalidCount).toBe(1);
    expect(s.status).toBe('UNVERIFIED');
  });

  it('16. a current-day active break accumulates correctly without being marked invalid', () => {
    // Current date is 2026-10-09 (NOW is 10:00 UTC = 15:30 IST)
    // Break started 30 mins ago at 09:30 UTC (15:00 IST)
    const activeBreak = brk('cur-1', T('09:30'), null, { break_type: 'AUTO_GPS' });
    const todayAttendance = day([activeBreak], { attendance_date: '2026-10-09' });
    const s = summarizeBreakDay(todayAttendance, 60, NOW);

    expect(s.sessions.length).toBe(1);
    expect(s.sessions[0].state).toBe('ACTIVE');
    expect(s.sessions[0].minutes).toBe(30);
    expect(s.activeMins).toBe(30);
    expect(s.totalMins).toBe(30);
    expect(s.status).toBe('ON_BREAK');
  });

  it('17. invalid break sessions cannot inflate excess-break calculations', () => {
    // Attendance on past date with an unclosed open break, plus a valid completed 20-min break
    const completed = brk('c1', '2026-10-08T05:00:00Z', '2026-10-08T05:20:00Z', { duration_minutes: 20 });
    const unclosed = brk('u1', '2026-10-08T08:00:00Z', null, { break_type: 'AUTO_GPS' });
    const pastDay = day([completed, unclosed], { attendance_date: '2026-10-08' });

    // Allowed is 60 minutes. Completed is 20 mins.
    // If the unclosed break were naively counted, total would be >1,400 mins with massive excess!
    const s = summarizeBreakDay(pastDay, 60, NOW);

    expect(s.completedMins).toBe(20);
    expect(s.activeMins).toBe(0);
    expect(s.totalMins).toBe(20);
    expect(s.excessMins).toBe(0); // 20 <= 60, zero excess!
    expect(s.invalidCount).toBe(1);
    expect(s.sessions.find(x => x.id === 'u1')?.state).toBe('INVALID');
    expect(s.status).toBe('UNVERIFIED');
  });
});
