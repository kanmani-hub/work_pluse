/**
 * Admin → Overtime summary cards (pure, unit-tested). Same filters as the page's KPI numbers:
 *  - Pending review: every PENDING request.
 *  - Approved this month: APPROVED requests whose work date is in the current company month;
 *    the card shows the sum of the hours the admin approved (never requested/eligible hours).
 *  - Rejected this month: REJECTED requests whose work date is in the current company month.
 * Opening a card never approves or rejects anything.
 */
import { employeeFields } from '../common/cardDetails';

export type OvertimeCard = 'pending' | 'approved' | 'rejected';
export interface OvertimeCardData { count: number; hours: number; rows: Record<string, any>[] }

const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));
const hhmm = (t?: string | null) => (t ? String(t).substring(0, 5) : '—');

export function overtimeCards(requests: any[], month: string): Record<OvertimeCard, OvertimeCardData> {
  const list = requests || [];
  const row = (r: any) => {
    const who = employeeFields(r.employee);
    return {
      __key: r.id, employee: who.employee, code: who.code, workDate: r.work_date,
      shift: r.shift ? `${r.shift.name} (${hhmm(r.shift.start_time)} – ${hhmm(r.shift.end_time)})` : '—',
      requested: num(r.requested_overtime_hours), eligible: num(r.eligible_overtime_hours), approved: num(r.approved_overtime_hours),
      status: r.status, remarks: r.admin_remarks || r.reviewer_remarks || '—',
    };
  };
  const inMonth = (r: any) => String(r.work_date || '').startsWith(month);
  const pack = (f: (r: any) => boolean): OvertimeCardData => {
    const rows = list.filter(f).map(row);
    const hours = Math.round(rows.reduce((s, r) => s + (r.status === 'APPROVED' ? Number(r.approved || 0) : 0), 0) * 100) / 100;
    return { count: rows.length, hours, rows };
  };
  return {
    pending: pack(r => r.status === 'PENDING'),
    approved: pack(r => r.status === 'APPROVED' && inMonth(r)),
    rejected: pack(r => r.status === 'REJECTED' && inMonth(r)),
  };
}
