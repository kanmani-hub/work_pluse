/**
 * Payroll Settings Service
 * 
 * Manages payroll configuration: working-day basis, rounding, deduction rules, limits.
 * Persists to localStorage as primary store (Supabase table can be added later).
 * All payroll calculations must read settings from this service — never hardcode rules.
 */

const SETTINGS_KEY = 'workpulse_payroll_settings';

export interface PayrollSettings {
  // General
  workingDaysBasis: 'configured' | 'calendar' | 'actual';
  configuredWorkingDays: number; // e.g. 26 — only used when workingDaysBasis === 'configured'
  salaryRounding: 'round' | 'exact';
  requireMultiLevelApproval: boolean;

  // Deduction Rules
  enableLopDeductions: boolean;
  enableHalfDayDeductions: boolean;
  
  enableLateLoginDeduction: boolean;
  monthlyLateLoginLimit: number;    // e.g. 3 — no deduction until exceeded
  lateDeductionMethod: 'per_minute' | 'fixed' | 'half_day';
  lateDeductionAmountOrRate: number;

  enablePermissionDeduction: boolean;
  permissionLimit: number;          // e.g. 2 — no deduction until exceeded
  enableWfhDeduction: boolean;

  // Overtime
  enableOvertimePay: boolean;
  overtimeRateType: 'multiplier' | 'fixed';
  overtimeMultiplier: number;       // e.g. 1.5
}

const DEFAULT_SETTINGS: PayrollSettings = {
  workingDaysBasis: 'configured',
  configuredWorkingDays: 26,
  salaryRounding: 'round',
  requireMultiLevelApproval: false,

  enableLopDeductions: true,
  enableHalfDayDeductions: true,
  
  enableLateLoginDeduction: true,
  monthlyLateLoginLimit: 0,
  lateDeductionMethod: 'fixed',
  lateDeductionAmountOrRate: 100,

  enablePermissionDeduction: false,
  permissionLimit: 2,
  enableWfhDeduction: false,

  enableOvertimePay: true,
  overtimeRateType: 'multiplier',
  overtimeMultiplier: 1.5,
};

export const payrollSettingsService = {
  /**
   * Get current payroll settings. Returns persisted settings or defaults.
   */
  getSettings(): PayrollSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        
        // Handle migration from old 'lateLoginLimit'
        if (parsed.lateLoginLimit !== undefined && parsed.monthlyLateLoginLimit === undefined) {
          parsed.monthlyLateLoginLimit = parsed.lateLoginLimit;
        }

        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load payroll settings from storage:', e);
    }
    return { ...DEFAULT_SETTINGS };
  },

  /**
   * Save payroll settings.
   */
  saveSettings(settings: PayrollSettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save payroll settings:', e);
    }
  },

  /**
   * Get the number of working days for a given month based on settings.
   */
  getWorkingDaysForMonth(year: number, month: number, settings?: PayrollSettings): number {
    const s = settings || this.getSettings();

    switch (s.workingDaysBasis) {
      case 'configured':
        return s.configuredWorkingDays;

      case 'calendar':
        // Number of days in the month
        return new Date(year, month, 0).getDate();

      case 'actual':
        // Actual working days = calendar days minus weekends (Sat/Sun)
        const daysInMonth = new Date(year, month, 0).getDate();
        let workingDays = 0;
        for (let d = 1; d <= daysInMonth; d++) {
          const day = new Date(year, month - 1, d).getDay();
          if (day !== 0 && day !== 6) workingDays++;
        }
        return workingDays;

      default:
        return 26;
    }
  },

  /**
   * Apply rounding based on settings.
   */
  applyRounding(amount: number, settings?: PayrollSettings): number {
    const s = settings || this.getSettings();
    if (s.salaryRounding === 'round') {
      return Math.round(amount);
    }
    return Number(amount.toFixed(2));
  },

  /**
   * Get the default settings (useful for reset).
   */
  getDefaults(): PayrollSettings {
    return { ...DEFAULT_SETTINGS };
  }
};
