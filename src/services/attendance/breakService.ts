import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';
import { attendanceService } from './attendanceService';
import { auditService } from '../audit/auditService';
import { qaTimeService } from '../qa/qaTimeService';

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
   * Handle automatic break transitions based on GPS geofence exits/entries
   */
  async handleAutoBreakTransition(empId: string, transition: 'START' | 'END', timestamp: string) {
    // 1. Get active attendance for today
    const { data: attendance } = await supabase
      .from('attendance')
      .select('id, status, clock_out_at, break_minutes')
      .eq('employee_id', empId)
      .is('clock_out_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as any;

    if (!attendance) return; // Not working

    if (transition === 'START') {
      if (attendance.status === 'ON_BREAK') return; // Already on break
      
      // Check if WFH (no auto breaks for WFH)
      const localDateStr = new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const { data: wfhData } = await supabase
        .from('wfh_requests')
        .select('id')
        .eq('employee_id', empId)
        .eq('request_date', localDateStr)
        .eq('status', 'APPROVED')
        .maybeSingle();
      if (wfhData) return;

      // Start automatic break
      const { data: newBreak } = await supabase
        .from('attendance_breaks')
        .insert({
          attendance_id: attendance.id,
          employee_id: empId,
          break_type: 'AUTO_GPS',
          started_at: timestamp
        } as any)
        .select()
        .single();
        
      if (newBreak) {
        // @ts-ignore
        await supabase.from('attendance').update({ status: 'ON_BREAK' } as any).eq('id', attendance.id);
        
        auditService.recordAuditLog({
          action: 'AUTOMATIC_BREAK_STARTED',
          module: 'ATTENDANCE',
          entity_type: 'attendance_breaks',
          entity_id: (newBreak as any).id,
          description: `Automatic GPS break started at ${new Date(timestamp).toLocaleTimeString('en-IN')}.`,
        }).catch(() => {});
      }
    } else if (transition === 'END') {
      if (attendance.status !== 'ON_BREAK') return; // Not on break
      
      const { data: activeBreak } = await supabase
        .from('attendance_breaks')
        .select('id, started_at')
        .eq('attendance_id', attendance.id)
        .is('ended_at', null)
        .maybeSingle() as any;
        
      if (!activeBreak) return;
      
      const startMs = new Date(activeBreak.started_at).getTime();
      const endMs = new Date(timestamp).getTime();
      const durationMinutes = Math.floor((endMs - startMs) / 60000);
      
      const { data: updatedBreak } = await supabase
        .from('attendance_breaks')
        // @ts-ignore
        .update({
          ended_at: timestamp,
          duration_minutes: durationMinutes
        } as any)
        .eq('id', activeBreak.id)
        .select()
        .single();
        
      if (updatedBreak) {
        // Calculate break overrun
        const { globalSettingsService } = await import('../settings/globalSettingsService');
        const globalSettings = await globalSettingsService.loadSettings();
        
        // Fetch Shift info to get allowed break
        const { data: attData } = await supabase
          .from('attendance')
          .select('shift_template:shift_template_id(break_duration_minutes)')
          .eq('id', attendance.id)
          .single() as any;
          
        const allowedBreakMins = attData?.shift_template?.break_duration_minutes ?? globalSettings.app.breakDurationMins ?? 75;
        
        // Get all breaks for this attendance to sum actual duration
        const { data: pastBreaks } = await supabase.from('attendance_breaks').select('duration_minutes').eq('attendance_id', attendance.id);
        let actualBreakMins = 0;
        if (pastBreaks) {
           pastBreaks.forEach((b: any) => actualBreakMins += (b.duration_minutes || 0));
        }
        
        let breakOverrunMins = 0;
        if (actualBreakMins > allowedBreakMins) {
           breakOverrunMins = actualBreakMins - allowedBreakMins;
        }

        // @ts-ignore
        await supabase.from('attendance').update({ 
          status: 'WORKING',
          break_minutes: actualBreakMins,
          break_overrun_minutes: breakOverrunMins
        } as any).eq('id', attendance.id);
        
        auditService.recordAuditLog({
          action: 'AUTOMATIC_BREAK_ENDED',
          module: 'ATTENDANCE',
          entity_type: 'attendance_breaks',
          entity_id: activeBreak.id,
          description: `Automatic GPS break ended. Duration: ${durationMinutes}m.`,
        }).catch(() => {});
        
        if (breakOverrunMins > 0) {
          auditService.recordAuditLog({
            action: 'BREAK_OVERRUN_DETECTED',
            module: 'ATTENDANCE',
            entity_type: 'attendance',
            entity_id: attendance.id,
            description: `Break overrun detected: ${breakOverrunMins} minutes.`,
          }).catch(() => {});
        }
      }
    }
  }
};
