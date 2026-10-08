import { supabase } from '../../lib/supabase';
import { completedBreakMinutes, computeBreakOverrun, resolveAllowedBreakMinutes } from './breakRules';
import type { Database } from '../../types/database';
import { auditService } from '../audit/auditService';
import { qaTimeService } from '../qa/qaTimeService';

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
          ),
          shift_templates (name, start_time, end_time, crosses_midnight)
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

    const { globalSettingsService } = await import('../settings/globalSettingsService');
    const globalSettings = await globalSettingsService.loadSettings();
    const settings = globalSettings.app;
    // Prefer global settings grace period, fallback to shift template if needed
    const globalGracePeriod = settings.gracePeriodMins ?? 0;
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

    // 2. Resolve applicable shift
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
    let shiftGracePeriod = globalGracePeriod;

    if (shiftAssignments && shiftAssignments.shift_template) {
      const st = shiftAssignments.shift_template as any;
      shiftTemplateId = st.id;
      requiredHours = st.required_hours ?? 8;
      if (st.start_time) shiftStartStr = st.start_time;
      if (st.grace_period_minutes !== undefined) shiftGracePeriod = st.grace_period_minutes; // could override if we want, but user said admin settings
    }
    
    // User requested: "The grace-period behavior must come from Admin Settings"
    const finalGracePeriod = globalGracePeriod;

    if (!shiftTemplateId) {
      return { data: null, error: new Error('No shift assigned for today.') };
    }

    const now = qaTimeService.getDate();
    const nowIso = qaTimeService.getIsoString();

    if (shiftTemplateId) {
      // Calculate late based on shift start + grace
      const nowInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const [hrs, mins, secs = 0] = shiftStartStr.split(':').map(Number);
      
      const shiftStartInTz = new Date(nowInTz);
      shiftStartInTz.setHours(hrs, mins, secs, 0);
      
      const allowedStartInTz = new Date(shiftStartInTz.getTime() + finalGracePeriod * 60000);
      
      if (nowInTz > allowedStartInTz) {
        lateMinutes = Math.floor((nowInTz.getTime() - shiftStartInTz.getTime()) / 60000);
      }
    }

    const initialStatus = lateMinutes > 0 ? 'LATE' : 'WORKING';

    // 3. Create Attendance
    // @ts-ignore
    const { data: newAttendance, error } = await supabase
      .from('attendance')
      .insert({
        employee_id: empId,
        shift_template_id: shiftTemplateId,
        attendance_date: input.localDateStr,
        clock_in_at: nowIso,
        required_hours: requiredHours,
        status: initialStatus,
        break_minutes: 0,
        late_minutes: lateMinutes,
        early_logout_minutes: 0,
        break_overrun_minutes: 0,
        overtime_minutes: 0,
        absence_minutes: 0,
        is_half_day: false,
        is_auto_logged_out: false
      } as any)
      .select()
      .single();

    if (error) return { data: null, error: new Error(error.message) };

    // Audit: CLOCK_IN
    auditService.recordAuditLog({
      action: 'CLOCK_IN',
      module: 'ATTENDANCE',
      entity_type: 'attendance',
      entity_id: (newAttendance as any).id,
      description: `Employee clocked in at ${now.toLocaleTimeString('en-IN')}. Status: ${initialStatus}. Late minutes: ${lateMinutes}.`,
      new_values: { status: initialStatus, late_minutes: lateMinutes, date: input.localDateStr }
    }).catch(e => console.error('[AUDIT] CLOCK_IN failed:', e));

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

    return { data: newAttendance as any, error: null };
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
      .select('*, shift_template:shift_template_id(*)')
      .eq('id', attendanceId)
      .eq('employee_id', empId)
      .single() as any;

    if (!existing) {
      return { data: null, error: new Error('No active attendance exists.') };
    }
    if (existing.status === 'COMPLETED' || existing.clock_out_at) {
      return { data: null, error: new Error('Attendance is already completed.') };
    }
    if (existing.status === 'ON_BREAK') {
      return { data: null, error: new Error('Please end your active break before clocking out.') };
    }

    const { globalSettingsService } = await import('../settings/globalSettingsService');
    const globalSettings = await globalSettingsService.loadSettings();

    const nowIso = qaTimeService.getIsoString();
    
    const inTime = new Date(existing.clock_in_at!).getTime();
    const outTime = new Date(nowIso).getTime();
    const totalDurationHrs = (outTime - inTime) / (1000 * 60 * 60);
    
    // Fetch Break durations to calculate actual break minutes accurately
    const { data: breaks } = await supabase
      .from('attendance_breaks')
      .select('*')
      .eq('attendance_id', attendanceId) as any;

    // Sum of the actual stored break durations (same rule as the break service and timers)
    const actualBreakMins = completedBreakMinutes(breaks || []);

    const requiredHours = existing.required_hours ?? 8;
    const allowedBreakMins = resolveAllowedBreakMinutes(existing.shift_template?.break_duration_minutes, globalSettings.app.breakDurationMins);
    
    // Prevent clock out if any break is still active (fallback check)
    if (breaks?.some((b: any) => b.ended_at === null)) {
      return { data: null, error: new Error('Please end your active break before clocking out.') };
    }

    const breakOverrunMins = computeBreakOverrun(actualBreakMins, allowedBreakMins, globalSettings.payroll.enableBreakOverrunDetection);

    // Calculate effective working hours
    const actualBreakHrs = actualBreakMins / 60;
    const effectiveWorkedHrs = Math.max(0, totalDurationHrs - actualBreakHrs);

    // Calculate Early Logout / Overtime
    let earlyLogoutMins = 0;
    let overtimeMins = 0;
    const effectiveWorkedMins = Math.floor(effectiveWorkedHrs * 60);
    const requiredMins = Math.floor(requiredHours * 60);

    if (effectiveWorkedMins < requiredMins) {
      earlyLogoutMins = requiredMins - effectiveWorkedMins;
    } else if (effectiveWorkedMins > requiredMins) {
      overtimeMins = effectiveWorkedMins - requiredMins;
    }

    // Determine status
    let status = 'COMPLETED';
    let isHalfDay = false;
    
    if (effectiveWorkedMins < requiredMins * 0.5) {
      // Worked less than half of required shift
      isHalfDay = true;
      status = 'HALF_DAY';
    }

    // @ts-ignore
    const { data: updated, error } = await (supabase.from('attendance') as any)
      .update({
        clock_out_at: nowIso,
        worked_hours: Number(effectiveWorkedHrs.toFixed(2)),
        break_minutes: actualBreakMins,
        break_overrun_minutes: breakOverrunMins,
        early_logout_minutes: earlyLogoutMins,
        overtime_minutes: overtimeMins,
        is_half_day: isHalfDay,
        status: status
      } as any)
      .eq('id', attendanceId)
      .select()
      .single() as any;

    if (error) return { data: null, error: new Error(error.message) };

    // Audit: CLOCK_OUT
    auditService.recordAuditLog({
      action: 'CLOCK_OUT',
      module: 'ATTENDANCE',
      entity_type: 'attendance',
      entity_id: attendanceId,
      description: `Employee clocked out. Status: ${status}. Worked: ${effectiveWorkedMins}m. Overtime: ${overtimeMins}m. Early logout: ${earlyLogoutMins}m.`,
      new_values: { status, worked_minutes: effectiveWorkedMins, break_minutes: actualBreakMins, overtime_minutes: overtimeMins }
    }).catch(e => console.error('[AUDIT] CLOCK_OUT failed:', e));

    // @ts-ignore
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
