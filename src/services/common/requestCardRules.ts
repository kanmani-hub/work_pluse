/**
 * WFH / Leave / Permission admin summary cards (pure, unit-tested). Each card's number is the
 * length of the rows its detail view lists. Dates use the company calendar (Asia/Kolkata).
 * Opening a card is read-only: nothing here approves, rejects or edits a request.
 *  - "Approved Today" = status APPROVED and reviewed (approved) on today's company date.
 *  - "Active / On Leave Today" = status APPROVED and the request covers today.
 */
import { companyDateStr } from '../../utils/companyDate';

export interface CardData { count: number; rows: Record<string, any>[] }
const pack = (rows: Record<string, any>[]): CardData => ({ count: rows.length, rows });
const reviewedOn = (iso: string | null | undefined, today: string) => !!iso && companyDateStr(iso) === today;
const day = (iso?: string | null) => (iso ? companyDateStr(iso) : '—');

// ── WFH ──────────────────────────────────────────────────────────────────────
export type WfhCard = 'total' | 'pending' | 'approvedToday' | 'activeToday' | 'alerts' | 'rejected';
/** requests: the page's mapped WFH requests (with raw requestDate / reviewed_at / requested_at). */
export function wfhCards(requests: any[], today: string): Record<WfhCard, CardData> {
  const list = requests || [];
  const row = (r: any) => ({
    __key: r.id, employee: r.employee, code: r.employeeId, department: r.department, date: r.requestDate || r.date,
    status: r.status, reason: r.reason || '—', submitted: day(r.requested_at), reviewed: day(r.reviewed_at), remarks: r.rejectReason || '—',
  });
  const by = (f: (r: any) => boolean) => pack(list.filter(f).map(row));
  return {
    total: by(() => true),
    pending: by(r => r.status === 'PENDING'),
    approvedToday: by(r => r.status === 'APPROVED' && reviewedOn(r.reviewed_at, today)),
    activeToday: by(r => r.status === 'APPROVED' && r.requestDate === today),
    alerts: by(r => (r.conflicts?.length || 0) > 0),
    rejected: by(r => r.status === 'REJECTED'),
  };
}

// ── Leave ────────────────────────────────────────────────────────────────────
export type LeaveCard = 'total' | 'pending' | 'approvedToday' | 'onLeaveToday' | 'halfDay' | 'alerts' | 'rejected';
/** requests: the page's mapped leave requests (with raw start_date / end_date / reviewed_at). */
export function leaveCards(requests: any[], today: string): Record<LeaveCard, CardData> {
  const list = requests || [];
  const row = (r: any) => ({
    __key: r.id, employee: r.name, code: r.empId, department: r.dept, office: r.office || '—', leaveType: r.type,
    from: r.start_date, to: r.end_date, days: r.total_days ?? r.duration, halfDay: r.halfDay ? (r.half || 'Yes') : 'No',
    status: r.status, submitted: day(r.requested_at), reviewed: day(r.reviewed_at), remarks: r.reviewer_remarks || '—',
  });
  const by = (f: (r: any) => boolean) => pack(list.filter(f).map(row));
  return {
    total: by(() => true),
    pending: by(r => r.status === 'PENDING'),
    approvedToday: by(r => r.status === 'APPROVED' && reviewedOn(r.reviewed_at, today)),
    onLeaveToday: by(r => r.status === 'APPROVED' && !!r.start_date && r.start_date <= today && (r.end_date || r.start_date) >= today),
    halfDay: by(r => !!r.halfDay),
    alerts: by(r => (r.conflicts?.length || 0) > 0),
    rejected: by(r => r.status === 'REJECTED'),
  };
}

// ── Permission ───────────────────────────────────────────────────────────────
export type PermissionCard = 'total' | 'pending' | 'approvedToday' | 'activeToday' | 'rejected' | 'totalHours' | 'alerts';
/** requests: the page's mapped permission requests (with raw dateISO / minutes / reviewed_at). */
export function permissionCards(requests: any[], today: string): Record<PermissionCard, CardData> & { approvedMinutes: number } {
  const list = requests || [];
  const row = (r: any) => ({
    __key: r.id, employee: r.name, code: r.empId, department: r.dept, date: r.dateISO || r.date,
    from: r.startTime, to: r.endTime, duration: r.duration, minutes: r.minutes ?? null,
    status: r.status, submitted: day(r.requested_at), reviewed: day(r.reviewed_at), remarks: r.reviewer_remarks || '—',
  });
  const by = (f: (r: any) => boolean) => pack(list.filter(f).map(row));
  const approved = by(r => r.status === 'APPROVED');
  return {
    total: by(() => true),
    pending: by(r => r.status === 'PENDING'),
    approvedToday: by(r => r.status === 'APPROVED' && reviewedOn(r.reviewed_at, today)),
    activeToday: by(r => r.status === 'APPROVED' && r.dateISO === today),
    rejected: by(r => r.status === 'REJECTED'),
    totalHours: approved,
    // Usage-limit alerts are not implemented (no configured limit rule) — always empty, never invented
    alerts: pack([]),
    approvedMinutes: approved.rows.reduce((s, r) => s + (Number(r.minutes) || 0), 0),
  };
}

export const hoursLabel = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
