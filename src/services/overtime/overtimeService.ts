/**
 * Overtime requests. Reuses: attendanceService (own employee id), attendance + breaks
 * (worked time), shift templates, leave requests, auditService, notificationService.
 *
 * Employee: sees potential OT for recent completed days, requests ≤ potential, cancels own
 * pending requests. Admin/HR: approves a specific number of hours (≤ requested, ≤ eligible)
 * or rejects. Only approved_overtime_hours of APPROVED requests may be used by payroll
 * (getApprovedOvertimeHours). Database rules: docs/proposals/PROPOSED_overtime_requests.sql.
 */
import { supabase } from '../../lib/supabase';
import { attendanceService } from '../attendance/attendanceService';
import { auditService } from '../audit/auditService';
import { notificationService } from '../notifications/notificationService';
import { overtimeReviewed } from '../notifications/notificationRules';
import { companyDateStr } from '../../utils/companyDate';
import { isPayrollLocked, payrollPeriodOf } from '../payroll/payrollRules';
import {
  estimateOvertime, validateOvertimeRequest, validateOvertimeApproval, approvedOvertimeHours, minutesToHours,
  ACTIVE_OVERTIME_STATUSES, type OtEstimate,
} from './overtimeRules';

const table = () => (supabase.from('overtime_requests' as any) as any);

export const OT_NOT_SET_UP = 'Overtime requests are not set up in the database yet. Please contact your administrator.';
const isMissingTable = (e: any) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /overtime_requests/.test(e.message || '') && /(does not exist|could not find)/i.test(e.message || ''));
const friendly = (e: any, fallback: string) => {
  if (!e) return null;
  if (isMissingTable(e)) return new Error(OT_NOT_SET_UP);
  if (e.code === '23505') return new Error('An overtime request already exists for this day.');
  if (e.code === '42501') return new Error('You are not allowed to do this.');
  // messages raised by the database rules are written for users
  if (e.code === '23514' && e.message) return new Error(e.message);
  return new Error(fallback);
};

export interface OvertimeDay {
  attendance: any;
  shift: any;
  estimate: OtEstimate;
  request: any | null; // latest request for that attendance (any status)
}

/** Approved leave covering a date → full / half day */
function leaveContext(leaves: any[], date: string) {
  const covering = leaves.filter(l => l.status === 'APPROVED' && l.start_date <= date && l.end_date >= date);
  return { fullDayLeave: covering.some(l => !l.is_half_day), halfDayLeave: covering.some(l => !!l.is_half_day) };
}

async function loadDayInputs(empId: string, attendanceIds?: string[], sinceDate?: string) {
  let q = supabase.from('attendance')
    .select('id, employee_id, attendance_date, clock_in_at, clock_out_at, required_hours, is_half_day, status, is_auto_logged_out, worked_hours, shift_template:shift_template_id(*)')
    .eq('employee_id', empId)
    .order('attendance_date', { ascending: false }) as any;
  if (attendanceIds) q = q.in('id', attendanceIds);
  if (sinceDate) q = q.gte('attendance_date', sinceDate);
  const { data: rows, error } = await q;
  if (error) return { error };
  const ids = (rows || []).map((r: any) => r.id);
  const [{ data: breaks }, { data: leaves }] = await Promise.all([
    ids.length ? supabase.from('attendance_breaks').select('attendance_id, started_at, ended_at, duration_minutes, break_type').in('attendance_id', ids) as any : { data: [] },
    supabase.from('leave_requests').select('start_date, end_date, status, is_half_day').eq('employee_id', empId).eq('status', 'APPROVED') as any,
  ]);
  return { rows: rows || [], breaks: breaks || [], leaves: leaves || [], error: null };
}

function estimateFor(att: any, breaks: any[], leaves: any[]): OtEstimate {
  return estimateOvertime(att, att.shift_template ?? null, breaks.filter((b: any) => b.attendance_id === att.id), leaveContext(leaves, att.attendance_date));
}

