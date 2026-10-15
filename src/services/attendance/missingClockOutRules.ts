/**
 * Missing clock-out + additional working time (pure, unit-tested).
 *
 * Company policy (confirmed 2026-10-14):
 *  - A clock-in without a clock-out after shift end + the auto clock-out grace period is a
 *    MISSING CLOCK-OUT. Nothing is assumed: no clock-out time is invented, worked time is not
 *    extended to "end of day", no overtime is created.
 *  - The employee may submit ONE correction: a claimed clock-out time + a mandatory reason, and
 *    optionally overtime for the additional time. The claim stays UNVERIFIED until an admin approves.
 *  - Additional working time for this workflow is limited to `maxAdditionalHours` (default 3,
 *    Payroll Settings). Claimed time beyond it is NOT discarded: it is shown as excess for admin review.
 *  - Admin APPROVES (with a verified clock-out time) → no deduction; any deduction already recorded for
 *    the case is cancelled (not yet in a payroll) or reversed once (already in an approved payroll).
 *  - Admin REJECTS (reason required) → the configured FIXED deduction per case applies; overtime is unpaid.
 *  - Still PENDING when payroll is calculated → no deduction yet (deferred); it is settled as an
 *    adjustment in the next payroll calculated after the decision.
 *  - The deduction amount is a setting; it is never derived from the missing clock-out itself
 *    (never a full-day / half-day deduction because a clock-out is missing).
 *
 * The same rules are enforced in the database by docs/proposals/PROPOSED_missing_clock_out_workflow.sql.
 */
import { estimateOvertime, minutesToHours, shiftWindow, type OtAttendance, type OtShift, type OtDayContext } from '../overtime/overtimeRules';
import type { BreakLike } from './breakRules';

export const DEFAULT_MAX_ADDITIONAL_HOURS = 3;
/** Without a shift the end of the working day is unknown: flag only after this long. */
export const NO_SHIFT_OPEN_HOURS = 24;
/** A claimed clock-out further than this after clock-in is not a plausible working day. */
export const MAX_CLAIM_SPAN_HOURS = 24;
export const MIN_REASON_LENGTH = 10;

const HOUR = 3_600_000;

const validMs = (iso: unknown) => (typeof iso === 'string' && iso.length > 0 ? Date.parse(iso) : NaN);

// ------------------------------------------------------------------ detection

export type MissingClockOutState = 'NOT_APPLICABLE' | 'IN_PROGRESS' | 'MISSING_CLOCK_OUT';
export interface MissingClockOutDetection {
  state: MissingClockOutState;
  /** Scheduled shift end (company time), when a shift is known */
  shiftEndMs: number | null;
  /** When the record counts as a missing clock-out */
  flagAtMs: number | null;
  reason: string | null;
}

/**
 * Open attendance (clock-in, no clock-out) becomes a missing clock-out once the shift end + grace
 * hours have passed (same threshold as the auto clock-out setting). Overnight shifts end the next
 * day. Without a shift, only after 24 hours. Location (GPS) is never used.
 */
export function detectMissingClockOut(
  att: { attendance_date: string; clock_in_at: string | null; clock_out_at: string | null } | null | undefined,
  shift: OtShift | null | undefined,
  nowMs: number,
  graceHours: number | null | undefined,
): MissingClockOutDetection {
  const none = (state: MissingClockOutState, reason: string | null = null): MissingClockOutDetection => ({ state, shiftEndMs: null, flagAtMs: null, reason });
  if (!att || !att.clock_in_at || !Number.isFinite(validMs(att.clock_in_at))) return none('NOT_APPLICABLE');
  if (att.clock_out_at) return none('NOT_APPLICABLE');
  const grace = Number.isFinite(Number(graceHours)) && Number(graceHours) > 0 ? Number(graceHours) : 0;
  const win = shift ? shiftWindow(att.attendance_date, shift) : null;
  if (!win) {
    const flagAtMs = validMs(att.clock_in_at) + NO_SHIFT_OPEN_HOURS * HOUR;
    return nowMs >= flagAtMs
      ? { state: 'MISSING_CLOCK_OUT', shiftEndMs: null, flagAtMs, reason: `No clock-out ${NO_SHIFT_OPEN_HOURS} hours after clock-in (no shift assigned).` }
      : { state: 'IN_PROGRESS', shiftEndMs: null, flagAtMs, reason: null };
  }
  const flagAtMs = win.endMs + grace * HOUR;
  return nowMs >= flagAtMs
    ? { state: 'MISSING_CLOCK_OUT', shiftEndMs: win.endMs, flagAtMs, reason: 'No clock-out recorded after the shift ended.' }
    : { state: 'IN_PROGRESS', shiftEndMs: win.endMs, flagAtMs, reason: null };
}

