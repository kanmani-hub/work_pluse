import { describe, it, expect } from 'vitest';
import { marginalDailyCalculation, itemKey, isoDayBefore, mapLimited } from './dailyImpactRules';
import { calculateLateDeduction } from './payrollLateDeductionRules';

// Synthetic month-to-date calculations only (the shape calculatePayrollDetails returns).
const mtd = (o: any = {}) => ({
  grossSalary: 26000, dailyRate: 1000, lopDeduction: o.lop ?? 0, overtime: o.ot ?? 0,
  deductionItems: o.items || [], earningAdjustmentItems: o.earn || [], lateCalculation: o.late ?? null,
  empData: { attendance: { totalLateMinutes: o.lateMin ?? 0, lopDays: o.lopDays ?? 0, absentDays: o.absent ?? 0, totalBreakExcessMinutes: 0, totalOvertimeMinutes: o.otMin ?? 0 }, leave: { lopLeave: o.lopLeave ?? 0 } },
  days: o.days || [], settings: {}, appSettings: {},
});

describe('marginalDailyCalculation', () => {
  it('item categories ignore the count suffix', () => {
    expect(itemKey('LOP Deduction (2 days)')).toBe('LOP Deduction');
    expect(itemKey('Late Deduction')).toBe('Late Deduction');
    expect(itemKey('Missing Clock-Out Deduction (1 case)')).toBe('Missing Clock-Out Deduction');
  });

  it('LOP: the second absence of the month adds exactly one day', () => {
    const before = mtd({ lop: 1000, lopDays: 1, absent: 1, items: [{ name: 'LOP Deduction (1 day)', amount: 1000 }] });
    const through = mtd({ lop: 2000, lopDays: 2, absent: 2, items: [{ name: 'LOP Deduction (2 days)', amount: 2000 }], days: [{ date: '2026-10-12', kind: 'ABSENT' }] });
    const c = marginalDailyCalculation(through, before, '2026-10-12');
    expect(c.lopDeduction).toBe(1000);
    expect(c.deductionItems).toEqual([{ name: 'LOP Deduction (this day)', amount: 1000 }]);
    expect(c.empData.attendance).toMatchObject({ lopDays: 1, absentDays: 1 });
    expect(c.totalDeductions).toBe(1000);
    expect(c.dayKind).toBe('ABSENT');
  });

  it('half-day LOP adds 0.5 day', () => {
    const c = marginalDailyCalculation(mtd({ lop: 500, lopDays: 0.5, lopLeave: 0.5, items: [{ name: 'LOP Deduction (0.5 day)', amount: 500 }] }), mtd(), '2026-10-03');
    expect(c).toMatchObject({ lopDeduction: 500, totalDeductions: 500 });
    expect(c.empData.leave.lopLeave).toBe(0.5);
  });

  it('interval-based late: rounding is on the month total, so a day can add a full interval for few minutes', () => {
    // 10 min before (0 intervals of 15) + 8 min today = 18 → 1 interval: today adds ₹100
    const before = mtd({ lateMin: 10 });
    const through = mtd({ lateMin: 18, items: [{ name: 'Late Deduction', amount: 100 }] });
    const c = marginalDailyCalculation(through, before, '2026-10-12');
    expect(c.empData.attendance.totalLateMinutes).toBe(8);
    expect(c.deductionItems).toEqual([{ name: 'Late Deduction', amount: 100 }]);
    expect(c.monthToDate.late).toEqual({ through: 100, before: 0 });
  });

  it('pending missing clock-out adjustment of an earlier date is not repeated; on its own date it is shown', () => {
    const mco = [{ name: 'Missing Clock-Out Deduction (1 case)', amount: 500 }];
    expect(marginalDailyCalculation(mtd({ items: mco }), mtd({ items: mco }), '2026-10-12').deductionItems).toEqual([]);
    expect(marginalDailyCalculation(mtd({ items: mco }), mtd(), '2026-10-05').deductionItems).toEqual([{ name: 'Missing Clock-Out Deduction (this day)', amount: 500 }]);
  });

  it('approved overtime: only the date\'s approved pay; a reversal earning appears once', () => {
    const c = marginalDailyCalculation(mtd({ ot: 375, otMin: 180, earn: [{ name: 'Refund', amount: 200 }] }), mtd({ ot: 125, otMin: 60, earn: [{ name: 'Refund', amount: 200 }] }), '2026-10-12');
    expect(c.overtime).toBe(250);
    expect(c.empData.attendance.totalOvertimeMinutes).toBe(120);
    expect(c.earningAdjustmentItems).toEqual([]);
  });

  it('first day of the month: no previous day, the month-to-date is the day', () => {
    const c = marginalDailyCalculation(mtd({ items: [{ name: 'Late Deduction', amount: 100 }], lateMin: 20 }), null, '2026-10-01');
    expect(c.deductionItems).toEqual([{ name: 'Late Deduction', amount: 100 }]);
    expect(c.empData.attendance.totalLateMinutes).toBe(20);
  });

  it('a lower month-to-date (inputs changed between the two reads) is never shown as a negative deduction', () => {
    const c = marginalDailyCalculation(mtd({ items: [{ name: 'Late Deduction', amount: 100 }] }), mtd({ items: [{ name: 'Late Deduction', amount: 200 }] }), '2026-10-12');
    expect(c.deductionItems).toEqual([]);
    expect(c.totalDeductions).toBe(0);
  });
});

