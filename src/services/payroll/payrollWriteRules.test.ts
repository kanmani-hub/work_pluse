import { describe, it, expect } from 'vitest';
import { buildPayrollWrite, payrollWriteError, isMissingReplaceFunction, calculationDrift, stalePayrollReason } from './payrollWriteRules';

const input = (over: any = {}) => ({
  employeeId: 'e1', year: 2026, month: 10, periodStart: '2026-10-01', periodEnd: '2026-10-31',
  basic: 26000, grossSalary: 26000, totalAllowances: 0, totalDeductions: 1600, lopDeduction: 1000, overtime: 250, netSalary: 24650,
  remarks: '{}',
  deductionItems: [{ name: 'LOP Deduction (1 day)', amount: 1000 }, { name: 'Late Deduction', amount: 100 }],
  earningAdjustmentItems: [{ name: 'Refund', amount: 0 }],
  standardDeduction: 500,
  lateFormula: '17 min → 1 interval × ₹100',
  ...over,
});

describe('buildPayrollWrite', () => {
  it('row carries the calculated figures; items in the existing order with the existing basis text', () => {
    const w = buildPayrollWrite(input());
    expect(w.row).toMatchObject({ employee_id: 'e1', payroll_year: 2026, payroll_month: 10, gross_salary: 26000, lop_deduction: 1000, overtime_amount: 250, net_salary: 24650 });
    expect(w.row).not.toHaveProperty('status'); // the database decides (CALCULATED, or UNDER_REVIEW kept)
    expect(w.items.map(i => `${i.item_type}:${i.item_name}:${i.amount}`)).toEqual([
      'EARNING:Gross Salary:26000', 'EARNING:Approved Overtime:250', 'EARNING:Refund:0',
      'DEDUCTION:LOP Deduction (1 day):1000', 'DEDUCTION:Late Deduction:100', 'DEDUCTION:Standard Deduction:500',
    ]);
    expect(w.items.find(i => i.item_name === 'Late Deduction')?.calculation_basis).toBe('17 min → 1 interval × ₹100');
    expect(w.items.find(i => i.item_name.startsWith('LOP'))?.calculation_basis).toBe('System calculated from settings and attendance');
    expect(w.items.some(i => 'payroll_id' in i)).toBe(false);
  });

  it('no overtime / no standard deduction → no such items', () => {
    const w = buildPayrollWrite(input({ overtime: 0, standardDeduction: 0, earningAdjustmentItems: [], deductionItems: [] }));
    expect(w.items.map(i => i.item_name)).toEqual(['Gross Salary']);
  });
});

describe('payrollWriteError', () => {
  it('valid figures pass', () => expect(payrollWriteError(buildPayrollWrite(input()))).toBeNull());
  it('NaN / Infinity amount is refused before anything is saved', () => {
    expect(payrollWriteError(buildPayrollWrite(input({ netSalary: NaN })))).toMatch('net salary');
    expect(payrollWriteError(buildPayrollWrite(input({ lopDeduction: Infinity })))).toMatch('lop deduction');
  });
  it('a negative or missing item amount is refused', () => {
    expect(payrollWriteError(buildPayrollWrite(input({ deductionItems: [{ name: 'Late Deduction', amount: -5 }] })))).toMatch('Late Deduction');
    expect(payrollWriteError(buildPayrollWrite(input({ deductionItems: [{ name: 'X', amount: undefined }] })))).toMatch('"X"');
  });
});

describe('isMissingReplaceFunction', () => {
  it('recognises the missing-function errors only', () => {
    expect(isMissingReplaceFunction({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true);
    expect(isMissingReplaceFunction({ code: '42883', message: 'function does not exist' })).toBe(true);
    expect(isMissingReplaceFunction({ message: 'function public.replace_payroll_calculation(jsonb, jsonb) does not exist' })).toBe(true);
    expect(isMissingReplaceFunction({ code: '42501', message: 'Payroll for 10/2026 is APPROVED and locked' })).toBe(false);
    expect(isMissingReplaceFunction({ code: '23514', message: 'check constraint' })).toBe(false);
    expect(isMissingReplaceFunction(null)).toBe(false);
  });
});

describe('stale payroll check', () => {
  const stored = { basic_salary: 26000, gross_salary: 26000, total_allowances: 0, total_deductions: 1000, lop_deduction: 1000, overtime_amount: 0, net_salary: 25000 };
  const fresh = { basic: 26000, grossSalary: 26000, totalAllowances: 0, totalDeductions: 1000, lopDeduction: 1000, overtime: 0, netSalary: 25000 };
  it('same figures (numeric strings from the database included) → no drift', () => {
    expect(calculationDrift({ ...stored, net_salary: '25000.00' }, fresh)).toEqual([]);
    expect(stalePayrollReason(stored, fresh)).toBeNull();
  });
  it('differences under half a paisa are rounding, not drift', () => {
    expect(calculationDrift(stored, { ...fresh, netSalary: 25000.004 })).toEqual([]);
    expect(calculationDrift(stored, { ...fresh, netSalary: 25000.01 })).toEqual(['net salary']);
  });
  it('a leave approved as paid after calculation (LOP removed) is reported with the changed amounts', () => {
    const r = stalePayrollReason(stored, { ...fresh, totalDeductions: 0, lopDeduction: 0, netSalary: 26000 });
    expect(r).toBe('Attendance, leave, overtime or settings changed after this payroll was calculated (deductions, LOP deduction, net salary differ). Recalculate the payroll before approving.');
  });
  it('no fresh calculation → refused, never approved blind', () => {
    expect(stalePayrollReason(stored, null, 'offline')).toMatch('could not be re-checked');
  });
});
