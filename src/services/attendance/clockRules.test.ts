import { describe, it, expect } from 'vitest';
import { resolveClockInSession, computeClockOutTotals, companySecondsOfDay } from './clockRules';

// IST = UTC+05:30
const ist = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+05:30`);

describe('companySecondsOfDay', () => {
  it('uses IST regardless of the browser zone', () => {
    expect(companySecondsOfDay(ist('2026-10-08', '09:17'))).toBe(9 * 3600 + 17 * 60);
  });
});

describe('resolveClockInSession — day shift', () => {
  const shift = { start_time: '09:00:00', end_time: '18:00:00', crosses_midnight: false };
  it('09:17 with 10 min grace = 17 minutes late, today', () => {
    expect(resolveClockInSession({ nowMs: ist('2026-10-08', '09:17'), today: '2026-10-08', shift, graceMinutes: 10 }))
      .toEqual({ attendanceDate: '2026-10-08', lateMinutes: 17 });
  });
  it('inside the grace period is not late', () => {
    expect(resolveClockInSession({ nowMs: ist('2026-10-08', '09:08'), today: '2026-10-08', shift, graceMinutes: 10 }).lateMinutes).toBe(0);
  });
  it('early clock-in is not late', () => {
    expect(resolveClockInSession({ nowMs: ist('2026-10-08', '08:40'), today: '2026-10-08', shift, graceMinutes: 0 }).lateMinutes).toBe(0);
  });
  it('uses the real shift start, not 09:00', () => {
    const s = { start_time: '10:00:00', end_time: '19:30:00' };
    expect(resolveClockInSession({ nowMs: ist('2026-10-08', '10:25'), today: '2026-10-08', shift: s, graceMinutes: 15 }).lateMinutes).toBe(25);
  });
});

describe('resolveClockInSession — overnight shift 22:00 → 06:00', () => {
  const shift = { start_time: '22:00:00', end_time: '06:00:00', crosses_midnight: true };
  it('on-time 21:55 belongs to today', () => {
    expect(resolveClockInSession({ nowMs: ist('2026-10-08', '21:55'), today: '2026-10-08', shift, graceMinutes: 10 }))
      .toEqual({ attendanceDate: '2026-10-08', lateMinutes: 0 });
  });
  it('22:20 is 20 minutes late, today', () => {
    expect(resolveClockInSession({ nowMs: ist('2026-10-08', '22:20'), today: '2026-10-08', shift, graceMinutes: 10 }))
      .toEqual({ attendanceDate: '2026-10-08', lateMinutes: 20 });
  });
  it('00:30 after midnight belongs to YESTERDAY\'s shift and is 150 minutes late', () => {
    expect(resolveClockInSession({ nowMs: ist('2026-10-09', '00:30'), today: '2026-10-09', shift, graceMinutes: 10 }))
      .toEqual({ attendanceDate: '2026-10-08', lateMinutes: 150 });
  });
  it('after the shift end (07:00) it is an early clock-in for tonight', () => {
    expect(resolveClockInSession({ nowMs: ist('2026-10-09', '07:00'), today: '2026-10-09', shift, graceMinutes: 10 }))
      .toEqual({ attendanceDate: '2026-10-09', lateMinutes: 0 });
  });
});

describe('computeClockOutTotals', () => {
  it('09:00 → 18:00 with a 60 min break = 8h worked', () => {
    const t = computeClockOutTotals({ clockInMs: ist('2026-10-08', '09:00'), clockOutMs: ist('2026-10-08', '18:00'), breakMinutes: 60, requiredHours: 8 });
    expect(t.workedHours).toBe(8);
    expect(t.workedMinutes).toBe(480);
    expect(t.earlyLogoutMinutes).toBe(0);
    expect(t.status).toBe('COMPLETED');
  });
  it('overnight 22:00 → 06:00 next day with 30 min break = 7.5h', () => {
    const t = computeClockOutTotals({ clockInMs: ist('2026-10-08', '22:00'), clockOutMs: ist('2026-10-09', '06:00'), breakMinutes: 30, requiredHours: 8 });
    expect(t.workedMinutes).toBe(450);
    expect(t.earlyLogoutMinutes).toBe(30);
  });
  it('extra time is never overtime', () => {
    const t = computeClockOutTotals({ clockInMs: ist('2026-10-08', '09:00'), clockOutMs: ist('2026-10-08', '20:00'), breakMinutes: 60, requiredHours: 8 });
    expect(t.extraMinutes).toBe(120);
    expect(t.overtimeMinutes).toBe(0);
  });
  it('less than half the required hours is a half day', () => {
    const t = computeClockOutTotals({ clockInMs: ist('2026-10-08', '09:00'), clockOutMs: ist('2026-10-08', '12:00'), breakMinutes: 0, requiredHours: 8 });
    expect(t.isHalfDay).toBe(true);
    expect(t.status).toBe('HALF_DAY');
    const full = computeClockOutTotals({ clockInMs: ist('2026-10-08', '09:00'), clockOutMs: ist('2026-10-08', '13:00'), breakMinutes: 0, requiredHours: 8 });
    expect(full.isHalfDay).toBe(false);
  });
  it('break time is never counted as work, and worked time is never negative', () => {
    const t = computeClockOutTotals({ clockInMs: ist('2026-10-08', '09:00'), clockOutMs: ist('2026-10-08', '09:30'), breakMinutes: 45, requiredHours: 8 });
    expect(t.workedMinutes).toBe(0);
  });
});
