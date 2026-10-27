/**
 * Reports → Working Hours / WFH / Leave / Permission tabs (QA finding B-09: these tabs were
 * "Analytics Prototype" placeholders). Pure functions over the rows returned by reportService, so the
 * totals shown are computed from the underlying records and can be tested.
 * Dates are company dates (Asia/Kolkata) as stored; no business rule is invented: leave days are the
 * stored total_days, permission minutes the stored duration_minutes, worked hours the stored
 * worked_hours (or clock-out − clock-in − break minutes for a closed day without it).
 */
export type RequestKind = 'Leave' | 'WFH' | 'Permission';
export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;

const name = (e: any) => (e ? `${e.first_name || ''} ${e.last_name || ''}`.trim() || 'Unknown' : 'Unknown');
const dept = (e: any) => e?.departments?.name || '—';

export interface RequestReportRow { id: string; employee: string; code: string; department: string; date: string; detail: string; amount: number; status: string }
export interface RequestReport { rows: RequestReportRow[]; byStatus: Record<string, number>; approvedAmount: number; amountLabel: string }

export function buildRequestReport(kind: RequestKind, data: any[] | null | undefined): RequestReport {
  const rows: RequestReportRow[] = (data || []).map((r: any) => {
    const e = r.employees;
    if (kind === 'Leave') return { id: r.id, employee: name(e), code: e?.employee_code || '—', department: dept(e), date: r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`, detail: `${r.leave_types?.name || 'Leave'}${r.is_half_day ? ` (${r.half_day_type === 'SECOND_HALF' ? 'second' : 'first'} half)` : ''}`, amount: Number(r.total_days) || 0, status: r.status };
    if (kind === 'WFH') return { id: r.id, employee: name(e), code: e?.employee_code || '—', department: dept(e), date: r.request_date, detail: r.reason || '', amount: 1, status: r.status };
    return { id: r.id, employee: name(e), code: e?.employee_code || '—', department: dept(e), date: r.permission_date, detail: `${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}`, amount: Number(r.duration_minutes) || 0, status: r.status };
  });
  const byStatus: Record<string, number> = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0]));
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const approvedAmount = rows.filter((r) => r.status === 'APPROVED').reduce((t, r) => t + r.amount, 0);
  const amountLabel = kind === 'Leave' ? 'Approved leave days' : kind === 'WFH' ? 'Approved WFH days' : 'Approved permission minutes';
  return { rows, byStatus, approvedAmount, amountLabel };
}

export interface WorkingHoursRow { employeeId: string; employee: string; code: string; department: string; days: number; openDays: number; workedMinutes: number; breakMinutes: number; avgMinutes: number }

/** Worked minutes of one attendance row; null for a day that is still open (no clock-out). */
export function workedMinutes(a: any): number | null {
  if (a.worked_hours !== null && a.worked_hours !== undefined && a.worked_hours !== '') return Math.round(Number(a.worked_hours) * 60);
  if (!a.clock_in_at || !a.clock_out_at) return null;
  const m = Math.floor((Date.parse(a.clock_out_at) - Date.parse(a.clock_in_at)) / 60000) - (Number(a.break_minutes) || 0);
  return Math.max(0, m);
}

export function buildWorkingHours(data: any[] | null | undefined): WorkingHoursRow[] {
  const map = new Map<string, WorkingHoursRow>();
  for (const a of data || []) {
    if (!a.clock_in_at) continue;
    const id = a.employee_id || a.employees?.employee_code || 'unknown';
    const row = map.get(id) || { employeeId: id, employee: name(a.employees), code: a.employees?.employee_code || '—', department: dept(a.employees), days: 0, openDays: 0, workedMinutes: 0, breakMinutes: 0, avgMinutes: 0 };
    const w = workedMinutes(a);
    if (w === null) row.openDays += 1;
    else { row.days += 1; row.workedMinutes += w; row.breakMinutes += Number(a.break_minutes) || 0; }
    map.set(id, row);
  }
  return [...map.values()].map((r) => ({ ...r, avgMinutes: r.days ? Math.round(r.workedMinutes / r.days) : 0 }))
    .sort((a, b) => a.employee.localeCompare(b.employee));
}
