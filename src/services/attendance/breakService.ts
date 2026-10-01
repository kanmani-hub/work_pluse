import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';
import { attendanceService } from './attendanceService';

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
      .select('status, id')
      .eq('id', attendanceId)
      .eq('employee_id', empId)
      .single() as any;
      
    if (!attendance) {
      return { data: null, error: new Error('Attendance record not found.') };
    }
    if (attendance.status !== 'WORKING' && attendance.status !== 'ON_BREAK') {
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
  }
};
