/**
 * Employee self-service summary cards for WFH and Permission (pure, unit-tested). Built only
 * from the signed-in employee's own request history (the pages load nothing else), with the
 * same rules the cards already used, so card values and detail rows reconcile.
 */
export interface MyCardData { count: number; rows: Record<string, any>[] }
const pack = (rows: Record<string, any>[]): MyCardData => ({ count: rows.length, rows });

// ── WFH ──────────────────────────────────────────────────────────────────────
export type MyWfhCard = 'used' | 'remaining' | 'pending' | 'approved' | 'rejected';
/** history: page rows (rawDate, type 'Full Day'|'Half Day', status 'Pending'|'Approved'|'Rejected'…). */
export function myWfhCards(history: any[], todayStr: string, maxDaysPerMonth: number) {
  const list = history || [];
  const month = todayStr.substring(0, 7);
  const row = (h: any) => ({ __key: h.id, date: h.rawDate, type: h.type, status: h.status, reason: h.reason || '—', requestedOn: h.requestedOn || '—', remarks: h.rejectReason || '—' });
  // Used = approved WFH in the current month on or before today (half day = 0.5)
  const usedRows = list.filter(h => h.status === 'Approved' && String(h.rawDate).substring(0, 7) === month && h.rawDate <= todayStr);
  const used = usedRows.reduce((s, h) => s + (h.type === 'Half Day' ? 0.5 : 1), 0);
  const cards: Record<MyWfhCard, MyCardData> = {
    used: pack(usedRows.map(row)),
    remaining: pack(usedRows.map(row)),
    pending: pack(list.filter(h => h.status === 'Pending').map(row)),
    approved: pack(list.filter(h => h.status === 'Approved').map(row)),
    rejected: pack(list.filter(h => h.status === 'Rejected').map(row)),
  };
  return { cards, used, remaining: Math.max(0, maxDaysPerMonth - used), limit: maxDaysPerMonth };
}

// ── Permission ───────────────────────────────────────────────────────────────
export type MyPermissionCard = 'available' | 'used' | 'pending' | 'approved';
/** history: page rows (rawDate, duration 'Xh Ym', status 'Pending'|'Approved'…); monthKey 'YYYY-MM'. */
export function myPermissionCards(history: any[], monthKey: string) {
  const list = (history || []).filter(h => String(h.rawDate || '').startsWith(monthKey));
  const minutes = (h: any) => { const m = String(h.duration || '').match(/(\d+)h\s*(\d+)m/); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0; };
  const row = (h: any) => ({ __key: h.id, date: h.rawDate, from: h.start || '—', to: h.end || '—', duration: h.duration, minutes: minutes(h), status: h.status, reason: h.reason || '—', remarks: h.rejectReason || '—' });
  const approved = list.filter(h => String(h.status).toUpperCase() === 'APPROVED').map(row);
  const usedMinutes = approved.reduce((s, r) => s + r.minutes, 0);
  const cards: Record<MyPermissionCard, MyCardData> = {
    available: pack(approved),
    used: pack(approved),
    pending: pack(list.filter(h => String(h.status).toUpperCase() === 'PENDING').map(row)),
    approved: pack(approved),
  };
  return { cards, usedMinutes };
}

export const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

// ── Leave balances ───────────────────────────────────────────────────────────
/** One balance card → its figures and the employee's own requests of that leave type. */
export function myLeaveBalanceDetail(balance: any, history: any[]) {
  const name = balance?.leave_types?.name || '';
  const code = balance?.leave_types?.code || '';
  const rows = (history || [])
    .filter(h => (code && h.typeCode === code) || (!!name && h.type === name))
    .map(h => ({ __key: h.id, type: h.type || name || '—', from: h.rawFrom, to: h.rawTo, days: h.totalDays, status: h.status, reason: h.reason || '—', requestedOn: h.requestedOn || '—', remarks: h.rejectReason || '—' }));
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    name: name || 'Leave',
    allowance: num(balance?.total_allowance ?? balance?.allocated_days ?? balance?.total_days),
    used: num(balance?.used_days),
    remaining: num(balance?.remaining_days),
    monthly: balance?.id === 'virtual-cl' || (!!code && code === 'CL'),
    rows,
  };
}

// ── Overtime (employee) ──────────────────────────────────────────────────────
export type MyOvertimeCard = 'pending' | 'approved' | 'requestable';
/** days: OvertimeDay[] from overtimeService.getMyOvertimeDays (own attendance only). */
export function myOvertimeCards(days: any[], monthKey: string) {
  const list = days || [];
  const t = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—');
  const row = (d: any) => ({
    __key: d.attendance?.id, date: d.attendance?.attendance_date, shift: d.shift?.name || '—',
    clockIn: t(d.attendance?.clock_in_at), clockOut: d.attendance?.clock_out_at ? t(d.attendance.clock_out_at) : 'Not clocked out',
    possible: d.estimate?.potentialHours ?? 0, requested: d.request ? Number(d.request.requested_overtime_hours) : null,
    approved: d.request && d.request.approved_overtime_hours !== null && d.request.approved_overtime_hours !== undefined ? Number(d.request.approved_overtime_hours) : null,
    status: d.request?.status || (d.estimate?.eligible ? 'Not requested' : '—'),
  });
  const withReq = list.filter(d => d.request);
  const approvedRows = withReq.filter(d => d.request.status === 'APPROVED' && String(d.request.work_date).startsWith(monthKey)).map(row);
  const cards: Record<MyOvertimeCard, MyCardData> = {
    pending: pack(withReq.filter(d => d.request.status === 'PENDING').map(row)),
    approved: pack(approvedRows),
    requestable: pack(list.filter(d => d.estimate?.eligible && (!d.request || ['REJECTED', 'CANCELLED'].includes(d.request.status))).map(row)),
  };
  return { cards, approvedHours: approvedRows.reduce((s, r) => s + Number(r.approved || 0), 0) };
}