/** Employees with more than one open attendance (clock-in, no clock-out): a data problem to review. */
export function duplicateOpenAttendance(rows: { id: string; employee_id: string; clock_in_at: string | null; clock_out_at: string | null }[]): Record<string, string[]> {
  const open: Record<string, string[]> = {};
  for (const r of rows || []) if (r?.clock_in_at && !r.clock_out_at) (open[r.employee_id] ||= []).push(r.id);
  return Object.fromEntries(Object.entries(open).filter(([, ids]) => ids.length > 1));
}

// ------------------------------------------------------------------ claim evaluation

export interface ClaimEvaluation {
  ok: boolean;
  error: string | null;
  verified: false;               // a claim is never verified by itself
  scheduledMinutes: number | null;
  workedMinutes: number;         // claimed clock-out − clock-in − completed breaks
  lateMinutes: number;
  additionalMinutes: number;     // worked − scheduled − late (same rule as overtime), ≥ 0
  limitHours: number;
  claimedAdditionalHours: number;
  eligibleHours: number;         // min(additional, limit): the most that can be requested
  excessHours: number;           // additional beyond the limit: flagged for admin review, never dropped
}

export function normalizeLimitHours(limit: unknown): number {
  const n = Number(limit);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : DEFAULT_MAX_ADDITIONAL_HOURS;
}

/**
 * Additional working time implied by a claimed clock-out (or by the admin-verified one).
 * Uses the overtime rule (late time is made up first; breaks excluded; leave / half day → none).
 */
