/**
 * Daily payroll impact = what this date adds to the month (pure, unit-tested).
 *
 * The daily view used to run the payroll calculation for the single date. Rules that depend on the
 * rest of the month then gave a different answer than the monthly payroll:
 *   - salary-based late deduction exempts the first N late days of the month (monthlyLateLoginLimit);
 *   - interval-based late deduction rounds the month's total minutes (floor(total ÷ interval));
 *   - fixed / half-day late deduction is charged once per month (policy confirmed 2026-10-28);
 *   - missing clock-out adjustments were read for every date up to the day (shown again every day).
 * Now the day's figures are the month-to-date calculation through the date minus the month-to-date
 * calculation through the previous day, with the same function the monthly payroll uses. Summed over
 * every day of the month the differences equal the monthly payroll exactly.
 */

export interface CalcLike {
  basic?: number;
  grossSalary?: number;
  totalAllowances?: number;
  totalDeductions?: number;
  lopDeduction?: number;
  overtime?: number;
  netSalary?: number;
  workingDays?: number;
  dailyRate?: number;
  deductionItems?: { name: string; amount: number }[];
  earningAdjustmentItems?: { name: string; amount: number }[];
  lateCalculation?: any;
  empData?: any;
  settings?: any;
  appSettings?: any;
  days?: { date: string; kind: string }[];
  [k: string]: any;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Item category: the name without its count suffix ("LOP Deduction (2 days)" → "LOP Deduction"). */
export const itemKey = (name: string) => String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();

function itemDelta(through: { name: string; amount: number }[] = [], before: { name: string; amount: number }[] = []) {
  const sums = (list: { name: string; amount: number }[]) => {
    const m = new Map<string, { name: string; amount: number }>();
    for (const it of list || []) {
      const k = itemKey(it.name);
      const cur = m.get(k);
      m.set(k, { name: cur?.name ?? it.name, amount: (cur?.amount ?? 0) + num(it.amount) });
    }
    return m;
  };
  const t = sums(through); const b = sums(before);
  const out: { name: string; amount: number }[] = [];
  for (const [k, v] of t) {
    // Month-to-date amounts never decrease as days are added; a negative difference would mean the
    // inputs changed between the two reads, so it is not shown as a negative deduction.
    const d = r2(v.amount - (b.get(k)?.amount ?? 0));
    if (d > 0.004) out.push({ name: k === v.name ? v.name : `${k} (this day)`, amount: d });
  }
  return out;
}

/** The given date's share of the month: calculation through the date minus calculation through the previous day. */
export function marginalDailyCalculation(through: CalcLike, before: CalcLike | null | undefined, date: string): CalcLike & { dayKind: string | null; monthToDate: { late: { through: number; before: number } } } {
  const b: CalcLike = before || {};
  const deductionItems = itemDelta(through.deductionItems, b.deductionItems);
  const earningAdjustmentItems = itemDelta(through.earningAdjustmentItems, b.earningAdjustmentItems);
  const lateOf = (c: CalcLike) => (c.deductionItems || []).filter(d => itemKey(d.name) === 'Late Deduction').reduce((s, d) => s + num(d.amount), 0);
  const ta = through.empData?.attendance || {}; const ba = b.empData?.attendance || {};
  const tl = through.empData?.leave || {}; const bl = b.empData?.leave || {};
  const diff = (k: string, x: any = ta, y: any = ba) => Math.max(0, r2(num(x[k]) - num(y[k])));
  const tLate = through.lateCalculation || null; const bLate = b.lateCalculation || null;
  const dayKind = (through.days || []).find(d => d.date === date)?.kind ?? null;
  return {
    ...through,
    deductionItems,
    earningAdjustmentItems,
    totalDeductions: r2(deductionItems.reduce((s, d) => s + d.amount, 0)),
    lopDeduction: Math.max(0, r2(num(through.lopDeduction) - num(b.lopDeduction))),
    overtime: Math.max(0, r2(num(through.overtime) - num(b.overtime))),
    lateCalculation: tLate ? {
      ...tLate,
      deductionAmount: Math.max(0, r2(num(tLate.deductionAmount) - num(bLate?.deductionAmount))),
      exemptOccurrences: Math.max(0, num(tLate.exemptOccurrences) - num(bLate?.exemptOccurrences)),
      chargeableMinutes: Math.max(0, num(tLate.chargeableMinutes) - num(bLate?.chargeableMinutes)),
      exemptMinutes: Math.max(0, num(tLate.exemptMinutes) - num(bLate?.exemptMinutes)),
    } : tLate,
    empData: {
      ...through.empData,
      attendance: {
        ...ta,
        totalLateMinutes: diff('totalLateMinutes'),
        totalBreakExcessMinutes: diff('totalBreakExcessMinutes'),
        totalBreakOverrunMinutes: diff('totalBreakOverrunMinutes'),
        totalOvertimeMinutes: diff('totalOvertimeMinutes'),
        recordedOvertimeMinutes: diff('recordedOvertimeMinutes'),
        lopDays: diff('lopDays'),
        absentDays: diff('absentDays'),
        sandwichLopDays: diff('sandwichLopDays'),
        halfDays: diff('halfDays'),
        lateLogins: diff('lateLogins'),
      },
      leave: { ...tl, lopLeave: diff('lopLeave', tl, bl), approvedLeave: diff('approvedLeave', tl, bl) },
    },
    dayKind,
    monthToDate: { late: { through: r2(lateOf(through)), before: r2(lateOf(b)) } },
  };
}

/** Day kinds listed in the daily view even without an attendance row (absence, leave, today not clocked in). */
export const NO_ATTENDANCE_LISTED_KINDS = ['ABSENT', 'LOP_LEAVE', 'MIXED_LEAVE', 'PAID_LEAVE', 'SANDWICH_LOP', 'TODAY_PENDING'];

export const isoDayBefore = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Runs tasks with at most `limit` in flight, results in input order. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
