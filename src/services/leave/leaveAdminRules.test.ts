import { describe, it, expect } from 'vitest';
import { toBalanceRow, findBalance, toLeaveTypeRows } from './leaveAdminRules';

describe('leave balances from public.leave_balances (no invented numbers)', () => {
  it('maps stored columns (allocated_days / used_days / pending_days / remaining_days)', () => {
    expect(toBalanceRow({ employee_id: 'e', leave_type_id: 't', allocated_days: '12.00', used_days: 3, pending_days: '1.5', remaining_days: '7.5' }))
      .toEqual({ employeeId: 'e', leaveTypeId: 't', allocated: 12, used: 3, pending: 1.5, remaining: 7.5 });
  });
  it('derives remaining only when not stored; missing values stay null (shown as —)', () => {
    expect(toBalanceRow({ allocated_days: 10, used_days: 4, pending_days: 2 }).remaining).toBe(4);
    expect(toBalanceRow({}).allocated).toBeNull();
    expect(toBalanceRow({}).remaining).toBeNull();
    // the old code read a non-existent total_days column → NaN
    expect(toBalanceRow({ total_days: 12 }).allocated).toBeNull();
  });
  it('finds the balance for the request employee + leave type, else null (unavailable state)', () => {
    const rows = [toBalanceRow({ employee_id: 'e1', leave_type_id: 'EL', allocated_days: 5 })];
    expect(findBalance(rows, 'e1', 'EL')?.allocated).toBe(5);
    expect(findBalance(rows, 'e1', 'CL')).toBeNull();
    expect(findBalance(rows, null, 'EL')).toBeNull();
  });
});

describe('leave types from public.leave_types', () => {
  it('uses real names/codes/paid/active, sorted, no hard-coded list', () => {
    expect(toLeaveTypeRows([
      { id: '2', name: 'Sick Leave', code: 'SL', is_paid: true, is_active: true },
      { id: '1', name: 'Earned Leave', code: 'EL', is_paid: true, is_active: false },
      { id: '3', name: 'Loss of Pay', code: null, is_paid: false },
      { id: '4' },
    ])).toEqual([
      { id: '1', name: 'Earned Leave', code: 'EL', paid: true, active: false },
      { id: '3', name: 'Loss of Pay', code: '—', paid: false, active: true },
      { id: '2', name: 'Sick Leave', code: 'SL', paid: true, active: true },
    ]);
    expect(toLeaveTypeRows([])).toEqual([]);
  });
});