export function evaluateClockOutClaim(input: {
  attendance: OtAttendance;
  shift: OtShift | null;
  breaks: BreakLike[] | null | undefined;
  claimedClockOutIso: string;
  nowMs: number;
  limitHours: unknown;
  dayContext?: OtDayContext;
}): ClaimEvaluation {
  const limitHours = normalizeLimitHours(input.limitHours);
  const fail = (error: string): ClaimEvaluation => ({
    ok: false, error, verified: false, scheduledMinutes: null, workedMinutes: 0, lateMinutes: 0,
    additionalMinutes: 0, limitHours, claimedAdditionalHours: 0, eligibleHours: 0, excessHours: 0,
  });
  const att = input.attendance;
  const inMs = validMs(att?.clock_in_at);
  const outMs = validMs(input.claimedClockOutIso);
  if (!Number.isFinite(inMs)) return fail('This attendance has no clock-in.');
  if (att.clock_out_at) return fail('This attendance already has a clock-out.');
  if (!Number.isFinite(outMs)) return fail('Enter a valid clock-out date and time.');
  if (outMs <= inMs) return fail('The clock-out time must be after your clock-in time.');
  if (outMs > input.nowMs) return fail('The clock-out time cannot be in the future.');
  if (outMs - inMs > MAX_CLAIM_SPAN_HOURS * HOUR) return fail(`The clock-out time must be within ${MAX_CLAIM_SPAN_HOURS} hours of your clock-in.`);
  const lastBreakEnd = Math.max(-Infinity, ...(input.breaks || []).filter(b => b.ended_at && b.break_type !== 'CANCELLED').map(b => validMs(b.ended_at)).filter(Number.isFinite));
  if (Number.isFinite(lastBreakEnd) && outMs < lastBreakEnd) return fail('The clock-out time cannot be before the end of your last break.');
  // A break still open is closed at the clock-out time: it cannot have started after it
  const openBreakStart = Math.max(-Infinity, ...(input.breaks || []).filter(b => !b.ended_at && b.break_type !== 'CANCELLED').map(b => validMs(b.started_at)).filter(Number.isFinite));
  if (Number.isFinite(openBreakStart) && outMs < openBreakStart) return fail('The clock-out time cannot be before the start of a break that is still open.');
  if (!input.shift || !shiftWindow(att.attendance_date, input.shift)) return fail('No shift was assigned for this day, so the additional time cannot be calculated. Please contact HR.');

  const est = estimateOvertime({ ...att, clock_out_at: new Date(outMs).toISOString() }, input.shift, input.breaks, input.dayContext || {});
  const additionalMinutes = est.eligible ? est.potentialMinutes : 0;
  const limitMinutes = Math.round(limitHours * 60);
  return {
    ok: true, error: null, verified: false,
    scheduledMinutes: est.scheduledMinutes, workedMinutes: est.workedMinutes, lateMinutes: est.lateMinutes,
    additionalMinutes, limitHours,
    claimedAdditionalHours: minutesToHours(additionalMinutes),
    eligibleHours: minutesToHours(Math.min(additionalMinutes, limitMinutes)),
    excessHours: minutesToHours(Math.max(0, additionalMinutes - limitMinutes)),
  };
}

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** Employee submission (correction + optional overtime). Returns an error message or null. */
export function validateMissingClockOutSubmission(ev: ClaimEvaluation, requestedHours: number, reason: string): string | null {
  if (!ev.ok) return ev.error;
  if (!reason || reason.trim().length < MIN_REASON_LENGTH) return `Please describe the work or project (at least ${MIN_REASON_LENGTH} characters).`;
  if (!Number.isFinite(requestedHours) || requestedHours < 0) return 'Requested overtime cannot be negative.';
  if (!twoDecimals(requestedHours)) return 'Use at most 2 decimal places.';
  if (requestedHours > ev.eligibleHours + 1e-9) {
    return ev.eligibleHours <= 0
      ? 'There is no additional working time after your shift to request.'
      : `You can request at most ${ev.eligibleHours} hours (limit ${ev.limitHours} h for a missing clock-out).`;
  }
  return null;
}

/** Admin decision. Approve needs a verified clock-out (re-evaluated) and hours within every limit. */
export function validateMissingClockOutReview(input: {
  decision: 'APPROVED' | 'REJECTED';
  remarks: string;
  requestedHours: number;
  verified?: ClaimEvaluation | null;
  approvedHours?: number | null;
  reviewerEmployeeId: string | null;
  requestEmployeeId: string;
  requestStatus: string;
}): string | null {
  if (!input.reviewerEmployeeId) return 'Your session has expired. Please sign in again.';
  if (input.reviewerEmployeeId === input.requestEmployeeId) return 'You cannot review your own request.';
  if (input.requestStatus !== 'PENDING') return `This request has already been ${String(input.requestStatus).toLowerCase()}.`;
  if (input.decision === 'REJECTED') return input.remarks?.trim() ? null : 'Please give a reason for rejecting.';
  const v = input.verified;
  if (!v) return 'Enter the verified clock-out time.';
  if (!v.ok) return v.error;
  const h = Number(input.approvedHours);
  if (!Number.isFinite(h) || h < 0) return 'Approved overtime cannot be negative.';
  if (!twoDecimals(h)) return 'Use at most 2 decimal places.';
  if (h > input.requestedHours + 1e-9) return `Cannot approve more than the requested ${input.requestedHours} hours.`;
  if (h > v.eligibleHours + 1e-9) return `Cannot approve more than ${v.eligibleHours} hours for the verified clock-out time (limit ${v.limitHours} h).`;
  return null;
}

// ------------------------------------------------------------------ payroll adjustments

