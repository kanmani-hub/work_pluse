import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';
import { attendanceService } from './attendanceService';
import { logBreakAudit } from './breakAudit';
import { qaTimeService } from '../qa/qaTimeService';
import { breakDurationMinutes, classifyOpenBreaks, completedBreakMinutes, computeBreakOverrun, resolveAllowedBreakMinutes, statusAfterBreakEnds } from './breakRules';
import { isAutomaticBreak, mapAutoBreakResult, type AutoBreakTransitionResult } from './automaticBreakRules';

import { isReadingTimeAcceptable } from '../location/geofenceStability';
import { isAdminPortalRole } from '../../lib/roles';

type BreakTotals =
  | { ok: true; actual: number; allowed: number | null; overrun: number; statusAfterBreak: 'LATE' | 'WORKING' }
  | { ok: false; error: Error; statusAfterBreak: 'LATE' | 'WORKING' | null };

/**
 * Recalculate attendance.break_minutes and break_overrun_minutes from the stored breaks.
 * Allowed minutes = shift break_duration_minutes, else Admin setting (no hard-coded default).
 * If the attendance row, the breaks or the settings cannot be read, nothing is calculated
 * (ok: false): a failed read must never be written back as 0 break minutes / 0 overrun.
 */
async function recalculateBreakTotals(attendanceId: string): Promise<BreakTotals> {
  // Status to restore when a break ends, from the attendance row actually read (kept even if a
  // later step fails, e.g. the settings cannot be loaded): LATE stays LATE, otherwise WORKING.
  let statusAfterBreak: 'LATE' | 'WORKING' | null = null;
  try {
    const [attRes, breaksRes, { globalSettingsService }] = await Promise.all([
      supabase.from('attendance').select('late_minutes, shift_template:shift_template_id(break_duration_minutes)').eq('id', attendanceId).single() as any,
      supabase.from('attendance_breaks').select('started_at, ended_at, duration_minutes, break_type').eq('attendance_id', attendanceId) as any,
      import('../settings/globalSettingsService'),
    ]);
    const att = attRes?.data;
    statusAfterBreak = att && !attRes?.error ? statusAfterBreakEnds(att) : null;
    if (attRes?.error || !att) return { ok: false, statusAfterBreak, error: new Error(`attendance could not be read (${attRes?.error?.message || 'no data returned'})`) };
    if (breaksRes?.error || !Array.isArray(breaksRes?.data)) return { ok: false, statusAfterBreak, error: new Error(`breaks could not be read (${breaksRes?.error?.message || 'no data returned'})`) };
    const settings = await globalSettingsService.loadSettings();
    const actual = completedBreakMinutes(breaksRes.data);
    const allowed = resolveAllowedBreakMinutes(att.shift_template?.break_duration_minutes, settings.app.breakDurationMins);
    const overrun = computeBreakOverrun(actual, allowed, settings.payroll.enableBreakOverrunDetection);
    return { ok: true, actual, allowed, overrun, statusAfterBreak: statusAfterBreakEnds(att) };
  } catch (e: any) {
    return { ok: false, statusAfterBreak, error: new Error(`break totals could not be calculated (${e?.message || e})`) };
  }
}

/**
 * Outcome of writing the break totals after a break ended (the break itself is already closed).
 * totalsSaved: break_minutes / break_overrun_minutes were written. statusSaved: the attendance
 * left ON_BREAK. error: why something was not saved (null only when both were saved).
 * Re-running the calculation is always safe: the totals are derived from the stored breaks,
 * so a later break end or the clock-out writes the correct values again (never double counts).
 */
interface BreakTotalsWrite { totalsSaved: boolean; statusSaved: boolean; error: Error | null }

