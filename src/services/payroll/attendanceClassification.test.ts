import { describe, it, expect } from 'vitest';
import { classifyPayrollDays, summarizeDays, isLopLeaveType, REVIEW_HALF_DAY_UNCOVERED, REVIEW_SHORT_DAY } from './attendanceClassification';
import type { ClassificationInput } from './attendanceClassification';

// Synthetic data only. October 2026: Thu 1, Fri 2, Sat 3, Sun 4, Mon 5 … Sat 10, Sun 11.
// Company working days Mon–Sat (Admin → Settings); Sunday is the weekly off.
const MON_SAT = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const IN = '2026-10-01T03:30:00Z';

const base = (over: Partial<ClassificationInput> = {}): ClassificationInput => ({
  periodStart: '2026-10-01', periodEnd: '2026-10-10', today: '2026-10-31',
  joiningDate: '2025-01-01', workingDays: MON_SAT, holidays: [], attendance: [], leaves: [], ...over,
});
const row = (date: string, status: string, extra: any = {}) => ({ attendance_date: date, status, clock_in_at: IN, ...extra });
const kindOn = (input: ClassificationInput, date: string) => classifyPayrollDays(input).find(d => d.date === date);
// Every scheduled day worked except the one under test, so only that day can produce LOP
const allWorkedExcept = (skip: string[], extra: any[] = []) => {
  const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  return [...dates.filter(d => !skip.includes(d)).map(d => row(d, 'COMPLETED')), ...extra];
};

describe('every attendance status with a clock-in is a worked day (never absent / LOP)', () => {
  for (const status of ['WORKING', 'LATE', 'ON_BREAK', 'COMPLETED', 'PRESENT', 'EARLY_LOGOUT']) {
    it(`${status} → PRESENT, 0 LOP`, () => {
      const d = kindOn(base({ attendance: [row('2026-10-05', status, { late_minutes: status === 'LATE' ? 30 : 0 })] }), '2026-10-05');
      expect(d).toMatchObject({ kind: 'PRESENT', lop: 0, paidLeave: 0, halfDayDeduction: false });
    });
  }

  it('auto logout (is_auto_logged_out, status COMPLETED) → PRESENT', () => {
    const d = kindOn(base({ attendance: [row('2026-10-05', 'COMPLETED', { is_auto_logged_out: true })] }), '2026-10-05');
    expect(d).toMatchObject({ kind: 'PRESENT', lop: 0 });
  });

  // Policy 2026-10-09: a short day is flagged; the half-day deduction applies only after an Admin chooses APPLY
  it('auto logout with too few hours (status HALF_DAY) → half day, 0 LOP, flagged (no automatic half-day deduction); APPLY restores the deduction', () => {
    const input = base({ attendance: [row('2026-10-05', 'HALF_DAY', { is_auto_logged_out: true, is_half_day: true })] });
    expect(kindOn(input, '2026-10-05')).toMatchObject({ kind: 'HALF_DAY', lop: 0, halfDayDeduction: false, reviewType: 'SHORT_DAY', review: REVIEW_SHORT_DAY });
    expect(kindOn({ ...input, resolutions: { '2026-10-05|SHORT_DAY': 'APPLY' } }, '2026-10-05'))
      .toMatchObject({ kind: 'HALF_DAY', lop: 0, halfDayDeduction: true, review: null, resolution: 'APPLY' });
  });

  it('is_half_day=true with status COMPLETED is a half day (flagged; deduction after APPLY)', () => {
    const input = base({ attendance: [row('2026-10-05', 'COMPLETED', { is_half_day: true })] });
    expect(kindOn(input, '2026-10-05')).toMatchObject({ kind: 'HALF_DAY', halfDayDeduction: false, lop: 0, reviewType: 'SHORT_DAY' });
    expect(kindOn({ ...input, resolutions: { '2026-10-05|SHORT_DAY': 'APPLY' } }, '2026-10-05')).toMatchObject({ kind: 'HALF_DAY', halfDayDeduction: true, lop: 0 });
  });

  it('statuses that do not prove attendance (ABSENT / ON_LEAVE / WFH / NOT STARTED) without a clock-in are absences', () => {
    for (const status of ['ABSENT', 'ON_LEAVE', 'WFH', 'NOT STARTED']) {
      const d = kindOn(base({ attendance: [{ attendance_date: '2026-10-05', status, clock_in_at: null }] }), '2026-10-05');
      expect(d).toMatchObject({ kind: 'ABSENT', lop: 1 });
    }
  });

  it('SANDWICH LOP row (existing sandwich-leave rule) → 1 LOP day, even on a weekly off', () => {
    const d = kindOn(base({ attendance: [{ attendance_date: '2026-10-04', status: 'SANDWICH LOP', clock_in_at: null }] }), '2026-10-04');
    expect(d).toMatchObject({ kind: 'SANDWICH_LOP', lop: 1 });
  });
});