export type AdjustmentKind = 'MISSING_CLOCK_OUT_DEDUCTION' | 'MISSING_CLOCK_OUT_REVERSAL' | 'DEFERRED_OVERTIME';
export type AdjustmentStatus = 'PENDING' | 'SETTLED' | 'CANCELLED';
export interface PayrollAdjustment {
  id: string;
  reference: string;
  kind: AdjustmentKind;
  status: AdjustmentStatus;
  work_date: string;
  amount: number | null;          // deduction / reversal amount
  hours: number | null;           // deferred overtime hours
  attendance_id?: string | null;
  overtime_request_id?: string | null;
  settled_year?: number | null;
  settled_month?: number | null;
}

/** One deduction, one reversal and one deferred-overtime entry per case at most (unique in the database). */
export const adjustmentReference = {
  deduction: (attendanceId: string) => `MCO-DED:${attendanceId}`,
  reversal: (attendanceId: string) => `MCO-REV:${attendanceId}`,
  deferredOvertime: (requestId: string) => `MCO-OT:${requestId}`,
};

/**
 * Adjustments a payroll for the period includes: still PENDING and for a work date on or before the
 * period end (decided after an earlier month was locked → settled in the next payroll).
 * Repeated calculation reads the same rows and creates nothing, so it never double counts.
 */
export function adjustmentsForPayroll(adjustments: PayrollAdjustment[] | null | undefined, periodEnd: string) {
  const included = (adjustments || []).filter(a => a?.status === 'PENDING' && String(a.work_date).slice(0, 10) <= periodEnd.slice(0, 10));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const sum = (k: AdjustmentKind, f: 'amount' | 'hours') => r2(included.filter(a => a.kind === k).reduce((s, a) => s + (Number(a[f]) || 0), 0));
  return {
    included,
    deductionAmount: sum('MISSING_CLOCK_OUT_DEDUCTION', 'amount'),
    reversalAmount: sum('MISSING_CLOCK_OUT_REVERSAL', 'amount'),
    deferredOvertimeHours: sum('DEFERRED_OVERTIME', 'hours'),
  };
}

/** What the employee / admin sees for a case's payroll effect. */
export function missingClockOutPayrollStatus(request: { status?: string | null } | null | undefined, adjustments: PayrollAdjustment[]): string {
  const ded = adjustments.find(a => a.kind === 'MISSING_CLOCK_OUT_DEDUCTION');
  const rev = adjustments.find(a => a.kind === 'MISSING_CLOCK_OUT_REVERSAL');
  const money = (n: number | null | undefined) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
  const when = (a: PayrollAdjustment) => (a.status === 'SETTLED' && a.settled_month ? `in ${a.settled_month}/${a.settled_year} payroll` : 'in the next payroll');
  if (rev) return `Deduction reversed: ${money(rev.amount)} refunded ${when(rev)}.`;
  if (ded && ded.status === 'CANCELLED') return 'No deduction (request approved).';
  if (ded) return `Deduction ${money(ded.amount)} ${ded.status === 'SETTLED' ? 'applied' : 'will be applied'} ${when(ded)}.`;
  switch (request?.status) {
    case 'APPROVED': return 'No deduction (request approved).';
    case 'REJECTED': return 'Request rejected. No deduction is configured.';
    case 'PENDING': return 'Pending approval: no deduction yet (deferred until the decision).';
    default: return 'Clock-out missing: submit a correction. No deduction until an admin decides.';
  }
}


/**
 * Payroll lines for the missing clock-out adjustments a calculation includes (amounts before rounding).
 *  - deduction → its own DEDUCTION line (fixed amount per case, from the approved policy setting)
 *  - reversal  → an EARNING line (refund of a deduction already paid out; never folded into gross salary)
 *  - deferred overtime → approved overtime minutes, paid at the normal overtime rate. When overtime pay
 *    is switched off it is NOT included, so it stays pending instead of being settled for nothing.
 * `ids` are the adjustments this payroll settles when it is approved (atomically, in the database).
 */
