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
  configuredWorkingDays: number;
  salaryRounding: 'round' | 'exact';
  requireMultiLevelApproval: boolean;
  approvalLevels: number;

  // LOP Rules
  enableLopDeductions: boolean;
  lopMethod: 'daily_rate' | 'fixed';
  lopAmount: number;

  // Half-Day Rules
  enableHalfDayDeductions: boolean;
  halfDayMethod: '50_percent' | 'fixed';
  halfDayAmount: number;
  
  // Late Login Rules
  enableLateLoginDeduction: boolean;
  monthlyLateLoginLimit: number;
  lateDeductionMethod: 'per_minute' | 'fixed' | 'half_day';
  lateFixedAmount: number;
  latePerMinuteRate: number;
  lateHalfDayAmount: number; // For when method is half_day and halfDayMethod is fixed

  // Permission Rules
  enablePermissionDeduction: boolean;
  permissionLimit: number;
  permissionDeductionMethod: 'per_minute' | 'fixed' | 'half_day';
  permissionFixedAmount: number;
  permissionPerMinuteRate: number;
  permissionHalfDayAmount: number;

  // WFH Rules
  enableWfhDeduction: boolean;
  wfhDeductionMethod: 'per_day' | 'fixed' | 'half_day';
  wfhFixedAmount: number;
  wfhPerDayAmount: number;
  wfhHalfDayAmount: number;

  // Break Rules
  enableBreakOverrunDetection: boolean;
  enableBreakOverrunDeduction: boolean;
  breakOverrunDeductionMethod: 'per_minute' | 'fixed' | 'half_day';
  breakOverrunFixedAmount: number;
  breakOverrunPerMinuteRate: number;
  breakOverrunHalfDayAmount: number;

  // Overtime
  enableOvertimePay: boolean;
  overtimeRateType: 'multiplier' | 'fixed';
  overtimeMultiplier: number;
  overtimeFixedRate: number;
}

const DEFAULT_SETTINGS: PayrollSettings = {
  workingDaysBasis: 'configured',
  configuredWorkingDays: 26,
  salaryRounding: 'round',
  requireMultiLevelApproval: false,
  approvalLevels: 2,

  enableLopDeductions: true,
  lopMethod: 'daily_rate',
  lopAmount: 0,

  enableHalfDayDeductions: true,
  halfDayMethod: '50_percent',
  halfDayAmount: 0,
  
  enableLateLoginDeduction: true,
  monthlyLateLoginLimit: 0,
  lateDeductionMethod: 'fixed',
  lateFixedAmount: 100,
  latePerMinuteRate: 10,
  lateHalfDayAmount: 0,

  enablePermissionDeduction: false,
  permissionLimit: 2,
  permissionDeductionMethod: 'fixed',
  permissionFixedAmount: 100,
  permissionPerMinuteRate: 10,
  permissionHalfDayAmount: 0,

  enableWfhDeduction: false,
  wfhDeductionMethod: 'fixed',
  wfhFixedAmount: 100,
  wfhPerDayAmount: 500,
  wfhHalfDayAmount: 0,

  enableBreakOverrunDetection: false,
  enableBreakOverrunDeduction: false,
  breakOverrunDeductionMethod: 'fixed',
  breakOverrunFixedAmount: 100,
  breakOverrunPerMinuteRate: 10,
  breakOverrunHalfDayAmount: 0,

  enableOvertimePay: true,
  overtimeRateType: 'multiplier',
  overtimeMultiplier: 1.5,
  overtimeFixedRate: 0,
};

export const payrollSettingsService = {
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

  saveSettings(settings: PayrollSettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save payroll settings:', e);
    }
  },

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

  applyRounding(amount: number, settings?: PayrollSettings): number {
    const s = settings || this.getSettings();
    if (s.salaryRounding === 'round') {
      return Math.round(amount);
    }
    return Number(amount.toFixed(2));
  },

  getDefaults(): PayrollSettings {
    return { ...DEFAULT_SETTINGS };
  }
};
