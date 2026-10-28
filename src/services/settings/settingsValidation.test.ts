import { describe, it, expect } from 'vitest';
import { settingsSaveErrors } from './settingsValidation';
import { normalizeLimitHours, missingClockOutGraceHours, DEFAULT_MAX_ADDITIONAL_HOURS } from '../attendance/missingClockOutRules';

const valid = () => ({
  app: { autoClockOutGraceHours: 4, autoClockOutMode: 'after_grace_period' },
  payroll: { missingClockOutMaxAdditionalHours: 3, enableMissingClockOutDeduction: true, missingClockOutDeductionAmount: 200, enableOvertimePay: true, overtimeRateType: 'multiplier', overtimeMultiplier: 1.5 },
});

describe('settingsSaveErrors (same rules as trg_validate_app_settings)', () => {
  it('the values on the Settings screen (3 h, deduction on, ₹200, overtime ×1.5) are valid', () => {
    expect(settingsSaveErrors(valid())).toEqual([]);
  });

  it('maximum additional working time: 0–24 hours; empty keeps the default', () => {
    const s = valid();
    for (const bad of [-1, 25, Number.NaN, 'abc']) {
      (s.payroll as any).missingClockOutMaxAdditionalHours = bad;
      expect(settingsSaveErrors(s)).toEqual(['Maximum additional working time must be a number of hours from 0 to 24.']);
    }
    for (const ok of [0, 24, 2.5, null, '']) {
      (s.payroll as any).missingClockOutMaxAdditionalHours = ok;
      expect(settingsSaveErrors(s)).toEqual([]);
    }
  });

  it('deduction per case: ₹0 or more, at most 2 decimals, above ₹0 while the deduction is on', () => {
    const s = valid();
    s.payroll.missingClockOutDeductionAmount = -5;
    expect(settingsSaveErrors(s)[0]).toMatch('₹0 or more');
    s.payroll.missingClockOutDeductionAmount = 10.555;
    expect(settingsSaveErrors(s)[0]).toMatch('2 decimals');
    s.payroll.missingClockOutDeductionAmount = 0;
    expect(settingsSaveErrors(s)).toEqual(['Enter a deduction per case above ₹0, or switch the missing clock-out deduction off.']);
    (s.payroll as any).missingClockOutDeductionAmount = null;
    expect(settingsSaveErrors(s)).toEqual(['Enter a deduction per case above ₹0, or switch the missing clock-out deduction off.']);
    s.payroll.enableMissingClockOutDeduction = false;
    expect(settingsSaveErrors(s)).toEqual([]);   // off: ₹0 / empty is fine
  });

  it('auto clock-out grace and mode', () => {
    const s = valid();
    s.app.autoClockOutGraceHours = -1;
    expect(settingsSaveErrors(s)).toEqual(['Auto clock-out grace must be 0 or more hours.']);
    s.app.autoClockOutGraceHours = 0;
    s.app.autoClockOutMode = 'sometimes';
    expect(settingsSaveErrors(s)[0]).toMatch('mode');
  });

  it('overtime rate is checked only while overtime pay is on', () => {
    const s = valid();
    s.payroll.overtimeMultiplier = 0;
    expect(settingsSaveErrors(s)).toEqual(['Overtime multiplier must be a number above 0.']);
    s.payroll.enableOvertimePay = false;
    expect(settingsSaveErrors(s)).toEqual([]);
    s.payroll.enableOvertimePay = true; s.payroll.overtimeRateType = 'fixed'; (s.payroll as any).overtimeFixedRate = -1;
    expect(settingsSaveErrors(s)).toEqual(['Overtime rate per hour must be ₹0 or more.']);
  });

  it('several problems are all reported', () => {
    const s = valid();
    s.payroll.missingClockOutMaxAdditionalHours = 30; s.app.autoClockOutGraceHours = -1;
    expect(settingsSaveErrors(s)).toHaveLength(2);
  });
});

describe('the app reads saved values like the database (mco_settings)', () => {
  it('limit: 0–24 used as saved, anything else → 3', () => {
    expect(normalizeLimitHours(1.5)).toBe(1.5);
    expect(normalizeLimitHours(0)).toBe(0);
    expect(normalizeLimitHours(24)).toBe(24);
    for (const v of [25, -1, 'abc', null, undefined, '']) expect(normalizeLimitHours(v)).toBe(DEFAULT_MAX_ADDITIONAL_HOURS);
  });
  it('grace: "at shift end" → 0; unreadable → 4; negative → 0', () => {
    expect(missingClockOutGraceHours({ autoClockOutMode: 'at_shift_end', autoClockOutGraceHours: 9 })).toBe(0);
    expect(missingClockOutGraceHours({ autoClockOutGraceHours: 'four' as any })).toBe(4);
    expect(missingClockOutGraceHours({ autoClockOutGraceHours: null })).toBe(4);
    expect(missingClockOutGraceHours({ autoClockOutGraceHours: -2 })).toBe(0);
    expect(missingClockOutGraceHours({ autoClockOutGraceHours: 2.5 })).toBe(2.5);
  });
});
