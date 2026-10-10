/**
 * Admin → Employees summary cards (pure, unit-tested). Each card's number is the length of its
 * row list, built from the same employee list the page shows.
 *  - On Leave: employees with an APPROVED leave covering today (pending requests do not count).
 *  - WFH Today: employees with an APPROVED WFH request for today.
 */
import { employeeFields } from '../common/cardDetails';

export type EmployeeCard = 'total' | 'active' | 'inactive' | 'onLeave' | 'wfhToday';

export function employeeCards(
  employees: any[],
  approvedLeaves: { employee_id: string; start_date: string; end_date: string; leave_types?: { name?: string } | null }[],
  approvedWfh: { employee_id: string; request_date: string }[],
  today: string,
): Record<EmployeeCard, { count: number; rows: Record<string, any>[] }> {
  const list = employees || [];
  const byId = new Map(list.map(e => [e.id, e]));
  const base = (e: any) => ({ __key: e.id, ...employeeFields(e), status: e.status || '—' });
  const pack = (rows: Record<string, any>[]) => ({ count: rows.length, rows });

  const leaveSeen = new Set<string>();
  const onLeave = (approvedLeaves || [])
    .filter(l => byId.has(l.employee_id) && l.start_date <= today && l.end_date >= today && !leaveSeen.has(l.employee_id) && leaveSeen.add(l.employee_id))
    .map(l => ({ ...base(byId.get(l.employee_id)), leaveType: l.leave_types?.name || '—', from: l.start_date, to: l.end_date }));

  const wfhSeen = new Set<string>();
  const wfhToday = (approvedWfh || [])
    .filter(w => byId.has(w.employee_id) && w.request_date === today && !wfhSeen.has(w.employee_id) && wfhSeen.add(w.employee_id))
    .map(w => ({ ...base(byId.get(w.employee_id)), date: w.request_date }));

  return {
    total: pack(list.map(base)),
    active: pack(list.filter(e => e.status === 'ACTIVE').map(base)),
    inactive: pack(list.filter(e => e.status === 'INACTIVE').map(base)),
    onLeave: pack(onLeave),
    wfhToday: pack(wfhToday),
  };
}
