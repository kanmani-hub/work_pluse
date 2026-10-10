/**
 * Payroll month-view summary cards and the daily "Employees Clocked In" card (pure, unit-tested).
 * Same filters as the page's KPI numbers, so each card and its detail rows reconcile.
 * Amount cards sum one stored column each (gross_salary / total_deductions / net_salary);
 * LOP is shown as the part of Total deductions it already is, never added a second time.
 * Read-only: nothing here generates, approves or pays payroll.
 */
import { employeeFields, elapsedMinutes, formatDuration, istTime } from '../common/cardDetails';

export type PayrollMonthCard = 'total' | 'generated' | 'underReview' | 'approved' | 'paymentPending' | 'paid' | 'gross' | 'deductions' | 'net';
export interface PayrollCardData { count: number; amount: number; rows: Record<string, any>[] }

const money = (v: any) => Math.round(Number(v || 0) * 100) / 100;

export function payrollMonthCards(employees: any[], monthPayrolls: any[]): Record<PayrollMonthCard, PayrollCardData> {
  const emps = employees || [];
  const byId = new Map(emps.map(e => [e.id, e]));
  const pays = monthPayrolls || [];
  const payrollRow = (p: any) => {
    const lop = money(p.lop_deduction), total = money(p.total_deductions);
    return {
      __key: p.id, ...employeeFields(p.employees || byId.get(p.employee_id)), status: p.status,
      gross: money(p.gross_salary), overtime: money(p.overtime_amount), lop, otherDeductions: money(total - lop),
      deductions: total, net: money(p.net_salary),
    };
  };
  const pack = (rows: Record<string, any>[], amountKey?: string): PayrollCardData => ({
    count: rows.length, rows, amount: amountKey ? money(rows.reduce((s, r) => s + Number(r[amountKey] || 0), 0)) : 0,
  });
  const by = (f: (p: any) => boolean, amountKey?: string) => pack(pays.filter(f).map(payrollRow), amountKey);
  const statusOf = (empId: string) => pays.find(p => p.employee_id === empId)?.status || 'NOT_GENERATED';
  return {
    total: pack(emps.filter(e => String(e.status || '').toUpperCase() === 'ACTIVE').map(e => ({ __key: e.id, ...employeeFields(e), status: statusOf(e.id) }))),
    generated: by(p => p.status !== 'DRAFT', 'net'),
    underReview: by(p => p.status === 'UNDER_REVIEW', 'net'),
    approved: by(p => p.status === 'APPROVED', 'net'),
    paymentPending: by(p => p.status === 'PAYMENT_PENDING', 'net'),
    paid: by(p => p.status === 'PAID' || p.status === 'CLOSED', 'net'),
    gross: by(() => true, 'gross'),
    deductions: by(() => true, 'deductions'),
    net: by(() => true, 'net'),
  };
}

/** Daily view: one row per daily report (an attendance record for the date). No hours are invented when clock-out is missing. */
export function clockedInCard(dailyReports: any[]): PayrollCardData {
  const rows = (dailyReports || []).map(r => {
    const worked = elapsedMinutes(r.clockIn, r.clockOut);
    return {
      __key: r.employee?.id, ...employeeFields(r.employee), shift: r.shift || '—', status: r.status || '—',
      clockIn: istTime(r.clockIn), clockOut: r.clockOut ? istTime(r.clockOut) : 'Not clocked out yet',
      elapsed: worked === null ? 'Missing clock-out — not calculated' : formatDuration(worked),
    };
  });
  return { count: rows.length, amount: 0, rows };
}
