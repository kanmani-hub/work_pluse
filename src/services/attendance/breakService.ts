import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';
import { attendanceService } from './attendanceService';
import { auditService } from '../audit/auditService';
import { qaTimeService } from '../qa/qaTimeService';
import { notificationService } from '../notifications/notificationService';
import { autoBreakStarted, autoBreakEnded } from '../notifications/notificationRules';
import { breakDurationMinutes, completedBreakMinutes, computeBreakOverrun, resolveAllowedBreakMinutes, statusAfterBreakEnds } from './breakRules';

import { companyDateStr as companyDate } from '../../utils/companyDate';
import { isReadingTimeAcceptable } from '../location/geofenceStability';

type BreakTotals = { actual: number; allowed: number | null; overrun: number; statusAfterBreak: 'LATE' | 'WORKING' };

/**
 * Recalculate attendance.break_minutes and break_overrun_minutes from the stored breaks.
 * Allowed minutes = shift break_duration_minutes, else Admin setting (no hard-coded default).
 * A failed read is an error, never "no breaks": otherwise a read failure would store 0 break
 * minutes (the value payroll uses) and reset the status.
 */
async function recalculateBreakTotals(attendanceId: string): Promise<{ totals: BreakTotals | null; error: string | null }> {
  const [{ data: att, error: attErr }, { data: breaks, error: breaksErr }, { globalSettingsService }] = await Promise.all([
    supabase.from('attendance').select('late_minutes, shift_template:shift_template_id(break_duration_minutes)').eq('id', attendanceId).single() as any,
    supabase.from('attendance_breaks').select('started_at, ended_at, duration_minutes, break_type').eq('attendance_id', attendanceId) as any,
    import('../settings/globalSettingsService'),
  ]);
  if (attErr || !att) return { totals: null, error: `attendance could not be read${attErr?.message ? `: ${attErr.message}` : ''}` };
  if (breaksErr || !Array.isArray(breaks)) return { totals: null, error: `breaks could not be read${breaksErr?.message ? `: ${breaksErr.message}` : ''}` };
  const settings = await globalSettingsService.loadSettings();
  const validBreaks = breaks.filter((b: any) => b.break_type !== 'CANCELLED');
  const actual = completedBreakMinutes(validBreaks);
  const allowed = resolveAllowedBreakMinutes(att?.shift_template?.break_duration_minutes, settings.app.breakDurationMins);
  const overrun = computeBreakOverrun(actual, allowed, settings.payroll.enableBreakOverrunDetection);
  // Status to restore when a break ends: keeps LATE for a late arrival (never resets it to WORKING)
  return { totals: { actual, allowed, overrun, statusAfterBreak: statusAfterBreakEnds(att) }, error: null };
}

/**
 * Recalculate and store the attendance break totals + status after a break changed.
 * Returns an explicit error code instead of silently skipping or writing a guessed value.
 */
async function saveBreakTotals(attendanceId: string): Promise<{ totals: BreakTotals | null; error: string | null }> {
  const { totals, error } = await recalculateBreakTotals(attendanceId);
  if (!totals) return { totals: null, error: `TOTALS_NOT_RECALCULATED: ${error}` };
  // @ts-ignore
  const { error: writeErr } = await (supabase.from('attendance') as any).update({
    status: totals.statusAfterBreak,
    break_minutes: totals.actual,
    break_overrun_minutes: totals.overrun,
  }).eq('id', attendanceId);
  if (writeErr) return { totals, error: `TOTALS_NOT_SAVED: ${writeErr.message}` };
  return { totals, error: null };
}

/** Unique-violation from the database (e.g. a second active break once the one-active-break index exists). */
const isUniqueViolation = (error: any) => error?.code === '23505';

export type AttendanceBreakRow = Database['public']['Tables']['attendance_breaks']['Row'];
export type AttendanceBreakInsert = Database['public']['Tables']['attendance_breaks']['Insert'];
export type AttendanceBreakUpdate = Database['public']['Tables']['attendance_breaks']['Update'];

