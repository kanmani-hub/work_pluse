/**
 * Payroll write rules (pure, unit-tested).
 *
 * One calculated payroll = one row + its items. They are built here from the calculation result and
 * written together by the database function replace_payroll_calculation (one transaction: a failed
 * write keeps the previous payroll and items; a locked month is refused). See
 * supabase/migrations/20261028090100_payroll_lock_and_replace.sql.
 */

export interface PayrollWriteInput {
  employeeId: string;
  year: number;
  month: number;
  periodStart: string;
  periodEnd: string;
  basic: number;
  grossSalary: number;
  totalAllowances: number;
  totalDeductions: number;
  lopDeduction: number;
  overtime: number;
  netSalary: number;
  remarks: string;
  deductionItems: { name: string; amount: number }[];
  earningAdjustmentItems?: { name: string; amount: number }[];
  standardDeduction?: number | null;
  lateFormula?: string | null;
}

export interface PayrollItemWrite {
  item_type: 'EARNING' | 'DEDUCTION';
  item_name: string;
  amount: number;
  calculation_basis?: string | null;
  notes?: string | null;
}

export interface PayrollWrite {
  row: Record<string, unknown>;
  items: PayrollItemWrite[];
}

const SYSTEM_BASIS = 'System calculated from settings and attendance';

/** Row and items exactly as the previous insert code built them (same names, same order, same basis text). */
export function buildPayrollWrite(i: PayrollWriteInput): PayrollWrite {
  const row = {
    employee_id: i.employeeId,
    payroll_year: i.year,
    payroll_month: i.month,
    period_start: i.periodStart,
    period_end: i.periodEnd,
    basic_salary: i.basic,
    gross_salary: i.grossSalary,
    total_allowances: i.totalAllowances,
    total_deductions: i.totalDeductions,
    lop_deduction: i.lopDeduction,
    overtime_amount: i.overtime,
    net_salary: i.netSalary,
    remarks: i.remarks,
  };
  const items: PayrollItemWrite[] = [];
  if (i.grossSalary > 0) items.push({ item_type: 'EARNING', item_name: 'Gross Salary', amount: i.grossSalary });
  if (i.overtime > 0) items.push({ item_type: 'EARNING', item_name: 'Approved Overtime', amount: i.overtime });
  for (const e of i.earningAdjustmentItems || []) items.push({ item_type: 'EARNING', item_name: e.name, amount: e.amount });
  for (const d of i.deductionItems || []) {
    items.push({
      item_type: 'DEDUCTION',
      item_name: d.name,
      amount: d.amount,
      calculation_basis: d.name.includes('Late Deduction') && i.lateFormula ? i.lateFormula : SYSTEM_BASIS,
    });
  }
  const std = Number(i.standardDeduction || 0);
  if (std > 0) items.push({ item_type: 'DEDUCTION', item_name: 'Standard Deduction', amount: std });
  return { row, items };
}

const AMOUNT_FIELDS = ['basic_salary', 'gross_salary', 'total_allowances', 'total_deductions', 'lop_deduction', 'overtime_amount', 'net_salary'] as const;

/** Refusal message when the calculated figures cannot be stored as they are (NaN, Infinity, negative item); null when valid. */
export function payrollWriteError(w: PayrollWrite): string | null {
  for (const f of AMOUNT_FIELDS) {
    const v = w.row[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) return `Payroll could not be saved: ${f.replace(/_/g, ' ')} is not a valid amount.`;
  }
  for (const it of w.items) {
    if (typeof it.amount !== 'number' || !Number.isFinite(it.amount) || it.amount < 0) {
      return `Payroll could not be saved: "${it.item_name}" is not a valid amount.`;
    }
  }
  return null;
}

/** True when the database does not have replace_payroll_calculation yet (migration not applied). */
export function isMissingReplaceFunction(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST202' || err.code === '42883') return true;
  return /replace_payroll_calculation/.test(err.message || '') && /(does not exist|could not find)/i.test(err.message || '');
}

// ------------------------------------------------------------------------------------------------
// Stale payroll: approval re-runs the calculation from the current attendance, leave, overtime,
// adjustments and settings and compares it with the stored figures. Any difference means something
// changed after the payroll was calculated, so approving would lock outdated amounts.

const DRIFT_FIELDS: { stored: string; fresh: string; label: string }[] = [
  { stored: 'basic_salary', fresh: 'basic', label: 'basic salary' },
  { stored: 'gross_salary', fresh: 'grossSalary', label: 'gross salary' },
  { stored: 'total_allowances', fresh: 'totalAllowances', label: 'allowances' },
  { stored: 'total_deductions', fresh: 'totalDeductions', label: 'deductions' },
  { stored: 'lop_deduction', fresh: 'lopDeduction', label: 'LOP deduction' },
  { stored: 'overtime_amount', fresh: 'overtime', label: 'overtime' },
  { stored: 'net_salary', fresh: 'netSalary', label: 'net salary' },
];

/** Labels of the amounts that differ (more than half a paisa) between the stored payroll and a fresh calculation. */
export function calculationDrift(stored: Record<string, unknown>, fresh: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const f of DRIFT_FIELDS) {
    const a = Number(stored[f.stored] ?? 0);
    const b = Number(fresh[f.fresh] ?? 0);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 0.005) out.push(f.label);
  }
  return out;
}

/** Refusal message for approval when the stored payroll no longer matches its inputs; null when it matches. */
export function stalePayrollReason(stored: Record<string, unknown>, fresh: Record<string, unknown> | null, freshError?: string | null): string | null {
  if (!fresh) {
    return `The payroll could not be re-checked against current attendance and leave (${freshError || 'calculation failed'}), so it was not approved. Please try again.`;
  }
  const drift = calculationDrift(stored, fresh);
  if (drift.length === 0) return null;
  return `Attendance, leave, overtime or settings changed after this payroll was calculated (${drift.join(', ')} differ). Recalculate the payroll before approving.`;
}
