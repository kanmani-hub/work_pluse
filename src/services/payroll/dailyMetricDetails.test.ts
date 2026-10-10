import { describe, it, expect } from 'vitest';
import { buildDailyMetrics, lateRuleText, breakRuleText, overtimeRuleText, istTime } from './dailyMetricDetails';

// Synthetic rows shaped like payrollService.getDailyDeductionReport() output (no real employees).
const SETTINGS = {
  enableLateLoginDeduction: true, lateDeductionMethod: 'interval_based', lateIntervalMinutes: 15, lateIntervalAmount: 100,
  enableBreakOverrunDetection: true, enableBreakOverrunDeduction: true, breakOverrunDeductionMethod: 'salary_based',
  enableLopDeductions: true, lopMethod: 'daily_rate', workingDaysBasis: 'configured', configuredWorkingDays: 26,
  enableOvertimePay: true, overtimeRateType: 'multiplier', overtimeMultiplier: 1.5, salaryRounding: 'round',
};
const APP = { gracePeriodMins: 10, breakDurationMins: 60 };
const SHIFT = { name: 'General', start_time: '09:00:00', end_time: '18:00:00', required_hours: 8, break_duration_minutes: 60 };

let n = 0;
function row(o: any = {}) {
  n++;
  const a = { lopDays: 0, absentDays: 0, sandwichLopDays: 0, totalOvertimeMinutes: o.overtimeMinutes || 0, recordedOvertimeMinutes: 0, ...(o.att || {}) };
  const late = o.lateDeduction || 0, brk = o.breakDeduction || 0, lop = o.lopImpact || 0, other = o.otherDeductions || 0;
  const items = [
    ...(late ? [{ name: `Late Deduction (${o.lateMinutes}m)`, amount: late }] : []),
    ...(brk ? [{ name: 'Break Excess Deduction (0.5h)', amount: brk }] : []),
    ...(lop ? [{ name: 'LOP Deduction (1d unauthorized absence)', amount: lop }] : []),
    ...(other ? [{ name: 'Half-Day Deduction', amount: other }] : []),
  ];
  return {
    employee: { id: `e${n}`, first_name: 'Test', last_name: `Person ${n}`, employee_code: `EMP${String(n).padStart(3, '0')}`, departments: { name: 'Synthetic Dept' }, office: { name: 'Synthetic Office' } },
    shift: 'General', status: o.status || 'COMPLETED',
    clockIn: o.clockIn === undefined ? '2026-10-12T03:30:00.000Z' : o.clockIn, // 09:00 IST
    clockOut: o.clockOut === undefined ? '2026-10-12T12:30:00.000Z' : o.clockOut, // 18:00 IST
    lateMinutes: o.lateMinutes || 0, lateDeduction: late,
    breakOverrunMinutes: o.breakOverrunMinutes || 0, breakDeduction: brk,
    overtimeMinutes: o.overtimeMinutes || 0, overtimePay: o.overtimePay || 0,
    lopImpact: lop, otherDeductions: other,
    totalDailyImpact: o.totalDailyImpact ?? late + brk + lop + other,
    rawCalc: {
      grossSalary: 26000, workingDays: 26, dailyRate: 1000, lopDeduction: lop, overtime: o.overtimePay || 0,
      settings: { ...SETTINGS, ...(o.settings || {}) }, appSettings: APP, deductionItems: items,
      empData: { attendance: a, leave: { lopLeave: 0, ...(o.leave || {}) } },
    },
    attendance: { break_minutes: o.breakMinutes ?? 30, required_hours: 8, shift_template: SHIFT, ...(o.attendance || {}) },
    overtimeRequests: o.overtimeRequests || [],
    overtimeRequestsError: o.overtimeRequestsError || null,
  };
}

const rows = () => {
  n = 0;
  return [
    row({ lateMinutes: 30, lateDeduction: 200, clockIn: '2026-10-12T04:00:00.000Z' }),                                   // late 09:30 IST
    row({}),                                                                                                                // nothing
    row({ breakMinutes: 90, breakOverrunMinutes: 30, breakDeduction: 63 }),                                                 // break overrun
    row({ clockIn: null, clockOut: null, status: 'ABSENT', lopImpact: 1000, att: { lopDays: 1, absentDays: 1 } }),          // absent row
    row({ clockOut: null, status: 'WORKING', overtimeRequests: [{ status: 'PENDING', eligible_overtime_hours: 1.5, requested_overtime_hours: 1 }] }), // missing clock-out
    row({ clockOut: '2026-10-12T14:30:00.000Z', overtimeMinutes: 60, overtimePay: 188,
          overtimeRequests: [{ status: 'APPROVED', eligible_overtime_hours: 2, requested_overtime_hours: 1, approved_overtime_hours: 1 }] }), // approved OT
    row({ otherDeductions: 500 }),                                                                                           // half day (other)
  ];
};

