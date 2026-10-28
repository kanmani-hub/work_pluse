/**
 * Save-time validation of company settings (pure, unit-tested).
 *
 * Same rules as the database trigger trg_validate_app_settings
 * (supabase/migrations/20261028090200_auto_clock_out_and_settings_hardening.sql), so the Settings
 * screen explains a problem before saving instead of the save being refused. An empty value keeps the
 * documented default (limit 3 h, grace 4 h, ₹0) exactly as the server reads it.
 */

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const num = (v: unknown): number | null => {
  if (isEmpty(v) || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

export interface SettingsForValidation {
  app?: Record<string, any> | null;
  payroll?: Record<string, any> | null;
}

/** Problems that block saving; [] when the settings can be saved. */
export function settingsSaveErrors(s: SettingsForValidation): string[] {
  const p = s?.payroll || {};
  const a = s?.app || {};
  const errs: string[] = [];

  const limit = p.missingClockOutMaxAdditionalHours;
  if (!isEmpty(limit)) {
    const n = num(limit);
    if (n === null || n < 0 || n > 24) errs.push('Maximum additional working time must be a number of hours from 0 to 24.');
  }

  const amountRaw = p.missingClockOutDeductionAmount;
  const amount = num(amountRaw);
  if (!isEmpty(amountRaw) && (amount === null || amount < 0 || !twoDecimals(amount))) {
    errs.push('Deduction per case must be an amount of ₹0 or more with at most 2 decimals.');
  }
  if (!isEmpty(p.enableMissingClockOutDeduction) && typeof p.enableMissingClockOutDeduction !== 'boolean') {
    errs.push('Deduct for a rejected missing clock-out must be on or off.');
  } else if (p.enableMissingClockOutDeduction === true && !((amount ?? 0) > 0)) {
    errs.push('Enter a deduction per case above ₹0, or switch the missing clock-out deduction off.');
  }

  if (!isEmpty(a.autoClockOutGraceHours)) {
    const g = num(a.autoClockOutGraceHours);
    if (g === null || g < 0) errs.push('Auto clock-out grace must be 0 or more hours.');
  }
  if (!isEmpty(a.autoClockOutMode) && !['after_grace_period', 'at_shift_end'].includes(String(a.autoClockOutMode))) {
    errs.push('Auto clock-out mode must be "after grace period" or "at shift end".');
  }

  if (!isEmpty(p.enableOvertimePay) && typeof p.enableOvertimePay !== 'boolean') {
    errs.push('Enable Overtime Pay must be on or off.');
  }
  if (p.enableOvertimePay === true) {
    const type = isEmpty(p.overtimeRateType) ? 'multiplier' : p.overtimeRateType;
    if (type === 'multiplier' && !isEmpty(p.overtimeMultiplier) && !((num(p.overtimeMultiplier) ?? 0) > 0)) {
      errs.push('Overtime multiplier must be a number above 0.');
    } else if (type === 'fixed' && !isEmpty(p.overtimeFixedRate) && !((num(p.overtimeFixedRate) ?? -1) >= 0)) {
      errs.push('Overtime rate per hour must be ₹0 or more.');
    }
  }
  return errs;
}
