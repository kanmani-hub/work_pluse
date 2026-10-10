import { describe, it, expect } from 'vitest';
import { payrollMonthCards, clockedInCard } from './payrollCardRules';

const emp = (id: string, status = 'ACTIVE') => ({ id, status, first_name: 'E', last_name: id, employee_code: 'C' + id, department: { name: 'Ops' } });
const pay = (id: string, employee_id: string, status: string, gross: number, ded: number, lop: number, ot: number) =>
  ({ id, employee_id, status, gross_salary: gross, total_deductions: ded, lop_deduction: lop, overtime_amount: ot, net_salary: gross + ot - ded });

describe('Payroll month cards', () => {
  const employees = [emp('1'), emp('2'), emp('3'), emp('4', 'INACTIVE')];
  const pays = [pay('p1', '1', 'APPROVED', 30000, 2000, 1500, 500), pay('p2', '2', 'PAID', 20000, 0, 0, 0), pay('p3', '4', 'DRAFT', 10000, 100, 0, 0)];
  const c = payrollMonthCards(employees, pays);
  it('Total Employees = active employees with their payroll status (Not generated when none)', () => {
    expect(c.total.count).toBe(3);
    expect(c.total.rows.map(r => r.status)).toEqual(['APPROVED', 'PAID', 'NOT_GENERATED']);
  });
  it('status cards follow the page filters (DRAFT is not "generated"; CLOSED counts as paid)', () => {
    expect(c.generated.count).toBe(2); expect(c.approved.count).toBe(1); expect(c.paid.count).toBe(1); expect(c.underReview.count).toBe(0);
    expect(payrollMonthCards(employees, [pay('x', '1', 'CLOSED', 1, 0, 0, 0)]).paid.count).toBe(1);
  });
  it('amount cards equal the sum of their rows; LOP is part of deductions, not added again', () => {
    expect(c.gross.amount).toBe(60000);
    expect(c.deductions.amount).toBe(2100);
    const r1 = c.deductions.rows[0];
    expect(r1).toMatchObject({ lop: 1500, otherDeductions: 500, deductions: 2000 });
    expect(c.deductions.rows.reduce((s, r) => s + r.lop + r.otherDeductions, 0)).toBe(c.deductions.amount);
    expect(c.net.amount).toBe(60000 + 500 - 2100);
  });
  it('empty month', () => {
    const e = payrollMonthCards([], []);
    expect([e.total.count, e.gross.amount, e.net.amount]).toEqual([0, 0, 0]);
  });
});

describe('Employees Clocked In (daily)', () => {
  it('never fabricates hours for a missing clock-out', () => {
    const c = clockedInCard([
      { employee: emp('1'), shift: 'General', status: 'COMPLETED', clockIn: '2026-10-09T03:30:00Z', clockOut: '2026-10-09T12:45:00Z' },
      { employee: emp('2'), shift: 'General', status: 'WORKING', clockIn: '2026-10-09T03:40:00Z', clockOut: null },
    ]);
    expect(c.count).toBe(2);
    expect(c.rows[0]).toMatchObject({ clockIn: '09:00', clockOut: '18:15', elapsed: '9h 15m' });
    expect(c.rows[1]).toMatchObject({ clockOut: 'Not clocked out yet', elapsed: 'Missing clock-out — not calculated' });
  });
});
