import { supabase } from '../../lib/supabase';
import { completedBreakMinutes, computeBreakOverrun, resolveAllowedBreakMinutes, findActiveBreak, classifyOpenBreaks } from './breakRules';
import { isAutomaticBreak } from './automaticBreakRules';
import { logBreakAudit } from './breakAudit';
import { selectCurrentAttendance } from './currentAttendance';
import { companyDateStr, previousDateStr } from '../../utils/companyDate';
import type { Database } from '../../types/database';
import { auditService } from '../audit/auditService';
import { qaTimeService } from '../qa/qaTimeService';
import { resolveClockInSession, computeClockOutTotals } from './clockRules';

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
  _cachedEmpId: null as string | null,
  _cachedAuthUserId: null as string | null,
  /**
   * Helper to get the current authenticated employee ID.
   * Do not trust arbitrary employee_ids from the UI for employee self-service.
   */
  async getCurrentEmployeeId(): Promise<string | null> {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      this._cachedEmpId = null;
      this._cachedAuthUserId = null;
      return null;
    }
    if (this._cachedAuthUserId === authData.user.id && this._cachedEmpId) {
      return this._cachedEmpId;
    }
    
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('employee_id')
      .eq('auth_user_id', authData.user.id)
      .single() as any;
      
    if (profErr || !profile?.employee_id) return null;
    this._cachedAuthUserId = authData.user.id;
    this._cachedEmpId = profile.employee_id;
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
   * Resolve shift for an employee on a specific date.
   * Checks published roster assignment first (highest priority), then falls back to any active roster assignment, then shift_assignments.
   */
  async getShiftForDate(employeeId: string, localDateStr: string): Promise<{
    data: any | null;
    error: Error | null;
    isWeekOff?: boolean;
    source?: 'ROSTER' | 'PERMANENT' | 'NONE';
    rosterAssignmentId?: string | null;
  }> {
    try {
      // 1. Check roster_assignments for this date
      const { data: rosterRows, error: rosterErr } = await supabase
        .from('roster_assignments')
        .select('id, employee_id, assignment_date, day_type, work_mode, shift_template_id, shift_templates(*), rosters(id, status, start_date, end_date)')
        .eq('employee_id', employeeId)
        .eq('assignment_date', localDateStr);

      if (rosterErr) {
        console.error('[Attendance] error loading roster_assignments:', rosterErr.message);
        return { data: null, error: new Error(`Roster assignment query failed: ${rosterErr.message}`) };
      }

      const published: any = ((rosterRows as any[]) || []).find((r: any) =>
        String(r?.rosters?.status || r?.roster?.status || '').toUpperCase() === 'PUBLISHED'
      );

      if (published) {
        const isWeekOff = String(published.day_type || 'WORK').toUpperCase() === 'WEEK_OFF';
        if (isWeekOff) {
          return { data: null, isWeekOff: true, source: 'ROSTER', rosterAssignmentId: published.id, error: null };
        }
        const shiftTemplate = published.shift_templates || published.shift_template || null;
        if (shiftTemplate) {
          return {
            data: {
              ...shiftTemplate,
              work_mode: published.work_mode || 'OFFICE',
              roster_assignment_id: published.id,
            },
            isWeekOff: false,
            source: 'ROSTER',
            rosterAssignmentId: published.id,
            error: null,
          };
        }
      }

      // 2. Fallback to permanent shift_assignments
      const { data: saRows, error: saErr } = await supabase
        .from('shift_assignments')
        .select('id, employee_id, effective_date, end_date, shift_template_id, shift_templates(*)')
        .eq('employee_id', employeeId)
        .lte('effective_date', localDateStr)
        .or(`end_date.is.null,end_date.gte.${localDateStr}`)
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle() as any;

      if (saErr) {
        // Fallback relation check if needed
        const { data: fallbackRows, error: fallbackErr } = await supabase
          .from('shift_assignments')
          .select('id, employee_id, effective_date, end_date, shift_template_id, shift_template:shift_template_id(*)')
          .eq('employee_id', employeeId)
          .lte('effective_date', localDateStr)
          .or(`end_date.is.null,end_date.gte.${localDateStr}`)
          .order('effective_date', { ascending: false })
          .limit(1)
          .maybeSingle() as any;

        if (fallbackErr) {
          console.error('[Attendance] error loading shift_assignments:', fallbackErr.message);
          return { data: null, error: new Error(`Shift assignment query failed: ${fallbackErr.message}`) };
        }
        if (fallbackRows && (!fallbackRows.end_date || fallbackRows.end_date >= localDateStr) && fallbackRows.shift_template) {
          return { data: { ...fallbackRows.shift_template, work_mode: 'OFFICE' }, isWeekOff: false, source: 'PERMANENT', error: null };
        }
      } else if (saRows && (!saRows.end_date || saRows.end_date >= localDateStr) && saRows.shift_templates) {
        return { data: { ...saRows.shift_templates, work_mode: 'OFFICE' }, isWeekOff: false, source: 'PERMANENT', error: null };
      }

      return { data: null, isWeekOff: false, source: 'NONE', error: null };
    } catch (err: any) {
      console.error('[Attendance] unexpected error in getShiftForDate:', err);
      return { data: null, error: new Error(`Failed to resolve shift: ${err?.message || err}`) };
    }
  },

  /**
   * Get the current assigned shift for the authenticated employee
   */
  async getCurrentShift(localDateStr: string): Promise<{ data: any | null; error: Error | null; isWeekOff?: boolean }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const res = await this.getShiftForDate(empId, localDateStr);
    return { data: res.data, error: res.error, isWeekOff: res.isWeekOff };
  },

  /**
   * Get the assigned shift for the authenticated employee on a specific date.
   */
  async getMyShiftForDate(localDateStr: string): Promise<{ data: any | null; error: Error | null; isWeekOff?: boolean; source?: string }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const res = await this.getShiftForDate(empId, localDateStr);
    return { data: res.data, error: res.error, isWeekOff: res.isWeekOff, source: res.source };
  },

  /**
   * Get the authenticated employee's schedule for a date range (e.g. week or month).
   * Checks published roster assignments and fallback permanent assignments.
   */
  async getMyScheduleForRange(startDate: string, endDate: string): Promise<{ data: Record<string, any>; error: Error | null }> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: {}, error: new Error('Unauthorized') };

    try {
      // 1. Published roster assignments for the employee in this range
      const { data: rosterRows, error: rErr } = await supabase
        .from('roster_assignments')
        .select('id, assignment_date, day_type, work_mode, shift_template_id, shift_templates(*), rosters(status)')
        .eq('employee_id', empId)
        .gte('assignment_date', startDate)
        .lte('assignment_date', endDate);

      if (rErr) return { data: {}, error: new Error(rErr.message) };

      const schedule: Record<string, any> = {};

      for (const r of (rosterRows || []) as any[]) {
        const isPub = String(r?.rosters?.status || '').toUpperCase() === 'PUBLISHED';
        if (isPub) {
          const dStr = String(r.assignment_date).slice(0, 10);
          schedule[dStr] = {
            id: r.id,
            isWeekOff: String(r.day_type).toUpperCase() === 'WEEK_OFF',
            workMode: r.work_mode || 'OFFICE',
            shift: r.shift_templates,
            source: 'ROSTER',
          };
        }
      }

      return { data: schedule, error: null };
    } catch (e: any) {
      return { data: {}, error: new Error(e?.message || e) };
    }
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

    // 2. Resolve applicable shift (checks published roster first, then permanent assignment)
    const { data: applicableShift, error: shiftErr, isWeekOff } = await this.getShiftForDate(empId, input.localDateStr);
    if (shiftErr) return { data: null, error: shiftErr };
    if (isWeekOff) {
      return { data: null, error: new Error('Today is scheduled as a Week Off in the published roster.') };
    }

    let shiftTemplateId: string | null = null;
    let rosterAssignmentId: string | null = null;
    let requiredHours = 8;
    let lateMinutes = 0;
    let shiftStartStr = '09:00:00';
    let shiftGracePeriod = globalGracePeriod;

    if (applicableShift) {
      shiftTemplateId = applicableShift.id;
      rosterAssignmentId = applicableShift.roster_assignment_id || null;
      requiredHours = applicableShift.required_hours ?? 8;
      if (applicableShift.start_time) shiftStartStr = applicableShift.start_time;
      if (applicableShift.grace_period_minutes !== undefined) shiftGracePeriod = applicableShift.grace_period_minutes;
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
        end_time: applicableShift?.end_time ?? null,
        crosses_midnight: !!applicableShift?.crosses_midnight,
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
        roster_assignment_id: rosterAssignmentId,
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
    // A failed read never counts as "no breaks" (the clock-out would otherwise miss an open break)
    if (breaksErr || !Array.isArray(breakRows)) return { data: null, error: new Error(`Your breaks could not be checked (${breaksErr?.message || 'no data returned'}). You are still clocked in; please try again.`) };
    let breaks: any[] = breakRows;

    // Two or more open breaks are ambiguous (overlapping time would be counted twice, and which
    // one is real cannot be decided here): refuse, close nothing, and leave it to an administrator.
    const openCheck = classifyOpenBreaks(breaks.filter((b: any) => !b.ended_at), null);
    if (openCheck.kind === 'MULTIPLE') {
      await logBreakAudit({
        action: 'CLOCK_OUT_BLOCKED_MULTIPLE_OPEN_BREAKS',
        module: 'ATTENDANCE',
        entity_type: 'attendance',
        entity_id: attendanceId,
        description: `Clock-out refused: ${openCheck.count} open breaks on this attendance. No break was closed.`,
      });
      return { data: null, error: new Error(`${openCheck.count} breaks are open for this attendance, so you cannot be clocked out automatically. Nothing was changed; please contact an administrator to correct your break records.`) };
    }

    // An active MANUAL break must be ended by the employee first (existing rule).
    // An active AUTOMATIC break (geofence or tracking) is closed by the server at database time
    // (close_auto_break_for_clock_out): the employee does not have to walk back into the office or
    // restore tracking just to clock out, and no break stays open afterwards. The server also writes
    // the BREAK_END event, the audit entry and the employee notification.
    const activeBreak = findActiveBreak(breaks);
    if (activeBreak && !isAutomaticBreak(activeBreak)) {
      return { data: null, error: new Error('Please end your active break before clocking out.') };
    }
    let closedAutoBreak: { id: string; duration_minutes: number; ended_at: string } | null = null;
    if (activeBreak) {
      const { data: closeRes, error: closeErr } = await (supabase as any).rpc('close_auto_break_for_clock_out', { p_attendance_id: attendanceId });
      if (closeErr) return { data: null, error: new Error(`Your automatic break could not be closed (${closeErr.message}). You are still clocked in; please try again.`) };
      // Re-read: the server closed it (or a return / fresh location closed it a moment earlier)
      const { data: fresh, error: freshErr } = await supabase.from('attendance_breaks').select('*').eq('attendance_id', attendanceId) as any;
      if (freshErr || !Array.isArray(fresh)) return { data: null, error: new Error(`Your breaks could not be checked (${freshErr?.message || 'no data returned'}). You are still clocked in; please try again.`) };
      breaks = fresh;
      if (findActiveBreak(breaks)) return { data: null, error: new Error('Please try again.') };
      if (closeRes?.action === 'ENDED') closedAutoBreak = { id: closeRes.break_id, duration_minutes: closeRes.duration_minutes, ended_at: closeRes.ended_at };
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
      // (if an automatic break was closed above, the database already set the status back from ON_BREAK)
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