export const breakService = {
  /**
   * Start a new break
   */
  async startBreak(attendanceId: string, breakType: string = 'REGULAR'): Promise<{ data: AttendanceBreakRow | null; error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    // 1. Verify Attendance is active
    const { data: attendance } = await supabase
      .from('attendance')
      .select('status, id, clock_in_at, clock_out_at')
      .eq('id', attendanceId)
      .eq('employee_id', empId)
      .single() as any;
      
    if (!attendance) {
      return { data: null, error: new Error('Attendance record not found.') };
    }
    
    if (!attendance.clock_in_at || attendance.clock_out_at !== null) {
      return { data: null, error: new Error('Cannot start break for completed attendance.') };
    }

    // 2. Check if a break is already active. A list (not maybeSingle): with two open rows maybeSingle
    //    errors and returned null, which used to let a THIRD break start. A failed read is not "none".
    const { data: openBreaks, error: openErr } = await supabase
      .from('attendance_breaks')
      .select('id, break_type')
      .eq('attendance_id', attendanceId)
      .is('ended_at', null) as any;

    if (openErr) return { data: null, error: new Error(`Your current breaks could not be checked (${openErr.message}). Please try again.`) };
    if ((openBreaks || []).some((b: any) => b.break_type !== 'CANCELLED')) {
      return { data: null, error: new Error('A break is already active.') };
    }

    // 2.5 Check break limit exhaustion
    const { data: attendanceData } = await supabase
      .from('attendance')
      .select('*, shift_template:shift_template_id(break_duration_minutes)')
      .eq('id', attendanceId)
      .single() as any;

    const { globalSettingsService } = await import('../settings/globalSettingsService');
    const globalSettings = await globalSettingsService.loadSettings();
    const allowedBreakMins = resolveAllowedBreakMinutes(attendanceData?.shift_template?.break_duration_minutes, globalSettings.app.breakDurationMins);

    const { data: pastBreaks, error: pastErr } = await supabase.from('attendance_breaks').select('duration_minutes, break_type').eq('attendance_id', attendanceId) as any;
    // A failed read is not "0 minutes used": the allowance check cannot be skipped silently
    if (pastErr) return { data: null, error: new Error(`Your break time could not be checked (${pastErr.message}). Please try again.`) };
    let usedMins = 0;
    (pastBreaks || []).filter((b: any) => b.break_type !== 'CANCELLED').forEach((b: any) => usedMins += (b.duration_minutes || 0));
    
    if (allowedBreakMins !== null && usedMins >= allowedBreakMins) {
      return { data: null, error: new Error('You have already exhausted your allowed break duration for today.') };
    }

    const nowIso = qaTimeService.getIsoString();

    // 3. Create break
    // @ts-ignore
    const { data: newBreak, error } = await supabase
      .from('attendance_breaks')
      .insert({
        attendance_id: attendanceId,
        employee_id: empId,
        break_type: breakType,
        started_at: nowIso
      } as any)
      .select()
      .single() as any;

    if (error) {
      if (isUniqueViolation(error)) return { data: null, error: new Error('A break is already active.') };
      return { data: null, error: new Error(error.message) };
    }

    // Audit: BREAK_STARTED
    auditService.recordAuditLog({
      action: 'BREAK_STARTED',
      module: 'ATTENDANCE',
      entity_type: 'attendance_breaks',
      entity_id: (newBreak as any).id,
      description: `Employee started a ${breakType} break.`,
      new_values: { attendance_id: attendanceId, break_type: breakType, started_at: nowIso }
    }).catch(e => console.error('[AUDIT] BREAK_STARTED failed:', e));

    // Update Attendance status (the break row is the record; a failed status write is logged, not hidden)
    // @ts-ignore
    const statusRes: any = await supabase.from('attendance').update({ status: 'ON_BREAK' }).eq('id', attendanceId);
    if (statusRes?.error) console.error('[BREAK] started, but attendance status not updated', statusRes.error.message);

    // Add Event
    await supabase.from('attendance_events').insert({
      attendance_id: attendanceId,
      employee_id: empId,
      event_type: 'BREAK_START',
      event_at: nowIso,
      source: 'WEB'
    } as any);

    return { data: newBreak, error: null };
  },

  /**
   * End the current active break
   */
  async endBreak(attendanceId: string): Promise<{ data: AttendanceBreakRow | null; error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    // 1. Find active break
    const { data: openRows, error: findErr } = await supabase
      .from('attendance_breaks')
      .select('*')
      .eq('attendance_id', attendanceId)
      .eq('employee_id', empId)
      .is('ended_at', null) as any;

    if (findErr) return { data: null, error: new Error(`Your break could not be loaded (${findErr.message}). Please try again.`) };
    const open = (openRows || []).filter((b: any) => b.break_type !== 'CANCELLED');
    if (open.length === 0) {
      return { data: null, error: new Error('No active break found.') };
    }
    if (open.length > 1) {
      return { data: null, error: new Error('More than one open break was found. Please ask HR to correct your breaks.') };
    }
    const activeBreak = open[0];
    // An automatic (GPS) break ends only on a confirmed return inside, clock-out or an admin action
    // (the employee screens never offer "End Break" for it; this keeps the service consistent).
    if (activeBreak.break_type === 'AUTO_GPS') {
      return { data: null, error: new Error('An automatic break ends when you are detected back in the office, or when you clock out.') };
    }

    const nowIso = qaTimeService.getIsoString();
    const durationMinutes = breakDurationMinutes(activeBreak.started_at, nowIso);

    // 2. Update break
    // @ts-ignore
    const { data: updatedBreak, error } = await (supabase.from('attendance_breaks') as any)
      .update({
        ended_at: nowIso,
        duration_minutes: durationMinutes
      } as any)
      .eq('id', activeBreak.id)
      .is('ended_at', null) // a second click / tab cannot overwrite the end time
      .select()
      .maybeSingle() as any;

    if (error) return { data: null, error: new Error(error.message) };
    if (!updatedBreak) return { data: null, error: new Error('No active break found.') };

    // Audit: BREAK_ENDED
    auditService.recordAuditLog({
      action: 'BREAK_ENDED',
      module: 'ATTENDANCE',
      entity_type: 'attendance_breaks',
      entity_id: (updatedBreak as any)?.id || activeBreak.id,
      description: `Employee ended break. Duration: ${durationMinutes} minutes.`,
      new_values: { attendance_id: attendanceId, duration_minutes: durationMinutes, ended_at: nowIso }
    }).catch(e => console.error('[AUDIT] BREAK_ENDED failed:', e));

    // 3. Update attendance totals from the stored breaks (sum of actual durations) and status
    const saved = await saveBreakTotals(attendanceId);
    if (saved.error) console.error('[BREAK] ended, but attendance totals were not updated', saved.error);

    // Add Event
    await supabase.from('attendance_events').insert({
      attendance_id: attendanceId,
      employee_id: empId,
      event_type: 'BREAK_END',
      event_at: nowIso,
      source: 'WEB'
    } as any);

    if (saved.error) {
      // The break IS ended (returned as data); the stored total is left as it was, never guessed.
      return { data: updatedBreak, error: new Error('Your break was ended, but your break total could not be updated. Please refresh the page.') };
    }
    return { data: updatedBreak, error: null };
  },

  /**
   * Admin: Force end an active break session
   */
  async adminEndBreak(breakId: string, attendanceId: string, customEndIso?: string): Promise<{ data: any; error: Error | null }> {
    try {
      const { data: bRecord, error: fetchErr } = await supabase
        .from('attendance_breaks')
        .select('*')
        .eq('id', breakId)
        .maybeSingle() as any;

      if (fetchErr) return { data: null, error: new Error(fetchErr.message) };
      if (!bRecord) return { data: null, error: new Error('Break record not found.') };

      if (bRecord.ended_at) return { data: null, error: new Error('This break has already ended.') };

      const nowIso = customEndIso || qaTimeService.getIsoString();
      const endMs = new Date(nowIso).getTime();
      if (!Number.isFinite(endMs) || endMs < new Date(bRecord.started_at).getTime()) {
        return { data: null, error: new Error('The end time must be a valid time after the break started.') };
      }
      const durationMinutes = breakDurationMinutes(bRecord.started_at, nowIso);

      const { data: updatedBreak, error: updErr } = await (supabase.from('attendance_breaks') as any)
        .update({
          ended_at: nowIso,
          duration_minutes: durationMinutes
        })
        .eq('id', breakId)
        .is('ended_at', null) // ended meanwhile (return to office / clock-out / another admin): keep that end time
        .select()
        .maybeSingle();

      if (updErr) return { data: null, error: new Error(updErr.message) };
      if (!updatedBreak) return { data: null, error: new Error('This break has already ended.') };

      const saved = await saveBreakTotals(attendanceId);

      auditService.recordAuditLog({
        action: 'ADMIN_BREAK_ENDED',
        module: 'ATTENDANCE',
        entity_type: 'attendance_breaks',
        entity_id: breakId,
        description: `Admin ended break session. Duration: ${durationMinutes} minutes.`,
        new_values: { ended_at: nowIso, duration_minutes: durationMinutes }
      }).catch(e => console.error('[AUDIT] ADMIN_BREAK_ENDED failed:', e));

      await (supabase.from('attendance_events') as any).insert({
        attendance_id: attendanceId,
        employee_id: bRecord.employee_id,
        event_type: 'BREAK_END',
        event_at: nowIso,
        source: 'ADMIN',
        metadata: { break_id: breakId, admin_action: true }
      });

      if (saved.error) {
        return { data: updatedBreak, error: new Error(`Break ended, but the attendance break total could not be updated (${saved.error}). Refresh and check before payroll.`) };
      }
      return { data: updatedBreak, error: null };
    } catch (err: any) {
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  },

  /**
   * Admin: Discard / Delete an erroneous or accidental break session
   */
  async adminDeleteBreak(breakId: string, attendanceId: string): Promise<{ success: boolean; error: Error | null }> {
    try {
      const { data: bRecord } = await supabase
        .from('attendance_breaks')
        .select('*')
        .eq('id', breakId)
        .maybeSingle() as any;

      if (!bRecord) return { success: false, error: new Error('Break record not found.') };

      // Attempt hard deletion first. RLS can make a DELETE match 0 rows WITHOUT an error,
      // so the deleted rows are returned and counted.
      const { data: deletedRows, error: delErr } = await (supabase
        .from('attendance_breaks')
        .delete()
        .eq('id', breakId) as any)
        .select('id');

      if (delErr || !deletedRows || deletedRows.length === 0) {
        // Fallback in case DB RLS restricts DELETE: cancel the break with 0 duration
        const { data: cancelledRows, error: cancelErr } = await (supabase.from('attendance_breaks') as any)
          .update({
            break_type: 'CANCELLED',
            duration_minutes: 0,
            ended_at: bRecord.started_at
          })
          .eq('id', breakId)
          .select('id');
        if (cancelErr || !cancelledRows || cancelledRows.length === 0) {
          return { success: false, error: new Error(`The break session could not be discarded${cancelErr?.message ? `: ${cancelErr.message}` : ' (not permitted or already removed)'}.`) };
        }
      }

      const saved = await saveBreakTotals(attendanceId);

      auditService.recordAuditLog({
        action: 'ADMIN_BREAK_DELETED',
        module: 'ATTENDANCE',
        entity_type: 'attendance_breaks',
        entity_id: breakId,
        description: `Admin discarded break session for employee ${bRecord.employee_id}.`,
        old_values: bRecord
      }).catch(e => console.error('[AUDIT] ADMIN_BREAK_DELETED failed:', e));

      await (supabase.from('attendance_events') as any).insert({
        attendance_id: attendanceId,
        employee_id: bRecord.employee_id,
        event_type: 'BREAK_CANCELLED',
        event_at: new Date().toISOString(),
        source: 'ADMIN',
        metadata: { discarded_break_id: breakId }
      });

      if (saved.error) {
        return { success: true, error: new Error(`Session discarded, but the attendance break total could not be updated (${saved.error}). Refresh and check before payroll.`) };
      }
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  },

  /**
   * Get breaks for an attendance record
   */
  async getAttendanceBreaks(attendanceId: string): Promise<{ data: AttendanceBreakRow[] | null; error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('attendance_breaks')
      .select('*')
      .eq('attendance_id', attendanceId)
      .eq('employee_id', empId)
      .order('started_at', { ascending: true });

    if (error) return { data: null, error: new Error(error.message) };
    return { data, error: null };
  },

  /**
   * Admin: Get all breaks for a specific date
   */
  async getAllBreaks(dateStr?: string): Promise<{ data: any[] | null; error: Error | null }> {
    let query = supabase
      .from('attendance_breaks')
      .select(`
        *,
        attendance:attendance_id!inner(attendance_date, shift_template_id, shift_template:shift_template_id(name)),
        employees:employee_id(first_name, last_name, employee_code, departments(name))
      `)
      .order('started_at', { ascending: false });

    if (dateStr) {
      query = query.eq('attendance.attendance_date', dateStr);
    }

    const { data, error } = await query;
    if (error) return { data: null, error: new Error(error.message) };
    return { data, error: null };
  },

  /**
   * Admin: Get break report for a specific date (includes employees with 0 breaks)
   */
  async getBreakReport(dateStr: string): Promise<{ data: any[] | null; error: Error | null }> {
    const { data, error } = await supabase
      .from('attendance')
      .select(`
        id,
        attendance_date,
        clock_in_at,
        clock_out_at,
        status,
        break_minutes,
        break_overrun_minutes,
        shift_template_id,
        shift_template:shift_template_id(name, break_duration_minutes),
        employee_id,
        employees:employee_id(first_name, last_name, employee_code, departments(name)),
        attendance_breaks(*)
      `)
      .eq('attendance_date', dateStr)
      .order('clock_in_at', { ascending: false });

    if (error) return { data: null, error: new Error(error.message) };
    return { data, error: null };
  },

  /**
   * Admin: everything else the Break Management page needs besides the attendance rows.
   * - employees: to list active employees who have NO attendance for the date
   * - live locations + failed location checks: tracking freshness (today only)
   * Each part reports its own error; a failed part is shown as "could not be loaded", never as empty.
   */
  async getBreakReportContext(dateStr: string, isToday: boolean): Promise<{
    employees: any[] | null; liveLocations: any[] | null; locationProblems: any[] | null; breakEndEvents: any[] | null; errors: string[];
  }> {
    const dayStartMs = new Date(`${dateStr}T00:00:00+05:30`).getTime();
    const dayStartIso = new Date(dayStartMs).toISOString();
    const none = Promise.resolve({ data: null, error: null } as any);
    const [employees, live, problems, endEvents] = await Promise.all([
      supabase.from('employees').select('id, employee_code, first_name, last_name, status, joining_date, departments(name), role:role_id(name)') as any,
      isToday ? supabase.from('employee_live_locations').select('employee_id, location_status, location_context, last_seen_at') as any : none,
      isToday
        ? (supabase.from('location_verification_events') as any)
            .select('employee_id, result, verified_at')
            .gte('verified_at', dayStartIso)
            .in('result', ['LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'LOW_ACCURACY', 'ERROR'])
            .order('verified_at', { ascending: false })
            .limit(1000)
        : none,
      // Break ends for the date (+1 day for overnight shifts): flags returns seen only after a tracking gap
      (supabase.from('attendance_events') as any)
        .select('attendance_id, event_at, metadata')
        .eq('event_type', 'BREAK_END')
        .gte('event_at', dayStartIso)
        .lt('event_at', new Date(dayStartMs + 2 * 86_400_000).toISOString()),
    ]);
    const errors: string[] = [];
    if (employees.error) errors.push(`Employee list could not be loaded (${employees.error.message}); employees without attendance are not listed.`);
    if (live.error) errors.push(`Location tracking status could not be loaded (${live.error.message}).`);
    if (problems.error) errors.push(`Location problems could not be loaded (${problems.error.message}).`);
    if (endEvents.error) errors.push(`Break end details could not be loaded (${endEvents.error.message}); returns after a tracking gap are not flagged.`);
    // Supabase returns at most 1000 rows per request by default: a full page may be a truncated list
    if (!employees.error && (employees.data || []).length >= 1000) errors.push('The employee list reached the 1000-row API limit and may be incomplete.');
    return {
      employees: employees.error ? null : (employees.data || []),
      liveLocations: !isToday || live.error ? null : (live.data || []),
      locationProblems: !isToday || problems.error ? null : (problems.data || []),
      breakEndEvents: endEvents.error ? null : (endEvents.data || []),
      errors,
    };
  },

  /**
   * Employee: Get all breaks for a specific date
   */
  async getMyBreaks(dateStr: string): Promise<{ data: any[] | null; error: Error | null }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    let query = supabase
      .from('attendance_breaks')
      .select(`
        *,
        attendance:attendance_id!inner(attendance_date, shift_template_id, shift_template:shift_template_id(name))
      `)
      .eq('employee_id', empId)
      .order('started_at', { ascending: true });

    if (dateStr) {
      query = query.eq('attendance.attendance_date', dateStr);
    }

    const { data, error } = await query;
    if (error) return { data: null, error: new Error(error.message) };
    return { data, error: null };
  },

  /**
   * Handle automatic break transitions based on confirmed GPS geofence exits/entries.
   * START: outside transition while clocked in (office mode) -> AUTO_GPS break from the transition time.
   * END: return transition -> close the active AUTO_GPS break at the return time.
   * Never clocks the employee out. WFH attendance never gets AUTO_GPS breaks.
   */
  async handleAutoBreakTransition(
    empId: string, transition: 'START' | 'END', timestamp: string,
    opts: { isWfhContext?: boolean; trackingGap?: { lastSeenAt: string } } = {},
  ) {
    const today = companyDate(new Date().toISOString());
    const yesterday = companyDate(new Date(Date.now() - 86400000).toISOString());

    // The transition time comes from the device: never trust an unparseable, delayed or future time.
    // (QA fast mode deliberately back-dates transitions and is exempt; it never runs in normal builds.)
    const transitionMs = new Date(timestamp).getTime();
    if (!Number.isFinite(transitionMs)) return { action: 'ERROR', reason: 'INVALID_TRANSITION_TIME' };
    if (!qaTimeService.isEnabled && !isReadingTimeAcceptable(transitionMs, Date.now())) {
      return { action: 'ERROR', reason: 'TRANSITION_TIME_OUT_OF_WINDOW' };
    }

    // 1. Open attendance for today (or an overnight shift that started yesterday)
    const { data: attendance, error: attendanceErr } = await supabase
      .from('attendance')
      .select('id, status, late_minutes, attendance_date, clock_in_at, clock_out_at, shift_template:shift_template_id(crosses_midnight)')
      .eq('employee_id', empId)
      .is('clock_out_at', null)
      .in('attendance_date', [today, yesterday])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as any;

    // A failed read is not "not clocked in"
    if (attendanceErr) return { action: 'ERROR', reason: `ATTENDANCE_CHECK_FAILED: ${attendanceErr.message}` };
    if (!attendance || !attendance.clock_in_at) return { action: 'NONE', reason: 'NOT_CLOCKED_IN' };
    if (attendance.attendance_date !== today && !attendance.shift_template?.crosses_midnight) return { action: 'NONE', reason: 'STALE_OPEN_ATTENDANCE' };

    // A transition before clock-in belongs to no attendance
    const atIso = new Date(Math.max(transitionMs, new Date(attendance.clock_in_at).getTime())).toISOString();

    const { data: openBreaks, error: fetchBreaksErr } = await supabase
      .from('attendance_breaks')
      .select('id, started_at, break_type')
      .eq('attendance_id', attendance.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false }) as any;

    if (fetchBreaksErr) {
      return { action: 'ERROR', reason: fetchBreaksErr.message };
    }

    const validOpenBreaks = (openBreaks || []).filter((b: any) => b.break_type !== 'CANCELLED');
    const activeBreak = validOpenBreaks[0] || null;
    const hasDuplicateActiveBreaks = validOpenBreaks.length > 1;

    if (transition === 'START') {
      if (validOpenBreaks.length > 0) return { action: 'NONE', reason: 'BREAK_ALREADY_ACTIVE' }; // no duplicate active breaks
      if (opts.isWfhContext) return { action: 'NONE', reason: 'WFH' };

      const { data: wfhData, error: wfhError } = await supabase
        .from('wfh_requests')
        .select('id')
        .eq('employee_id', empId)
        .eq('request_date', attendance.attendance_date)
        .eq('status', 'APPROVED')
        .maybeSingle();
      // A failed WFH check is not "no WFH": without knowing, no automatic break is started
      if (wfhError) return { action: 'ERROR', reason: `WFH_CHECK_FAILED: ${wfhError.message}` };
      if (wfhData) return { action: 'NONE', reason: 'WFH' };

      const { data: newBreak, error } = await supabase
        .from('attendance_breaks')
        .insert({ attendance_id: attendance.id, employee_id: empId, break_type: 'AUTO_GPS', started_at: atIso } as any)
        .select()
        .single();

      // Another tab/device created the active break first: keep that one, log nothing twice
      if (isUniqueViolation(error)) return { action: 'NONE', reason: 'BREAK_ALREADY_ACTIVE' };
      if (error || !newBreak) return { action: 'ERROR', reason: error?.message };

      // Follow-up writes are checked. The break itself is kept even if one fails (it is the record of
      // the exit); the next transition or the employee's next action repairs the status.
      const followUp: string[] = [];
      // @ts-ignore
      const statusRes: any = await supabase.from('attendance').update({ status: 'ON_BREAK' } as any).eq('id', attendance.id);
      if (statusRes?.error) followUp.push(`STATUS_NOT_UPDATED: ${statusRes.error.message}`);
      const eventRes: any = await supabase.from('attendance_events').insert({
        attendance_id: attendance.id, employee_id: empId, event_type: 'BREAK_START', event_at: atIso, source: 'SYSTEM',
        metadata: { trigger: 'GPS_GEOFENCE', break_type: 'AUTO_GPS', break_id: (newBreak as any).id },
      } as any);
      if (eventRes?.error) followUp.push(`EVENT_NOT_LOGGED: ${eventRes.error.message}`);
      if (followUp.length) console.error('[AUTO BREAK] started with follow-up failures', (newBreak as any).id, followUp.join('; '));

      auditService.recordAuditLog({
        action: 'AUTOMATIC_BREAK_STARTED',
        module: 'ATTENDANCE',
        entity_type: 'attendance_breaks',
        entity_id: (newBreak as any).id,
        description: `Automatic GPS break started at ${new Date(atIso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
      }).catch(() => {});
      // Only the request that actually created the break notifies (jitter / second tab never reach here)
      await notificationService.notifyEmployee(empId, autoBreakStarted({ breakId: (newBreak as any).id }));
      if (followUp.length) return { action: 'STARTED', breakId: (newBreak as any).id, complete: false, reason: followUp.join('; ') };
      return { action: 'STARTED', breakId: (newBreak as any).id, complete: true };
    }

    // END transition
    if (validOpenBreaks.length === 0) return { action: 'NONE', reason: 'NO_ACTIVE_AUTO_BREAK' };

    // Duplicate active breaks detected: handle safely without crashing or blindly deleting
    if (hasDuplicateActiveBreaks) {
      console.warn(`[AUTO BREAK] Duplicate active breaks detected for employee ${empId}, attendance ${attendance.id}: ${validOpenBreaks.length} open sessions.`);
      return {
        action: 'CONFLICT',
        reason: 'MULTIPLE_ACTIVE_BREAKS',
        openBreaksCount: validOpenBreaks.length,
        breakIds: validOpenBreaks.map((b: any) => b.id),
      };
    }

    // Only an automatic break is closed by returning inside (manual breaks are ended by the employee)
    if (activeBreak.break_type !== 'AUTO_GPS') return { action: 'NONE', reason: 'NO_ACTIVE_AUTO_BREAK' };

    const endIso = new Date(Math.max(new Date(atIso).getTime(), new Date(activeBreak.started_at).getTime())).toISOString();
    const durationMinutes = breakDurationMinutes(activeBreak.started_at, endIso);

    const { data: updatedBreak, error } = await supabase
      .from('attendance_breaks')
      // @ts-ignore
      .update({ ended_at: endIso, duration_minutes: durationMinutes } as any)
      .eq('id', activeBreak.id)
      .is('ended_at', null)
      .select()
      .maybeSingle();
    if (error) return { action: 'ERROR', reason: error.message };
    // Closed in the meantime (other tab / device, clock-out, admin): its end time is kept, nothing logged twice
    if (!updatedBreak) return { action: 'NONE', reason: 'BREAK_ALREADY_ENDED' };

    // Follow-up writes are checked: the break end is kept even if one fails, and the result says so.
    const followUp: string[] = [];
    const saved = await saveBreakTotals(attendance.id); // LATE stays LATE after the break
    if (saved.error) followUp.push(saved.error);
    const totals = saved.totals;
    const eventRes: any = await supabase.from('attendance_events').insert({
      attendance_id: attendance.id, employee_id: empId, event_type: 'BREAK_END', event_at: endIso, source: 'SYSTEM',
      metadata: {
        trigger: 'GPS_GEOFENCE', break_type: 'AUTO_GPS', break_id: activeBreak.id, duration_minutes: durationMinutes,
        // Return seen only after the device stopped reporting: the real return time is unknown (≤ end time)
        ...(opts.trackingGap ? { tracking_gap: true, last_seen_before_return: opts.trackingGap.lastSeenAt } : {}),
      },
    } as any);
    if (eventRes?.error) followUp.push(`EVENT_NOT_LOGGED: ${eventRes.error.message}`);
    if (followUp.length) console.error('[AUTO BREAK] ended with follow-up failures', activeBreak.id, followUp.join('; '));

    auditService.recordAuditLog({
      action: 'AUTOMATIC_BREAK_ENDED',
      module: 'ATTENDANCE',
      entity_type: 'attendance_breaks',
      entity_id: activeBreak.id,
      description: `Automatic GPS break ended. Duration: ${durationMinutes}m.${opts.trackingGap ? ' Return detected after a location tracking gap; the actual return may have been earlier.' : ''}`,
    }).catch(() => {});
    if (totals && totals.overrun > 0) {
      auditService.recordAuditLog({
        action: 'BREAK_OVERRUN_DETECTED',
        module: 'ATTENDANCE',
        entity_type: 'attendance',
        entity_id: attendance.id,
        description: `Break overrun detected: ${totals.overrun} minutes (allowed ${totals.allowed}, actual ${totals.actual}).`,
      }).catch(() => {});
    }
    await notificationService.notifyEmployee(empId, autoBreakEnded({ breakId: activeBreak.id, minutes: durationMinutes }));
    const gap = opts.trackingGap ? { trackingGap: true } : {};
    if (followUp.length) return { action: 'ENDED', breakId: activeBreak.id, durationMinutes, ...(totals ?? {}), ...gap, complete: false, reason: followUp.join('; ') };
    return { action: 'ENDED', breakId: activeBreak.id, durationMinutes, ...totals, ...gap, complete: true };
  }
};
