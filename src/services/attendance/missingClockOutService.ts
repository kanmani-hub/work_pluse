/**
 * Missing clock-out workflow (employee correction + admin decision + payroll adjustments).
 *
 * The browser only pre-checks with the shared rules (missingClockOutRules) to show clear messages;
 * every decision is made again, atomically, by the database functions in
 * docs/proposals/PROPOSED_missing_clock_out_workflow.sql. Until that proposal is applied the
 * functions do not exist and every action reports MCO_NOT_SET_UP instead of pretending to work.
 * Location / GPS is never used: no clock-out or working time is ever derived from it.
 */
import { supabase } from '../../lib/supabase';
import { attendanceService } from './attendanceService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { companyDateStr } from '../../utils/companyDate';
import {
  detectMissingClockOut, evaluateClockOutClaim, validateMissingClockOutSubmission, validateMissingClockOutReview,
  duplicateOpenAttendance, missingClockOutPayrollStatus, normalizeLimitHours, isMissingClockOutSchemaError, missingClockOutGraceHours,
  type MissingClockOutDetection, type PayrollAdjustment, type ClaimEvaluation,
} from './missingClockOutRules';

export const MCO_NOT_SET_UP = 'Missing clock-out corrections are not set up in the database yet. Please contact your administrator.';

const isNotSetUp = isMissingClockOutSchemaError;

/** Database rule messages are written for users; anything else gets a generic message (never hidden success). */
export function mcoErrorMessage(e: any, fallback: string): Error | null {
  if (!e) return null;
  if (isNotSetUp(e)) return new Error(MCO_NOT_SET_UP);
  if (['23514', '23505', '42501', '23503', '40001'].includes(e.code) && e.message) return new Error(e.message);
  return new Error(fallback);
}

export interface MissingClockOutCase {
  attendance: any;
  shift: any | null;
  detection: MissingClockOutDetection;
  request: any | null;              // MISSING_CLOCK_OUT request (latest)
  adjustments: PayrollAdjustment[];
  payrollStatus: string;
  canSubmit: boolean;
  cannotSubmitReason: string | null;
  employee?: any;
  duplicateOpen?: boolean;
}

const ATT_COLUMNS = 'id, employee_id, attendance_date, clock_in_at, clock_out_at, required_hours, is_half_day, status, shift_template:shift_template_id(*)';

type McoSettings = { graceHours: number; limitHours: number; error: Error | null };
async function loadSettings(): Promise<McoSettings> {
  const s = await globalSettingsService.loadSettings();
  if (!s?.updated_at || !s.app || !s.payroll) return { graceHours: 0, limitHours: 0, error: new Error('Company settings could not be loaded. Please try again.') };
  return {
    graceHours: missingClockOutGraceHours(s.app),
    limitHours: normalizeLimitHours(s.payroll.missingClockOutMaxAdditionalHours),
    error: null,
  };
}

function leaveContext(leaves: any[], date: string) {
  const covering = (leaves || []).filter(l => l.status === 'APPROVED' && l.start_date <= date && l.end_date >= date);
  return { fullDayLeave: covering.some(l => !l.is_half_day), halfDayLeave: covering.some(l => !!l.is_half_day) };
}

function buildCase(att: any, nowMs: number, graceHours: number, request: any | null, adjustments: PayrollAdjustment[]): MissingClockOutCase {
  const shift = att.shift_template ?? null;
  const detection = detectMissingClockOut(att, shift, nowMs, graceHours);
  let cannotSubmitReason: string | null = null;
  if (request && ['PENDING', 'APPROVED', 'REJECTED'].includes(request.status)) cannotSubmitReason = `A correction for this day is ${String(request.status).toLowerCase()}.`;
  else if (detection.state === 'IN_PROGRESS') cannotSubmitReason = 'Your shift is still in progress: please clock out normally.';
  else if (detection.state !== 'MISSING_CLOCK_OUT') cannotSubmitReason = 'This day already has a clock-out.';
  else if (!shift) cannotSubmitReason = 'No shift was assigned for this day. Please contact HR.';
  return {
    attendance: att, shift, detection, request, adjustments,
    payrollStatus: missingClockOutPayrollStatus(request, adjustments),
    canSubmit: cannotSubmitReason === null, cannotSubmitReason,
  };
}

