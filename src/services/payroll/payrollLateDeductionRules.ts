/**
 * Late Login Deduction Rules (Pure, unit-tested).
 *
 * Implements salary-based per-minute late login deductions alongside existing methods.
 *
 * Approved Policy (2026-10-16):
 *  1. Salary basis: Monthly gross salary (basic_salary + allowances, matching LOP and daily rate).
 *  2. Denominator: Paid working days divisor from Settings (workingDaysBasis: configured e.g. 25/26,
 *     calendar, or actual company working days).
 *  3. Shift duration: Shift template / attendance required_hours, with 8-hour fallback.
 *  4. Monthly limit: monthlyLateLoginLimit exempts the first N late occurrences in the month.
 *     Subsequent late logins incur deductions.
 *  5. Grace period: Governed by Attendance Settings at clock-in. Arrivals <= grace period are
 *     recorded as 0 late minutes, so grace is not double-subtracted here.
 *  6. Rounding: Follows company salaryRounding setting ('round' = nearest rupee, 'exact' = 2 decimals).
 */

export interface LateOccurrenceRecord {
  date?: string;
  lateMinutes: number;
  requiredHours?: number | null;
}

export interface CalculateLateDeductionInput {
  enableLateLoginDeduction: boolean;
  lateDeductionMethod: 'per_minute' | 'fixed' | 'half_day' | 'interval_based' | 'salary_based';
  monthlySalary: number; // Gross salary
  workingDays: number; // Paid working days divisor (from settings)
  totalLateMinutes: number;
  lateLogins?: number;
  lateRecords?: LateOccurrenceRecord[];
  monthlyLateLoginLimit?: number; // First N occurrences exempt
  defaultRequiredHours?: number; // Standard shift hours, fallback 8
  salaryRounding?: 'round' | 'exact';
  // Additional method parameters:
  lateFixedAmount?: number;
  latePerMinuteRate?: number;
  lateIntervalMinutes?: number;
  lateIntervalAmount?: number;
  lateHalfDayAmount?: number;
  halfDayMethod?: '50_percent' | 'fixed';
  halfDayAmount?: number;
}

export interface LateOccurrenceBreakdownItem {
  date?: string;
  occurrenceIndex: number;
  actualLateMinutes: number;
  isExempt: boolean;
  requiredHours: number;
  scheduledMinutes: number;
  ratePerMinute: number;
  chargeableMinutes: number;
  deduction: number;
}

export interface LateDeductionCalculationResult {
  chargeableMinutes: number;
  exemptMinutes: number;
  totalLateMinutes: number;
  chargeableOccurrences: number;
  exemptOccurrences: number;
  totalLateOccurrences: number;
  salaryPerMinute: number;
  unroundedAmount: number;
  deductionAmount: number;
  formulaDescription: string;
  breakdown: {
    monthlySalary: number;
    workingDays: number;
    dailyRate: number;
    defaultShiftHours: number;
    items: LateOccurrenceBreakdownItem[];
  };
}

/** Safely normalizes numeric input to a non-negative finite number */
const safeNonNegative = (val: unknown, fallback = 0): number => {
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Currency rounding helper conforming to payrollSettingsService:
 * 'round' -> Math.round (nearest rupee)
 * 'exact' -> 2 decimal places
 */
export function applyMonetaryRounding(amount: number, rounding: 'round' | 'exact' = 'round'): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (rounding === 'round') {
    return Math.round(amount);
  }
  return Number(amount.toFixed(2));
}

/**
 * Pure calculation function for late-login deductions.
 */