describe('days without an attendance row', () => {
  it('a working day with no row at all is a genuine absence (1 LOP)', () => {
    expect(kindOn(base(), '2026-10-05')).toMatchObject({ kind: 'ABSENT', lop: 1 });
  });

  it('weekly off (Sunday) is neither worked nor absent', () => {
    expect(kindOn(base(), '2026-10-04')).toMatchObject({ kind: 'WEEKLY_OFF', lop: 0 });
  });

  it('Saturday is a working day when Settings say Mon–Sat, a weekly off when Settings say Mon–Fri', () => {
    expect(kindOn(base(), '2026-10-03')).toMatchObject({ kind: 'ABSENT', lop: 1 });
    expect(kindOn(base({ workingDays: MON_SAT.slice(0, 5) }), '2026-10-03')).toMatchObject({ kind: 'WEEKLY_OFF', lop: 0 });
  });

  it('a public holiday from Settings is not an absence', () => {
    expect(kindOn(base({ holidays: ['2026-10-02'] }), '2026-10-02')).toMatchObject({ kind: 'HOLIDAY', lop: 0 });
  });

  it('days before joining_date are not counted', () => {
    const days = classifyPayrollDays(base({ joiningDate: '2026-10-07' }));
    expect(days.filter(d => d.kind === 'NOT_EMPLOYED').length).toBe(6);
    expect(summarizeDays(days).absentDays).toBe(4); // Wed 7, Thu 8, Fri 9, Sat 10 only
  });

  it('today without a clock-in yet and future days are not absences', () => {
    const days = classifyPayrollDays(base({ today: '2026-10-07' }));
    expect(days.find(d => d.date === '2026-10-07')).toMatchObject({ kind: 'TODAY_PENDING', lop: 0 });
    expect(days.find(d => d.date === '2026-10-08')).toMatchObject({ kind: 'FUTURE', lop: 0 });
  });

  it('a day worked on a weekly off / holiday is a worked day (no LOP)', () => {
    expect(kindOn(base({ attendance: [row('2026-10-04', 'COMPLETED')] }), '2026-10-04')).toMatchObject({ kind: 'PRESENT', lop: 0 });
    expect(kindOn(base({ holidays: ['2026-10-02'], attendance: [row('2026-10-02', 'LATE')] }), '2026-10-02')).toMatchObject({ kind: 'PRESENT', lop: 0 });
  });
});