const byAttendance = (rows: any[]) => {
  const m = new Map<string, any[]>();
  for (const r of rows || []) if (r?.attendance_id) m.set(r.attendance_id, [...(m.get(r.attendance_id) || []), r]);
  return m;
};
const latest = (rows: any[] | undefined) => (rows || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;

export const missingClockOutService = {
  // ------------------------------------------------------------------ employee

  /** Own missing clock-outs (and decided ones) of the last `days` days. */
  async getMyCases(days = 45): Promise<{ data: MissingClockOutCase[] | null; error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Your session has expired. Please sign in again.') };
    const cfg = await loadSettings();
    if (cfg.error) return { data: null, error: cfg.error };
    const since = companyDateStr(Date.now() - days * 86_400_000);

    const [attRes, reqRes, adjRes] = await Promise.all([
      supabase.from('attendance').select(ATT_COLUMNS).eq('employee_id', empId).gte('attendance_date', since).order('attendance_date', { ascending: false }) as any,
      (supabase.from('overtime_requests' as any) as any).select('*').eq('employee_id', empId).eq('request_type', 'MISSING_CLOCK_OUT').gte('work_date', since),
      (supabase.from('payroll_adjustments' as any) as any).select('*').eq('employee_id', empId).gte('work_date', since),
    ]);
    // A failed read is never shown as "no missing clock-outs"
    if (attRes.error) return { data: null, error: new Error('Unable to load your attendance.') };
    const notSetUp = isNotSetUp(reqRes.error) || isNotSetUp(adjRes.error);
    if (!notSetUp && (reqRes.error || adjRes.error)) return { data: null, error: mcoErrorMessage(reqRes.error || adjRes.error, 'Unable to load your clock-out corrections.') };

    const reqs = byAttendance(notSetUp ? [] : reqRes.data);
    const adjs = byAttendance(notSetUp ? [] : adjRes.data);
    const nowMs = Date.now();
    const cases = (attRes.data || [])
      .map((att: any) => buildCase(att, nowMs, cfg.graceHours, latest(reqs.get(att.id)), adjs.get(att.id) || []))
      .filter((c: MissingClockOutCase) => c.detection.state === 'MISSING_CLOCK_OUT' || c.request);
    return { data: cases, error: notSetUp ? new Error(MCO_NOT_SET_UP) : null };
  },

  /** Preview what a claimed clock-out means (unverified), for the form. */
  async previewClaim(attendanceId: string, claimedIso: string): Promise<{ data: ClaimEvaluation | null; error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Your session has expired. Please sign in again.') };
    const inputs = await this._loadDay(attendanceId, empId);
    if (inputs.error) return { data: null, error: inputs.error };
    return {
      data: evaluateClockOutClaim({ attendance: inputs.att, shift: inputs.att.shift_template ?? null, breaks: inputs.breaks, claimedClockOutIso: claimedIso, nowMs: Date.now(), limitHours: inputs.limitHours, dayContext: leaveContext(inputs.leaves, inputs.att.attendance_date) }),
      error: null,
    };
  },

  async submit(attendanceId: string, claimedIso: string, requestedHours: number, reason: string): Promise<{ data: string | null; error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Your session has expired. Please sign in again.') };
    const inputs = await this._loadDay(attendanceId, empId);
    if (inputs.error) return { data: null, error: inputs.error };
    const det = detectMissingClockOut(inputs.att, inputs.att.shift_template ?? null, Date.now(), inputs.graceHours);
    if (det.state === 'IN_PROGRESS') return { data: null, error: new Error('Your shift is still in progress: please clock out normally.') };
    if (det.state !== 'MISSING_CLOCK_OUT') return { data: null, error: new Error('This day already has a clock-out.') };
    const ev = evaluateClockOutClaim({ attendance: inputs.att, shift: inputs.att.shift_template ?? null, breaks: inputs.breaks, claimedClockOutIso: claimedIso, nowMs: Date.now(), limitHours: inputs.limitHours, dayContext: leaveContext(inputs.leaves, inputs.att.attendance_date) });
    const invalid = validateMissingClockOutSubmission(ev, requestedHours, reason);
    if (invalid) return { data: null, error: new Error(invalid) };

    const { data, error } = await (supabase as any).rpc('submit_missing_clock_out_request', {
      p_attendance_id: attendanceId, p_claimed_clock_out: new Date(claimedIso).toISOString(),
      p_requested_hours: Math.round(requestedHours * 100) / 100, p_reason: reason.trim(),
    });
    if (error) return { data: null, error: mcoErrorMessage(error, 'Your correction could not be submitted. Please try again.') };
    if (!data) return { data: null, error: new Error('Your correction could not be submitted. Please try again.') };
    return { data: String(data), error: null };
  },

  /** Employee cancels their own PENDING correction (allowed directly by the database guard). */
  async cancel(requestId: string): Promise<{ error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { error: new Error('Your session has expired. Please sign in again.') };
    const { data, error } = await (supabase.from('overtime_requests' as any) as any)
      .update({ status: 'CANCELLED' }).eq('id', requestId).eq('employee_id', empId).eq('status', 'PENDING').eq('request_type', 'MISSING_CLOCK_OUT').select('id');
    if (error) return { error: mcoErrorMessage(error, 'The request could not be cancelled.') };
    if (!data || data.length === 0) return { error: new Error('Only a pending request can be cancelled.') };
    return { error: null };
  },

  // ------------------------------------------------------------------ admin

  /** All open missing clock-outs + decided corrections of the last `days` days. */
  async listCases(days = 62): Promise<{ data: MissingClockOutCase[] | null; error: Error | null; notSetUp: boolean }> {
    const cfg = await loadSettings();
    if (cfg.error) return { data: null, error: cfg.error, notSetUp: false };
    const since = companyDateStr(Date.now() - days * 86_400_000);
    const [openRes, reqRes, adjRes] = await Promise.all([
      supabase.from('attendance').select(`${ATT_COLUMNS}, employee:employee_id(first_name, last_name, employee_code)`)
        .not('clock_in_at', 'is', null).is('clock_out_at', null).gte('attendance_date', since) as any,
      (supabase.from('overtime_requests' as any) as any)
        .select('*, employee:employee_id(first_name, last_name, employee_code), attendance:attendance_id(' + ATT_COLUMNS + ')')
        .eq('request_type', 'MISSING_CLOCK_OUT').gte('work_date', since),
      (supabase.from('payroll_adjustments' as any) as any).select('*').gte('work_date', since),
    ]);
    if (openRes.error) return { data: null, error: new Error('Open attendance could not be loaded.'), notSetUp: false };
    const notSetUp = isNotSetUp(reqRes.error) || isNotSetUp(adjRes.error);
    if (!notSetUp && (reqRes.error || adjRes.error)) return { data: null, error: mcoErrorMessage(reqRes.error || adjRes.error, 'Missing clock-out requests could not be loaded.'), notSetUp: false };

    const reqs = byAttendance(notSetUp ? [] : reqRes.data);
    const adjs = byAttendance(notSetUp ? [] : adjRes.data);
    const dupes = duplicateOpenAttendance(openRes.data || []);
    const nowMs = Date.now();
    const seen = new Set<string>();
    const cases: MissingClockOutCase[] = [];
    for (const att of openRes.data || []) {
      const c = buildCase(att, nowMs, cfg.graceHours, latest(reqs.get(att.id)), adjs.get(att.id) || []);
      if (c.detection.state !== 'MISSING_CLOCK_OUT' && !c.request) continue;
      seen.add(att.id);
      cases.push({ ...c, employee: att.employee ?? null, duplicateOpen: !!dupes[att.employee_id] });
    }
    // decided corrections (the attendance now has its verified clock-out)
    for (const [attId, list] of reqs) {
      if (seen.has(attId)) continue;
      const req = latest(list);
      if (!req?.attendance) continue;
      cases.push({ ...buildCase(req.attendance, nowMs, cfg.graceHours, req, adjs.get(attId) || []), employee: req.employee ?? null });
    }
    cases.sort((a, b) => String(b.attendance.attendance_date).localeCompare(String(a.attendance.attendance_date)));
    return { data: cases, error: null, notSetUp };
  },

  /** Admin: what a verified clock-out time means (same rules as the database function). */
  async previewVerified(attendanceId: string, verifiedIso: string): Promise<{ data: ClaimEvaluation | null; error: Error | null }> {
    const inputs = await this._loadDay(attendanceId, null);
    if (inputs.error) return { data: null, error: inputs.error };
    return {
      data: evaluateClockOutClaim({ attendance: inputs.att, shift: inputs.att.shift_template ?? null, breaks: inputs.breaks, claimedClockOutIso: verifiedIso, nowMs: Date.now(), limitHours: inputs.limitHours, dayContext: leaveContext(inputs.leaves, inputs.att.attendance_date) }),
      error: null,
    };
  },

  async review(requestId: string, decision: 'APPROVED' | 'REJECTED', verifiedIso: string | null, approvedHours: number | null, remarks: string) {
    const adminId = await attendanceService.getCurrentEmployeeId();
    const { data: req, error: loadErr } = await (supabase.from('overtime_requests' as any) as any).select('*').eq('id', requestId).maybeSingle();
    if (loadErr) return { data: null, error: mcoErrorMessage(loadErr, 'The request could not be loaded.') };
    if (!req || req.request_type !== 'MISSING_CLOCK_OUT') return { data: null, error: new Error('Request not found.') };

    let verified: ClaimEvaluation | null = null;
    if (decision === 'APPROVED') {
      const inputs = await this._loadDay(req.attendance_id, null);
      if (inputs.error) return { data: null, error: inputs.error };
      verified = verifiedIso
        ? evaluateClockOutClaim({ attendance: inputs.att, shift: inputs.att.shift_template ?? null, breaks: inputs.breaks, claimedClockOutIso: verifiedIso, nowMs: Date.now(), limitHours: inputs.limitHours, dayContext: leaveContext(inputs.leaves, inputs.att.attendance_date) })
        : null;
    }
    const invalid = validateMissingClockOutReview({
      decision, remarks, requestedHours: Number(req.requested_overtime_hours), verified, approvedHours,
      reviewerEmployeeId: adminId, requestEmployeeId: req.employee_id, requestStatus: req.status,
    });
    if (invalid) return { data: null, error: new Error(invalid) };

    const { data, error } = await (supabase as any).rpc('review_missing_clock_out_request', {
      p_request_id: requestId, p_decision: decision,
      p_verified_clock_out: decision === 'APPROVED' && verifiedIso ? new Date(verifiedIso).toISOString() : null,
      p_approved_hours: decision === 'APPROVED' ? Math.round(Number(approvedHours) * 100) / 100 : null,
      p_remarks: remarks?.trim() || null,
    });
    if (error) return { data: null, error: mcoErrorMessage(error, 'The decision could not be saved. Please try again.') };
    if (!data) return { data: null, error: new Error('The decision could not be saved. Please try again.') };
    return { data, error: null };
  },

  /** Explicit admin decision for a flagged day without (pending/approved) correction. */
  async applyDeduction(attendanceId: string, reason: string) {
    if (!reason?.trim()) return { data: null, error: new Error('Please give a reason.') };
    const { data, error } = await (supabase as any).rpc('apply_missing_clock_out_deduction', { p_attendance_id: attendanceId, p_reason: reason.trim() });
    if (error) return { data: null, error: mcoErrorMessage(error, 'The deduction could not be recorded. Please try again.') };
    return { data, error: null };
  },

  /**
   * Audit trail of one case: audit log entries for the request and its payroll adjustments, plus the
   * attendance events (flagged as missing, clock-out corrected). A failed read is reported, never shown as "no history".
   */
  async getAuditTrail(c: Pick<MissingClockOutCase, 'attendance' | 'request' | 'adjustments'>): Promise<{ data: { at: string; action: string; description: string; actor: string }[] | null; error: Error | null }> {
    const ids = [c.request?.id, ...(c.adjustments || []).map(a => a.id)].filter(Boolean) as string[];
    const [logs, events] = await Promise.all([
      ids.length
        ? supabase.from('audit_logs').select('created_at, action, description, employees(first_name, last_name)').in('entity_id', ids).order('created_at', { ascending: true }) as any
        : Promise.resolve({ data: [], error: null }),
      supabase.from('attendance_events').select('event_at, event_type, source, metadata').eq('attendance_id', c.attendance.id)
        .in('event_type', ['MISSING_CLOCK_OUT', 'CLOCK_OUT_CORRECTED']).order('event_at', { ascending: true }) as any,
    ]);
    if (logs.error || events.error) return { data: null, error: new Error('The audit trail could not be loaded.') };
    const rows = [
      ...(logs.data || []).map((l: any) => ({ at: l.created_at, action: l.action, description: l.description || '', actor: l.employees ? `${l.employees.first_name} ${l.employees.last_name}` : 'System' })),
      ...(events.data || []).map((e: any) => ({
        at: e.event_at, action: e.event_type,
        description: e.event_type === 'MISSING_CLOCK_OUT' ? 'Flagged: no clock-out after the shift (nothing was assumed).' : 'Clock-out set to the verified time.',
        actor: e.source === 'SYSTEM' ? 'System' : 'Administrator',
      })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return { data: rows, error: null };
  },

  // ------------------------------------------------------------------ shared

  async _loadDay(attendanceId: string, ownerEmployeeId: string | null) {
    const cfg = await loadSettings();
    if (cfg.error) return { error: cfg.error } as const;
    let q = supabase.from('attendance').select(ATT_COLUMNS).eq('id', attendanceId) as any;
    if (ownerEmployeeId) q = q.eq('employee_id', ownerEmployeeId);
    const { data: att, error } = await q.maybeSingle();
    if (error) return { error: new Error('Attendance could not be loaded.') } as const;
    if (!att) return { error: new Error('Attendance record not found.') } as const;
    const [bRes, lRes] = await Promise.all([
      supabase.from('attendance_breaks').select('started_at, ended_at, duration_minutes, break_type').eq('attendance_id', attendanceId) as any,
      supabase.from('leave_requests').select('start_date, end_date, status, is_half_day').eq('employee_id', att.employee_id).eq('status', 'APPROVED') as any,
    ]);
    if (bRes.error || !Array.isArray(bRes.data)) return { error: new Error('Breaks could not be loaded.') } as const;
    if (lRes.error || !Array.isArray(lRes.data)) return { error: new Error('Approved leave could not be loaded.') } as const;
    return { att, breaks: bRes.data, leaves: lRes.data, graceHours: cfg.graceHours, limitHours: cfg.limitHours, error: null } as const;
  },
};
