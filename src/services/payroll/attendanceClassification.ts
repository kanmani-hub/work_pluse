/**
 * Payroll day classification (pure, unit-tested).
 *
 * Every calendar day of the payroll period is classified exactly once, so a day can never be
 * deducted twice (e.g. as absence AND as leave). Owner-confirmed rules (2026-10-09):
 *  - Scheduled working days: the employee's roster where a valid (PUBLISHED) roster covers the date
 *    — a rostered date is a working day, an unassigned date inside the roster is the employee's
 *    weekly off; otherwise the company working days (Admin → Settings → Working Days).
 *    Public holidays (Settings) and days before joining_date are never working days.
 *  - A day with a clock-in is a worked day, whatever its status: WORKING, LATE, ON_BREAK,
 *    COMPLETED, PRESENT, EARLY_LOGOUT, auto logout (late/break penalties are separate,
 *    minute-based deductions). HALF_DAY / is_half_day = half day (existing 50% half-day rule).
 *  - Early logout is recorded for information only: no early-logout salary deduction.
 *  - A scheduled working day with NO clock-in is an absence (1 LOP day) unless covered by
 *    approved leave. Approved WFH does NOT excuse a missing clock-in.
 *  - Approved "Loss of Pay" leave = LOP; a SANDWICH LOP row (existing sandwich-leave rule) = LOP.
 *  - Approved half-day leave with no clock-in: the leave half is leave; if no other approved leave
 *    covers the other half, that half is NOT deducted — the day is flagged for Admin review.
 *  - Short working day (HALF_DAY / is_half_day: worked under half the required hours) not covered by
 *    leave: the half-day deduction is NOT applied automatically — the day is flagged for Admin review.
 *  - An Admin resolves each flag with APPLY (half-day deduction / 0.5 absence) or WAIVE (no
 *    deduction); resolved flags no longer block approval (see payrollRules.unresolvedReviewItems).
 *  - Weekly offs and holidays without a clock-in are neither worked nor absent.
 *  - Today without a clock-in yet, and future days, are not counted (the day is not over).
 */

export type DayKind =
  | 'NOT_EMPLOYED' | 'FUTURE' | 'TODAY_PENDING'
  | 'PRESENT' | 'HALF_DAY'
  | 'WEEKLY_OFF' | 'HOLIDAY'
  | 'PAID_LEAVE' | 'LOP_LEAVE' | 'MIXED_LEAVE' | 'SANDWICH_LOP' | 'ABSENT';

export interface ClassifiedDay {
  date: string;
  kind: DayKind;
  /** Total LOP days this date contributes (absentLop + leaveLop + sandwichLop): 0, 0.5 or 1. */
  lop: number;
  /** Unexcused absence (scheduled day, no clock-in, no approved leave). */
  absentLop: number;
  /** Approved Loss-of-Pay leave. */
  leaveLop: number;
  /** Sandwich-leave LOP row. */
  sandwichLop: number;
  /** Paid-leave days this date contributes (0, 0.5 or 1). */
  paidLeave: number;
  /** True when the existing half-day deduction applies (worked half, other half not covered by leave). */
  halfDayDeduction: boolean;
  /** Where "working day / weekly off" came from (only for days that reached the schedule check). */
  scheduleSource?: 'ROSTER' | 'COMPANY';
  /** Recorded early-logout minutes (information only; never deducted). */
  earlyLogoutMinutes: number;
  /** Set when an Admin must review the day; no deduction was applied for the uncertain part. */
  review: string | null;
  /** Flag type (also set once resolved, with `resolution`). */
  reviewType?: ReviewType | null;
  resolution?: ReviewDecision | null;
}

export type ReviewType = 'HALF_DAY_LEAVE_UNCOVERED' | 'SHORT_DAY';
export type ReviewDecision = 'APPLY' | 'WAIVE';
/** Key for a resolution: `${date}|${type}` */
export const reviewKey = (date: string, type: ReviewType | string) => `${date}|${type}`;

export interface LeaveLike {
  start_date: string;
  end_date: string;
  is_half_day?: boolean | null;
  /** FIRST_HALF | SECOND_HALF for a half-day leave (schema check constraint) */
  half_day_type?: string | null;
  /** true for Loss-of-Pay / unpaid leave types */
  isLop: boolean;
}

export interface ClassificationInput {
  periodStart: string;   // YYYY-MM-DD
  periodEnd: string;     // YYYY-MM-DD
  today: string;         // YYYY-MM-DD (company timezone)
  joiningDate?: string | null;
  workingDays: string[]; // company working days, e.g. ['Monday', ..., 'Saturday']
  holidays: string[];    // YYYY-MM-DD
  /** Dates covered by a valid roster for this employee: WORK = rostered shift, OFF = roster weekly off. */
  rosterDays?: Record<string, 'WORK' | 'OFF'>;
  /** Admin decisions on review flags, keyed by reviewKey(date, type). */
  resolutions?: Record<string, ReviewDecision>;
  attendance: any[];     // rows: attendance_date, status, clock_in_at, is_half_day, early_logout_minutes
  leaves: LeaveLike[];   // APPROVED leave only
}