describe('approved leave', () => {
  const paid = (s: string, e: string, half = false) => ({ start_date: s, end_date: e, is_half_day: half, isLop: false });
  const lop = (s: string, e: string, half = false) => ({ start_date: s, end_date: e, is_half_day: half, isLop: true });

  it('approved paid leave on a working day → paid leave, 0 LOP', () => {
    expect(kindOn(base({ leaves: [paid('2026-10-05', '2026-10-05')] }), '2026-10-05')).toMatchObject({ kind: 'PAID_LEAVE', paidLeave: 1, lop: 0 });
  });

  it('approved Loss-of-Pay leave → 1 LOP day, counted once', () => {
    const s = summarizeDays(classifyPayrollDays(base({ attendance: allWorkedExcept(['2026-10-05']), leaves: [lop('2026-10-05', '2026-10-05')] })));
    expect(s).toMatchObject({ lopLeaveDays: 1, absentDays: 0, lopDays: 1 });
  });

  it('leave spanning a weekly off counts only the working days (Sun not counted as leave)', () => {
    const s = summarizeDays(classifyPayrollDays(base({ attendance: allWorkedExcept(['2026-10-03', '2026-10-05']), leaves: [paid('2026-10-03', '2026-10-05')] })));
    expect(s).toMatchObject({ paidLeaveDays: 2, weeklyOffDays: 1, lopDays: 0 });
  });

  it('approved half-day paid leave + worked half day → no LOP and no half-day deduction', () => {
    expect(kindOn(base({ attendance: [row('2026-10-05', 'HALF_DAY', { is_half_day: true })], leaves: [paid('2026-10-05', '2026-10-05', true)] }), '2026-10-05'))
      .toMatchObject({ kind: 'HALF_DAY', paidLeave: 0.5, lop: 0, halfDayDeduction: false });
  });

  it('approved half-day LOP leave + worked half day → 0.5 LOP, no extra half-day deduction', () => {
    expect(kindOn(base({ attendance: [row('2026-10-05', 'HALF_DAY', { is_half_day: true })], leaves: [lop('2026-10-05', '2026-10-05', true)] }), '2026-10-05'))
      .toMatchObject({ kind: 'HALF_DAY', paidLeave: 0, lop: 0.5, halfDayDeduction: false });
  });

  // Rule 1 (owner, 2026-10-09 final rules): the uncovered half is NOT deducted automatically; it is flagged
  it('approved half-day paid leave but no clock-in and nothing else for the other half → 0.5 paid leave, 0 LOP, flagged for Admin review', () => {
    expect(kindOn(base({ leaves: [paid('2026-10-05', '2026-10-05', true)] }), '2026-10-05'))
      .toMatchObject({ kind: 'PAID_LEAVE', paidLeave: 0.5, lop: 0, absentLop: 0, halfDayDeduction: false, review: REVIEW_HALF_DAY_UNCOVERED });
  });

  it('leave on a holiday is not counted as leave', () => {
    expect(kindOn(base({ holidays: ['2026-10-05'], leaves: [paid('2026-10-05', '2026-10-05')] }), '2026-10-05')).toMatchObject({ kind: 'HOLIDAY', paidLeave: 0, lop: 0 });
  });
});

describe('approved WFH without a clock-in is an absence (owner rule 2026-10-09)', () => {
  it('WFH has no effect on classification: only a clock-in counts', () => {
    expect(kindOn(base({ attendance: [{ attendance_date: '2026-10-05', status: 'WFH', clock_in_at: null }] }), '2026-10-05')).toMatchObject({ kind: 'ABSENT', lop: 1 });
  });
});

describe('month summary: no double counting', () => {
  it('a realistic synthetic period adds up exactly', () => {
    const days = classifyPayrollDays(base({
      holidays: ['2026-10-02'],
      attendance: [
        row('2026-10-01', 'LATE', { late_minutes: 30 }),         // late → present
        row('2026-10-03', 'COMPLETED', { early_logout_minutes: 20 }), // early logout → present
        { attendance_date: '2026-10-04', status: 'SANDWICH LOP', clock_in_at: null }, // sandwich
        row('2026-10-06', 'HALF_DAY', { is_half_day: true }),     // half day
        row('2026-10-07', 'COMPLETED', { is_auto_logged_out: true }),
        row('2026-10-09', 'ON_BREAK'),
        row('2026-10-10', 'WORKING'),
      ],
      leaves: [{ start_date: '2026-10-05', end_date: '2026-10-05', is_half_day: false, isLop: false }],
      // 2026-10-08 (Thu): no row, no leave → absent
    }));
    expect(summarizeDays(days)).toEqual({
      scheduledDays: 9, presentDays: 6, halfDays: 0, absentDays: 1, paidLeaveDays: 1,
      lopLeaveDays: 0, sandwichLopDays: 1, lopDays: 2, holidayDays: 1, weeklyOffDays: 0,
      rosterDays: 0, earlyLogoutDays: 1, earlyLogoutMinutes: 20,
      reviewItems: [{ date: '2026-10-06', type: 'SHORT_DAY', reason: REVIEW_SHORT_DAY }], resolvedReviews: [],
    });
  });

  it('one entry per calendar day', () => {
    const days = classifyPayrollDays(base({ periodStart: '2026-10-01', periodEnd: '2026-10-31' }));
    expect(days.length).toBe(31);
    expect(new Set(days.map(d => d.date)).size).toBe(31);
  });
});

