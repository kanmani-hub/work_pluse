import { describe, it, expect } from 'vitest';
import { classifyPayrollDays, summarizeDays, REVIEW_PENDING_LEAVE, REVIEW_MISSING_CLOCK_OUT } from './attendanceClassification';
import { pendingLeaveBlockReason, appliedDeductions, monthWorkflowStatus, resolutionError, approvalBlockReason } from './payrollRules';
import { payrollMonthCards } from './payrollCardRules';

// 2026-11-02 live-audit fixes. Synthetic data only.
const base = {
  periodStart: '2026-10-19', periodEnd: '2026-10-25', today: '2026-11-02',
  workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], holidays: [] as string[],
  leaves: [] as any[],
};
const day = (days: any[], d: string) => days.find(x => x.date === d)!;
const worked = (d: string, o: any = {}) => ({ attendance_date: d, status: 'COMPLETED', clock_in_at: `${d}T04:30:00Z`, clock_out_at: `${d}T14:00:00Z`, ...o });
const fullWeek = () => ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-25'].map(d => worked(d));

describe('pending leave blocks approval (EMP016 case)', () => {
  const pendingLeaves = [{ start_date: '2026-10-23', end_date: '2026-10-24', isLop: false }];

  it('absence covered by a PENDING leave: still counted as absence, flagged PENDING_LEAVE', () => {
    const days = classifyPayrollDays({ ...base, attendance: fullWeek(), pendingLeaves });
    expect(day(days, '2026-10-23')).toMatchObject({ kind: 'ABSENT', absentLop: 1, reviewType: 'PENDING_LEAVE', review: REVIEW_PENDING_LEAVE });
    expect(day(days, '2026-10-24')).toMatchObject({ kind: 'ABSENT', reviewType: 'PENDING_LEAVE' });
    const sum = summarizeDays(days);
    expect(sum.absentDays).toBe(2);
    expect(sum.reviewItems.map(r => r.type)).toEqual(['PENDING_LEAVE', 'PENDING_LEAVE']);
  });

  it('once the leave is approved it is leave (no flag, no LOP); a pending request on a worked day changes nothing', () => {
    const approved = classifyPayrollDays({ ...base, attendance: fullWeek(), leaves: pendingLeaves });
    expect(day(approved, '2026-10-23')).toMatchObject({ kind: 'PAID_LEAVE', lop: 0, review: null });
    const workedDay = classifyPayrollDays({ ...base, attendance: [...fullWeek(), worked('2026-10-23'), worked('2026-10-24')], pendingLeaves });
    expect(summarizeDays(workedDay).reviewItems).toEqual([]);
  });

  it('the flag blocks approval and cannot be waived from payroll', () => {
    const remarks = JSON.stringify({ attendance: { reviewItems: [{ date: '2026-10-23', type: 'PENDING_LEAVE', reason: REVIEW_PENDING_LEAVE }] } });
    expect(approvalBlockReason(remarks, { gross_salary: 23000 })).toMatch(/1 attendance review flag/);
    expect(resolutionError({ status: 'UNDER_REVIEW', remarks }, '2026-10-23', 'PENDING_LEAVE', 'WAIVE', 'ok')).toMatch(/Leave Management/);
  });

  it('approval-time check names the pending dates; none pending → allowed', () => {
    expect(pendingLeaveBlockReason([{ start_date: '2026-10-23', end_date: '2026-10-24' }])).toMatch(/1 leave request\(s\).*2026-10-23 – 2026-10-24/);
    expect(pendingLeaveBlockReason([{ start_date: '2026-10-05', end_date: '2026-10-05' }])).toMatch(/\(2026-10-05\)/);
    expect(pendingLeaveBlockReason([])).toBeNull();
    expect(pendingLeaveBlockReason(null)).toBeNull();
  });
});