export const REVIEW_HALF_DAY_UNCOVERED =
  'Approved half-day leave, but no attendance or other approved leave covers the other half. Not deducted — Admin review needed.';
export const REVIEW_SHORT_DAY =
  'Short working day (under half the required hours). Half-day deduction not applied — Admin review needed.';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = (d: string) => DAY_NAMES[new Date(`${d}T12:00:00Z`).getUTCDay()];
const isDate = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.slice(0, 10));
const r2 = (n: number) => Math.round(n * 100) / 100;

export const isLopLeaveType = (lt: { code?: string | null; name?: string | null } | null | undefined): boolean => {
  const code = String(lt?.code || '').toUpperCase();
  const name = String(lt?.name || '').toUpperCase();
  return code === 'LOP' || code === 'LOSS_OF_PAY' || name.includes('LOSS OF PAY') || name.includes('LOP') || name.includes('UNPAID');
};

type HalfCover = 'PAID' | 'LOP' | null;

/** Which halves of the date are covered by approved leave (paid preferred over LOP when both cover a half). */
export function leaveCoverage(date: string, leaves: LeaveLike[]): { first: HalfCover; second: HalfCover } {
  let first: HalfCover = null;
  let second: HalfCover = null;
  const pick = (cur: HalfCover, add: HalfCover): HalfCover => (cur === 'PAID' || add === 'PAID' ? 'PAID' : cur || add);
  for (const l of leaves || []) {
    if (!(l.start_date <= date && l.end_date >= date)) continue;
    const type: HalfCover = l.isLop ? 'LOP' : 'PAID';
    const isHalf = !!l.is_half_day && l.start_date === l.end_date;
    if (!isHalf) { first = pick(first, type); second = pick(second, type); continue; }
    const half = String(l.half_day_type || '').toUpperCase();
    if (half === 'SECOND_HALF') second = pick(second, type);
    else if (half === 'FIRST_HALF') first = pick(first, type);
    else if (!first) first = type; // half unknown: fill an uncovered half
    else second = pick(second, type);
  }
  return { first, second };
}

export function classifyPayrollDays(input: ClassificationInput): ClassifiedDay[] {
  const working = new Set((input.workingDays || []).map(d => d.toLowerCase()));
  const holidays = new Set((input.holidays || []).filter(isDate).map(d => d.slice(0, 10)));
  const roster = input.rosterDays || {};
  const resolutions = input.resolutions || {};
  const decisionFor = (date: string, type: ReviewType): ReviewDecision | null => resolutions[reviewKey(date, type)] || null;
  const byDate = new Map<string, any>();
  for (const a of input.attendance || []) if (a?.attendance_date) byDate.set(String(a.attendance_date).slice(0, 10), a);

  const days: ClassifiedDay[] = [];
  for (let date = input.periodStart.slice(0, 10); date <= input.periodEnd.slice(0, 10); date = addDays(date, 1)) {
    const base = { date, lop: 0, absentLop: 0, leaveLop: 0, sandwichLop: 0, paidLeave: 0, halfDayDeduction: false, earlyLogoutMinutes: 0, review: null as string | null, reviewType: null as ReviewType | null, resolution: null as ReviewDecision | null };
    const push = (d: Omit<ClassifiedDay, 'lop'> & { lop?: number }) => days.push({ ...d, lop: r2(d.absentLop + d.leaveLop + d.sandwichLop) });

    if (input.joiningDate && date < input.joiningDate.slice(0, 10)) { push({ ...base, kind: 'NOT_EMPLOYED' }); continue; }
    if (date > input.today) { push({ ...base, kind: 'FUTURE' }); continue; }

    const row = byDate.get(date);
    const worked = !!row?.clock_in_at;
    const status = String(row?.status || '').toUpperCase();
    const cover = leaveCoverage(date, input.leaves || []);
    const halves = [cover.first, cover.second].filter(Boolean) as ('PAID' | 'LOP')[];

    if (status === 'SANDWICH LOP' && !worked) { push({ ...base, kind: 'SANDWICH_LOP', sandwichLop: 1 }); continue; }

    if (worked) {
      const early = Math.max(0, Number(row?.early_logout_minutes) || 0);
      const half = status === 'HALF_DAY' || row?.is_half_day === true;
      if (!half) { push({ ...base, kind: 'PRESENT', earlyLogoutMinutes: early }); continue; }
      // Worked half a day: the other half is paid leave, LOP leave, or the half-day deduction — never two of them
      if (halves.length > 0) {
        const other = halves.includes('PAID') ? 'PAID' : 'LOP';
        push({ ...base, kind: 'HALF_DAY', earlyLogoutMinutes: early, paidLeave: other === 'PAID' ? 0.5 : 0, leaveLop: other === 'LOP' ? 0.5 : 0 });
      } else {
        // Short day: the half-day deduction needs an Admin decision first (never applied automatically)
        const decision = decisionFor(date, 'SHORT_DAY');
        push({ ...base, kind: 'HALF_DAY', earlyLogoutMinutes: early, halfDayDeduction: decision === 'APPLY',
          reviewType: 'SHORT_DAY', resolution: decision, review: decision ? null : REVIEW_SHORT_DAY });
      }
      continue;
    }

    if (holidays.has(date)) { push({ ...base, kind: 'HOLIDAY' }); continue; }
    const rosterDay = roster[date];
    const scheduleSource: 'ROSTER' | 'COMPANY' = rosterDay ? 'ROSTER' : 'COMPANY';
    const scheduled = rosterDay ? rosterDay === 'WORK' : working.has(weekday(date).toLowerCase());
    if (!scheduled) { push({ ...base, kind: 'WEEKLY_OFF', scheduleSource }); continue; }
    if (date === input.today) { push({ ...base, kind: 'TODAY_PENDING', scheduleSource }); continue; }

    if (halves.length > 0) {
      const paidLeave = halves.filter(h => h === 'PAID').length * 0.5;
      const leaveLop = halves.filter(h => h === 'LOP').length * 0.5;
      const kind: DayKind = paidLeave > 0 && leaveLop > 0 ? 'MIXED_LEAVE' : paidLeave > 0 ? 'PAID_LEAVE' : 'LOP_LEAVE';
      // Only one half covered and no clock-in: never deduct the uncertain half automatically
      if (halves.length === 1) {
        const decision = decisionFor(date, 'HALF_DAY_LEAVE_UNCOVERED');
        push({ ...base, kind, scheduleSource, paidLeave, leaveLop, absentLop: decision === 'APPLY' ? 0.5 : 0,
          reviewType: 'HALF_DAY_LEAVE_UNCOVERED', resolution: decision, review: decision ? null : REVIEW_HALF_DAY_UNCOVERED });
      } else {
        push({ ...base, kind, scheduleSource, paidLeave, leaveLop });
      }
      continue;
    }
    push({ ...base, kind: 'ABSENT', scheduleSource, absentLop: 1 });
  }
  return days;
}