export function calculateLateDeduction(input: CalculateLateDeductionInput): LateDeductionCalculationResult {
  const rounding = input.salaryRounding || 'round';
  const totalLateMins = Math.max(0, safeNonNegative(input.totalLateMinutes, 0));
  const rawSalary = safeNonNegative(input.monthlySalary, 0);
  const workingDays = safeNonNegative(input.workingDays, 0);
  const defaultHours = safeNonNegative(input.defaultRequiredHours, 8);
  const limitOccurrences = Math.max(0, safeNonNegative(input.monthlyLateLoginLimit, 0));

  const dailyRate = workingDays > 0 ? rawSalary / workingDays : 0;
  const standardScheduledMinutes = defaultHours * 60;
  const standardRatePerMinute = (workingDays > 0 && standardScheduledMinutes > 0)
    ? rawSalary / (workingDays * standardScheduledMinutes)
    : 0;

  // Base empty result
  const baseResult: LateDeductionCalculationResult = {
    chargeableMinutes: 0,
    exemptMinutes: 0,
    totalLateMinutes: totalLateMins,
    chargeableOccurrences: 0,
    exemptOccurrences: 0,
    totalLateOccurrences: 0,
    salaryPerMinute: standardRatePerMinute,
    unroundedAmount: 0,
    deductionAmount: 0,
    formulaDescription: 'Late deduction disabled or 0 late minutes',
    breakdown: {
      monthlySalary: rawSalary,
      workingDays,
      dailyRate,
      defaultShiftHours: defaultHours,
      items: [],
    },
  };

  if (!input.enableLateLoginDeduction || totalLateMins <= 0) {
    return baseResult;
  }

  // 1. SALARY-BASED METHOD
  if (input.lateDeductionMethod === 'salary_based') {
    // If salary or working days are missing or zero, no deduction can be computed safely
    if (rawSalary <= 0 || workingDays <= 0) {
      return {
        ...baseResult,
        formulaDescription: 'Gross salary or working days divisor is zero — ₹0 deducted.',
      };
    }

    // Build occurrence breakdown
    const items: LateOccurrenceBreakdownItem[] = [];
    const rawRecords = Array.isArray(input.lateRecords) ? input.lateRecords : [];
    const validRecords = rawRecords.filter(r => (Number(r.lateMinutes) || 0) > 0);

    let chargeableMinutes = 0;
    let exemptMinutes = 0;
    let chargeableOccurrences = 0;
    let exemptOccurrences = 0;
    let unroundedAmount = 0;

    if (validRecords.length > 0) {
      // Sort chronologically by date if available
      const sorted = [...validRecords].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

      sorted.forEach((rec, idx) => {
        const occIndex = idx + 1;
        const mins = Math.max(0, Number(rec.lateMinutes) || 0);
        const reqHours = safeNonNegative(rec.requiredHours, defaultHours);
        const shiftScheduledMins = reqHours * 60;
        const ratePerMin = (workingDays > 0 && shiftScheduledMins > 0)
          ? rawSalary / (workingDays * shiftScheduledMins)
          : 0;

        const isExempt = occIndex <= limitOccurrences;
        const recChargeable = isExempt ? 0 : mins;
        const recDeduction = recChargeable * ratePerMin;

        if (isExempt) {
          exemptOccurrences++;
          exemptMinutes += mins;
        } else {
          chargeableOccurrences++;
          chargeableMinutes += recChargeable;
          unroundedAmount += recDeduction;
        }

        items.push({
          date: rec.date,
          occurrenceIndex: occIndex,
          actualLateMinutes: mins,
          isExempt,
          requiredHours: reqHours,
          scheduledMinutes: shiftScheduledMins,
          ratePerMinute: ratePerMin,
          chargeableMinutes: recChargeable,
          deduction: recDeduction,
        });
      });
    } else {
      // Fallback when detailed per-day records are not passed (e.g. synthetic test mocks)
      const count = Math.max(1, safeNonNegative(input.lateLogins, 1));
      exemptOccurrences = Math.min(count, limitOccurrences);
      chargeableOccurrences = Math.max(0, count - exemptOccurrences);

      if (count > 0 && chargeableOccurrences === 0) {
        exemptMinutes = totalLateMins;
        chargeableMinutes = 0;
        unroundedAmount = 0;
      } else if (count > 0 && exemptOccurrences > 0) {
        // Proportionally attribute exempt vs chargeable minutes
        const minutesPerOcc = totalLateMins / count;
        exemptMinutes = Math.round(exemptOccurrences * minutesPerOcc);
        chargeableMinutes = Math.max(0, totalLateMins - exemptMinutes);
        unroundedAmount = chargeableMinutes * standardRatePerMinute;
      } else {
        chargeableMinutes = totalLateMins;
        exemptMinutes = 0;
        unroundedAmount = chargeableMinutes * standardRatePerMinute;
      }

      items.push({
        occurrenceIndex: 1,
        actualLateMinutes: totalLateMins,
        isExempt: chargeableMinutes === 0,
        requiredHours: defaultHours,
        scheduledMinutes: standardScheduledMinutes,
        ratePerMinute: standardRatePerMinute,
        chargeableMinutes,
        deduction: unroundedAmount,
      });
    }

    const deductionAmount = applyMonetaryRounding(unroundedAmount, rounding);
    const primaryRate = items.length > 0 ? items[0].ratePerMinute : standardRatePerMinute;

    const formulaDescription = limitOccurrences > 0
      ? `${chargeableMinutes} chargeable late mins (of ${totalLateMins}m, ${exemptOccurrences} occ exempt) × ₹${primaryRate.toFixed(2)}/min`
      : `${chargeableMinutes} late mins × ₹${primaryRate.toFixed(2)}/min`;

    return {
      chargeableMinutes,
      exemptMinutes,
      totalLateMinutes: totalLateMins,
      chargeableOccurrences,
      exemptOccurrences,
      totalLateOccurrences: items.length || 1,
      salaryPerMinute: primaryRate,
      unroundedAmount,
      deductionAmount,
      formulaDescription,
      breakdown: {
        monthlySalary: rawSalary,
        workingDays,
        dailyRate,
        defaultShiftHours: defaultHours,
        items,
      },
    };
  }

  // 2. INTERVAL-BASED METHOD (Preserved existing behavior)
  if (input.lateDeductionMethod === 'interval_based') {
    const intervalMins = safeNonNegative(input.lateIntervalMinutes, 15);
    const intervalAmount = safeNonNegative(input.lateIntervalAmount, 100);
    const intervals = Math.floor(totalLateMins / intervalMins);
    const unroundedAmount = intervals * intervalAmount;
    const deductionAmount = applyMonetaryRounding(unroundedAmount, rounding);

    return {
      ...baseResult,
      chargeableMinutes: totalLateMins,
      chargeableOccurrences: input.lateLogins || 1,
      unroundedAmount,
      deductionAmount,
      formulaDescription: `floor(${totalLateMins}m ÷ ${intervalMins}m) × ₹${intervalAmount}`,
    };
  }

  // 3. FIXED AMOUNT METHOD (Preserved existing behavior)
  if (input.lateDeductionMethod === 'fixed') {
    const fixedAmount = safeNonNegative(input.lateFixedAmount, 0);
    const deductionAmount = applyMonetaryRounding(fixedAmount, rounding);

    return {
      ...baseResult,
      chargeableMinutes: totalLateMins,
      chargeableOccurrences: input.lateLogins || 1,
      unroundedAmount: fixedAmount,
      deductionAmount,
      formulaDescription: `Fixed ₹${fixedAmount} for late arrivals`,
    };
  }

  // 4. PER MINUTE METHOD (Preserved existing flat-rate behavior)
  if (input.lateDeductionMethod === 'per_minute') {
    const rate = safeNonNegative(input.latePerMinuteRate, 0);
    const unroundedAmount = totalLateMins * rate;
    const deductionAmount = applyMonetaryRounding(unroundedAmount, rounding);

    return {
      ...baseResult,
      chargeableMinutes: totalLateMins,
      chargeableOccurrences: input.lateLogins || 1,
      unroundedAmount,
      deductionAmount,
      salaryPerMinute: rate,
      formulaDescription: `${totalLateMins}m × ₹${rate}/min`,
    };
  }

  // 5. HALF-DAY METHOD (Preserved existing behavior)
  if (input.lateDeductionMethod === 'half_day') {
    let unroundedAmount = 0;
    if (input.halfDayMethod === 'fixed') {
      unroundedAmount = safeNonNegative(input.lateHalfDayAmount ?? input.halfDayAmount, 0);
    } else {
      unroundedAmount = dailyRate * 0.5;
    }
    const deductionAmount = applyMonetaryRounding(unroundedAmount, rounding);

    return {
      ...baseResult,
      chargeableMinutes: totalLateMins,
      chargeableOccurrences: input.lateLogins || 1,
      unroundedAmount,
      deductionAmount,
      formulaDescription: input.halfDayMethod === 'fixed'
        ? `Half-day fixed ₹${unroundedAmount}`
        : `Half-day: 50% of daily rate (₹${dailyRate.toFixed(2)})`,
    };
  }

  return baseResult;
}
