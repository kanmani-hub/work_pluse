import { supabase } from '../../lib/supabase';
import { completedBreakMinutes, computeBreakOverrun, resolveAllowedBreakMinutes, findActiveBreak, closeActiveBreakAt, statusAfterBreakEnds } from './breakRules';
import { selectCurrentAttendance } from './currentAttendance';
import { companyDateStr, previousDateStr } from '../../utils/companyDate';
import type { Database } from '../../types/database';
import { auditService } from '../audit/auditService';
import { qaTimeService } from '../qa/qaTimeService';
import { resolveClockInSession, computeClockOutTotals } from './clockRules';
import { notificationService } from '../notifications/notificationService';
import { autoBreakClosedAtClockOut } from '../notifications/notificationRules';

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
   * The employee's CURRENT attendance: today's record (company date), or yesterday's overnight
   * session that is still open. Never "the latest record". See currentAttendance.ts.
   */
  async getCurrentAttendance(): Promise<{ data: AttendanceRow | null; error: Error | null; today: string }> {
    const today = companyDateStr();
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized'), today };

    const yesterday = previousDateStr(today);
    const { data, error } = await supabase
      .from('attendance')
      .select('*, shift_template:shift_template_id (*)')
      .eq('employee_id', empId)
      .in('attendance_date', [today, yesterday]);

    if (error) return { data: null, error: new Error(error.message), today };
    return { data: selectCurrentAttendance((data || []) as any[], today, yesterday) as any, error: null, today };
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

    // The business date is always the company date, never the caller's (possibly UTC) date
    const companyToday = companyDateStr();
    if (input.localDateStr !== companyToday) {
      console.warn(`[Attendance] clockIn received date ${input.localDateStr}; using company date ${companyToday}`);
    }
    input = { ...input, localDateStr: companyToday };

    // 1. Load today's and yesterday's rows (duplicate / open-overnight checks below)
    const { data: existingRows, error: existingErr } = await supabase
      .from('attendance')
      .select('id, attendance_date, clock_in_at, clock_out_at, shift_template:shift_template_id(crosses_midnight)')
      .eq('employee_id', empId)
      .in('attendance_date', [companyToday, previousDateStr(companyToday)]) as any;
    if (existingErr) return { data: null, error: new Error(existingErr.message) };

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
    const nowIso = now.toISOString();

    // Late + attendance date from the assigned shift (shift start + Admin Settings grace).
    // An overnight shift clocked into after midnight belongs to the shift that started yesterday.
    const session = resolveClockInSession({
      nowMs: now.getTime(),
      today: companyToday,
      shift: {
        start_time: shiftStartStr,
        end_time: shiftAssignments?.shift_template?.end_time ?? null,
        crosses_midnight: !!shiftAssignments?.shift_template?.crosses_midnight,
      },
      graceMinutes: finalGracePeriod,
      timeZone: timezone,
    });
    const attendanceDate = session.attendanceDate;
    lateMinutes = session.lateMinutes;
    input = { ...input, localDateStr: attendanceDate };

    // 3. Never a second record for the same shift date, and never while an overnight session is open
    const existing = (existingRows || []).find((r: any) => r.attendance_date === attendanceDate);
    const openOvernight = selectCurrentAttendance(existingRows || [], companyToday, previousDateStr(companyToday));
    if (openOvernight && openOvernight.attendance_date !== attendanceDate) {
      return { data: null, error: new Error('You are still clocked in to your overnight shift. Clock out of it first.') };
    }
    if (existing) {
      return { data: null, error: new Error('Attendance already exists for today.') };
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

    if (error) {
      // unique_attendance_per_day (employee_id, attendance_date): a second click / tab got there first
      if ((error as any).code === '23505') return { data: null, error: new Error('Attendance already exists for today.') };
      return { data: null, error: new Error(error.message) };
    }

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
    // Whether a break blocks clock-out is decided from the actual break rows below
    // (a stale ON_BREAK status alone must not block it).

    const { globalSettingsService } = await import('../settings/globalSettingsService');
    const globalSettings = await globalSettingsService.loadSettings();

    const nowIso = qaTimeService.getIsoString();
    
    const inTime = new Date(existing.clock_in_at!).getTime();
    const outTime = new Date(nowIso).getTime();
    
    // Fetch Break durations to calculate actual break minutes accurately
    const { data: breakRows, error: breaksErr } = await supabase
      .from('attendance_breaks')
      .select('*')
      .eq('attendance_id', attendanceId) as any;
    if (breaksErr) return { data: null, error: new Error(breaksErr.message) };
    let breaks: any[] = breakRows || [];

    // An active MANUAL break must be ended by the employee first (existing rule).
    // An active AUTOMATIC (GPS) break is closed at the clock-out time: the employee does not
    // have to walk back into the office just to clock out, and no break stays open afterwards.
    const activeBreak = findActiveBreak(breaks);
    if (activeBreak && activeBreak.break_type !== 'AUTO_GPS') {
      return { data: null, error: new Error('Please end your active break before clocking out.') };
    }
    let closedAutoBreak: any = null;
    if (activeBreak) {
      const { breaks: withClosed, closed } = closeActiveBreakAt(breaks, nowIso);
      const { data: closedRow, error: closeErr } = await (supabase.from('attendance_breaks') as any)
        .update({ ended_at: closed!.ended_at, duration_minutes: closed!.duration_minutes })
        .eq('id', activeBreak.id)
        .is('ended_at', null) // only if still open (the return-to-office transition may have just closed it)
        .select()
        .maybeSingle();
      if (closeErr) return { data: null, error: new Error(closeErr.message) };
      if (closedRow) {
        breaks = withClosed;
        closedAutoBreak = closed;
      } else {
        // Closed concurrently: use the stored end time
        const { data: fresh } = await supabase.from('attendance_breaks').select('*').eq('attendance_id', attendanceId) as any;
        breaks = fresh || [];
        if (findActiveBreak(breaks)) return { data: null, error: new Error('Please try again.') };
      }
    }

    // Sum of the actual stored break durations (same rule as the break service and timers)
    const actualBreakMins = completedBreakMinutes(breaks);

    const requiredHours = existing.required_hours ?? 8;
    const allowedBreakMins = resolveAllowedBreakMinutes(existing.shift_template?.break_duration_minutes, globalSettings.app.breakDurationMins);
    
    // Fallback: never complete attendance with a break still open
    if (breaks.some((b: any) => !b.ended_at)) {
      return { data: null, error: new Error('Please end your active break before clocking out.') };
    }

    const breakOverrunMins = computeBreakOverrun(actualBreakMins, allowedBreakMins, globalSettings.payroll.enableBreakOverrunDetection);

    // Worked = elapsed - completed breaks; half day < 50% of required (see clockRules).
    // Extra time is NOT overtime: overtime only exists once an employee request is approved
    // by an admin, so it is never written automatically (payroll pays overtime_minutes).
    const totals = computeClockOutTotals({ clockInMs: inTime, clockOutMs: outTime, breakMinutes: actualBreakMins, requiredHours });
    const effectiveWorkedHrs = totals.workedHours;
    const effectiveWorkedMins = totals.workedMinutes;
    const earlyLogoutMins = totals.earlyLogoutMinutes;
    const overtimeMins = totals.overtimeMinutes; // always 0 until approved overtime exists
    const extraMins = totals.extraMinutes;
    const status = totals.status;
    const isHalfDay = totals.isHalfDay;

    // @ts-ignore
    const { data: updated, error } = await (supabase.from('attendance') as any)
      .update({
        clock_out_at: nowIso,
        worked_hours: effectiveWorkedHrs,
        break_minutes: actualBreakMins,
        break_overrun_minutes: breakOverrunMins,
        early_logout_minutes: earlyLogoutMins,
        overtime_minutes: overtimeMins,
        is_half_day: isHalfDay,
        status: status
      } as any)
      .eq('id', attendanceId)
      .eq('employee_id', empId)
      .is('clock_out_at', null) // a second click / tab cannot overwrite an existing clock-out
      .select()
      .maybeSingle() as any;

    if (error || !updated) {
      if (error && closedAutoBreak) {
        // The automatic break was closed but the clock-out could not be saved: the employee is
        // still clocked in and no longer on a break, so do not leave a stale ON_BREAK status.
        await (supabase.from('attendance') as any)
          .update({ status: statusAfterBreakEnds(existing) })
          .eq('id', attendanceId)
          .is('clock_out_at', null);
      }
      if (error) return { data: null, error: new Error(error.message) };
      return { data: null, error: new Error('Attendance is already completed.') };
    }

    // Audit: CLOCK_OUT
    auditService.recordAuditLog({
      action: 'CLOCK_OUT',
      module: 'ATTENDANCE',
      entity_type: 'attendance',
      entity_id: attendanceId,
      description: `Employee clocked out. Status: ${status}. Worked: ${effectiveWorkedMins}m. Extra time (not overtime): ${extraMins}m. Early logout: ${earlyLogoutMins}m.`,
      new_values: { status, worked_minutes: effectiveWorkedMins, break_minutes: actualBreakMins, overtime_minutes: overtimeMins }
    }).catch(e => console.error('[AUDIT] CLOCK_OUT failed:', e));

    if (closedAutoBreak) {
      // The automatic break ended because the employee clocked out (logged once: only the
      // request that actually closed the break gets here)
      await supabase.from('attendance_events').insert({
        attendance_id: attendanceId,
        employee_id: empId,
        event_type: 'BREAK_END',
        event_at: closedAutoBreak.ended_at,
        source: 'SYSTEM',
        metadata: { trigger: 'CLOCK_OUT', break_type: 'AUTO_GPS', break_id: closedAutoBreak.id, duration_minutes: closedAutoBreak.duration_minutes },
      } as any);
      auditService.recordAuditLog({
        action: 'AUTOMATIC_BREAK_ENDED',
        module: 'ATTENDANCE',
        entity_type: 'attendance_breaks',
        entity_id: closedAutoBreak.id,
        description: `Automatic GPS break closed at clock-out. Duration: ${closedAutoBreak.duration_minutes}m.`,
      }).catch(e => console.error('[AUDIT] AUTOMATIC_BREAK_ENDED failed:', e));
      await notificationService.notifyEmployee(empId, autoBreakClosedAtClockOut({ breakId: closedAutoBreak.id, attendanceId }));
    }

    // @ts-ignore
    await supabase.from('attendance_events').insert({
      attendance_id: attendanceId,
      employee_id: empId,
      event_type: 'CLOCK_OUT',
      event_at: nowIso,
      source: 'WEB',
      ...(closedAutoBreak ? { metadata: { during_auto_break: true } } : {}),
    } as any);

    return { data: updated, error: null };
  }
};
