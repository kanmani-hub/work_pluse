import { describe, it, expect } from 'vitest';
import {
  detectMissingClockOut, evaluateClockOutClaim, validateMissingClockOutSubmission, validateMissingClockOutReview,
  duplicateOpenAttendance, adjustmentsForPayroll, missingClockOutPayrollLines, missingClockOutPayrollStatus,
  adjustmentReference, normalizeLimitHours, companyLocalToIso, isoToCompanyLocal, isMissingClockOutSchemaError,
  caseStatusLabel, staleMissingClockOutReason,
  DEFAULT_MAX_ADDITIONAL_HOURS, type PayrollAdjustment,
} from './missingClockOutRules';
import { estimateOvertime } from '../overtime/overtimeRules';
import { classifyPayrollDays, summarizeDays } from '../payroll/attendanceClassification';

// Synthetic data only. Company time is IST (UTC+05:30).
const DAY = { start_time: '09:00', end_time: '17:00', required_hours: 8, name: 'Day', crosses_midnight: false } as any;
const NIGHT = { start_time: '22:00', end_time: '06:00', required_hours: 8, name: 'Night', crosses_midnight: true } as any;
const ist = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`).toISOString();
const att = (over: any = {}) => ({ id: 'a1', employee_id: 'e1', attendance_date: '2026-10-05', clock_in_at: ist('2026-10-05', '09:00'), clock_out_at: null, required_hours: 8, is_half_day: false, status: 'IN_PROGRESS', ...over });
const NOW = Date.parse(ist('2026-10-07', '12:00'));
const evalAt = (out: string, extra: any = {}) => evaluateClockOutClaim({ attendance: att(), shift: DAY, breaks: [], claimedClockOutIso: out, nowMs: NOW, limitHours: 3, ...extra });

describe('missing clock-out detection (case 5, 13, 16)', () => {
  it('case 5: open attendance after shift end + grace is flagged; nothing is assumed', () => {
    const d = detectMissingClockOut(att(), DAY, Date.parse(ist('2026-10-05', '21:01')), 4);
    expect(d.state).toBe('MISSING_CLOCK_OUT');
    expect(d.shiftEndMs).toBe(Date.parse(ist('2026-10-05', '17:00')));
    // no clock-out is invented: the input is unchanged and the detection carries no clock-out time
    expect(Object.keys(d)).not.toContain('clockOutAt');
  });
  it('still in progress before shift end + grace', () => {
    expect(detectMissingClockOut(att(), DAY, Date.parse(ist('2026-10-05', '20:59')), 4).state).toBe('IN_PROGRESS');
  });
  it('a day with a clock-out is not applicable', () => {
    expect(detectMissingClockOut(att({ clock_out_at: ist('2026-10-05', '17:00') }), DAY, NOW, 4).state).toBe('NOT_APPLICABLE');
  });
  it('case 13: an overnight shift ends the next morning (flag on the next day, not at midnight)', () => {
    const night = att({ clock_in_at: ist('2026-10-05', '22:00') });
    expect(detectMissingClockOut(night, NIGHT, Date.parse(ist('2026-10-06', '05:00')), 0).state).toBe('IN_PROGRESS');
    const d = detectMissingClockOut(night, NIGHT, Date.parse(ist('2026-10-06', '06:00')), 0);
    expect(d.state).toBe('MISSING_CLOCK_OUT');
    expect(d.shiftEndMs).toBe(Date.parse(ist('2026-10-06', '06:00')));
  });
  it('no shift: only flagged 24 hours after clock-in', () => {
    expect(detectMissingClockOut(att(), null, Date.parse(ist('2026-10-06', '08:59')), 4).state).toBe('IN_PROGRESS');
    expect(detectMissingClockOut(att(), null, Date.parse(ist('2026-10-06', '09:00')), 4).state).toBe('MISSING_CLOCK_OUT');
  });
  it('case 16: detection never uses location; no GPS input exists and the result has no timestamp beyond the schedule', () => {
    expect(detectMissingClockOut.length).toBe(4); // attendance, shift, now, grace: no location parameter
    const d = detectMissingClockOut(att(), DAY, NOW, 0);
    expect(d.flagAtMs).toBe(d.shiftEndMs);
  });
  it('duplicate clock-ins: more than one open attendance per employee is reported', () => {
    const rows = [
      { id: 'x1', employee_id: 'e1', clock_in_at: 'a', clock_out_at: null },
      { id: 'x2', employee_id: 'e1', clock_in_at: 'b', clock_out_at: null },
      { id: 'x3', employee_id: 'e2', clock_in_at: 'c', clock_out_at: null },
      { id: 'x4', employee_id: 'e2', clock_in_at: 'd', clock_out_at: 'e' },
    ];
    expect(duplicateOpenAttendance(rows)).toEqual({ e1: ['x1', 'x2'] });
  });
});

describe('additional working time and the configurable limit (cases 1–4, 6, 13)', () => {
  it('case 1: clocking out on time needs no overtime request (no additional time)', () => {
    const e = estimateOvertime({ ...att(), clock_out_at: ist('2026-10-05', '17:00') }, DAY, [], {});
    expect(e.potentialMinutes).toBe(0);
    const c = evalAt(ist('2026-10-05', '17:00'));
    expect(c.ok).toBe(true);
    expect(c.claimedAdditionalHours).toBe(0);
    expect(validateMissingClockOutSubmission(c, 0.5, 'Finished the release notes')).toBe('There is no additional working time after your shift to request.');
    expect(validateMissingClockOutSubmission(c, 0, 'Forgot to clock out at the gate')).toBeNull();
  });
  it('case 2: one hour beyond the shift = 1 hour of potential overtime', () => {
    const c = evalAt(ist('2026-10-05', '18:00'));
    expect(c).toMatchObject({ ok: true, scheduledMinutes: 480, workedMinutes: 540, additionalMinutes: 60, eligibleHours: 1, excessHours: 0 });
  });
  it('case 3: exactly 3 additional hours is within the configured limit', () => {
    const c = evalAt(ist('2026-10-05', '20:00'));
    expect(c).toMatchObject({ ok: true, claimedAdditionalHours: 3, eligibleHours: 3, excessHours: 0, limitHours: 3 });
    expect(validateMissingClockOutSubmission(c, 3, 'Production deployment')).toBeNull();
    expect(validateMissingClockOutSubmission(c, 3.01, 'Production deployment')).toMatch('at most 3 hours');
  });
  it('case 4: more than 3 additional hours: the excess is flagged, not discarded', () => {
    const c = evalAt(ist('2026-10-05', '21:30'));
    expect(c).toMatchObject({ ok: true, claimedAdditionalHours: 4.5, eligibleHours: 3, excessHours: 1.5 });
    expect(c.claimedAdditionalHours).toBe(c.eligibleHours + c.excessHours);
  });
  it('the limit is configurable (not hard-coded 3) and invalid settings fall back to the default', () => {
    expect(evalAt(ist('2026-10-05', '21:30'), { limitHours: 5 })).toMatchObject({ eligibleHours: 4.5, excessHours: 0 });
    expect(evalAt(ist('2026-10-05', '21:30'), { limitHours: 2 })).toMatchObject({ eligibleHours: 2, excessHours: 2.5 });
    expect(normalizeLimitHours('abc')).toBe(DEFAULT_MAX_ADDITIONAL_HOURS);
    expect(normalizeLimitHours(-1)).toBe(DEFAULT_MAX_ADDITIONAL_HOURS);
    expect(normalizeLimitHours(0)).toBe(0);
  });
  it('late arrival is made up first and completed breaks are excluded', () => {
    const late = evaluateClockOutClaim({ attendance: att({ clock_in_at: ist('2026-10-05', '10:00') }), shift: DAY, breaks: [], claimedClockOutIso: ist('2026-10-05', '19:00'), nowMs: NOW, limitHours: 3 });
    expect(late).toMatchObject({ lateMinutes: 60, additionalMinutes: 0 });
    const withBreak = evaluateClockOutClaim({ attendance: att(), shift: DAY, breaks: [{ started_at: ist('2026-10-05', '13:00'), ended_at: ist('2026-10-05', '14:00'), duration_minutes: 60 } as any], claimedClockOutIso: ist('2026-10-05', '19:00'), nowMs: NOW, limitHours: 3 });
    expect(withBreak.additionalMinutes).toBe(60);
  });
  it('case 6: a claim is never verified by itself', () => {
    expect(evalAt(ist('2026-10-05', '19:00')).verified).toBe(false);
  });
  it('case 13: overnight shift crossing midnight uses the shift date and real hours', () => {
    const c = evaluateClockOutClaim({ attendance: att({ clock_in_at: ist('2026-10-05', '22:00') }), shift: NIGHT, breaks: [], claimedClockOutIso: ist('2026-10-06', '07:30'), nowMs: NOW, limitHours: 3 });
    expect(c).toMatchObject({ ok: true, workedMinutes: 570, additionalMinutes: 90, eligibleHours: 1.5 });
  });
  it('invalid claims get clear messages', () => {
    expect(evalAt('nonsense').error).toBe('Enter a valid clock-out date and time.');
    expect(evalAt(ist('2026-10-05', '08:00')).error).toBe('The clock-out time must be after your clock-in time.');
    expect(evalAt(ist('2026-10-08', '08:00')).error).toBe('The clock-out time cannot be in the future.');
    expect(evaluateClockOutClaim({ attendance: att(), shift: DAY, breaks: [], claimedClockOutIso: ist('2026-10-06', '10:00'), nowMs: NOW, limitHours: 3 }).error).toMatch('within 24 hours');
    expect(evaluateClockOutClaim({ attendance: att(), shift: null, breaks: [], claimedClockOutIso: ist('2026-10-05', '18:00'), nowMs: NOW, limitHours: 3 }).error).toMatch('No shift');
    expect(evaluateClockOutClaim({ attendance: att({ clock_out_at: ist('2026-10-05', '17:00') }), shift: DAY, breaks: [], claimedClockOutIso: ist('2026-10-05', '18:00'), nowMs: NOW, limitHours: 3 }).error).toBe('This attendance already has a clock-out.');
    expect(evaluateClockOutClaim({ attendance: att(), shift: DAY, breaks: [{ started_at: ist('2026-10-05', '17:30'), ended_at: ist('2026-10-05', '18:30') } as any], claimedClockOutIso: ist('2026-10-05', '18:00'), nowMs: NOW, limitHours: 3 }).error).toMatch('last break');
  });
  it('the reason is mandatory and hours are validated', () => {
    const c = evalAt(ist('2026-10-05', '19:00'));
    expect(validateMissingClockOutSubmission(c, 1, '')).toMatch('at least 10 characters');
    expect(validateMissingClockOutSubmission(c, -1, 'Long enough reason')).toBe('Requested overtime cannot be negative.');
    expect(validateMissingClockOutSubmission(c, 1.234, 'Long enough reason')).toBe('Use at most 2 decimal places.');
  });
});

describe('admin review rules (cases 7, 8, 11, 12)', () => {
  const v = evalAt(ist('2026-10-05', '19:00'));
  const base = { decision: 'APPROVED' as const, remarks: '', requestedHours: 2, verified: v, approvedHours: 2, reviewerEmployeeId: 'admin1', requestEmployeeId: 'e1', requestStatus: 'PENDING' };
  it('case 12: an employee cannot approve (review) their own request', () => {
    expect(validateMissingClockOutReview({ ...base, reviewerEmployeeId: 'e1' })).toBe('You cannot review your own request.');
  });
  it('case 11: a request that is no longer pending cannot be decided again', () => {
    expect(validateMissingClockOutReview({ ...base, requestStatus: 'APPROVED' })).toBe('This request has already been approved.');
  });
  it('case 8: rejecting needs a reason', () => {
    expect(validateMissingClockOutReview({ ...base, decision: 'REJECTED' })).toBe('Please give a reason for rejecting.');
    expect(validateMissingClockOutReview({ ...base, decision: 'REJECTED', remarks: 'Gate log shows 17:05' })).toBeNull();
  });
  it('case 7: approving needs a verified clock-out and hours within the verified time and the request', () => {
    expect(validateMissingClockOutReview({ ...base, verified: null })).toBe('Enter the verified clock-out time.');
    expect(validateMissingClockOutReview(base)).toBeNull();
    expect(validateMissingClockOutReview({ ...base, approvedHours: 2.5 })).toMatch('requested 2 hours');
    const shorter = evalAt(ist('2026-10-05', '18:00'));
    expect(validateMissingClockOutReview({ ...base, verified: shorter })).toMatch('Cannot approve more than 1 hours');
  });
});

describe('payroll adjustments (cases 7, 8, 9, 11, 15)', () => {
  const adj = (over: Partial<PayrollAdjustment>): PayrollAdjustment => ({ id: 'x', reference: 'r', kind: 'MISSING_CLOCK_OUT_DEDUCTION', status: 'PENDING', work_date: '2026-10-05', amount: 500, hours: null, ...over });
  it('unique reference per case and kind', () => {
    expect(adjustmentReference.deduction('a1')).toBe('MCO-DED:a1');
    expect(adjustmentReference.reversal('a1')).toBe('MCO-REV:a1');
    expect(adjustmentReference.deferredOvertime('r1')).toBe('MCO-OT:r1');
  });
  it('case 8: a rejected case\'s deduction is included as its own line, only while PENDING and up to the period end', () => {
    const list = [adj({ id: 'd1' }), adj({ id: 'd2', status: 'SETTLED' }), adj({ id: 'd3', status: 'CANCELLED' }), adj({ id: 'd4', work_date: '2026-11-02' })];
    const lines = missingClockOutPayrollLines(list, '2026-10-31', { overtimePayEnabled: true });
    expect(lines.ids).toEqual(['d1']);
    expect(lines.deduction).toEqual({ name: 'Missing Clock-Out Deduction (1 case)', amount: 500 });
  });
  it('case 7 / 11: a reversal is one earning line; a cancelled deduction adds nothing', () => {
    const lines = missingClockOutPayrollLines([adj({ id: 'v1', kind: 'MISSING_CLOCK_OUT_REVERSAL' }), adj({ id: 'd1', status: 'CANCELLED' })], '2026-10-31', { overtimePayEnabled: true });
    expect(lines.reversal).toEqual({ name: 'Missing Clock-Out Deduction Reversal (1 case)', amount: 500 });
    expect(lines.deduction).toBeNull();
    expect(lines.ids).toEqual(['v1']);
  });
  it('case 15: overtime approved after its month was locked is paid in a later payroll as deferred overtime', () => {
    const list = [adj({ id: 'o1', kind: 'DEFERRED_OVERTIME', amount: null, hours: 1.5, work_date: '2026-09-29' })];
    expect(missingClockOutPayrollLines(list, '2026-10-31', { overtimePayEnabled: true })).toMatchObject({ ids: ['o1'], deferredOvertimeMinutes: 90 });
    // overtime pay switched off: not included, so it is not settled for nothing
    expect(missingClockOutPayrollLines(list, '2026-10-31', { overtimePayEnabled: false })).toMatchObject({ ids: [], deferredOvertimeMinutes: 0 });
  });
  it('case 9: pending at cutoff: no deduction exists yet, so nothing is deducted and the status says so', () => {
    expect(missingClockOutPayrollLines([], '2026-10-31', { overtimePayEnabled: true })).toMatchObject({ ids: [], deduction: null, reversal: null });
    expect(missingClockOutPayrollStatus({ status: 'PENDING' }, [])).toBe('Pending approval: no deduction yet (deferred until the decision).');
  });
  it('repeated calculation of the same rows gives the same totals (idempotent)', () => {
    const list = [adj({ id: 'd1' }), adj({ id: 'd2', amount: 250.5 })];
    expect(adjustmentsForPayroll(list, '2026-10-31')).toEqual(adjustmentsForPayroll(list, '2026-10-31'));
    expect(adjustmentsForPayroll(list, '2026-10-31').deductionAmount).toBe(750.5);
  });
  it('status text shows pending, applied and reversed deductions', () => {
    expect(missingClockOutPayrollStatus({ status: 'REJECTED' }, [adj({})])).toMatch('will be applied in the next payroll');
    expect(missingClockOutPayrollStatus({ status: 'REJECTED' }, [adj({ status: 'SETTLED', settled_month: 10, settled_year: 2026 })])).toMatch('applied in 10/2026 payroll');
    expect(missingClockOutPayrollStatus({ status: 'APPROVED' }, [adj({ status: 'SETTLED' }), adj({ kind: 'MISSING_CLOCK_OUT_REVERSAL' })])).toMatch('Deduction reversed');
    expect(missingClockOutPayrollStatus({ status: 'APPROVED' }, [adj({ status: 'CANCELLED' })])).toBe('No deduction (request approved).');
  });
});

describe('company-time input helpers and schema detection', () => {
  it('converts datetime-local (IST) both ways', () => {
    expect(companyLocalToIso('2026-10-05T18:30')).toBe('2026-10-05T13:00:00.000Z');
    expect(isoToCompanyLocal('2026-10-05T13:00:00.000Z')).toBe('2026-10-05T18:30');
    expect(companyLocalToIso('')).toBeNull();
    expect(companyLocalToIso('2026-10-05 18:30')).toBeNull();
  });
  it('recognises "not set up" errors only', () => {
    expect(isMissingClockOutSchemaError({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
    expect(isMissingClockOutSchemaError({ code: '42P01', message: 'relation "payroll_adjustments" does not exist' })).toBe(true);
    expect(isMissingClockOutSchemaError({ code: '08006', message: 'connection failure' })).toBe(false);
    expect(isMissingClockOutSchemaError(null)).toBe(false);
  });
});

describe('no full-day or half-day deduction because a clock-out is missing', () => {
  it('a flagged day with a clock-in counts as present (no LOP, no half day, no review flag)', () => {
    const days = classifyPayrollDays({
      periodStart: '2026-10-05', periodEnd: '2026-10-05', today: '2026-10-31', joiningDate: '2025-01-01',
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], holidays: [], leaves: [],
      attendance: [{ attendance_date: '2026-10-05', status: 'MISSING_CLOCK_OUT', clock_in_at: ist('2026-10-05', '09:00'), clock_out_at: null, is_half_day: false }],
    });
    expect(days[0].kind).toBe('PRESENT');
    const sum = summarizeDays(days);
    expect(sum).toMatchObject({ lopDays: 0, halfDays: 0, absentDays: 0 });
    expect(sum.reviewItems).toEqual([]);
  });
});

describe('code review fixes', () => {
  it('a claimed clock-out cannot be before the start of a break that is still open', () => {
    const open = [{ started_at: ist('2026-10-05', '18:30'), ended_at: null } as any];
    expect(evalAt(ist('2026-10-05', '18:00'), { breaks: open }).error).toBe('The clock-out time cannot be before the start of a break that is still open.');
    expect(evalAt(ist('2026-10-05', '19:00'), { breaks: open }).ok).toBe(true);
    expect(evalAt(ist('2026-10-05', '18:00'), { breaks: [{ ...open[0], break_type: 'CANCELLED' }] }).ok).toBe(true);
  });
  it('a cancelled correction leaves the day a missing clock-out', () => {
    expect(caseStatusLabel({ request: { status: 'CANCELLED' } })).toBe('Missing Clock-Out');
    expect(caseStatusLabel({ request: { status: 'PENDING' } })).toBe('Pending Approval');
    expect(caseStatusLabel({ request: null })).toBe('Missing Clock-Out');
  });
  it('a payroll calculated before a correction of its period was approved is stale', () => {
    const p = { period_start: '2026-10-01', period_end: '2026-10-31', calculated_at: '2026-10-20T10:00:00Z' };
    expect(staleMissingClockOutReason([{ work_date: '2026-10-05', reviewed_at: '2026-10-21T09:00:00Z' }], p)).toMatch('Recalculate the payroll, then approve.');
    expect(staleMissingClockOutReason([{ work_date: '2026-10-05', reviewed_at: '2026-10-19T09:00:00Z' }], p)).toBeNull();
    expect(staleMissingClockOutReason([{ work_date: '2026-09-28', reviewed_at: '2026-10-21T09:00:00Z' }], p)).toBeNull(); // other period: deferred adjustment
    expect(staleMissingClockOutReason([{ work_date: '2026-10-05', reviewed_at: null }], p)).toMatch('Recalculate'); // unknown time: refuse
    expect(staleMissingClockOutReason([{ work_date: '2026-10-05', reviewed_at: '2026-10-01T00:00:00Z' }], { ...p, calculated_at: null })).toMatch('Recalculate');
    expect(staleMissingClockOutReason([], p)).toBeNull();
  });
});