/** Write the recalculated totals, or (if they could not be calculated) only the status. */
async function applyBreakTotals(attendanceId: string, totals: BreakTotals): Promise<BreakTotalsWrite> {
  if (totals.ok) {
    // @ts-ignore
    const res: any = await supabase.from('attendance').update({
      status: totals.statusAfterBreak, // LATE stays LATE after the break
      break_minutes: totals.actual,
      break_overrun_minutes: totals.overrun,
    } as any).eq('id', attendanceId);
    if (res?.error) {
      console.error('[BREAK TOTALS] write failed for attendance', attendanceId, res.error.message);
      return { totalsSaved: false, statusSaved: false, error: new Error(`attendance totals could not be saved (${res.error.message})`) };
    }
    return { totalsSaved: true, statusSaved: true, error: null };
  }
  console.error('[BREAK TOTALS] not updated for attendance', attendanceId, totals.error.message);
  // break_minutes / break_overrun_minutes are left as they are; only leave the ON_BREAK status
  if (!totals.statusAfterBreak) return { totalsSaved: false, statusSaved: false, error: totals.error };
  // @ts-ignore
  const res: any = await supabase.from('attendance').update({ status: totals.statusAfterBreak } as any).eq('id', attendanceId);
  if (res?.error) return { totalsSaved: false, statusSaved: false, error: new Error(`${totals.error.message}; attendance status could not be saved either (${res.error.message})`) };
  return { totalsSaved: false, statusSaved: true, error: totals.error };
}

/** Recalculate and write the totals/status from the stored breaks (used when no break is open). */
/**
 * No break is open: bring the attendance back in line with the stored breaks if it is stale
 * (still ON_BREAK, or break_minutes / break_overrun_minutes differ from the recalculation, e.g.
 * after an earlier failed write or settings read). Writes nothing when everything already matches,
 * and is idempotent because the totals are derived from the breaks (never counted twice).
 */
async function reconcileIfStale(attendanceId: string, current: { status?: string | null; break_minutes?: number | null; break_overrun_minutes?: number | null }): Promise<{ reconciled: boolean; changed: boolean }> {
  const totals = await recalculateBreakTotals(attendanceId);
  const stale = current.status === 'ON_BREAK'
    || (totals.ok && ((current.break_minutes ?? 0) !== totals.actual || (current.break_overrun_minutes ?? 0) !== totals.overrun));
  if (!stale) return { reconciled: true, changed: false };
  if (!totals.ok && current.status !== 'ON_BREAK') return { reconciled: false, changed: false };
  const saved = await applyBreakTotals(attendanceId, totals);
  return { reconciled: saved.totalsSaved && saved.statusSaved, changed: saved.totalsSaved || saved.statusSaved };
}

/**
 * Admin corrections (end / discard): recalculate and write the totals from the stored breaks.
 * Returns null when the totals were saved, otherwise why not (the stored totals are never guessed).
 */