describe('reconciliation: the daily amounts of a month add up to the monthly payroll', () => {
  // Late minutes per day for one employee in October (synthetic). Real late rule, salary based with a
  // limit of 2 exempt occurrences, and interval based.
  const lateByDay: Record<string, number> = { '2026-10-03': 12, '2026-10-06': 25, '2026-10-09': 7, '2026-10-14': 40, '2026-10-20': 3, '2026-10-27': 16 };
  const dates = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const through = (date: string, settings: any) => {
    const records = Object.entries(lateByDay).filter(([d]) => d <= date).map(([d, m]) => ({ date: d, lateMinutes: m }));
    const total = records.reduce((s, r) => s + r.lateMinutes, 0);
    // same inputs payrollService passes (gross ₹26,000, divisor 26, 8 h shift)
    const res = calculateLateDeduction({
      ...settings, enableLateLoginDeduction: true, monthlySalary: 26000, workingDays: 26, defaultRequiredHours: 8, salaryRounding: 'exact',
      totalLateMinutes: total, lateLogins: records.length, lateRecords: records,
    } as any);
    const amount = Math.round(Number(res.deductionAmount) * 100) / 100;
    return mtd({ lateMin: total, items: amount > 0 ? [{ name: 'Late Deduction', amount }] : [], late: res });
  };
  for (const settings of [
    { enableLateLoginDeduction: true, lateDeductionMethod: 'interval_based', lateIntervalMinutes: 15, lateIntervalAmount: 100 },
    { enableLateLoginDeduction: true, lateDeductionMethod: 'salary_based', monthlyLateLoginLimit: 2 },
    { enableLateLoginDeduction: true, lateDeductionMethod: 'fixed', lateFixedAmount: 300 },
    { enableLateLoginDeduction: true, lateDeductionMethod: 'per_minute', latePerMinuteRate: 2 },
  ]) {
    it(`${settings.lateDeductionMethod}: Σ daily = monthly`, () => {
      let sum = 0;
      dates.forEach((d, i) => {
        const c = marginalDailyCalculation(through(d, settings), i === 0 ? null : through(dates[i - 1], settings), d);
        sum += c.totalDeductions || 0;
      });
      const monthly = (through('2026-10-31', settings).deductionItems[0]?.amount) || 0;
      expect(Math.round(sum * 100) / 100).toBe(monthly);
      expect(monthly).toBeGreaterThan(0);
    });
  }
});

describe('helpers', () => {
  it('isoDayBefore crosses month and year boundaries', () => {
    expect(isoDayBefore('2026-10-12')).toBe('2026-10-11');
    expect(isoDayBefore('2026-03-01')).toBe('2026-02-28');
    expect(isoDayBefore('2026-01-01')).toBe('2025-12-31');
  });
  it('mapLimited keeps order and never runs more than the limit at once', async () => {
    let running = 0; let peak = 0;
    const out = await mapLimited([5, 1, 4, 2, 3], 2, async (n) => {
      running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, n));
      running--; return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
});
