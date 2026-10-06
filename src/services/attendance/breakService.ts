import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';
import { attendanceService } from './attendanceService';
import { auditService } from '../audit/auditService';

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
    const allowedBreakMins = attendanceData?.shift_template?.break_duration_minutes ?? globalSettings.app.breakDurationMins ?? 60;

    const { data: pastBreaks } = await supabase.from('attendance_breaks').select('duration_minutes').eq('attendance_id', attendanceId);
    let usedMins = 0;
    if (pastBreaks) {
      pastBreaks.forEach((b: any) => usedMins += (b.duration_minutes || 0));
    }
    
    if (usedMins >= allowedBreakMins) {
      return { data: null, error: new Error('You have already exhausted your allowed break duration for today.') };
    }

    const nowIso = new Date().toISOString();

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

    const nowIso = new Date().toISOString();
    const startIso = new Date(activeBreak.started_at).getTime();
    const endMs = new Date(nowIso).getTime();
    const durationMinutes = Math.floor((endMs - startIso) / (1000 * 60));

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

    // 3. Update attendance total break minutes and status
    const { data: attendanceInfo } = await supabase
      .from('attendance')
      .select('break_minutes')
      .eq('id', attendanceId)
      .single() as any;
      
    const totalBreaks = (attendanceInfo?.break_minutes || 0) + durationMinutes;

    // @ts-ignore
    await supabase.from('attendance').update({ 
      status: 'WORKING',
      break_minutes: totalBreaks
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
  }
};
