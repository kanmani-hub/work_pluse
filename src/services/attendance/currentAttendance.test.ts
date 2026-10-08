import { describe, it, expect } from 'vitest';
import { selectCurrentAttendance, currentAttendanceState } from './currentAttendance';
import { companyDateStr, previousDateStr } from '../../utils/companyDate';

// Controlled fixtures only (nothing is written to the database)
const TODAY = '2026-10-08';
const YESTERDAY = '2026-10-07';
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00+05:30`;
const day = { crosses_midnight: false };
const night = { crosses_midnight: true };
const yesterdayDone = { attendance_date: YESTERDAY, clock_in_at: at(YESTERDAY, '09:45'), clock_out_at: at(YESTERDAY, '18:30'), status: 'COMPLETED', shift_template: day };
const pick = (rows: any[]) => selectCurrentAttendance(rows, TODAY, YESTERDAY);

describe('company business date (IST)', () => {
  it('between 00:00 and 05:30 IST the business date is already today, unlike the UTC date', () => {
    const instant = '2026-10-07T20:00:00Z'; // 01:30 IST on Oct 8
    expect(new Date(instant).toISOString().slice(0, 10)).toBe('2026-10-07'); // the old (wrong) UTC date
    expect(companyDateStr(instant)).toBe('2026-10-08');
    expect(companyDateStr('2026-10-08T00:05:00Z')).toBe('2026-10-08'); // 05:35 IST
    expect(previousDateStr('2026-10-01')).toBe('2026-09-30');
  });
});

describe('current attendance selection', () => {
  it('TEST 1/6: yesterday clocked out, no attendance today → NOT CLOCKED IN', () => {
    const current = pick([yesterdayDone]);
    expect(current).toBeNull();
    expect(currentAttendanceState(current, false)).toBe('NOT_CLOCKED_IN');
  });

  it('TEST 2: clocked in today, no clock-out → WORKING', () => {
    const today = { attendance_date: TODAY, clock_in_at: at(TODAY, '10:00'), clock_out_at: null, status: 'WORKING', shift_template: day };
    const current = pick([yesterdayDone, today]);
    expect(current).toBe(today);
    expect(currentAttendanceState(current, false)).toBe('WORKING');
  });

  it('TEST 3: AUTO_GPS break active today → ON BREAK', () => {
    const today = { attendance_date: TODAY, clock_in_at: at(TODAY, '10:00'), clock_out_at: null, status: 'ON_BREAK', shift_template: day };
    expect(currentAttendanceState(pick([today]), true)).toBe('ON_BREAK');
  });

  it('TEST 4: clocked in and out today → CLOCKED OUT with today\'s record', () => {
    const today = { attendance_date: TODAY, clock_in_at: at(TODAY, '10:00'), clock_out_at: at(TODAY, '19:00'), status: 'COMPLETED', shift_template: day };
    const current = pick([yesterdayDone, today]);
    expect(current).toBe(today);
    expect(currentAttendanceState(current, false)).toBe('CLOCKED_OUT');
  });

  it('TEST 5: yesterday clocked out, today clocked in → only today controls the state', () => {
    const today = { attendance_date: TODAY, clock_in_at: at(TODAY, '09:58'), clock_out_at: null, status: 'LATE', shift_template: day };
    const current = pick([today, yesterdayDone]);
    expect(current!.attendance_date).toBe(TODAY);
    expect(currentAttendanceState(current, false)).toBe('WORKING');
  });

  it('TEST 7a: overnight 21:00 Oct 7 still open at 01:00 Oct 8 → that session is current (WORKING)', () => {
    const overnight = { attendance_date: YESTERDAY, clock_in_at: at(YESTERDAY, '21:00'), clock_out_at: null, status: 'WORKING', shift_template: night };
    const current = pick([overnight]);
    expect(current).toBe(overnight);
    expect(currentAttendanceState(current, false)).toBe('WORKING');
  });

  it('TEST 7b: overnight clocked out 05:00 Oct 8 stays one Oct 7 session; Oct 8 is NOT CLOCKED IN, not a clock-out-only state', () => {
    const overnight = { attendance_date: YESTERDAY, clock_in_at: at(YESTERDAY, '21:00'), clock_out_at: at(TODAY, '05:00'), status: 'COMPLETED', shift_template: night };
    expect(pick([overnight])).toBeNull();
    expect(currentAttendanceState(pick([overnight]), false)).toBe('NOT_CLOCKED_IN');
  });

  it('an open record from yesterday on a DAY shift (missing clock-out) is not carried into today', () => {
    const stale = { attendance_date: YESTERDAY, clock_in_at: at(YESTERDAY, '09:50'), clock_out_at: null, status: 'WORKING', shift_template: day };
    expect(pick([stale])).toBeNull();
  });

  it('works with the employee page rows (rawDate instead of attendance_date)', () => {
    const rows = [{ rawDate: YESTERDAY, clock_in_at: at(YESTERDAY, '09:45'), clock_out_at: at(YESTERDAY, '18:30'), shift_template: day }];
    expect(selectCurrentAttendance(rows, TODAY, YESTERDAY)).toBeNull();
  });
});
