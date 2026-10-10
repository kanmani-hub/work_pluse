/**
 * Admin Dashboard: pure rules (unit-tested). Uses the SAME employee eligibility as
 * Admin → Attendance and Reports: the workforce is ACTIVE employees whose role is not ADMIN.
 *  - Present: attendance record with a clock-in (Admin → Attendance definition).
 *  - Working now: clocked in, not clocked out.
 *  - On leave: workforce employees with an APPROVED leave request covering today
 *    (start_date <= today <= end_date), counted once each. Pending requests are NOT leave.
 *  - Attendance rate: present / workforce.
 */
import { isWorkforceEmployee } from '../reports/reportRules';
import { employeeFields, istTime } from '../common/cardDetails';

export interface DashboardInput {
  employees: any[];   // { id, status, role:{name}, employment_type, office_id }
  attendance: any[];  // today's rows: { employee_id, clock_in_at, clock_out_at }
  leaves: any[];      // APPROVED leave rows: { employee_id, start_date, end_date }
  approvedWfhToday: any[]; // APPROVED WFH rows for today: { employee_id }
  today: string;
}

export function computeDashboardStats(input: DashboardInput) {
  const workforce = (input.employees || []).filter(isWorkforceEmployee);
  const ids = new Set(workforce.map(e => e.id));
  const att = (input.attendance || []).filter(a => ids.has(a.employee_id));
  const presentIds = new Set(att.filter(a => a.clock_in_at).map(a => a.employee_id));
  const workingIds = new Set(att.filter(a => a.clock_in_at && !a.clock_out_at).map(a => a.employee_id));
  const onLeaveIds = new Set((input.leaves || [])
    .filter(l => ids.has(l.employee_id) && l.start_date <= input.today && l.end_date >= input.today)
    .map(l => l.employee_id));
  const wfhIds = new Set((input.approvedWfhToday || []).filter(w => ids.has(w.employee_id)).map(w => w.employee_id));

  const type = (e: any) => String(e.employment_type || '').toLowerCase();
  const fullTime = workforce.filter(e => ['full-time', 'full time', ''].includes(type(e))).length;
  const partTime = workforce.filter(e => ['part-time', 'part time'].includes(type(e))).length;
  const contract = workforce.filter(e => type(e) === 'contract').length;

  const employees = workforce.length;
  return {
    employees,
    present: presentIds.size,
    working: workingIds.size,
    onLeave: onLeaveIds.size,
    attendanceRate: employees > 0 ? Math.round((presentIds.size / employees) * 100) : null,
    attendanceExists: att.length > 0,
    fullTime, partTime, intern: contract,
    activeWfh: wfhIds.size,
    onsite: Math.max(0, workforce.filter(e => e.office_id != null && !wfhIds.has(e.id)).length),
  };
}

// ---- Card details (same sets as computeDashboardStats, so each list length equals its card) ----

export interface DashboardPendingInput {
  leave: any[];      // PENDING leave_requests rows (with employees(...) and leave_types(name))
  wfh: any[];        // PENDING wfh_requests rows (with employees(...))
  permission: any[]; // PENDING permission_requests rows (with employees(...))
}

export type DashboardCard = 'employees' | 'working' | 'pending' | 'onLeave';

export function dashboardCardDetails(input: DashboardInput, pending: DashboardPendingInput): Record<DashboardCard, Record<string, any>[]> {
  const workforce = (input.employees || []).filter(isWorkforceEmployee);
  const byId = new Map(workforce.map(e => [e.id, e]));
  const att = (input.attendance || []).filter(a => byId.has(a.employee_id));

  const employees = workforce.map(e => ({ __key: e.id, ...employeeFields(e), type: e.employment_type || '—', status: e.status || '—' }));

  const seenWorking = new Set<string>();
  const working = att.filter(a => a.clock_in_at && !a.clock_out_at && !seenWorking.has(a.employee_id) && seenWorking.add(a.employee_id))
    .map(a => ({ __key: a.employee_id, ...employeeFields(byId.get(a.employee_id)), clockIn: istTime(a.clock_in_at), status: a.status || 'WORKING', clockOut: 'Not clocked out yet' }));

  const seenLeave = new Set<string>();
  const onLeave = (input.leaves || [])
    .filter(l => byId.has(l.employee_id) && l.start_date <= input.today && l.end_date >= input.today && !seenLeave.has(l.employee_id) && seenLeave.add(l.employee_id))
    .map(l => ({ __key: l.employee_id, ...employeeFields(byId.get(l.employee_id)), leaveType: l.leave_types?.name || '—', from: l.start_date, to: l.end_date }));

  const pend = (rows: any[], type: string, path: string, date: (r: any) => string) => (rows || []).map(r => ({
    __key: `${type}-${r.id}`, type, ...employeeFields(r.employees), date: date(r), status: r.status || 'PENDING', module: path,
  }));
  const pendingRows = [
    ...pend(pending.leave, 'Leave', '/admin/leave', r => r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`),
    ...pend(pending.wfh, 'WFH', '/admin/wfh', r => r.request_date),
    ...pend(pending.permission, 'Permission', '/admin/permission', r => `${r.permission_date}${r.start_time ? ` ${String(r.start_time).slice(0, 5)}–${String(r.end_time || '').slice(0, 5)}` : ''}`),
  ];

  return { employees, working, pending: pendingRows, onLeave };
}
