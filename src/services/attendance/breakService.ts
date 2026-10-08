import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';
import { attendanceService } from './attendanceService';
import { auditService } from '../audit/auditService';
import { qaTimeService } from '../qa/qaTimeService';
import { breakDurationMinutes, completedBreakMinutes, computeBreakOverrun, resolveAllowedBreakMinutes } from './breakRules';

const companyDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * Recalculate attendance.break_minutes and break_overrun_minutes from the stored breaks.
 * Allowed minutes = shift break_duration_minutes, else Admin setting (no hard-coded default).
 */
async function recalculateBreakTotals(attendanceId: string) {
  const [{ data: att }, { data: breaks }, { globalSettingsService }] = await Promise.all([
    supabase.from('attendance').select('shift_template:shift_template_id(break_duration_minutes)').eq('id', attendanceId).single() as any,
    supabase.from('attendance_breaks').select('started_at, ended_at, duration_minutes').eq('attendance_id', attendanceId) as any,
    import('../settings/globalSettingsService'),
  ]);
  const settings = await globalSettingsService.loadSettings();
  const actual = completedBreakMinutes(breaks || []);
  const allowed = resolveAllowedBreakMinutes(att?.shift_template?.break_duration_minutes, settings.app.breakDurationMins);
  const overrun = computeBreakOverrun(actual, allowed, settings.payroll.enableBreakOverrunDetection);
  return { actual, allowed, overrun };
}

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

    // 2. Check if a break is already active
    const { data: activeBreak } = await supabase
      .from('attendance_breaks')
      .select('id')
      .eq('attendance_id', attendanceId)
      .is('ended_at', null)
      .maybeSingle() as any;

    if (activeBreak) {
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

    const { data: pastBreaks } = await supabase.from('attendance_breaks').select('duration_minutes').eq('attendance_id', attendanceId);
    let usedMins = 0;
    if (pastBreaks) {
      pastBreaks.forEach((b: any) => usedMins += (b.duration_minutes || 0));
    }
    
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

    if (error) return { data: null, error: new Error(error.message) };

    // Audit: BREAK_STARTED
    auditService.recordAuditLog({
      action: 'BREAK_STARTED',
      module: 'ATTENDANCE',
      entity_type: 'attendance_breaks',
      entity_id: (newBreak as any).id,
      description: `Employee started a ${breakType} break.`,
      new_values: { attendance_id: attendanceId, break_type: breakType, started_at: nowIso }
    }).catch(e => console.error('[AUDIT] BREAK_STARTED failed:', e));

    // Update Attendance status
    // @ts-ignore
    await supabase.from('attendance').update({ status: 'ON_BREAK' }).eq('id', attendanceId);

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
    const { data: activeBreak } = await supabase
      .from('attendance_breaks')
      .select('*')
      .eq('attendance_id', attendanceId)
      .eq('employee_id', empId)
      .is('ended_at', null)
      .maybeSingle() as any;

    if (!activeBreak) {
      return { data: null, error: new Error('No active break found.') };
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
      .select()
      .single() as any;

    if (error) return { data: null, error: new Error(error.message) };

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
    const totals = await recalculateBreakTotals(attendanceId);

    // @ts-ignore
    await supabase.from('attendance').update({ 
      status: 'WORKING',
      break_minutes: totals.actual,
      break_overrun_minutes: totals.overrun
    }).eq('id', attendanceId);

    // Add Event
    await supabase.from('attendance_events').insert({
      attendance_id: attendanceId,
      employee_id: empId,
      event_type: 'BREAK_END',
      event_at: nowIso,
      source: 'WEB'
    } as any);

    return { data: updatedBreak, error: null };
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
  async handleAutoBreakTransition(empId: string, transition: 'START' | 'END', timestamp: string, opts: { isWfhContext?: boolean } = {}) {
    const today = companyDate(new Date().toISOString());
    const yesterday = companyDate(new Date(Date.now() - 86400000).toISOString());

    // 1. Open attendance for today (or an overnight shift that started yesterday)
    const { data: attendance } = await supabase
      .from('attendance')
      .select('id, status, attendance_date, clock_in_at, clock_out_at, shift_template:shift_template_id(crosses_midnight)')
      .eq('employee_id', empId)
      .is('clock_out_at', null)
      .in('attendance_date', [today, yesterday])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as any;

    if (!attendance || !attendance.clock_in_at) return { action: 'NONE', reason: 'NOT_CLOCKED_IN' };
    if (attendance.attendance_date !== today && !attendance.shift_template?.crosses_midnight) return { action: 'NONE', reason: 'STALE_OPEN_ATTENDANCE' };

    // A transition before clock-in belongs to no attendance
    const atIso = new Date(Math.max(new Date(timestamp).getTime(), new Date(attendance.clock_in_at).getTime())).toISOString();

    const { data: activeBreak } = await supabase
      .from('attendance_breaks')
      .select('id, started_at, break_type')
      .eq('attendance_id', attendance.id)
      .is('ended_at', null)
      .maybeSingle() as any;

    if (transition === 'START') {
      if (activeBreak) return { action: 'NONE', reason: 'BREAK_ALREADY_ACTIVE' }; // no duplicate active breaks
      if (opts.isWfhContext) return { action: 'NONE', reason: 'WFH' };

      const { data: wfhData } = await supabase
        .from('wfh_requests')
        .select('id')
        .eq('employee_id', empId)
        .eq('request_date', attendance.attendance_date)
        .eq('status', 'APPROVED')
        .maybeSingle();
      if (wfhData) return { action: 'NONE', reason: 'WFH' };

      const { data: newBreak, error } = await supabase
        .from('attendance_breaks')
        .insert({ attendance_id: attendance.id, employee_id: empId, break_type: 'AUTO_GPS', started_at: atIso } as any)
        .select()
        .single();
      if (error || !newBreak) return { action: 'ERROR', reason: error?.message };

      // @ts-ignore
      await supabase.from('attendance').update({ status: 'ON_BREAK' } as any).eq('id', attendance.id);
      await supabase.from('attendance_events').insert({
        attendance_id: attendance.id, employee_id: empId, event_type: 'BREAK_START', event_at: atIso, source: 'SYSTEM',
        metadata: { trigger: 'GPS_GEOFENCE', break_type: 'AUTO_GPS', break_id: (newBreak as any).id },
      } as any);

      auditService.recordAuditLog({
        action: 'AUTOMATIC_BREAK_STARTED',
        module: 'ATTENDANCE',
        entity_type: 'attendance_breaks',
        entity_id: (newBreak as any).id,
        description: `Automatic GPS break started at ${new Date(atIso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}.`,
      }).catch(() => {});
      return { action: 'STARTED', breakId: (newBreak as any).id };
    }

    // END: only an automatic break is closed by returning inside (manual breaks are ended by the employee)
    if (!activeBreak || activeBreak.break_type !== 'AUTO_GPS') return { action: 'NONE', reason: 'NO_ACTIVE_AUTO_BREAK' };

    const endIso = new Date(Math.max(new Date(atIso).getTime(), new Date(activeBreak.started_at).getTime())).toISOString();
    const durationMinutes = breakDurationMinutes(activeBreak.started_at, endIso);

    const { data: updatedBreak, error } = await supabase
      .from('attendance_breaks')
      // @ts-ignore
      .update({ ended_at: endIso, duration_minutes: durationMinutes } as any)
      .eq('id', activeBreak.id)
      .is('ended_at', null)
      .select()
      .single();
    if (error || !updatedBreak) return { action: 'ERROR', reason: error?.message };

    const totals = await recalculateBreakTotals(attendance.id);
    // @ts-ignore
    await supabase.from('attendance').update({
      status: 'WORKING',
      break_minutes: totals.actual,
      break_overrun_minutes: totals.overrun,
    } as any).eq('id', attendance.id);
    await supabase.from('attendance_events').insert({
      attendance_id: attendance.id, employee_id: empId, event_type: 'BREAK_END', event_at: endIso, source: 'SYSTEM',
      metadata: { trigger: 'GPS_GEOFENCE', break_type: 'AUTO_GPS', break_id: activeBreak.id, duration_minutes: durationMinutes },
    } as any);

    auditService.recordAuditLog({
      action: 'AUTOMATIC_BREAK_ENDED',
      module: 'ATTENDANCE',
      entity_type: 'attendance_breaks',
      entity_id: activeBreak.id,
      description: `Automatic GPS break ended. Duration: ${durationMinutes}m.`,
    }).catch(() => {});
    if (totals.overrun > 0) {
      auditService.recordAuditLog({
        action: 'BREAK_OVERRUN_DETECTED',
        module: 'ATTENDANCE',
        entity_type: 'attendance',
        entity_id: attendance.id,
        description: `Break overrun detected: ${totals.overrun} minutes (allowed ${totals.allowed}, actual ${totals.actual}).`,
      }).catch(() => {});
    }
    return { action: 'ENDED', breakId: activeBreak.id, durationMinutes, ...totals };
  }
};
