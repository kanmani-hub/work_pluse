import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';

export type AttendanceRow = Database['public']['Tables']['attendance']['Row'];
export type AttendanceInsert = Database['public']['Tables']['attendance']['Insert'];
export type AttendanceUpdate = Database['public']['Tables']['attendance']['Update'];

export type ShiftTemplateRow = Database['public']['Tables']['shift_templates']['Row'];

export const attendanceService = {
  /**
   * Admin: Get all attendance records (with employee info)
   */
  async getAllAttendance(date?: string) {
    try {
      let query = supabase
        .from('attendance')
        .select(`
          *,
          employees (
            first_name,
            last_name,
            employee_code,
            departments (name)
          )
        `)
        .order('attendance_date', { ascending: false });
        
      if (date) {
        query = query.eq('attendance_date', date);
      }
        
      const { data, error } = await query;

      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching all attendance:', error);
      return { data: null, error };
    }
  },
  /**
   * Helper to get the current authenticated employee ID.
   * Do not trust arbitrary employee_ids from the UI for employee self-service.
   */
  async getCurrentEmployeeId(): Promise<string | null> {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) return null;
    
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('employee_id')
      .eq('auth_user_id', authData.user.id)
      .single() as any;
      
    if (profErr || !profile?.employee_id) return null;
    return profile.employee_id;
  },

  /**
   * Get all attendance for the authenticated employee.
   */
  async getMyAttendance(): Promise<{ data: AttendanceRow[] | null; error: Error | null }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('attendance')
      .select(`
        *,
        shift_template:shift_template_id (*)
      `)
      .eq('employee_id', empId)
      .order('attendance_date', { ascending: false });

    if (error) return { data: null, error: new Error(error.message) };
    return { data: data as any, error: null };
  },

  /**
   * Get today's attendance for the authenticated employee based on local date string.
   * e.g., '2026-09-27'
   */
  async getTodayAttendance(localDateStr: string): Promise<{ data: AttendanceRow | null; error: Error | null }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('attendance')
      .select('*, shift_template:shift_template_id (*)')
      .eq('employee_id', empId)
      .eq('attendance_date', localDateStr)
      .maybeSingle();

    if (error) return { data: null, error: new Error(error.message) };
    return { data: data as any, error: null };
  },

  /**
   * Get the current assigned shift for the authenticated employee
   */
  async getCurrentShift(localDateStr: string): Promise<{ data: any | null; error: Error | null }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data: shiftAssignments } = await supabase
      .from('shift_assignments')
      .select('*, shift_template:shift_templates(*)')
      .eq('employee_id', empId)
      .lte('effective_date', localDateStr)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle() as any;

    if (shiftAssignments && shiftAssignments.shift_template) {
      return { data: shiftAssignments.shift_template, error: null };
    }
    
    return { data: null, error: null };
  },

  /**
   * Clock in
   */
  async clockIn(input: {
    localDateStr: string;
    locationVerificationId?: string;
    faceVerificationEventId?: string;
  }): Promise<{ data: AttendanceRow | null; error: Error | null }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { appSettingsService } = await import('../settings/appSettingsService');
    const settings = appSettingsService.getSettings();
    const gracePeriod = settings.gracePeriodMins || 0;
    const timezone = settings.timezone === 'UTC' ? 'UTC' : 'Asia/Kolkata';

    // 1. Check if attendance already exists for today
    const { data: existing } = await supabase
      .from('attendance')
      .select('id')
      .eq('employee_id', empId)
      .eq('attendance_date', input.localDateStr)
      .maybeSingle();

    if (existing) {
      return { data: null, error: new Error('Attendance already exists for today.') };
    }

    // 2. Resolve applicable shift (Simplified: get the first active shift_template for this mock, 
    // real logic would check roster_assignments or shift_assignments first)
    const { data: shiftAssignments } = await supabase
      .from('shift_assignments')
      .select('*, shift_template:shift_template_id(*)')
      .eq('employee_id', empId)
      .lte('effective_date', input.localDateStr)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle() as any;

    let shiftTemplateId: string | null = null;
    let requiredHours = 8;
    let lateMinutes = 0;
    let shiftStartStr = '09:00:00';

    if (shiftAssignments && shiftAssignments.shift_template) {
      const st = shiftAssignments.shift_template as any;
      shiftTemplateId = st.id;
      requiredHours = st.required_hours || 8;
      if (st.start_time) shiftStartStr = st.start_time;
    } else {
      // Fallback
      const { data: fallbackShift } = await supabase
        .from('shift_templates')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .single() as any;
      
      if (fallbackShift) {
        shiftTemplateId = fallbackShift.id;
        requiredHours = fallbackShift.required_hours;
        if (fallbackShift.start_time) shiftStartStr = fallbackShift.start_time;
      }
    }

    if (shiftTemplateId) {
      const now = new Date();
      const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const [hrs, mins, secs = 0] = shiftStartStr.split(':').map(Number);
      
      const shiftStartInTz = new Date(nowInTz);
      shiftStartInTz.setHours(hrs, mins, secs, 0);
      
      const allowedStartInTz = new Date(shiftStartInTz.getTime() + gracePeriod * 60000);
      
      if (nowInTz > allowedStartInTz) {
        lateMinutes = Math.floor((nowInTz.getTime() - shiftStartInTz.getTime()) / 60000);
      }
    }

    if (!shiftTemplateId) {
      return { data: null, error: new Error('No active shift is assigned for today.') };
    }

    // 3. Create Attendance
    const nowIso = new Date().toISOString();
    
    // @ts-ignore
    const { data: newAttendance, error } = await supabase
      .from('attendance')
      .insert({
        employee_id: empId,
        shift_template_id: shiftTemplateId,
        attendance_date: input.localDateStr,
        clock_in_at: nowIso,
        required_hours: requiredHours,
        status: 'WORKING',
        break_minutes: 0,
        late_minutes: lateMinutes,
        early_logout_minutes: 0,
        is_half_day: false,
        is_auto_logged_out: false
      } as any)
      .select()
      .single();

    if (error) return { data: null, error: new Error(error.message) };

    // 4. Create Event
    // @ts-ignore
    await supabase.from('attendance_events').insert({
      attendance_id: (newAttendance as any).id,
      employee_id: empId,
      event_type: 'CLOCK_IN',
      event_at: nowIso,
      source: 'WEB',
      metadata: {
        locationVerificationId: input.locationVerificationId,
        faceVerificationEventId: input.faceVerificationEventId
      }
    } as any);

    return { data: newAttendance, error: null };
  },

  /**
   * Clock out
   */
  async clockOut(attendanceId: string): Promise<{ data: AttendanceRow | null; error: Error | null }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    // Check existing
    const { data: existing } = await supabase
      .from('attendance')
      .select('*')
      .eq('id', attendanceId)
      .eq('employee_id', empId)
      .single() as any;

    if (!existing) {
      return { data: null, error: new Error('No active attendance exists.') };
    }
    if (existing.status === 'COMPLETED' || existing.clock_out_at) {
      return { data: null, error: new Error('Attendance is already completed.') };
    }

    const nowIso = new Date().toISOString();
    
    // Calculate worked hours (roughly, for demonstration)
    const inTime = new Date(existing.clock_in_at!).getTime();
    const outTime = new Date(nowIso).getTime();
    let workedHrs = (outTime - inTime) / (1000 * 60 * 60);
    const breakHrs = (existing.break_minutes || 0) / 60;
    workedHrs = Math.max(0, workedHrs - breakHrs);

    // Determine status (could also be HALF_DAY etc based on rules)
    let status = 'COMPLETED';
    
    // @ts-ignore
    // @ts-ignore
    const { data: updated, error } = await (supabase.from('attendance') as any)
      .update({
        clock_out_at: nowIso,
        worked_hours: Number(workedHrs.toFixed(2)),
        status: status
      } as any)
      .eq('id', attendanceId)
      .select()
      .single() as any;

    if (error) return { data: null, error: new Error(error.message) };

    await supabase.from('attendance_events').insert({
      attendance_id: attendanceId,
      employee_id: empId,
      event_type: 'CLOCK_OUT',
      event_at: nowIso,
      source: 'WEB'
    } as any);

    return { data: updated, error: null };
  }
};