describe('missing clock-out in payroll (₹200 rule while the database workflow is not set up)', () => {
  const open = (d: string) => ({ attendance_date: d, status: 'LATE', clock_in_at: `${d}T06:30:00Z`, clock_out_at: null });

  it('a past day with clock-in and no clock-out is a worked day flagged MISSING_CLOCK_OUT (no deduction until decided)', () => {
    const days = classifyPayrollDays({ ...base, attendance: [...fullWeek(), open('2026-10-23')], missingClockOutReview: true });
    expect(day(days, '2026-10-23')).toMatchObject({ kind: 'PRESENT', lop: 0, reviewType: 'MISSING_CLOCK_OUT', review: REVIEW_MISSING_CLOCK_OUT, missingClockOutDeduction: false });
    expect(summarizeDays(days)).toMatchObject({ presentDays: 6, missingClockOutDeductionDays: 0 });
  });

  it('APPLY → counted for the fixed deduction; WAIVE → no deduction; both resolve the flag', () => {
    const applied = summarizeDays(classifyPayrollDays({ ...base, attendance: [open('2026-10-22'), open('2026-10-23')], missingClockOutReview: true,
      resolutions: { '2026-10-22|MISSING_CLOCK_OUT': 'APPLY', '2026-10-23|MISSING_CLOCK_OUT': 'WAIVE' } }));
    expect(applied.missingClockOutDeductionDays).toBe(1);
    expect(applied.reviewItems.filter(r => r.type === 'MISSING_CLOCK_OUT')).toEqual([]);
    expect(applied.resolvedReviews).toEqual(expect.arrayContaining([
      { date: '2026-10-22', type: 'MISSING_CLOCK_OUT', decision: 'APPLY' }, { date: '2026-10-23', type: 'MISSING_CLOCK_OUT', decision: 'WAIVE' }]));
  });

  it('not flagged when the review is off (deduction disabled, or the database workflow handles it), for today, or for a completed day', () => {
    expect(summarizeDays(classifyPayrollDays({ ...base, attendance: [open('2026-10-23')] })).reviewItems).toEqual([]);
    const todayOpen = classifyPayrollDays({ ...base, periodEnd: '2026-11-02', attendance: [open('2026-11-02')], missingClockOutReview: true });
    expect(day(todayOpen, '2026-11-02').reviewType).toBeNull();
    const closedNoOut = classifyPayrollDays({ ...base, attendance: [{ ...open('2026-10-23'), status: 'COMPLETED' }], missingClockOutReview: true });
    expect(day(closedNoOut, '2026-10-23').reviewType).toBeNull();
  });

  it('an overnight shift from yesterday that is still running is not flagged', () => {
    const days = classifyPayrollDays({ ...base, periodEnd: '2026-11-02', attendance: [{ ...open('2026-11-01'), shift_template: { crosses_midnight: true } }], missingClockOutReview: true });
    expect(day(days, '2026-11-01').reviewType).toBeNull();
  });
});

describe('month totals reconcile (₹700 case)', () => {
  const rows = [
    { id: 'a', employee_id: 'e1', status: 'APPROVED', gross_salary: 486000, overtime_amount: 0, total_deductions: 241772, lop_deduction: 200000, net_salary: 244228 },
    { id: 'b', employee_id: 'e2', status: 'UNDER_REVIEW', gross_salary: 0, overtime_amount: 0, total_deductions: 700, lop_deduction: 0, net_salary: 0 },
  ];
  it('a deduction above the earnings is only applied up to the earnings', () => {
    expect(appliedDeductions(rows[1])).toBe(0);
    expect(appliedDeductions(rows[0])).toBe(241772);
    expect(appliedDeductions({ gross_salary: 1000, overtime_amount: 0, total_deductions: 1500, net_salary: 0 })).toBe(1000);
  });
  it('cards: Gross − Deductions = Net; the unrecoverable part is reported separately', () => {
    const c = payrollMonthCards([], rows);
    expect(c.gross.amount - c.deductions.amount).toBe(c.net.amount);
    expect(c.deductions.rows.find(r => r.__key === 'b')).toMatchObject({ deductions: 0, notRecovered: 700, lop: 0 });
  });
});

describe('month workflow status', () => {
  it('is the least advanced status, flagged as mixed (October: 3 under review, 8 approved, 2 payment pending)', () => {
    const rows = [...Array(3)].map(() => ({ status: 'UNDER_REVIEW' })).concat([...Array(8)].map(() => ({ status: 'APPROVED' })), [...Array(2)].map(() => ({ status: 'PAYMENT_PENDING' })));
    expect(monthWorkflowStatus(rows)).toEqual({ status: 'UNDER_REVIEW', mixed: true, counts: { UNDER_REVIEW: 3, APPROVED: 8, PAYMENT_PENDING: 2 } });
  });
  it('all the same → that status, not mixed; empty → DRAFT', () => {
    expect(monthWorkflowStatus([{ status: 'PAID' }, { status: 'PAID' }])).toMatchObject({ status: 'PAID', mixed: false });
    expect(monthWorkflowStatus([])).toMatchObject({ status: 'DRAFT', mixed: false });
  });
});