describe('isLopLeaveType', () => {
  it('recognises Loss-of-Pay / unpaid leave types only', () => {
    expect(isLopLeaveType({ code: 'LOP', name: 'Loss of Pay' })).toBe(true);
    expect(isLopLeaveType({ code: 'UL', name: 'Unpaid Leave' })).toBe(true);
    expect(isLopLeaveType({ code: 'CL', name: 'Casual Leave' })).toBe(false);
    expect(isLopLeaveType(null)).toBe(false);
  });
});

// ---- Final payroll rules (2026-10-09) -------------------------------------------------------
const half = (d: string, which: 'FIRST_HALF' | 'SECOND_HALF', isLop = false) => ({ start_date: d, end_date: d, is_half_day: true, half_day_type: which, isLop });

describe('Rule 1: approved half-day leave without a clock-in', () => {
  it('first-half paid + second-half paid leave → full paid leave day, no review', () => {
    expect(kindOn(base({ leaves: [half('2026-10-05', 'FIRST_HALF'), half('2026-10-05', 'SECOND_HALF')] }), '2026-10-05'))
      .toMatchObject({ kind: 'PAID_LEAVE', paidLeave: 1, lop: 0, review: null });
  });

  it('first-half paid + second-half Loss-of-Pay leave → 0.5 paid + 0.5 LOP leave, counted once', () => {
    const d = kindOn(base({ leaves: [half('2026-10-05', 'FIRST_HALF'), half('2026-10-05', 'SECOND_HALF', true)] }), '2026-10-05');
    expect(d).toMatchObject({ kind: 'MIXED_LEAVE', paidLeave: 0.5, leaveLop: 0.5, absentLop: 0, lop: 0.5, review: null });
  });

  it('two leaves for the SAME half do not cover the other half → still flagged', () => {
    const d = kindOn(base({ leaves: [half('2026-10-05', 'FIRST_HALF'), half('2026-10-05', 'FIRST_HALF')] }), '2026-10-05');
    expect(d).toMatchObject({ paidLeave: 0.5, lop: 0, review: REVIEW_HALF_DAY_UNCOVERED });
  });

  it('half-day leave + clock-in for the other half → worked half + 0.5 paid leave, no half-day deduction, no review', () => {
    const d = kindOn(base({ attendance: [row('2026-10-05', 'HALF_DAY', { is_half_day: true })], leaves: [half('2026-10-05', 'SECOND_HALF')] }), '2026-10-05');
    expect(d).toMatchObject({ kind: 'HALF_DAY', paidLeave: 0.5, lop: 0, halfDayDeduction: false, review: null });
  });

  it('half-day LOP leave with no clock-in → 0.5 LOP leave only (the other half is flagged, not deducted)', () => {
    const d = kindOn(base({ leaves: [half('2026-10-05', 'FIRST_HALF', true)] }), '2026-10-05');
    expect(d).toMatchObject({ kind: 'LOP_LEAVE', leaveLop: 0.5, absentLop: 0, lop: 0.5, review: REVIEW_HALF_DAY_UNCOVERED });
  });

  it('the review flag is listed in the summary and adds no LOP', () => {
    const s = summarizeDays(classifyPayrollDays(base({ attendance: allWorkedExcept(['2026-10-05']), leaves: [half('2026-10-05', 'FIRST_HALF')] })));
    expect(s).toMatchObject({ lopDays: 0, absentDays: 0, paidLeaveDays: 0.5, halfDays: 0 });
    expect(s.reviewItems).toEqual([{ date: '2026-10-05', type: 'HALF_DAY_LEAVE_UNCOVERED', reason: REVIEW_HALF_DAY_UNCOVERED }]);
  });

  it('a worked half day with a FULL-day approved leave uses the leave for the other half (no extra half-day deduction)', () => {
    const d = kindOn(base({ attendance: [row('2026-10-05', 'HALF_DAY', { is_half_day: true })], leaves: [{ start_date: '2026-10-05', end_date: '2026-10-05', is_half_day: false, isLop: false }] }), '2026-10-05');
    expect(d).toMatchObject({ kind: 'HALF_DAY', paidLeave: 0.5, halfDayDeduction: false, lop: 0 });
  });
});

