/**
 * Reports page summary cards → the records behind each number (pure, unit-tested).
 * Built from the exact rows getDashboardMetrics already reads for the selected date range and
 * department / office filters, using the same conditions as the card values.
 */
import { employeeFields, istTime, formatDuration } from '../common/cardDetails';
import type { AttendanceStats } from './reportRules';

export type ReportCard = 'totalEmployees' | 'attendanceRate' | 'present' | 'late' | 'wfh' | 'onLeave' | 'avgHours' | 'payroll';
export interface ReportCardData { count: number; rows: Record<string, any>[] }

const pack = (rows: Record<string, any>[]): ReportCardData => ({ count: rows.length, rows });
const dept = (e: any) => { const d = employeeFields(e).department; return d === '—' ? 'Unassigned' : d; };

export function reportCardRecords(input: {
  employees: any[]; attendance: any[]; wfh: any[]; leaves: any[]; payroll: any[]; days: AttendanceStats['days'];
}): Record<ReportCard, ReportCardData> {
  const emps = input.employees || [];
  const byId = new Map(emps.map(e => [e.id, e]));
  const who = (e: any) => ({ ...employeeFields(e), department: dept(e) });
  const att = input.attendance || [];

  const dayRow = (d: AttendanceStats['days'][number]) => ({
    __key: `${d.employee_id}|${d.date}`, ...who(byId.get(d.employee_id)), date: d.date,
    outcome: d.outcome === 'PRESENT' ? (d.wfh ? 'Present (WFH)' : 'Present') : d.outcome === 'ABSENT' ? 'Absent' : 'Full-day leave',
  });
  const days = input.days || [];

  const worked = att.filter(a => a.worked_hours);
  return {
    totalEmployees: pack(emps.map(e => ({ __key: e.id, ...who(e), status: e.status || '—' }))),
    attendanceRate: pack(days.filter(d => d.outcome !== 'LEAVE').map(dayRow)),
    present: pack(days.filter(d => d.outcome === 'PRESENT').map(dayRow)),
    late: pack(att.filter(a => a.late_minutes && a.late_minutes > 0).map(a => ({
      __key: a.id, ...who(a.employees), date: a.attendance_date, status: a.status,
      shiftStart: a.shift_templates?.start_time ? String(a.shift_templates.start_time).substring(0, 5) : '—',
      clockIn: istTime(a.clock_in_at), lateMinutes: a.late_minutes,
    }))),
    wfh: pack((input.wfh || []).map((w, i) => ({ __key: `${w.employee_id}|${w.request_date}|${i}`, ...who(w.employees || byId.get(w.employee_id)), date: w.request_date, status: 'APPROVED' }))),
    onLeave: pack((input.leaves || []).map((l, i) => ({
      __key: `${l.employee_id}|${l.start_date}|${i}`, ...who(l.employees || byId.get(l.employee_id)), leaveType: l.leave_types?.name || '—',
      from: l.start_date, to: l.end_date, halfDay: l.is_half_day ? 'Yes' : 'No', status: 'APPROVED',
    }))),
    avgHours: pack(worked.map(a => ({
      __key: a.id, ...who(a.employees), date: a.attendance_date, clockIn: istTime(a.clock_in_at),
      clockOut: a.clock_out_at ? istTime(a.clock_out_at) : 'Not clocked out', workedHours: formatDuration(Math.round(Number(a.worked_hours) * 60)),
      workedMinutes: Number(a.worked_hours) * 60,
    }))),
    payroll: pack((input.payroll || []).map(p => ({
      __key: p.id || p.employee_id, ...who(p.employees || byId.get(p.employee_id)), status: p.status || '—',
      gross: p.gross_salary ?? null, deductions: p.total_deductions ?? null, net: Number(p.net_salary || 0),
    }))),
  };
}

/** Department drill-down figures computed from the same records (null = nothing to average). */
export function departmentSummary(records: Record<ReportCard, ReportCardData> | undefined, department: string) {
  if (!records) return null;
  const inDept = (r: any) => r.department === department;
  const hours = records.avgHours.rows.filter(inDept);
  const avg = hours.length ? hours.reduce((s, r) => s + r.workedMinutes, 0) / hours.length : null;
  return {
    employees: records.totalEmployees.rows.filter(inDept).length,
    avgWorkingMinutes: avg,
    payrollNet: records.payroll.rows.filter(inDept).reduce((s, r) => s + r.net, 0),
    payrollRecords: records.payroll.rows.filter(inDept).length,
  };
}