export interface DaySummary {
  scheduledDays: number;   // working days evaluated so far (present + half + leave + absent + LOP)
  presentDays: number;     // days with a clock-in (full + half)
  halfDays: number;        // half days that get the half-day deduction
  absentDays: number;      // unexcused absences (no clock-in)
  paidLeaveDays: number;
  lopLeaveDays: number;    // approved LOP leave (incl. LOP half of half-day leave)
  sandwichLopDays: number;
  lopDays: number;         // absent + LOP leave + sandwich (single total, no overlap)
  holidayDays: number;
  weeklyOffDays: number;   // company weekly offs + roster weekly offs
  rosterDays: number;      // days whose working/off status came from the employee's roster
  earlyLogoutDays: number; // information only
  earlyLogoutMinutes: number;
  /** Unresolved flags only (these block approval). */
  reviewItems: { date: string; type: ReviewType; reason: string }[];
  /** Flags an Admin has resolved, and how. */
  resolvedReviews: { date: string; type: ReviewType; decision: ReviewDecision }[];
}

export function summarizeDays(days: ClassifiedDay[]): DaySummary {
  const count = (k: DayKind) => days.filter(d => d.kind === k).length;
  const sum = (f: (d: ClassifiedDay) => number) => r2(days.reduce((s, d) => s + f(d), 0));
  const absentDays = sum(d => d.absentLop);
  const lopLeaveDays = sum(d => d.leaveLop);
  const sandwichLopDays = sum(d => d.sandwichLop);
  return {
    scheduledDays: days.filter(d => ['PRESENT', 'HALF_DAY', 'PAID_LEAVE', 'LOP_LEAVE', 'MIXED_LEAVE', 'SANDWICH_LOP', 'ABSENT'].includes(d.kind)).length,
    presentDays: count('PRESENT') + count('HALF_DAY'),
    halfDays: days.filter(d => d.halfDayDeduction).length,
    absentDays,
    paidLeaveDays: sum(d => d.paidLeave),
    lopLeaveDays,
    sandwichLopDays,
    lopDays: r2(absentDays + lopLeaveDays + sandwichLopDays),
    holidayDays: count('HOLIDAY'),
    weeklyOffDays: count('WEEKLY_OFF'),
    rosterDays: days.filter(d => d.scheduleSource === 'ROSTER').length,
    earlyLogoutDays: days.filter(d => d.earlyLogoutMinutes > 0).length,
    earlyLogoutMinutes: sum(d => d.earlyLogoutMinutes),
    reviewItems: days.filter(d => d.review).map(d => ({ date: d.date, type: d.reviewType as ReviewType, reason: d.review as string })),
    resolvedReviews: days.filter(d => d.reviewType && d.resolution).map(d => ({ date: d.date, type: d.reviewType as ReviewType, decision: d.resolution as ReviewDecision })),
  };
}