describe('Rule 2: employee roster first, company working days as fallback', () => {
  it('roster WORK on a Sunday with no clock-in → absence (roster overrides the company weekly off)', () => {
    expect(kindOn(base({ rosterDays: { '2026-10-04': 'WORK' } }), '2026-10-04')).toMatchObject({ kind: 'ABSENT', lop: 1, scheduleSource: 'ROSTER' });
  });

  it('roster weekly off on a Monday → not an absence', () => {
    expect(kindOn(base({ rosterDays: { '2026-10-05': 'OFF' } }), '2026-10-05')).toMatchObject({ kind: 'WEEKLY_OFF', lop: 0, scheduleSource: 'ROSTER' });
  });

  it('dates without roster coverage fall back to the company working days', () => {
    const input = base({ rosterDays: { '2026-10-05': 'OFF' } });
    expect(kindOn(input, '2026-10-06')).toMatchObject({ kind: 'ABSENT', scheduleSource: 'COMPANY' });
    expect(kindOn(input, '2026-10-04')).toMatchObject({ kind: 'WEEKLY_OFF', scheduleSource: 'COMPANY' });
  });

  it('a public holiday is never an absence, even when rostered', () => {
    expect(kindOn(base({ holidays: ['2026-10-05'], rosterDays: { '2026-10-05': 'WORK' } }), '2026-10-05')).toMatchObject({ kind: 'HOLIDAY', lop: 0 });
  });

  it('approved leave on a rostered day is leave, not absence', () => {
    expect(kindOn(base({ rosterDays: { '2026-10-04': 'WORK' }, leaves: [{ start_date: '2026-10-04', end_date: '2026-10-04', isLop: false }] }), '2026-10-04'))
      .toMatchObject({ kind: 'PAID_LEAVE', paidLeave: 1, lop: 0 });
  });

  it('a roster month summary: rostered Sunday worked, roster off Monday, nothing double counted', () => {
    const rosterDays: Record<string, 'WORK' | 'OFF'> = {};
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']) rosterDays[d] = 'WORK';
    rosterDays['2026-10-05'] = 'OFF';
    const att = Object.keys(rosterDays).filter(d => rosterDays[d] === 'WORK' && d !== '2026-10-08').map(d => row(d, 'COMPLETED'));
    const s = summarizeDays(classifyPayrollDays(base({ rosterDays, attendance: att })));
    expect(s).toMatchObject({ presentDays: 8, absentDays: 1, lopDays: 1, weeklyOffDays: 1, rosterDays: 2 });
  });
});

describe('Rule 3: early logout is information only', () => {
  it('early logout minutes are recorded on a worked day with 0 LOP and no half-day deduction', () => {
    const d = kindOn(base({ attendance: [row('2026-10-05', 'COMPLETED', { early_logout_minutes: 45 })] }), '2026-10-05');
    expect(d).toMatchObject({ kind: 'PRESENT', earlyLogoutMinutes: 45, lop: 0, halfDayDeduction: false });
  });

  it('auto logout with an early clock-out keeps the minutes for information', () => {
    const s = summarizeDays(classifyPayrollDays(base({ attendance: [row('2026-10-05', 'COMPLETED', { is_auto_logged_out: true, early_logout_minutes: 30 }), row('2026-10-06', 'EARLY_LOGOUT', { early_logout_minutes: 15 })] })));
    expect(s).toMatchObject({ earlyLogoutDays: 2, earlyLogoutMinutes: 45 });
  });
});

