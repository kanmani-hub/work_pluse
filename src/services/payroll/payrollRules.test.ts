import { describe, it, expect } from 'vitest';
import { PAYROLL_TRANSITIONS, canTransitionPayroll, statusChangeError, paymentBlockReason, approvedOvertimeMinutes, overtimePayAmount } from './payrollRules';
import {
  canRecordPayment, validatePaymentAmount, isPayrollLocked, payrollPeriodOf,
  validatePaymentDate, paymentDateToTimestamp, paymentRpcErrorMessage,
} from './payrollRules';

describe('payroll status transitions (one forward path)', () => {
  it('allows only the next step', () => {
    expect(canTransitionPayroll('CALCULATED', 'UNDER_REVIEW')).toBe(true);
    expect(canTransitionPayroll('DRAFT', 'UNDER_REVIEW')).toBe(true);
    expect(canTransitionPayroll('UNDER_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionPayroll('APPROVED', 'PAYMENT_PENDING')).toBe(true);
    expect(canTransitionPayroll('PAYMENT_PENDING', 'PAID')).toBe(true);
    expect(canTransitionPayroll('PAID', 'CLOSED')).toBe(true);
  });
  it('refuses skips, reversals, repeats and anything after CLOSED', () => {
    expect(canTransitionPayroll('UNDER_REVIEW', 'PAYMENT_PENDING')).toBe(false);
    expect(canTransitionPayroll('APPROVED', 'PAID')).toBe(false);
    expect(canTransitionPayroll('PAID', 'PAYMENT_PENDING')).toBe(false);
    expect(canTransitionPayroll('PAID', 'PAID')).toBe(false);
    expect(PAYROLL_TRANSITIONS.CLOSED).toEqual([]);
    expect(canTransitionPayroll('CLOSED', 'PAID')).toBe(false);
    expect(canTransitionPayroll(undefined, 'APPROVED')).toBe(false);
  });
  it('a generic status change can never set PAID (only recording a payment can)', () => {
    expect(statusChangeError('PAYMENT_PENDING', 'PAID')).toBe('Use "Record payment" to mark a payroll as paid.');
    expect(statusChangeError('APPROVED', 'APPROVED')).toBe('Payroll is already APPROVED.');
    expect(statusChangeError('UNDER_REVIEW', 'APPROVED')).toBeNull();
  });
});

describe('payment guard (paid at most once)', () => {
  it('only PAYMENT_PENDING with no existing payment can be paid', () => {
    expect(paymentBlockReason('PAYMENT_PENDING', 0)).toBeNull();
    expect(paymentBlockReason('PAID', 0)).toBe('This payroll has already been paid.');
    expect(paymentBlockReason('CLOSED', 1)).toBe('This payroll has already been paid.');
    expect(paymentBlockReason('PAYMENT_PENDING', 1)).toBe('A payment is already recorded for this payroll.');
    expect(paymentBlockReason('APPROVED', 0)).toMatch('must be in PAYMENT_PENDING');
  });
});

describe('approved overtime only', () => {
  it('pending, rejected and cancelled requests contribute nothing', () => {
    expect(approvedOvertimeMinutes([
      { status: 'APPROVED', approved_overtime_hours: 1.5 },
      { status: 'PENDING', approved_overtime_hours: null },
      { status: 'REJECTED', approved_overtime_hours: 2 },
      { status: 'CANCELLED', approved_overtime_hours: 3 },
      { status: 'APPROVED', approved_overtime_hours: 0.25 },
    ])).toBe(105);
    expect(approvedOvertimeMinutes([])).toBe(0);
  });
  it('pay uses the existing rate rules on approved minutes only', () => {
    // daily ₹200 → hourly ₹25; 60 approved minutes × 1.5 = ₹37.50
    expect(overtimePayAmount({ enableOvertimePay: true, approvedOvertimeMinutes: 60, dailyRate: 200, overtimeRateType: 'multiplier', overtimeMultiplier: 1.5 })).toBe(37.5);
    expect(overtimePayAmount({ enableOvertimePay: true, approvedOvertimeMinutes: 90, dailyRate: 200, overtimeRateType: 'fixed', overtimeFixedRate: 100 })).toBe(150);
    expect(overtimePayAmount({ enableOvertimePay: true, approvedOvertimeMinutes: 0, dailyRate: 200, overtimeRateType: 'multiplier' })).toBe(0);
    expect(overtimePayAmount({ enableOvertimePay: false, approvedOvertimeMinutes: 60, dailyRate: 200, overtimeRateType: 'multiplier' })).toBe(0);
  });
});

// ---------------- confirmed payment / overtime policies ----------------

describe('payment amount must equal the approved net salary exactly', () => {
  it('accepts the exact amount (to the paisa)', () => {
    expect(validatePaymentAmount(5000, 5000)).toBeNull();
    expect(validatePaymentAmount(4987.5, '4987.50')).toBeNull();
    expect(validatePaymentAmount(0, 0)).toBeNull();
  });
  it('refuses partial, over-, negative, non-finite and non-numeric amounts', () => {
    expect(validatePaymentAmount(4999.99, 5000)).toBe('Payment must equal the approved net salary of ₹5000.00.');
    expect(validatePaymentAmount(5000.01, 5000)).toBe('Payment must equal the approved net salary of ₹5000.00.');
    expect(validatePaymentAmount(-1, 5000)).toBe('Payment amount cannot be negative.');
    expect(validatePaymentAmount(NaN, 5000)).toBe('Enter a valid payment amount.');
    expect(validatePaymentAmount(Infinity, 5000)).toBe('Enter a valid payment amount.');
    expect(validatePaymentAmount('5000' as any, 5000)).toBe('Enter a valid payment amount.');
    expect(validatePaymentAmount(undefined as any, 5000)).toBe('Enter a valid payment amount.');
    expect(validatePaymentAmount(100, null)).toBe('This payroll has no valid net salary to pay.');
  });
});

describe('who may record payments', () => {
  it('ADMIN only', () => {
    expect(canRecordPayment('ADMIN')).toBe(true);
    expect(canRecordPayment('admin')).toBe(true);
    expect(canRecordPayment('HR')).toBe(false);
    expect(canRecordPayment('EMPLOYEE')).toBe(false);
    expect(canRecordPayment(null)).toBe(false);
  });
});

describe('locked months and payment dates', () => {
  it('locked = APPROVED, PAYMENT_PENDING, PAID, CLOSED', () => {
    expect(['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'].every(isPayrollLocked)).toBe(true);
    expect(['DRAFT', 'CALCULATED', 'UNDER_REVIEW', undefined].some(s => isPayrollLocked(s as any))).toBe(false);
    expect(payrollPeriodOf('2026-09-30')).toEqual({ year: 2026, month: 9 });
    expect(payrollPeriodOf('bad')).toBeNull();
  });
  it('payment date: real, not in the future; stored at midday IST', () => {
    expect(validatePaymentDate('2026-10-09', '2026-10-09')).toBeNull();
    expect(validatePaymentDate(undefined, '2026-10-09')).toBeNull();
    expect(validatePaymentDate('2026-10-10', '2026-10-09')).toBe('Payment date cannot be in the future.');
    expect(validatePaymentDate('09/10/2026', '2026-10-09')).toBe('Enter a valid payment date.');
    expect(paymentDateToTimestamp('2026-10-09')).toBe('2026-10-09T12:00:00+05:30');
    expect(paymentDateToTimestamp(undefined)).toBeNull();
  });
  it('maps database-function errors without inventing success', () => {
    expect(paymentRpcErrorMessage({ code: 'PGRST202', message: 'Could not find the function public.record_payroll_payment' }))
      .toBe('Payment recording is not set up in the database yet (function record_payroll_payment is missing). No payment was recorded.');
    expect(paymentRpcErrorMessage({ code: 'P0001', message: 'This payroll has already been paid.' })).toBe('Payment was not recorded: This payroll has already been paid.');
    expect(paymentRpcErrorMessage(null)).toBe('Payment was not recorded.');
  });
});

import { approvalBlockReason, unresolvedReviewItems, resolutionError, resolutionMap, parsePayrollSnapshot, WFH_DEDUCTION_POLICY_APPROVED } from './payrollRules';

describe('attendance review flags (policy 2026-10-09)', () => {
  const snap = (items: any[], resolutions: any[] = []) => JSON.stringify({ attendance: { reviewItems: items }, reviewResolutions: resolutions });
  const flag = { date: '2026-10-06', type: 'SHORT_DAY', reason: 'Short working day' };

  it('approval is blocked while flags are unresolved, allowed when none remain', () => {
    expect(approvalBlockReason(snap([flag, { ...flag, date: '2026-10-07' }]))).toBe('Cannot approve: 2 attendance review flag(s) are unresolved. Resolve each flag (Apply or Waive) in the payroll details first.');
    expect(approvalBlockReason(snap([]))).toBeNull();
  });

  it('payrolls without a stored snapshot (calculated before this change) are not blocked', () => {
    expect(approvalBlockReason(null)).toBeNull();
    expect(approvalBlockReason('not json')).toBeNull();
    expect(unresolvedReviewItems(JSON.stringify({ attendance: {} }))).toEqual([]);
    expect(parsePayrollSnapshot('not json')).toBeNull();
  });

  it('a resolution needs CALCULATED / UNDER_REVIEW, APPLY or WAIVE, a note, and an open flag', () => {
    const p = (status: string) => ({ status, remarks: snap([flag]) });
    expect(resolutionError(p('UNDER_REVIEW'), '2026-10-06', 'SHORT_DAY', 'APPLY', 'Confirmed early exit')).toBeNull();
    expect(resolutionError(p('CALCULATED'), '2026-10-06', 'SHORT_DAY', 'WAIVE', 'Manager approved')).toBeNull();
    for (const st of ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED']) {
      expect(resolutionError(p(st), '2026-10-06', 'SHORT_DAY', 'APPLY', 'x')).toBe(`Review flags can only be resolved before approval (current status: ${st}).`);
    }
    expect(resolutionError(p('UNDER_REVIEW'), '2026-10-06', 'SHORT_DAY', 'DELETE', 'x')).toBe('Choose Apply or Waive.');
    expect(resolutionError(p('UNDER_REVIEW'), '2026-10-06', 'SHORT_DAY', 'APPLY', '   ')).toBe('Enter a note explaining the decision.');
    expect(resolutionError(p('UNDER_REVIEW'), '2026-10-09', 'SHORT_DAY', 'APPLY', 'x')).toMatch('not open on this payroll');
    expect(resolutionError(p('UNDER_REVIEW'), '2026-10-06', 'HALF_DAY_LEAVE_UNCOVERED', 'APPLY', 'x')).toMatch('not open on this payroll');
    expect(resolutionError(null, '2026-10-06', 'SHORT_DAY', 'APPLY', 'x')).toBe('Payroll not found.');
  });

  it('stored resolutions become the classification lookup (invalid entries ignored)', () => {
    expect(resolutionMap([
      { date: '2026-10-06', type: 'SHORT_DAY', decision: 'APPLY', note: 'n', by: 'a', at: 't' },
      { date: '2026-10-07', type: 'SHORT_DAY', decision: 'WAIVE', note: 'n', by: 'a', at: 't' },
      { date: '2026-10-08', type: 'SHORT_DAY', decision: 'OTHER' as any, note: 'n', by: 'a', at: 't' },
    ])).toEqual({ '2026-10-06|SHORT_DAY': 'APPLY', '2026-10-07|SHORT_DAY': 'WAIVE' });
    expect(resolutionMap(undefined)).toEqual({});
  });

  it('WFH deductions are disabled until a WFH policy is approved', () => {
    expect(WFH_DEDUCTION_POLICY_APPROVED).toBe(false);
  });
});
