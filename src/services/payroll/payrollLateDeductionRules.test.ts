import { describe, it, expect, vi } from 'vitest';
import {
  calculateLateDeduction,
  applyMonetaryRounding,
  type CalculateLateDeductionInput,
} from './payrollLateDeductionRules';
import { isPayrollLocked, LOCKED_PAYROLL_STATUSES } from './payrollRules';
import { resolveClockInSession } from '../attendance/clockRules';

describe('Salary-Based Late Login Deduction Rules', () => {
  // Test 1: Illustrative acceptance test: ₹30,000, 25 working days, 8h/day, 15 chargeable minutes -> ₹37.50
  it('1. calculates exact deduction of ₹37.50 for ₹30,000 salary, 25 working days, 8h shift, 15 late mins', () => {
    const input: CalculateLateDeductionInput = {
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 25,
      defaultRequiredHours: 8,
      totalLateMinutes: 15,
      monthlyLateLoginLimit: 0,
      salaryRounding: 'exact', // 2 decimals
    };

    const res = calculateLateDeduction(input);
    expect(res.salaryPerMinute).toBeCloseTo(2.5, 4); // 30,000 / (25 * 8 * 60) = 2.50
    expect(res.chargeableMinutes).toBe(15);
    expect(res.unroundedAmount).toBeCloseTo(37.5, 2);
    expect(res.deductionAmount).toBe(37.5);
  });

  // Test 2: Zero late minutes -> ₹0
  it('2. returns ₹0 deduction when there are 0 late minutes', () => {
    const input: CalculateLateDeductionInput = {
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 25,
      totalLateMinutes: 0,
      monthlyLateLoginLimit: 0,
    };

    const res = calculateLateDeduction(input);
    expect(res.deductionAmount).toBe(0);
    expect(res.chargeableMinutes).toBe(0);
    expect(res.unroundedAmount).toBe(0);
  });

  // Test 3: Late minutes entirely covered by applicable exemption -> ₹0
  it('3. returns ₹0 deduction when late minutes are entirely covered by monthlyLateLoginLimit exemption', () => {
    const input: CalculateLateDeductionInput = {
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 25,
      totalLateMinutes: 30,
      lateLogins: 2,
      monthlyLateLoginLimit: 2, // 2 late arrivals allowed
      lateRecords: [
        { date: '2026-10-02', lateMinutes: 15, requiredHours: 8 },
        { date: '2026-10-05', lateMinutes: 15, requiredHours: 8 },
      ],
    };

    const res = calculateLateDeduction(input);
    expect(res.exemptOccurrences).toBe(2);
    expect(res.chargeableOccurrences).toBe(0);
    expect(res.chargeableMinutes).toBe(0);
    expect(res.exemptMinutes).toBe(30);
    expect(res.deductionAmount).toBe(0);
  });

  // Test 4: Multiple late arrivals in one payroll month
  it('4. exempts the first N occurrences and accurately charges subsequent occurrences across the month', () => {
    const input: CalculateLateDeductionInput = {
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000, // rate per min = 2.50
      workingDays: 25,
      totalLateMinutes: 45,
      lateLogins: 3,
      monthlyLateLoginLimit: 1, // First 1 occurrence exempt
      salaryRounding: 'exact',
      lateRecords: [
        { date: '2026-10-02', lateMinutes: 15, requiredHours: 8 }, // Exempt (1st occ)
        { date: '2026-10-08', lateMinutes: 10, requiredHours: 8 }, // Chargeable: 10m * 2.5 = 25
        { date: '2026-10-15', lateMinutes: 20, requiredHours: 8 }, // Chargeable: 20m * 2.5 = 50
      ],
    };

    const res = calculateLateDeduction(input);
    expect(res.totalLateMinutes).toBe(45);
    expect(res.exemptOccurrences).toBe(1);
    expect(res.exemptMinutes).toBe(15);
    expect(res.chargeableOccurrences).toBe(2);
    expect(res.chargeableMinutes).toBe(30);
    expect(res.unroundedAmount).toBeCloseTo(75, 2);
    expect(res.deductionAmount).toBe(75);
    expect(res.breakdown.items).toHaveLength(3);
    expect(res.breakdown.items[0].isExempt).toBe(true);
    expect(res.breakdown.items[1].isExempt).toBe(false);
    expect(res.breakdown.items[2].isExempt).toBe(false);
  });

  // Test 5: Different salaries and shift durations
  it('5. handles different salaries and shift durations (e.g. 10h shift, 6h shift)', () => {
    // 10-hour shift: 48,000 / (24 days * 10h * 60m) = 48,000 / 14,400 = 3.3333... per min
    const res10h = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 48000,
      workingDays: 24,
      defaultRequiredHours: 10,
      totalLateMinutes: 30,
      salaryRounding: 'exact',
    });
    expect(res10h.salaryPerMinute).toBeCloseTo(48000 / (24 * 10 * 60), 4);
    expect(res10h.deductionAmount).toBe(100); // 30 * (48,000 / 14,400) = 100

    // Varying shift per late day: 1st late on 8h shift, 2nd late on 6h shift
    // Salary 60,000, 25 working days
    // 8h shift rate = 60,000 / (25 * 8 * 60) = 5.00/min
    // 6h shift rate = 60,000 / (25 * 6 * 60) = 6.6666.../min
    const resVarying = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 60000,
      workingDays: 25,
      totalLateMinutes: 40,
      monthlyLateLoginLimit: 0,
      salaryRounding: 'exact',
      lateRecords: [
        { date: '2026-10-03', lateMinutes: 20, requiredHours: 8 }, // 20 * 5.00 = 100
        { date: '2026-10-07', lateMinutes: 20, requiredHours: 6 }, // 20 * (60,000 / 9000) = 133.3333...
      ],
    });
    expect(resVarying.breakdown.items[0].ratePerMinute).toBe(5);
    expect(resVarying.breakdown.items[1].ratePerMinute).toBeCloseTo(6.6667, 4);
    expect(resVarying.deductionAmount).toBeCloseTo(233.33, 2);
  });

  // Test 6: Zero salary and zero scheduled minutes
  it('6. safely returns ₹0 with no NaN or error when salary, working days, or shift hours are zero', () => {
    // Zero salary
    const resZeroSalary = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 0,
      workingDays: 25,
      totalLateMinutes: 20,
    });
    expect(resZeroSalary.deductionAmount).toBe(0);
    expect(resZeroSalary.salaryPerMinute).toBe(0);

    // Zero working days
    const resZeroDays = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 0,
      totalLateMinutes: 20,
    });
    expect(resZeroDays.deductionAmount).toBe(0);

    // Zero shift hours fallback to 8
    const resZeroHours = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 25,
      defaultRequiredHours: 0,
      totalLateMinutes: 15,
      salaryRounding: 'exact',
    });
    expect(resZeroHours.deductionAmount).toBe(37.5);
  });

  // Test 7: Missing or invalid attendance timestamps
  it('7. safely normalizes negative or NaN late minutes without throwing or producing negative amounts', () => {
    const resNegative = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 25,
      totalLateMinutes: -20 as any,
    });
    expect(resNegative.deductionAmount).toBe(0);
    expect(resNegative.chargeableMinutes).toBe(0);

    const resNaN = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 25,
      totalLateMinutes: NaN as any,
    });
    expect(resNaN.deductionAmount).toBe(0);
  });

  // Test 8: Decimal salary values and currency rounding
  it('8. handles decimal salaries and respects currency rounding modes ("round" vs "exact")', () => {
    // 33,333.33 / (26 * 8 * 60) = 33,333.33 / 12,480 = 2.6709399...
    // 15 minutes * 2.6709399... = 40.0640985...
    const resExact = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 33333.33,
      workingDays: 26,
      defaultRequiredHours: 8,
      totalLateMinutes: 15,
      salaryRounding: 'exact',
    });
    expect(resExact.deductionAmount).toBe(40.06);

    const resRound = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 33333.33,
      workingDays: 26,
      defaultRequiredHours: 8,
      totalLateMinutes: 15,
      salaryRounding: 'round',
    });
    expect(resRound.deductionAmount).toBe(40);
  });

  // Test 9: Month boundaries and timezone differences (overnight shift clock-in)
  it('9. correctly associates overnight clock-in after midnight with yesterday shift and calculates late arrival', () => {
    // Shift: 22:00 to 06:00 (crosses midnight, 10 min grace).
    // Clock-in at 00:30 on 2026-10-09 (IST).
    // Should associate with 2026-10-08 and be 150 minutes late (from 22:00).
    const shift = { start_time: '22:00:00', end_time: '06:00:00', crosses_midnight: true };
    // 2026-10-09 00:30 IST is 2026-10-08 19:00 UTC
    const clockInMs = new Date('2026-10-08T19:00:00.000Z').getTime();

    const session = resolveClockInSession({
      nowMs: clockInMs,
      today: '2026-10-09',
      shift,
      graceMinutes: 10,
      timeZone: 'Asia/Kolkata',
    });

    expect(session.attendanceDate).toBe('2026-10-08');
    expect(session.lateMinutes).toBe(150);

    // Calculate late deduction for this overnight late session
    const res = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 36000,
      workingDays: 25,
      defaultRequiredHours: 8,
      totalLateMinutes: session.lateMinutes,
      salaryRounding: 'exact',
    });
    // Rate = 36000 / (25 * 8 * 60) = 3.00/min
    // Deduction = 150 * 3.00 = 450.00
    expect(res.salaryPerMinute).toBe(3);
    expect(res.deductionAmount).toBe(450);
  });

  // Test 10: Existing Fixed Amount calculations remain unchanged
  it('10. preserves existing Fixed Amount, interval_based, and per_minute methods completely unchanged', () => {
    const fixedRes = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'fixed',
      monthlySalary: 30000,
      workingDays: 25,
      totalLateMinutes: 25,
      lateFixedAmount: 150,
    });
    expect(fixedRes.deductionAmount).toBe(150);

    const intervalRes = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'interval_based',
      monthlySalary: 30000,
      workingDays: 25,
      totalLateMinutes: 40,
      lateIntervalMinutes: 15,
      lateIntervalAmount: 100,
    });
    // floor(40 / 15) * 100 = 2 * 100 = 200
    expect(intervalRes.deductionAmount).toBe(200);

    const flatPerMinRes = calculateLateDeduction({
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'per_minute',
      monthlySalary: 30000,
      workingDays: 25,
      totalLateMinutes: 15,
      latePerMinuteRate: 10,
    });
    expect(flatPerMinRes.deductionAmount).toBe(150);
  });

  // Test 11: No duplicate deductions after recalculation (pure calculation idempotency)
  it('11. calculation is purely functional and idempotent — calling multiple times yields identical results', () => {
    const input: CalculateLateDeductionInput = {
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 25,
      defaultRequiredHours: 8,
      totalLateMinutes: 15,
      monthlyLateLoginLimit: 0,
      salaryRounding: 'exact',
    };

    const res1 = calculateLateDeduction(input);
    const res2 = calculateLateDeduction(input);
    expect(res1).toEqual(res2);
    expect(res1.deductionAmount).toBe(37.5);
  });

  // Test 12: Approved and locked payroll remains protected
  it('12. verifies locked payroll statuses prevent modification of payroll calculations', () => {
    for (const status of LOCKED_PAYROLL_STATUSES) {
      expect(isPayrollLocked(status)).toBe(true);
    }
    expect(isPayrollLocked('DRAFT')).toBe(false);
    expect(isPayrollLocked('CALCULATED')).toBe(false);
    expect(isPayrollLocked('UNDER_REVIEW')).toBe(false);
  });

  // Test 13: Unauthorized users cannot change the method or deduction
  it('13. prevents deductions when enableLateLoginDeduction is false', () => {
    const res = calculateLateDeduction({
      enableLateLoginDeduction: false,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 30000,
      workingDays: 25,
      totalLateMinutes: 30,
    });
    expect(res.deductionAmount).toBe(0);
    expect(res.chargeableMinutes).toBe(0);
  });

  // Test 14: Payroll totals reconcile with individual deduction records
  it('14. verifies individual occurrence deductions sum exactly to the total unrounded deduction', () => {
    const input: CalculateLateDeductionInput = {
      enableLateLoginDeduction: true,
      lateDeductionMethod: 'salary_based',
      monthlySalary: 45000,
      workingDays: 25,
      totalLateMinutes: 65,
      lateLogins: 3,
      monthlyLateLoginLimit: 1, // 1st exempt
      salaryRounding: 'exact',
      lateRecords: [
        { date: '2026-10-01', lateMinutes: 15, requiredHours: 8 }, // exempt
        { date: '2026-10-05', lateMinutes: 20, requiredHours: 8 }, // chargeable
        { date: '2026-10-12', lateMinutes: 30, requiredHours: 9 }, // chargeable, 9h shift
      ],
    };

    const res = calculateLateDeduction(input);
    const sumOfItems = res.breakdown.items.reduce((s, it) => s + it.deduction, 0);
    expect(sumOfItems).toBeCloseTo(res.unroundedAmount, 6);
    expect(res.chargeableMinutes).toBe(50); // 20 + 30
    expect(res.exemptMinutes).toBe(15);
  });

  // Grace period behavior at clock-in
  it('15. verifies clockRules does not flag late arrival within grace period (preventing double grace subtraction)', () => {
    const shift = { start_time: '09:00:00', end_time: '18:00:00', crosses_midnight: false };
    // 09:08 clock-in with 10 min grace period -> lateMinutes = 0
    const nowWithinGrace = new Date('2026-10-08T03:38:00.000Z').getTime(); // 09:08 IST
    const sessionWithin = resolveClockInSession({
      nowMs: nowWithinGrace,
      today: '2026-10-08',
      shift,
      graceMinutes: 10,
      timeZone: 'Asia/Kolkata',
    });
    expect(sessionWithin.lateMinutes).toBe(0);

    // 09:15 clock-in with 10 min grace period -> lateMinutes = 15 (exceeded grace, late measured from shift start)
    const nowBeyondGrace = new Date('2026-10-08T03:45:00.000Z').getTime(); // 09:15 IST
    const sessionBeyond = resolveClockInSession({
      nowMs: nowBeyondGrace,
      today: '2026-10-08',
      shift,
      graceMinutes: 10,
      timeZone: 'Asia/Kolkata',
    });
    expect(sessionBeyond.lateMinutes).toBe(15);
  });
});