// ---- Policy decisions 2026-10-09 (short days, Admin resolution of flags) -------------------
describe('Admin resolution of review flags', () => {
  const shortDay = () => base({ attendance: [...allWorkedExcept(['2026-10-06']), row('2026-10-06', 'HALF_DAY', { is_half_day: true })] });

  it('unresolved short day: no half-day deduction, one review item', () => {
    const s = summarizeDays(classifyPayrollDays(shortDay()));
    expect(s).toMatchObject({ halfDays: 0, lopDays: 0, presentDays: 9 });
    expect(s.reviewItems).toEqual([{ date: '2026-10-06', type: 'SHORT_DAY', reason: REVIEW_SHORT_DAY }]);
    expect(s.resolvedReviews).toEqual([]);
  });

  it('APPLY: the existing half-day deduction applies once, flag resolved', () => {
    const s = summarizeDays(classifyPayrollDays({ ...shortDay(), resolutions: { '2026-10-06|SHORT_DAY': 'APPLY' } }));
    expect(s).toMatchObject({ halfDays: 1, lopDays: 0, reviewItems: [] });
    expect(s.resolvedReviews).toEqual([{ date: '2026-10-06', type: 'SHORT_DAY', decision: 'APPLY' }]);
  });

  it('WAIVE: no deduction, flag resolved', () => {
    const s = summarizeDays(classifyPayrollDays({ ...shortDay(), resolutions: { '2026-10-06|SHORT_DAY': 'WAIVE' } }));
    expect(s).toMatchObject({ halfDays: 0, lopDays: 0, reviewItems: [] });
    expect(s.resolvedReviews).toEqual([{ date: '2026-10-06', type: 'SHORT_DAY', decision: 'WAIVE' }]);
  });

  it('half-day leave with the other half uncovered: APPLY = 0.5 absence (LOP), WAIVE = nothing', () => {
    const input = base({ attendance: allWorkedExcept(['2026-10-05']), leaves: [half('2026-10-05', 'FIRST_HALF')] });
    const applied = summarizeDays(classifyPayrollDays({ ...input, resolutions: { '2026-10-05|HALF_DAY_LEAVE_UNCOVERED': 'APPLY' } }));
    expect(applied).toMatchObject({ absentDays: 0.5, lopDays: 0.5, paidLeaveDays: 0.5, reviewItems: [] });
    const waived = summarizeDays(classifyPayrollDays({ ...input, resolutions: { '2026-10-05|HALF_DAY_LEAVE_UNCOVERED': 'WAIVE' } }));
    expect(waived).toMatchObject({ absentDays: 0, lopDays: 0, paidLeaveDays: 0.5, reviewItems: [] });
  });

  it('a resolution for another date or type does not resolve the flag', () => {
    const s = summarizeDays(classifyPayrollDays({ ...shortDay(), resolutions: { '2026-10-07|SHORT_DAY': 'APPLY', '2026-10-06|HALF_DAY_LEAVE_UNCOVERED': 'APPLY' } }));
    expect(s).toMatchObject({ halfDays: 0, lopDays: 0 });
    expect(s.reviewItems.length).toBe(1);
  });

  it('a short day covered by approved leave for the other half is not flagged', () => {
    const d = kindOn(base({ attendance: [row('2026-10-05', 'HALF_DAY', { is_half_day: true })], leaves: [half('2026-10-05', 'SECOND_HALF')] }), '2026-10-05');
    expect(d).toMatchObject({ review: null, reviewType: null, halfDayDeduction: false, paidLeave: 0.5 });
  });
});
