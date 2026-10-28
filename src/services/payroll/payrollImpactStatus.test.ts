import { describe, it, expect } from 'vitest';
import { evaluateDailyImpact } from './payrollImpactRules';
import { missingClockOutGraceHours } from '../attendance/missingClockOutRules';

// Synthetic data. Shift 09:00–18:00 IST on 2026-10-12 → ends 12:30 UTC.
const SHIFT = { start_time: '09:00:00', end_time: '18:00:00', crosses_midnight: false };
const att = (o: any = {}) => ({ attendance_date: '2026-10-12', clock_in_at: '2026-10-12T03:30:00Z', clock_out_at: null, status: 'WORKING', shift_template: SHIFT, ...o });
const calc = (app: any = {}) => ({ settings: {}, appSettings: app, deductionItems: [] });
const at = (iso: string) => new Date(iso).getTime();

describe('missing clock-out threshold (same setting as the server job)', () => {
  it('missingClockOutGraceHours: default 4 h, the saved grace, 0 for "at shift end"', () => {
    expect(missingClockOutGraceHours({})).toBe(4);
    expect(missingClockOutGraceHours(null)).toBe(4);
    expect(missingClockOutGraceHours({ autoClockOutGraceHours: 2 })).toBe(2);
    expect(missingClockOutGraceHours({ autoClockOutMode: 'at_shift_end', autoClockOutGraceHours: 48 })).toBe(0);
    expect(missingClockOutGraceHours({ autoClockOutGraceHours: -3 })).toBe(0);
  });

  it('default settings: still in progress 3 h after shift end (was flagged after 2 h before), missing after 4 h', () => {
    expect(evaluateDailyImpact({ attendance: att(), calculation: calc(), nowMs: at('2026-10-12T15:30:00Z') }).clockOutStatus).toBe('IN_PROGRESS');
    expect(evaluateDailyImpact({ attendance: att(), calculation: calc(), nowMs: at('2026-10-12T16:31:00Z') }).clockOutStatus).toBe('MISSING');
  });

  it('mode "at shift end": missing right after the shift end', () => {
    const r = evaluateDailyImpact({ attendance: att(), calculation: calc({ autoClockOutMode: 'at_shift_end', autoClockOutGraceHours: 48 }), nowMs: at('2026-10-12T12:31:00Z') });
    expect(r.clockOutStatus).toBe('MISSING');
    expect(r.impactStatus).toBe('PENDING');
  });

  it('the server flag MISSING_CLOCK_OUT is shown as missing whatever the local clock says', () => {
    expect(evaluateDailyImpact({ attendance: att({ status: 'MISSING_CLOCK_OUT' }), calculation: calc(), nowMs: at('2026-10-12T05:00:00Z') }).clockOutStatus).toBe('MISSING');
  });

  it('no clock-in (absence / leave): not a shift in progress; absence decided → FINAL, today not clocked in yet → PENDING', () => {
    const absent = evaluateDailyImpact({ attendance: att({ clock_in_at: null, status: 'ABSENT' }), calculation: { ...calc(), lopDeduction: 1000 }, dayKind: 'ABSENT' });
    expect(absent).toMatchObject({ clockOutStatus: 'NOT_CLOCKED_IN', isShiftInProgress: false, lopStatus: 'FINAL', impactStatus: 'FINAL', lopImpact: 1000 });
    const today = evaluateDailyImpact({ attendance: att({ clock_in_at: null, status: 'TODAY_PENDING' }), calculation: calc(), dayKind: 'TODAY_PENDING' });
    expect(today).toMatchObject({ clockOutStatus: 'NOT_CLOCKED_IN', lopStatus: 'PENDING', impactStatus: 'PENDING', totalDeductions: 0 });
  });
});