async function saveTotalsAfterAdminChange(attendanceId: string): Promise<string | null> {
  const totals = await recalculateBreakTotals(attendanceId);
  const saved = await applyBreakTotals(attendanceId, totals);
  return saved.totalsSaved ? null : (saved.error?.message || 'unknown error');
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
  async startBreak(attendanceId: string, breakType: string = 'REGULAR'): Promise<{ data: AttendanceBreakRow | null; error: Error | null; auditLogged?: boolean }> {
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

    // 2. Check if a break is already active (a failed check never counts as "no break")
    const openRes = await supabase
      .from('attendance_breaks')
      .select('id, break_type')
      .eq('attendance_id', attendanceId)
      .is('ended_at', null) as any;
    const open = classifyOpenBreaks(openRes?.data, openRes?.error);
    if (open.kind === 'ERROR') {
      return { data: null, error: new Error(`Could not check for an active break (${open.message}). No break was started; please try again.`) };
    }
    if (open.kind === 'MULTIPLE') {
      return { data: null, error: new Error(`${open.count} breaks are open for this attendance. No new break was started; an administrator must correct the break records.`) };
    }
    if (open.kind === 'ONE') {
      // Safe retry after an earlier partial start: the break exists, make sure the status says so
      if (attendance.status !== 'ON_BREAK') {
        // @ts-ignore
        const fix: any = await supabase.from('attendance').update({ status: 'ON_BREAK' } as any).eq('id', attendanceId);
        if (fix?.error) console.error('[BREAK] status repair failed for attendance', attendanceId, fix.error.message);
      }
      return { data: null, error: new Error('A break is already active.') };
    }

    // 2.5 Check break limit exhaustion. Every read must succeed: if the allowance cannot be
    // verified, no break is started (a failed read is never treated as "nothing used").
    const allowanceError = (what: string, e: any) => ({ data: null, error: new Error(`Your break allowance could not be checked (${what}: ${e?.message || e || 'no data returned'}). No break was started; please try again.`) });
    const attRes = await supabase
      .from('attendance')
      .select('*, shift_template:shift_template_id(break_duration_minutes)')
      .eq('id', attendanceId)
      .single() as any;
    if (attRes?.error || !attRes?.data) return allowanceError('attendance', attRes?.error);
    const attendanceData = attRes.data;

    let globalSettings: any;
    try {
      const { globalSettingsService } = await import('../settings/globalSettingsService');
      globalSettings = await globalSettingsService.loadSettings();
    } catch (e: any) {
      return allowanceError('settings', e);
    }
    const allowedBreakMins = resolveAllowedBreakMinutes(attendanceData?.shift_template?.break_duration_minutes, globalSettings?.app?.breakDurationMins);

    const pastRes = await supabase.from('attendance_breaks').select('duration_minutes, break_type').eq('attendance_id', attendanceId) as any;
    if (pastRes?.error || !Array.isArray(pastRes?.data)) return allowanceError('earlier breaks', pastRes?.error);
    let usedMins = 0;
    pastRes.data.filter((b: any) => b.break_type !== 'CANCELLED').forEach((b: any) => usedMins += (b.duration_minutes || 0));

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

    // The database sets the start time of a manual break (guard trigger); log the stored value
    const startedAt: string = (newBreak as any)?.started_at || nowIso;

    // Audit: BREAK_STARTED
    const auditLogged = await logBreakAudit({
      action: 'BREAK_STARTED',
      module: 'ATTENDANCE',
      entity_type: 'attendance_breaks',
      entity_id: (newBreak as any).id,
      description: `Employee started a ${breakType} break.`,
      new_values: { attendance_id: attendanceId, break_type: breakType, started_at: startedAt }
    });

    // Update Attendance status and add the event. The break already exists and is never removed
    // because a follow-up write failed; the failure is reported instead (and starting again
    // repairs the status, see "already active" above).
    const followUp: string[] = [];
    // @ts-ignore
    const statusRes: any = await supabase.from('attendance').update({ status: 'ON_BREAK' }).eq('id', attendanceId);
    if (statusRes?.error) followUp.push(`attendance status not set to On Break (${statusRes.error.message})`);

    const eventRes: any = await supabase.from('attendance_events').insert({
      attendance_id: attendanceId,
      employee_id: empId,
      event_type: 'BREAK_START',
      event_at: startedAt,
      source: 'WEB'
    } as any);
    if (eventRes?.error) followUp.push(`break start event not logged (${eventRes.error.message})`);

    if (followUp.length) {
      console.error('[BREAK] started with follow-up failures', (newBreak as any).id, followUp.join('; '));
      return { data: newBreak, error: new Error(`Your break has started, but ${followUp.join(' and ')}. Please refresh the page; if it does not show you on break, contact an administrator.`), auditLogged };
    }
    // An audit failure is a diagnostic only (auditLogged: false); it never fails the break itself
    return { data: newBreak, error: null, auditLogged };
  },

  /**
   * End the current active break
   */
  async endBreak(attendanceId: string): Promise<{ data: AttendanceBreakRow | null; error: Error | null; auditLogged?: boolean }> {
    const empId = await attendanceService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    // 1. Find the active break: a failed or ambiguous lookup changes nothing
    const openRes = await supabase
      .from('attendance_breaks')
      .select('*')
      .eq('attendance_id', attendanceId)
      .eq('employee_id', empId)
      .is('ended_at', null) as any;
    const open = classifyOpenBreaks<any>(openRes?.data, openRes?.error);
    if (open.kind === 'ERROR') {
      return { data: null, error: new Error(`Could not check for an active break (${open.message}). Nothing was changed; please try again.`) };
    }
    if (open.kind === 'MULTIPLE') {
      return { data: null, error: new Error(`${open.count} breaks are open for this attendance. No break was ended; an administrator must correct the break records.`) };
    }
    if (open.kind === 'NONE') {
      // Safe retry after an earlier partial end (break closed, attendance write failed): no break
      // is open but the attendance still says On Break → rewrite totals and status from the
      // stored breaks. Idempotent: derived from the breaks, never counted twice.
      const cur = await supabase.from('attendance').select('status, clock_out_at, break_minutes, break_overrun_minutes').eq('id', attendanceId).eq('employee_id', empId).maybeSingle() as any;
      if (!cur?.error && cur?.data && !cur.data.clock_out_at) {
        await reconcileIfStale(attendanceId, cur.data);
      }
      return { data: null, error: new Error('No active break found.') };
    }
    const activeBreak = open.active;
    // An automatic break (geofence or tracking) ends only on a confirmed return inside / a fresh
    // location reaching the server, at clock-out, at shift end or by an admin. The employee screens
    // never offer "End Break" for it, and the database refuses it as well.
    if (isAutomaticBreak(activeBreak)) {
      return { data: null, error: new Error(activeBreak.break_type === 'AUTO_GPS'
        ? 'An automatic break ends when you are detected back in the office, or when you clock out.'
        : 'This automatic break ends by itself as soon as a fresh location reaches WorkPulse, or when you clock out.') };
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
    // The database sets the end time and duration of a manual break (guard trigger); log the stored values
    const endedAt: string = (updatedBreak as any)?.ended_at || nowIso;
    const storedMinutes: number = typeof (updatedBreak as any)?.duration_minutes === 'number' ? (updatedBreak as any).duration_minutes : durationMinutes;

    // Audit: BREAK_ENDED
    const auditLogged = await logBreakAudit({
      action: 'BREAK_ENDED',
      module: 'ATTENDANCE',
      entity_type: 'attendance_breaks',
      entity_id: (updatedBreak as any)?.id || activeBreak.id,
      description: `Employee ended break. Duration: ${storedMinutes} minutes.`,
      new_values: { attendance_id: attendanceId, duration_minutes: storedMinutes, ended_at: endedAt }
    });

    // 3. Update attendance totals from the stored breaks (sum of actual durations) and status.
    // If they cannot be recalculated, the stored totals are left untouched (never overwritten with 0).
    const totals = await recalculateBreakTotals(attendanceId);
    const saved = await applyBreakTotals(attendanceId, totals);

    // Add Event
    const eventRes: any = await supabase.from('attendance_events').insert({
      attendance_id: attendanceId,
      employee_id: empId,
      event_type: 'BREAK_END',
      event_at: endedAt,
      source: 'WEB'
    } as any);

    // The break is ended either way (it is never reopened). Anything not saved is reported, and
    // the totals are rewritten from the stored breaks at the next break end or at clock-out.
    const problems: string[] = [];
    if (!saved.totalsSaved) problems.push(`the attendance break totals could not be updated (${saved.error?.message || 'unknown error'})`);
    if (!saved.statusSaved) problems.push('your attendance still shows On Break');
    if (eventRes?.error) problems.push(`the break end event was not logged (${eventRes.error.message})`);
    if (problems.length) {
      return { data: updatedBreak, error: new Error(`Your break was ended, but ${problems.join('; ')}. Please refresh the page; if the totals look wrong, contact an administrator.`), auditLogged };
    }
    return { data: updatedBreak, error: null, auditLogged };
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

      const totalsError = await saveTotalsAfterAdminChange(attendanceId);

      await logBreakAudit({
        action: 'ADMIN_BREAK_ENDED',
        module: 'ATTENDANCE',
        entity_type: 'attendance_breaks',
        entity_id: breakId,
        description: `Admin ended break session. Duration: ${durationMinutes} minutes.`,
        new_values: { ended_at: nowIso, duration_minutes: durationMinutes }
      });

      await (supabase.from('attendance_events') as any).insert({
        attendance_id: attendanceId,
        employee_id: bRecord.employee_id,
        event_type: 'BREAK_END',
        event_at: nowIso,
        source: 'ADMIN',
        metadata: { break_id: breakId, admin_action: true }
      });

      if (totalsError) {
        return { data: updatedBreak, error: new Error(`Break ended, but the attendance break total could not be updated (${totalsError}). Refresh and check before payroll.`) };
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
      const { data: bRecord, error: fetchErr } = await supabase
        .from('attendance_breaks')
        .select('*')
        .eq('id', breakId)
        .maybeSingle() as any;

      if (fetchErr) return { success: false, error: new Error(`The break could not be loaded (${fetchErr.message}). Nothing was changed.`) };
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

      const totalsError = await saveTotalsAfterAdminChange(attendanceId);

      await logBreakAudit({
        action: 'ADMIN_BREAK_DELETED',
        module: 'ATTENDANCE',
        entity_type: 'attendance_breaks',
        entity_id: breakId,
        description: `Admin discarded break session for employee ${bRecord.employee_id}.`,
        old_values: bRecord
      });

      await (supabase.from('attendance_events') as any).insert({
        attendance_id: attendanceId,
        employee_id: bRecord.employee_id,
        event_type: 'BREAK_CANCELLED',
        event_at: new Date().toISOString(),
        source: 'ADMIN',
        metadata: { discarded_break_id: breakId }
      });

      if (totalsError) {
        return { success: true, error: new Error(`Session discarded, but the attendance break total could not be updated (${totalsError}). Refresh and check before payroll.`) };
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
        shift_template:shift_template_id(name, break_duration_minutes, crosses_midnight),
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
  /**
   * @param loadTracking true for the company's current day, and for yesterday (an overnight shift can
   *   still be open after midnight); live locations and failed location checks are loaded only then.
   */
  async getBreakReportContext(dateStr: string, loadTracking: boolean): Promise<{
    employees: any[] | null; liveLocations: any[] | null; locationProblems: any[] | null; breakEndEvents: any[] | null; trackingStates: any[] | null; errors: string[];
  }> {
    const dayStartMs = new Date(`${dateStr}T00:00:00+05:30`).getTime();
    const dayStartIso = new Date(dayStartMs).toISOString();
    const none = Promise.resolve({ data: null, error: null } as any);
    const [employees, live, problems, endEvents, states] = await Promise.all([
      supabase.from('employees').select('id, employee_code, first_name, last_name, status, joining_date, departments(name), role:role_id(name)') as any,
      // updated_at = server time of the last write (trigger), used with last_seen_at for freshness
      loadTracking ? supabase.from('employee_live_locations').select('employee_id, location_status, location_context, last_seen_at, updated_at') as any : none,
      loadTracking
        ? (supabase.from('location_verification_events') as any)
            .select('employee_id, result, verified_at, failure_reason')
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
      // Server-maintained tracking state (automatic breaks): today / open overnight shift only
      loadTracking
        ? (supabase.from('employee_tracking_state') as any)
            .select('employee_id, attendance_id, state, state_since, work_mode, last_fresh_fix_at, last_contact_at, last_problem, last_problem_at, last_reconnect_at, reported_offline_seconds, open_auto_break_id')
        : none,
    ]);
    const errors: string[] = [];
    if (employees.error) errors.push(`Employee list could not be loaded (${employees.error.message}); employees without attendance are not listed.`);
    if (live.error) errors.push(`Location tracking status could not be loaded (${live.error.message}).`);
    if (problems.error) errors.push(`Location problems could not be loaded (${problems.error.message}).`);
    if (endEvents.error) errors.push(`Break end details could not be loaded (${endEvents.error.message}); returns after a tracking gap are not flagged.`);
    if (states?.error) errors.push(`Server tracking status could not be loaded (${states.error.message}).`);
    // Supabase returns at most 1000 rows per request by default: a full page may be a truncated list
    if (!employees.error && (employees.data || []).length >= 1000) errors.push('The employee list reached the 1000-row API limit and may be incomplete.');
    return {
      employees: employees.error ? null : (employees.data || []),
      liveLocations: !loadTracking || live.error ? null : (live.data || []),
      locationProblems: !loadTracking || problems.error ? null : (problems.data || []),
      breakEndEvents: endEvents.error ? null : (endEvents.data || []),
      trackingStates: !loadTracking || states?.error ? null : (states?.data || []),
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
   * Automatic break on a confirmed GPS geofence exit / return (AUTO_GPS).
   * The inside/outside decision is made on this device (debounced, stored in employee_live_locations);
   * the break itself is created / closed by the database function geofence_auto_break with database
   * time, server-side checks (open attendance incl. overnight shifts, WFH incl. roster WFH, shift end,
   * one open break) and the employee notification. Never clocks the employee out.
   * The device transition time is only used to drop delayed / fabricated readings, never as break time.
   */
  async handleAutoBreakTransition(
    empId: string, transition: 'START' | 'END', timestamp: string,
    opts: { isWfhContext?: boolean; trackingGap?: { lastSeenAt: string } } = {},
  ): Promise<AutoBreakTransitionResult> {
    void empId; // the server identifies the employee from the session
    const transitionMs = new Date(timestamp).getTime();
    if (!Number.isFinite(transitionMs)) return { action: 'ERROR', reason: 'INVALID_TRANSITION_TIME' };
    if (!qaTimeService.isEnabled && !isReadingTimeAcceptable(transitionMs, Date.now())) {
      return { action: 'ERROR', reason: 'TRANSITION_TIME_OUT_OF_WINDOW' };
    }
    if (transition === 'START' && opts.isWfhContext) return { action: 'NONE', reason: 'WFH' };
    try {
      const { data, error } = await (supabase as any).rpc('geofence_auto_break', {
        p_transition: transition,
        p_tracking_gap_last_seen: opts.trackingGap?.lastSeenAt ?? null,
      });
      if (error) return { action: 'ERROR', reason: `SERVER_REFUSED: ${error.message}` };
      return mapAutoBreakResult(data);
    } catch (e: any) {
      return { action: 'ERROR', reason: `SERVER_UNREACHABLE: ${e?.message || e}` };
    }
  },

  /**
   * Correct an erroneous automatic break created by a false tracking incident.
   * Cancels the break, zeroes duration, recalculates attendance totals, and logs an audit trail.
   *
   * Security & Scope Controls:
   * 1. Requires authenticated session.
   * 2. Authoritative role check against profiles and roles table (ADMIN or HR only).
   * 3. Requires non-empty, trimmed correctionReason.
   * 4. Enforces scope: breakId must match attendanceId.
   * 5. Restricts eligible break types to AUTO_TRACKING or AUTO_GPS (prevents cancelling regular breaks).
   * 6. Preserves audit trail and attendance total recalculation.
   */
  async correctTrackingEnforcementBreak(params: {
    breakId: string;
    attendanceId: string;
    correctionReason: string;
  }): Promise<{ success: boolean; error: Error | null; auditLogged?: boolean }> {
    try {
      // 1. Validate inputs
      const reason = typeof params.correctionReason === 'string' ? params.correctionReason.trim() : '';
      if (!reason) {
        return { success: false, error: new Error('A valid, non-empty correction reason is required.') };
      }
      if (!params.breakId || !params.attendanceId) {
        return { success: false, error: new Error('Break ID and Attendance ID are required.') };
      }

      // 2. Authoritative caller authentication and role verification
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) {
        return { success: false, error: new Error('Unauthorized: Authentication required.') };
      }

      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('role_id, is_active, employee_id')
        .eq('auth_user_id', authData.user.id)
        .maybeSingle() as any;

      if (profileErr || !profile || !profile.is_active || !profile.role_id) {
        return { success: false, error: new Error('Unauthorized: Unable to verify caller identity or inactive account.') };
      }

      const { data: roleData, error: roleErr } = await supabase
        .from('roles')
        .select('name')
        .eq('id', profile.role_id)
        .maybeSingle() as any;

      const roleName = roleData?.name || '';
      if (roleErr || !isAdminPortalRole(roleName)) {
        return { success: false, error: new Error('Forbidden: Only Admin or HR roles are authorized to correct breaks.') };
      }

      // 3. Load break and verify scope (breakId + attendanceId)
      const { data: bRecord, error: fetchErr } = await supabase
        .from('attendance_breaks')
        .select('*')
        .eq('id', params.breakId)
        .eq('attendance_id', params.attendanceId)
        .maybeSingle() as any;

      if (fetchErr) return { success: false, error: new Error(`Could not load break: ${fetchErr.message}`) };
      if (!bRecord) return { success: false, error: new Error('Break record not found for the specified attendance.') };

      // 4. Prevent correction of unrelated break types (REGULAR, LUNCH, TEA, PERSONAL)
      const ELIGIBLE_BREAK_TYPES = ['AUTO_TRACKING', 'AUTO_GPS'];
      if (!ELIGIBLE_BREAK_TYPES.includes(bRecord.break_type)) {
        return {
          success: false,
          error: new Error(`Cannot correct break with type '${bRecord.break_type}'. Only automatic tracking breaks can be corrected.`),
        };
      }

      // If trusted database RPC function exists, prefer database-level execution
      if (typeof (supabase as any).rpc === 'function') {
        try {
          const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)('correct_tracking_enforcement_break', {
            p_break_id: params.breakId,
            p_attendance_id: params.attendanceId,
            p_reason: reason,
          });
          if (!rpcErr && rpcData?.success) {
            const totalsError = await saveTotalsAfterAdminChange(params.attendanceId);
            const auditLogged = await logBreakAudit({
              action: 'TRACKING_BREAK_CORRECTED',
              module: 'ATTENDANCE',
              entity_type: 'attendance_breaks',
              entity_id: params.breakId,
              description: `Erroneous tracking enforcement break corrected by ${roleName}. Reason: ${reason}`,
              old_values: bRecord,
              new_values: { break_type: 'CANCELLED', duration_minutes: 0 },
            });
            if (totalsError) {
              return { success: true, error: new Error(`Break corrected via RPC, but totals update reported: ${totalsError}`), auditLogged };
            }
            return { success: true, error: null, auditLogged };
          }
        } catch {
          // Graceful fallback to application update if RPC is unavailable in current DB
        }
      }

      // 5. Update to CANCELLED with 0 duration
      const { data: updatedRows, error: updateErr } = await (supabase.from('attendance_breaks') as any)
        .update({
          break_type: 'CANCELLED',
          duration_minutes: 0,
          ended_at: bRecord.started_at,
        })
        .eq('id', params.breakId)
        .select('id');

      if (updateErr || !updatedRows || updatedRows.length === 0) {
        return { success: false, error: new Error(`Failed to correct break: ${updateErr?.message || 'Record locked or updated'}`) };
      }

      // 6. Reconcile attendance totals
      const totalsError = await saveTotalsAfterAdminChange(params.attendanceId);

      // 7. Audit logging
      const auditLogged = await logBreakAudit({
        action: 'TRACKING_BREAK_CORRECTED',
        module: 'ATTENDANCE',
        entity_type: 'attendance_breaks',
        entity_id: params.breakId,
        description: `Erroneous tracking enforcement break corrected by ${roleName}. Reason: ${reason}`,
        old_values: bRecord,
        new_values: { break_type: 'CANCELLED', duration_minutes: 0 },
      });

      // 8. Attendance event
      await (supabase.from('attendance_events') as any).insert({
        attendance_id: params.attendanceId,
        employee_id: bRecord.employee_id,
        event_type: 'BREAK_CORRECTION',
        event_at: new Date().toISOString(),
        source: 'ADMIN',
        metadata: {
          break_id: params.breakId,
          correction_reason: reason,
          original_break_type: bRecord.break_type,
          corrected_by_role: roleName,
        },
      });

      if (totalsError) {
        return { success: true, error: new Error(`Break corrected, but totals update reported: ${totalsError}`), auditLogged };
      }

      return { success: true, error: null, auditLogged };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }
};
