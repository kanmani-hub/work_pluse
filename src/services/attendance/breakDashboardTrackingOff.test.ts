import { describe, it, expect } from 'vitest';
import { buildBreakReportRows } from './breakReportRules';

// Break Management columns for a "tracking OFF" automatic break, from the rows the database returns
// (getBreakReport: attendance + attendance_breaks). Synthetic data; Asia/Kolkata.
const NOW = Date.parse('2026-10-28T08:00:00Z');            // 13:30 IST
const att = (o: any = {}) => ({
  id: 'att1', employee_id: 'e1', attendance_date: '2026-10-28', clock_in_at: '2026-10-28T03:30:00Z', clock_out_at: null,
  status: 'WORKING', break_minutes: 0, break_overrun_minutes: 0,
  shift_template: { name: 'Day', break_duration_minutes: 30, crosses_midnight: false },
  employees: { first_name: 'Test', last_name: 'One', employee_code: 'E1' },
  attendance_breaks: [], ...o,
});
const autoBreak = (o: any = {}) => ({ id: 'b1', break_type: 'AUTO_TRACKING', source: 'SYSTEM', reason: 'LOCATION_PERMISSION_DENIED',
  started_at: '2026-10-28T07:20:00Z', ended_at: null, duration_minutes: null, ended_reason: null, ...o });
const rows = (attendanceRows: any[], extra: any = {}) => buildBreakReportRows({
  date: '2026-10-28', today: '2026-10-28', attendanceRows, employees: [], liveLocations: [], locationProblems: [], breakEndEvents: [],
  trackingStates: [{ employee_id: 'e1', attendance_id: 'att1', state: 'PERMISSION_DENIED', state_since: '2026-10-28T07:20:00Z', open_auto_break_id: 'b1' }],
  settingBreakMins: 60, nowMs: NOW, staleMinutes: 15, ...extra,
} as any);

describe('Break Management: tracking OFF automatic break', () => {
  it('active break: live 40 min, completed 0, stored 0 (payroll counts completed breaks), excess 10 over the 30-min shift allowance, ON_BREAK, tracking interrupted', () => {
    const [r] = rows([att({ attendance_breaks: [autoBreak()] })]);
    expect(r.summary).toMatchObject({ activeMins: 40, completedMins: 0, totalMins: 40, allowedMins: 30, excessMins: 10, status: 'ON_BREAK' });
    expect(r.storedBreakMins).toBe(0);
    expect(r.storedDiffers).toBe(false);              // not "settled" while a break is open
    expect(r.trackingInterrupted).toBe(true);
    expect(r.summary!.sessions[0]).toMatchObject({ state: 'ACTIVE', reason: 'LOCATION_PERMISSION_DENIED', source: 'SYSTEM' });
  });

  it('ended on recovery: completed 25 min = stored payroll minutes (database total), no live time', () => {
    const b = autoBreak({ ended_at: '2026-10-28T07:45:00Z', duration_minutes: 25, ended_reason: 'TRACKING_RESTORED' });
    const [r] = rows([att({ attendance_breaks: [b], break_minutes: 25 })], { trackingStates: [] });
    expect(r.summary).toMatchObject({ activeMins: 0, completedMins: 25, totalMins: 25, excessMins: 0, status: 'WITHIN' });
    expect(r.storedBreakMins).toBe(25);
    expect(r.storedDiffers).toBe(false);
    expect(r.summary!.sessions[0]).toMatchObject({ state: 'COMPLETED', ended_reason: 'TRACKING_RESTORED' });
  });

  it('a stored value that differs from the sessions is flagged, never hidden', () => {
    const b = autoBreak({ ended_at: '2026-10-28T07:45:00Z', duration_minutes: 25 });
    const [r] = rows([att({ attendance_breaks: [b], break_minutes: 0 })], { trackingStates: [] });
    expect(r.storedDiffers).toBe(true);
  });

  it('cancelled (discarded) and duplicate sessions are excluded; a manual break and the automatic one are both counted once', () => {
    const manual = { id: 'm1', break_type: 'REGULAR', source: 'MANUAL', started_at: '2026-10-28T06:00:00Z', ended_at: '2026-10-28T06:15:00Z' };
    const cancelled = autoBreak({ id: 'c1', break_type: 'CANCELLED', started_at: '2026-10-28T05:00:00Z', ended_at: '2026-10-28T05:30:00Z' });
    const done = autoBreak({ ended_at: '2026-10-28T07:30:00Z' });
    const [r] = rows([att({ attendance_breaks: [manual, cancelled, done, done], break_minutes: 25 })], { trackingStates: [] });
    expect(r.summary).toMatchObject({ completedMins: 25, duplicateCount: 1 });
    expect(r.summary!.sessions.map(s => s.id)).toEqual(['m1', 'b1']);
  });

  it('no shift allowance → the Settings break duration (60) is used', () => {
    const [r] = rows([att({ shift_template: { name: 'Flexi', break_duration_minutes: null }, attendance_breaks: [autoBreak()] })]);
    expect(r.summary).toMatchObject({ allowedMins: 60, excessMins: 0 });
  });

  it('missing / invalid timestamps are not counted and are reported, not shown as 0 confirmed', () => {
    const [r] = rows([att({ attendance_breaks: [autoBreak({ started_at: null }), autoBreak({ id: 'b2', started_at: 'not-a-date' })] })]);
    expect(r.summary).toMatchObject({ invalidCount: 2, totalMins: 0, status: 'UNVERIFIED' });
  });

  it('break rows not returned by the database → "not loaded", never a confirmed 0', () => {
    const [r] = rows([att({ attendance_breaks: null })]);
    expect(r.summary).toMatchObject({ breaksUnavailable: true, status: 'UNVERIFIED', excessMins: null });
  });

  it('no break rows at all → 0 / 0 / 0 "No Breaks Recorded" (the zero-minute screen = no break was created)', () => {
    const [r] = rows([att()], { trackingStates: [] });
    expect(r.summary).toMatchObject({ activeMins: 0, completedMins: 0, totalMins: 0, status: 'NO_BREAKS', breaksUnavailable: false });
    expect(r.storedBreakMins).toBe(0);
  });

  it('IST date boundary: a break started 23:50 IST yesterday on an overnight shift is still live after midnight', () => {
    const night = att({ id: 'att1', attendance_date: '2026-10-27', clock_in_at: '2026-10-27T16:30:00Z',
      shift_template: { name: 'Night', break_duration_minutes: 30, crosses_midnight: true, start_time: '22:00:00', end_time: '06:00:00' },
      attendance_breaks: [autoBreak({ started_at: '2026-10-27T18:20:00Z' })] });
    const r = buildBreakReportRows({ date: '2026-10-27', today: '2026-10-28', attendanceRows: [night], employees: [], liveLocations: [], locationProblems: [],
      breakEndEvents: [], trackingStates: [], settingBreakMins: 60, nowMs: Date.parse('2026-10-27T19:00:00Z'), staleMinutes: 15 } as any)[0];
    expect(r.summary).toMatchObject({ activeMins: 40, status: 'ON_BREAK', invalidCount: 0 });
  });
});