export const overtimeService = {
  // ---------------- Employee ----------------

  /** Last `days` days of the employee's own attendance with potential OT and any request. */
  async getMyOvertimeDays(days = 31): Promise<{ data: OvertimeDay[] | null; error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Your session has expired. Please sign in again.') };
    const since = companyDateStr(Date.now() - days * 86_400_000);
    const inputs = await loadDayInputs(empId, undefined, since);
    if (inputs.error) return { data: null, error: new Error('Unable to load your attendance.') };
    const { data: reqs, error: reqErr } = await table().select('*').eq('employee_id', empId).gte('work_date', since);
    if (reqErr && !isMissingTable(reqErr)) return { data: null, error: friendly(reqErr, 'Unable to load your overtime requests.') };
    const latestByAtt = new Map<string, any>();
    for (const r of (reqs || []) as any[]) {
      const cur = latestByAtt.get(r.attendance_id);
      if (!cur || r.created_at > cur.created_at) latestByAtt.set(r.attendance_id, r);
    }
    const data = inputs.rows.map((att: any) => ({
      attendance: att, shift: att.shift_template ?? null,
      estimate: estimateFor(att, inputs.breaks, inputs.leaves),
      request: latestByAtt.get(att.id) ?? null,
    }));
    return { data, error: reqErr && isMissingTable(reqErr) ? new Error(OT_NOT_SET_UP) : null };
  },

  async getMyRequests() {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Your session has expired. Please sign in again.') };
    const { data, error } = await table().select('*').eq('employee_id', empId).order('work_date', { ascending: false });
    return { data, error: friendly(error, 'Unable to load your overtime requests.') };
  },

  /** Submit an OT request. Potential OT is recomputed from the database, never taken from the UI. */
  async createRequest(attendanceId: string, requestedHours: number, reason: string) {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Your session has expired. Please sign in again.') };

    const inputs = await loadDayInputs(empId, [attendanceId]);
    const att = inputs.rows?.[0];
    if (inputs.error || !att) return { data: null, error: new Error('Attendance record not found.') };
    const est = estimateFor(att, inputs.breaks, inputs.leaves);

    const invalid = validateOvertimeRequest(requestedHours, est.potentialHours, reason);
    if (invalid) return { data: null, error: new Error(invalid) };

    // One active request per day (database unique index is the real guard; this gives a clear message)
    const { data: active, error: activeErr } = await table().select('id').eq('attendance_id', attendanceId).in('status', ACTIVE_OVERTIME_STATUSES);
    if (activeErr) return { data: null, error: friendly(activeErr, 'Unable to submit your overtime request.') };
    if (active && active.length > 0) return { data: null, error: new Error('An overtime request already exists for this day.') };

    const { data, error } = await table().insert({
      employee_id: empId,
      attendance_id: attendanceId,
      shift_id: att.shift_template?.id ?? null,
      work_date: att.attendance_date,
      scheduled_hours: minutesToHours(est.scheduledMinutes ?? 0),
      actual_working_hours: minutesToHours(est.workedMinutes),
      eligible_overtime_hours: est.potentialHours,
      requested_overtime_hours: Math.round(requestedHours * 100) / 100,
      employee_reason: reason.trim(),
      status: 'PENDING',
    }).select().single();
    if (error) return { data: null, error: friendly(error, 'Unable to submit your overtime request. Please try again.') };

    auditService.recordAuditLog({
      action: 'OT_REQUEST_CREATED', module: 'OVERTIME', entity_type: 'overtime_requests', entity_id: data.id,
      description: `Overtime requested for ${att.attendance_date}: ${data.requested_overtime_hours}h (eligible ${data.eligible_overtime_hours}h).`,
      new_values: { status: 'PENDING', employee_id: empId, requested_overtime_hours: data.requested_overtime_hours, eligible_overtime_hours: data.eligible_overtime_hours },
    }).catch(e => console.error('[AUDIT] OT_REQUEST_CREATED failed:', e));
    notificationService.notifyAdmins({
      notification_type: 'OVERTIME', title: 'New Overtime Request',
      message: `An overtime request for ${att.attendance_date} (${data.requested_overtime_hours}h) is waiting for review.`,
      action_url: '/admin/overtime', entity_type: 'overtime_requests', entity_id: data.id,
    }).catch(e => console.error('[NOTIFY] admin overtime notification failed:', e));

    return { data, error: null };
  },

  /** Employee cancels their own PENDING request. */
  async cancelMyRequest(id: string) {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { error: new Error('Your session has expired. Please sign in again.') };
    const { data, error } = await table().update({ status: 'CANCELLED' }).eq('id', id).eq('employee_id', empId).eq('status', 'PENDING').select('id');
    if (error) return { error: friendly(error, 'Unable to cancel the request.') };
    if (!data || data.length === 0) return { error: new Error('Only a pending request can be cancelled.') };
    return { error: null };
  },

  // ---------------- Admin / HR ----------------

  async getAllRequests() {
    const { data, error } = await table()
      .select('*, employee:employee_id(first_name, last_name, employee_code), shift:shift_id(name, start_time, end_time, crosses_midnight)')
      .order('created_at', { ascending: false });
    return { data, error: friendly(error, 'Unable to load overtime requests.') };
  },

  /**
   * Approve (with explicit hours) or reject a PENDING request. A request that is no longer
   * pending is never changed again (no second notification, no change of approved hours).
   */
  async reviewRequest(id: string, decision: 'APPROVED' | 'REJECTED', approvedHours: number | null, remarks?: string) {
    const adminId = await attendanceService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Your session has expired. Please sign in again.') };

    const { data: req, error: loadErr } = await table().select('*').eq('id', id).maybeSingle();
    if (loadErr) return { error: friendly(loadErr, 'Unable to load the request.') };
    if (!req) return { error: new Error('Overtime request not found.') };
    if (req.status !== 'PENDING') return { error: new Error(`This request has already been ${String(req.status).toLowerCase()}.`) };

    let approved: number | null = null;
    if (decision === 'APPROVED') {
      const invalid = validateOvertimeApproval(Number(approvedHours), Number(req.requested_overtime_hours), Number(req.eligible_overtime_hours));
      if (invalid) return { error: new Error(invalid) };
      approved = Math.round(Number(approvedHours) * 100) / 100;

      // Policy: overtime cannot be approved once that month's payroll is approved/being paid/paid/closed
      // (it could never be paid). Rejecting is still allowed.
      const period = payrollPeriodOf(req.work_date);
      if (!period) return { error: new Error('This request has no valid work date.') };
      const { data: payrollRow, error: payrollErr } = await (supabase.from('payroll') as any)
        .select('status').eq('employee_id', req.employee_id)
        .eq('payroll_year', period.year).eq('payroll_month', period.month).maybeSingle();
      if (payrollErr) return { error: new Error('Could not check this month\'s payroll status, so the overtime was not approved. Please try again.') };
      if (payrollRow && isPayrollLocked(payrollRow.status)) {
        return { error: new Error(`Payroll for ${period.month}/${period.year} is already ${String(payrollRow.status).replace('_', ' ').toLowerCase()}, so overtime for that month can no longer be approved.`) };
      }
    } else if (!remarks || !remarks.trim()) {
      return { error: new Error('Please give a reason for rejecting.') };
    }

    // Compare-and-set on PENDING: a double click / second admin tab cannot review it twice
    const { data: changed, error } = await table().update({
      status: decision,
      approved_overtime_hours: decision === 'APPROVED' ? approved : 0,
      admin_remarks: remarks?.trim() || null,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id).eq('status', 'PENDING').select('id');
    if (error) return { error: friendly(error, 'Unable to save the review. Please try again.') };
    if (!changed || changed.length === 0) return { error: new Error('This request has already been reviewed.') };

    auditService.recordAuditLog({
      action: decision === 'APPROVED' ? 'OT_REQUEST_APPROVED' : 'OT_REQUEST_REJECTED',
      module: 'OVERTIME', entity_type: 'overtime_requests', entity_id: id,
      description: `Overtime for ${req.work_date} ${decision.toLowerCase()}${decision === 'APPROVED' ? `: ${approved}h of ${req.requested_overtime_hours}h requested` : ''}.`,
      old_values: { status: req.status, approved_overtime_hours: req.approved_overtime_hours },
      new_values: { status: decision, approved_overtime_hours: decision === 'APPROVED' ? approved : 0, employee_id: req.employee_id, reviewed_by: adminId },
      metadata: { remarks: remarks?.trim() || null },
    } as any).catch(e => console.error('[AUDIT] OT review failed:', e));

    const notified = await notificationService.notifyEmployee(req.employee_id, overtimeReviewed({
      id, status: decision, workDate: req.work_date, approvedHours: approved, requestedHours: Number(req.requested_overtime_hours), remarks,
    }));
    // The review itself is saved; report a failed notification instead of hiding it
    return { error: null, notifyError: notified.error ? new Error('The decision was saved, but the employee notification could not be sent.') : null };
  },

  // ---------------- Payroll integration boundary ----------------

  /** The ONLY overtime payroll may use: approved hours of APPROVED requests in the period. */
  async getApprovedOvertimeHours(employeeId: string, periodStart: string, periodEnd: string): Promise<{ hours: number; error: Error | null }> {
    const { data, error } = await table().select('status, approved_overtime_hours')
      .eq('employee_id', employeeId).eq('status', 'APPROVED').gte('work_date', periodStart).lte('work_date', periodEnd);
    if (error) return { hours: 0, error: friendly(error, 'Unable to load approved overtime.') };
    return { hours: approvedOvertimeHours(data || []), error: null };
  },
};
