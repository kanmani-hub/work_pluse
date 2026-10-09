/**
 * Payroll safety rules (pure, unit-tested).
 *
 * 1. Overtime pay comes ONLY from overtime_requests with status APPROVED, using their
 *    approved_overtime_hours. Pending, rejected and cancelled requests, requested/eligible
 *    hours, and attendance.overtime_minutes (written by the server auto clock-out as plain
 *    "worked minus required" time) are never paid.
 * 2. Payroll status moves strictly forward along one path. PAID is reachable only through
 *    recording a payment (markPayrollPaid), never through a generic status change.
 */
import { approvedOvertimeHours } from '../overtime/overtimeRules';

export type PayrollStatus = 'DRAFT' | 'CALCULATED' | 'UNDER_REVIEW' | 'APPROVED' | 'PAYMENT_PENDING' | 'PAID' | 'CLOSED';

export const PAYROLL_TRANSITIONS: Record<PayrollStatus, PayrollStatus[]> = {
  DRAFT: ['UNDER_REVIEW'],
  CALCULATED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED'],
  APPROVED: ['PAYMENT_PENDING'],
  PAYMENT_PENDING: ['PAID'],
  PAID: ['CLOSED'],
  CLOSED: [],
};

export function canTransitionPayroll(from: string | null | undefined, to: string): boolean {
  const allowed = PAYROLL_TRANSITIONS[String(from || '') as PayrollStatus];
  return !!allowed && allowed.includes(to as PayrollStatus);
}

/** Why a generic status change is refused, or null when it is allowed. */
export function statusChangeError(from: string | null | undefined, to: string): string | null {
  if (to === 'PAID') return 'Use "Record payment" to mark a payroll as paid.';
  if (from === to) return `Payroll is already ${to}.`;
  if (!canTransitionPayroll(from, to)) return `Cannot change payroll status from ${from} to ${to}.`;
  return null;
}

/** Why a payment cannot be recorded, or null when it can. */
export function paymentBlockReason(status: string | null | undefined, existingPayments: number): string | null {
  if (status === 'PAID' || status === 'CLOSED') return 'This payroll has already been paid.';
  if (existingPayments > 0) return 'A payment is already recorded for this payroll.';
  if (status !== 'PAYMENT_PENDING') return `Payroll must be in PAYMENT_PENDING status to record a payment (current: ${status}).`;
  return null;
}

/** Minutes of APPROVED overtime from overtime_requests rows (other statuses contribute nothing). */
export function approvedOvertimeMinutes(requests: { status: string; approved_overtime_hours: number | null }[]): number {
  return Math.round(approvedOvertimeHours(requests || []) * 60);
}

/**
 * Overtime pay before rounding. Same rate rules as before (hourly = daily rate / 8,
 * multiplier or fixed rate per hour); only the source of the hours changed.
 */
export function overtimePayAmount(input: {
  enableOvertimePay?: boolean;
  approvedOvertimeMinutes: number;
  dailyRate: number;
  overtimeRateType?: string;
  overtimeMultiplier?: number;
  overtimeFixedRate?: number;
}): number {
  if (!input.enableOvertimePay || !(input.approvedOvertimeMinutes > 0)) return 0;
  const otHours = input.approvedOvertimeMinutes / 60;
  if (input.overtimeRateType === 'multiplier') return otHours * (input.dailyRate / 8) * (input.overtimeMultiplier || 1);
  return otHours * (input.overtimeFixedRate || 0);
}

// ---------------- Payment policy (confirmed by the business owner, 2026-10-09) ----------------
// 1. A payroll is paid with ONE payment that equals its approved net salary exactly.
// 2. Only ADMIN may record payroll payments (HR can still prepare, review and approve).
// 3. Overtime cannot be approved for a month whose payroll is already approved / being paid / paid / closed.

export const PAYMENT_RECORDER_ROLES = ['ADMIN'] as const;

export function canRecordPayment(role: string | null | undefined): boolean {
  return String(role || '').trim().toUpperCase() === 'ADMIN';
}

const toPaise = (n: number) => Math.round(n * 100);

/** Why a payment amount is refused, or null when it equals the net salary exactly. */
export function validatePaymentAmount(amount: unknown, netSalary: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'Enter a valid payment amount.';
  if (amount < 0) return 'Payment amount cannot be negative.';
  if (netSalary === null || netSalary === undefined || netSalary === '') return 'This payroll has no valid net salary to pay.';
  const net = typeof netSalary === 'number' ? netSalary : Number(netSalary);
  if (!Number.isFinite(net) || net < 0) return 'This payroll has no valid net salary to pay.';
  if (toPaise(amount) !== toPaise(net)) return `Payment must equal the approved net salary of ₹${net.toFixed(2)}.`;
  return null;
}

