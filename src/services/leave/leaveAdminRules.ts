/**
 * Admin → Leave: pure helpers for real leave balances and leave types (unit-tested).
 * Columns come from public.leave_balances (allocated_days, used_days, pending_days,
 * remaining_days) and public.leave_types (name, code, is_paid, is_active).
 */
const num = (v: any): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : null;
};

export interface BalanceRow {
  employeeId: string | null;
  leaveTypeId: string | null;
  allocated: number | null;
  used: number | null;
  pending: number | null;
  remaining: number | null;
}

export function toBalanceRow(b: any): BalanceRow {
  const allocated = num(b?.allocated_days);
  const used = num(b?.used_days);
  const pending = num(b?.pending_days);
  const stored = num(b?.remaining_days);
  const remaining = stored !== null ? stored
    : allocated !== null ? Math.max(0, allocated - (used || 0) - (pending || 0)) : null;
  return { employeeId: b?.employee_id ?? null, leaveTypeId: b?.leave_type_id ?? null, allocated, used, pending, remaining };
}

/** The stored balance for this employee + leave type, or null when none exists. */
export function findBalance<T extends { employeeId: string | null; leaveTypeId: string | null }>(rows: T[], employeeId: string | null | undefined, leaveTypeId: string | null | undefined): T | null {
  if (!employeeId || !leaveTypeId) return null;
  return (rows || []).find(r => r.employeeId === employeeId && r.leaveTypeId === leaveTypeId) || null;
}

export function toLeaveTypeRows(types: any[]): { id: string; name: string; code: string; paid: boolean; active: boolean }[] {
  return (types || [])
    .filter(t => t && t.name)
    .map(t => ({ id: t.id, name: t.name, code: t.code || '—', paid: t.is_paid !== false, active: t.is_active !== false }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