// The summary cards in Payroll.tsx show buildDailyMetrics(rows)[key].total — check they equal the raw row sums
const cardSum = (rs: any[], f: string) => rs.reduce((s, r) => s + r[f], 0);

describe('each card total equals its breakdown total and the raw report rows', () => {
  it('late / break / LOP / overtime / total', () => {
    const rs = rows();
    const m = buildDailyMetrics(rs);
    expect(m.late.total).toBe(cardSum(rs, 'lateDeduction'));
    expect(m.break.total).toBe(cardSum(rs, 'breakDeduction'));
    expect(m.lop.total).toBe(cardSum(rs, 'lopImpact'));
    expect(m.overtime.total).toBe(cardSum(rs, 'overtimePay'));
    expect(m.total.total).toBe(cardSum(rs, 'totalDailyImpact'));
    expect([m.late.total, m.break.total, m.lop.total, m.overtime.total, m.total.total]).toEqual([200, 63, 1000, 188, 1763]);
    // each breakdown's rows add up to its total
    for (const k of ['late', 'break', 'lop', 'overtime', 'total'] as const) {
      expect(m[k].rows.reduce((s, r) => s + r.amount, 0)).toBe(m[k].total);
    }
  });
});

describe('Late Deductions', () => {
  it('lists only late employees with shift start, IST clock-in, minutes, grace and amount', () => {
    const m = buildDailyMetrics(rows()).late;
    expect(m.rows).toEqual([{ employee: 'Test Person 1', code: 'EMP001', department: 'Synthetic Dept', office: 'Synthetic Office',
      shiftStart: '09:00', clockIn: '09:30', lateMinutes: 30, grace: '10 min', formula: 'floor(30 ÷ 15) × ₹100', amount: 200 }]);
    expect(m.explanation[0]).toBe('Interval based: floor(late minutes ÷ 15) × ₹100');
  });

  it('rule text follows the saved method; disabled → nothing deducted', () => {
    expect(lateRuleText({ enableLateLoginDeduction: false }, 1000).text).toMatch('turned off');
    expect(lateRuleText({ enableLateLoginDeduction: true, lateDeductionMethod: 'per_minute', latePerMinuteRate: 5 }, 1000).text).toBe('Per minute: late minutes × ₹5');
    expect(lateRuleText({ enableLateLoginDeduction: true, lateDeductionMethod: 'half_day' }, 1000).text).toBe('Half day: 50% of the daily rate (₹500)');
  });
});

describe('Break Overrun Deductions', () => {
  it('shows allowed (Settings), actual, overrun and amount; salary-based formula with the daily rate', () => {
    const m = buildDailyMetrics(rows()).break;
    expect(m.rows).toEqual([{ employee: 'Test Person 3', code: 'EMP003', department: 'Synthetic Dept', office: 'Synthetic Office',
      allowed: '60 min', actual: '90 min', overrun: '30 min', formula: '0.5h × ₹125/h', amount: 63 }]);
    // Explanation is generic (rates differ per employee); the per-row calculation shows each employee's rate
    expect(m.explanation[0]).toBe("Salary based: excess hours × hourly rate (the employee's daily rate ÷ 8)");
    expect(breakRuleText({ enableBreakOverrunDetection: true, enableBreakOverrunDeduction: true, breakOverrunDeductionMethod: 'salary_based' }, 1000).text)
      .toBe('Salary based: excess hours × hourly rate (daily rate ÷ 8 = ₹125)');
    expect(breakRuleText({ enableBreakOverrunDetection: true, enableBreakOverrunDeduction: false }, 1000).enabled).toBe(false);
  });
});

describe('LOP Impact', () => {
  it('shows gross, saved basis and divisor, daily rate, days, reason and formula', () => {
    const m = buildDailyMetrics(rows()).lop;
    expect(m.rows).toEqual([{ employee: 'Test Person 4', code: 'EMP004', department: 'Synthetic Dept', office: 'Synthetic Office',
      gross: 26000, basis: 'Configured / 26', dailyRate: 1000, lopDays: 1, reason: '1d absent (no clock-in, no approved leave)', formula: '1 × ₹1,000', amount: 1000 }]);
    expect(m.explanation[1]).toMatch('Configured (26 days)');
  });
});

