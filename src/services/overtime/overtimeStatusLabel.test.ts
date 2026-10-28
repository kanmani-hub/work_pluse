import { describe, it, expect } from 'vitest';
import { overtimeStatusLabel, OT_APPROVED_UNPAID_LABEL } from './overtimeRules';
import { overtimeMetric } from '../payroll/dailyMetricDetails';

// Decision 2026-10-28: approval and payment are separate.
describe('overtimeStatusLabel', () => {
  it('approved while Enable Overtime Pay is off → "Approved — Unpaid (Overtime Pay Disabled)"', () => {
    expect(overtimeStatusLabel('APPROVED', 2, false)).toBe(OT_APPROVED_UNPAID_LABEL);
    expect(OT_APPROVED_UNPAID_LABEL).toBe('Approved — Unpaid (Overtime Pay Disabled)');
  });
  it('approved while pay is on, or settings not loaded yet → "Approved" (never claims unpaid without knowing)', () => {
    expect(overtimeStatusLabel('APPROVED', 2, true)).toBe('Approved');
    expect(overtimeStatusLabel('APPROVED', 2, undefined)).toBe('Approved');
  });
  it('a clock-out correction approved with 0 overtime hours has nothing to pay → "Approved"', () => {
    expect(overtimeStatusLabel('APPROVED', 0, false)).toBe('Approved');
  });
  it('other statuses are unchanged by the setting', () => {
    expect(overtimeStatusLabel('PENDING', null, false)).toBe('Pending');
    expect(overtimeStatusLabel('REJECTED', 0, false)).toBe('Rejected');
    expect(overtimeStatusLabel(null, null, false)).toBe('—');
  });
});

describe('Payroll → Overtime Pay breakdown', () => {
  const row = (enableOvertimePay: boolean, pay: number) => ({
    employee: { first_name: 'A', last_name: 'B', employee_code: 'E1' },
    clockIn: '2026-10-12T03:30:00Z', clockOut: '2026-10-12T14:30:00Z', overtimeMinutes: 120, overtimePay: pay,
    overtimeRequests: [{ status: 'APPROVED', eligible_overtime_hours: 2, approved_overtime_hours: 2 }],
    rawCalc: { settings: { enableOvertimePay, overtimeRateType: 'multiplier', overtimeMultiplier: 1.5 }, dailyRate: 1000 },
    attendance: { required_hours: 8, shift_template: { start_time: '09:00:00', end_time: '18:00:00' } },
  });
  it('pay off: the approved request shows as unpaid and the amount is ₹0', () => {
    const m = overtimeMetric([row(false, 0)]);
    expect(m.rows[0]).toMatchObject({ status: OT_APPROVED_UNPAID_LABEL, amount: 0, formula: 'Overtime pay off' });
    expect(m.total).toBe(0);
  });
  it('pay on: approved and paid on the approved hours', () => {
    const m = overtimeMetric([row(true, 375)]);
    expect(m.rows[0]).toMatchObject({ status: 'Approved', amount: 375 });
    expect(m.total).toBe(375);
  });
});