/** Payroll statuses after which amounts are locked (no recalculation, no new overtime approvals). */
export const LOCKED_PAYROLL_STATUSES: PayrollStatus[] = ['APPROVED', 'PAYMENT_PENDING', 'PAID', 'CLOSED'];

export function isPayrollLocked(status: string | null | undefined): boolean {
  return LOCKED_PAYROLL_STATUSES.includes(String(status || '') as PayrollStatus);
}

/** Payroll year/month a work date (YYYY-MM-DD) belongs to. */
export function payrollPeriodOf(workDate: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(String(workDate || ''));
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** Payment date (YYYY-MM-DD, company date) must be a real date and not in the future. */
export function validatePaymentDate(date: string | null | undefined, today: string): string | null {
  if (!date) return null; // not given → the database records the current time
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(`${date}T00:00:00Z`).getTime())) return 'Enter a valid payment date.';
  if (date > today) return 'Payment date cannot be in the future.';
  return null;
}

/** Store a company-date payment date at midday IST so it never shifts to another day. */
export function paymentDateToTimestamp(date: string | null | undefined): string | null {
  return date ? `${date}T12:00:00+05:30` : null;
}

/** Human message for errors returned by the record_payroll_payment database function. */
export function paymentRpcErrorMessage(err: { code?: string; message?: string } | null | undefined): string {
  const msg = String(err?.message || '');
  if (err?.code === 'PGRST202' || /could not find the function|record_payroll_payment.*does not exist/i.test(msg)) {
    return 'Payment recording is not set up in the database yet (function record_payroll_payment is missing). No payment was recorded.';
  }
  return msg ? `Payment was not recorded: ${msg}` : 'Payment was not recorded.';
}

// ---- Attendance review flags (policy 2026-10-09) --------------------------------------------

/**
 * WFH-based deductions are disabled until the company explicitly approves a WFH deduction policy.
 * While false, payroll never charges for WFH days, whatever Settings → Payroll → "Deduct for WFH Days" says.
 */
export const WFH_DEDUCTION_POLICY_APPROVED: boolean = false;

export type ReviewDecisionValue = 'APPLY' | 'WAIVE';
export interface ReviewResolution { date: string; type: string; decision: ReviewDecisionValue; note: string; by: string; at: string }

/** The stored calculation snapshot (payroll.remarks JSON), or null if it is missing / not JSON. */
export function parsePayrollSnapshot(remarks: unknown): any | null {
  if (!remarks || typeof remarks !== 'string') return null;
  try { const v = JSON.parse(remarks); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

/** Unresolved attendance review flags stored with a payroll calculation. */
export function unresolvedReviewItems(remarks: unknown): { date: string; type?: string; reason: string }[] {
  const snap = parsePayrollSnapshot(remarks);
  const items = snap?.attendance?.reviewItems;
  return Array.isArray(items) ? items : [];
}

/** Approval is refused while flags are unresolved. Returns the message, or null when approval may proceed. */
export function approvalBlockReason(remarks: unknown): string | null {
  const n = unresolvedReviewItems(remarks).length;
  return n > 0 ? `Cannot approve: ${n} attendance review flag(s) are unresolved. Resolve each flag (Apply or Waive) in the payroll details first.` : null;
}

/** Resolutions stored with a payroll calculation, as the classification's lookup map. */
export function resolutionMap(list: ReviewResolution[] | undefined | null): Record<string, ReviewDecisionValue> {
  const out: Record<string, ReviewDecisionValue> = {};
  for (const r of list || []) if (r?.date && r?.type && (r.decision === 'APPLY' || r.decision === 'WAIVE')) out[`${r.date}|${r.type}`] = r.decision;
  return out;
}

/** Validates an Admin's resolution request against the payroll's status and stored flags. */
export function resolutionError(p: { status?: string | null; remarks?: unknown } | null, date: string, type: string, decision: string, note: string): string | null {
  if (!p) return 'Payroll not found.';
  if (!['CALCULATED', 'UNDER_REVIEW'].includes(String(p.status))) return `Review flags can only be resolved before approval (current status: ${p.status}).`;
  if (decision !== 'APPLY' && decision !== 'WAIVE') return 'Choose Apply or Waive.';
  if (!String(note || '').trim()) return 'Enter a note explaining the decision.';
  if (!unresolvedReviewItems(p.remarks).some(i => i.date === date && (i.type || '') === type)) return 'This review flag is not open on this payroll (it may already be resolved). Refresh and try again.';
  return null;
}