describe('Overtime Pay', () => {
  it('lists pending (missing clock-out) and approved overtime; time after shift end is not paid without approval', () => {
    const m = buildDailyMetrics(rows()).overtime;
    expect(m.rows.map(r => [r.code, r.clock, r.elapsed, r.eligible, r.status, r.approved, r.amount])).toEqual([
      ['EMP005', '09:00 – not clocked out', '—', '1h 30m', 'PENDING', '0h 00m', 0],
      ['EMP006', '09:00 – 20:00', '11h 00m', '2h 00m', 'APPROVED', '1h 00m', 188],
    ]);
    expect(m.rows[1].scheduled).toBe('8h 00m');
    expect(m.rows[1].formula).toBe('1h × ₹125/h × 1.5');
    expect(m.rows[0].formula).toBe('—'); // pending: nothing approved, nothing paid
    expect(m.explanation[0]).toBe("Approved hours × hourly rate (the employee's daily rate ÷ 8) × 1.5");
  });

  it('overtime pay off or fixed rate not configured → says so, never invents a rate', () => {
    expect(overtimeRuleText({ enableOvertimePay: false }, 1000).text).toMatch('turned off');
    const r = overtimeRuleText({ enableOvertimePay: true, overtimeRateType: 'fixed', overtimeFixedRate: 0 }, 1000);
    expect(r).toMatchObject({ configured: false });
    expect(r.text).toMatch('not configured');
    n = 0;
    const m = buildDailyMetrics([row({ settings: { overtimeRateType: 'fixed', overtimeFixedRate: 0 }, overtimeRequests: [{ status: 'APPROVED', eligible_overtime_hours: 1, approved_overtime_hours: 1 }] })]).overtime;
    expect(m.notes.join(' ')).toMatch('not configured');
  });

  it('a failed overtime-request lookup shows Unavailable, not "No request"', () => {
    n = 0;
    const m = buildDailyMetrics([row({ overtimeMinutes: 0, overtimeRequestsError: 'timeout', att: { recordedOvertimeMinutes: 30 } })]).overtime;
    expect(m.rows[0]).toMatchObject({ eligible: 'Unavailable', status: 'Unavailable' });
    expect(m.notes[0]).toMatch('could not be loaded');
  });
});

describe('Total Daily Deduction Impact', () => {
  it('per employee: late + break + LOP + other = total; overtime is not subtracted; nothing double counted', () => {
    const m = buildDailyMetrics(rows()).total;
    expect(m.rows.length).toBe(7);
    for (const r of m.rows) expect(r.late + r.break + r.lop + r.other).toBe(r.amount);
    expect(m.rows.find(r => r.code === 'EMP007')).toMatchObject({ other: 500, otherNames: 'Half-Day Deduction', amount: 500 });
    expect(m.rows.find(r => r.code === 'EMP006')?.amount).toBe(0); // overtime earner: no deduction
    expect(m.notes).toEqual([]);
  });

  it('a row whose parts do not add up is reported, not hidden', () => {
    n = 0;
    const m = buildDailyMetrics([row({ lateMinutes: 15, lateDeduction: 100, totalDailyImpact: 150 })]).total;
    expect(m.notes[0]).toMatch('1 employee row(s) do not add up');
  });
});

describe('empty date and zero deductions', () => {
  it('no rows → every total ₹0 with a clear message', () => {
    const m = buildDailyMetrics([]);
    for (const k of ['late', 'break', 'lop', 'overtime', 'total'] as const) {
      expect(m[k].total).toBe(0);
      expect(m[k].rows).toEqual([]);
      expect(m[k].emptyMessage.length > 0).toBe(true);
    }
    expect(buildDailyMetrics(undefined).total.total).toBe(0);
  });

  it('employees present but nobody late → Late total ₹0 and no rows', () => {
    n = 0;
    const m = buildDailyMetrics([row({}), row({})]).late;
    expect(m.total).toBe(0);
    expect(m.rows).toEqual([]);
    expect(m.emptyMessage).toBe('No late arrivals with a deduction were found for this date.');
  });
});

describe('times are shown in IST whatever the browser time zone', () => {
  it('istTime', () => {
    expect(istTime('2026-10-12T03:30:00.000Z')).toBe('09:00');
    expect(istTime('2026-10-11T18:45:00.000Z')).toBe('00:15');
    expect(istTime(null)).toBe('—');
  });
});

describe('per-employee calculation text uses that employee\'s own daily rate', () => {
  it('two employees with different salaries show different hourly rates', () => {
    n = 0;
    const a = row({ breakMinutes: 90, breakOverrunMinutes: 30, breakDeduction: 63 });
    const b = row({ breakMinutes: 90, breakOverrunMinutes: 30, breakDeduction: 125 });
    b.rawCalc.dailyRate = 2000;
    const m = buildDailyMetrics([a, b]).break;
    expect(m.rows.map(r => r.formula)).toEqual(['0.5h × ₹125/h', '0.5h × ₹250/h']);
    expect(m.total).toBe(188);
  });
});