export function missingClockOutPayrollLines(adjustments: PayrollAdjustment[] | null | undefined, periodEnd: string, opts: { overtimePayEnabled: boolean }) {
  const all = adjustmentsForPayroll(adjustments, periodEnd);
  const included = all.included.filter(a => a.kind !== 'DEFERRED_OVERTIME' || opts.overtimePayEnabled);
  const count = (k: AdjustmentKind) => included.filter(a => a.kind === k).length;
  const dedCount = count('MISSING_CLOCK_OUT_DEDUCTION');
  const revCount = count('MISSING_CLOCK_OUT_REVERSAL');
  const deferredOvertimeHours = opts.overtimePayEnabled ? all.deferredOvertimeHours : 0;
  return {
    ids: included.map(a => a.id),
    references: included.map(a => a.reference),
    deduction: all.deductionAmount > 0 ? { name: `Missing Clock-Out Deduction (${dedCount} ${dedCount === 1 ? 'case' : 'cases'})`, amount: all.deductionAmount } : null,
    reversal: all.reversalAmount > 0 ? { name: `Missing Clock-Out Deduction Reversal (${revCount} ${revCount === 1 ? 'case' : 'cases'})`, amount: all.reversalAmount } : null,
    deferredOvertimeHours,
    deferredOvertimeMinutes: Math.round(deferredOvertimeHours * 60),
  };
}

/** PostgREST / Postgres errors meaning "the proposal's tables / functions / columns do not exist yet". */
export function isMissingClockOutSchemaError(e: any): boolean {
  return !!e && (
    ['PGRST202', 'PGRST205', '42883', '42P01', '42703'].includes(e.code)
    || /(could not find the function|could not find the table|function .* does not exist|relation .* does not exist|column .*request_type.* does not exist)/i.test(e.message || ''));
}

// ------------------------------------------------------------------ company-time input helpers
/** India Standard Time has no daylight saving: a fixed +05:30 offset. */
const COMPANY_OFFSET = '+05:30';

/** `YYYY-MM-DDTHH:mm` typed in company time (datetime-local input) → ISO instant, or null if invalid. */
export function companyLocalToIso(local: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(local || '').trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00${COMPANY_OFFSET}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** ISO instant → `YYYY-MM-DDTHH:mm` in company time (for a datetime-local input). */
export function isoToCompanyLocal(iso: string | number | null | undefined): string {
  const ms = typeof iso === 'number' ? iso : validMs(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 16);
}

/** "14 Oct 2026, 06:30 PM" in company time. */
export function formatCompanyDateTime(iso: string | null | undefined): string {
  const ms = validMs(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/** Status label of a case for the employee and admin lists. A cancelled correction leaves the day missing. */
export function caseStatusLabel(c: { request?: { status?: string | null } | null }): string {
  switch (c.request?.status) {
    case 'PENDING': return 'Pending Approval';
    case 'APPROVED': return 'Approved';
    case 'REJECTED': return 'Rejected';
    default: return 'Missing Clock-Out';
  }
}

/**
 * A payroll calculated BEFORE a missing clock-out correction of its period was approved is stale: the
 * attendance was closed at the verified time and its overtime approved after the figures were taken.
 * Approving it would lock the month and the overtime would never be paid. Returns the refusal message, or null.
 */
export function staleMissingClockOutReason(
  approved: { work_date?: string | null; reviewed_at?: string | null }[] | null | undefined,
  payroll: { period_start?: string | null; period_end?: string | null; calculated_at?: string | null },
): string | null {
  const start = String(payroll.period_start || '').slice(0, 10), end = String(payroll.period_end || '').slice(0, 10);
  const calcMs = Date.parse(String(payroll.calculated_at || ''));
  const inPeriod = (approved || []).filter(r => { const d = String(r?.work_date || '').slice(0, 10); return !!d && d >= start && d <= end; });
  const changed = inPeriod.filter(r => !Number.isFinite(calcMs) || !(Date.parse(String(r.reviewed_at || '')) <= calcMs));
  return changed.length > 0
    ? `A missing clock-out correction for this period was approved after the payroll was calculated (${changed.length}). Recalculate the payroll, then approve.`
    : null;
}
