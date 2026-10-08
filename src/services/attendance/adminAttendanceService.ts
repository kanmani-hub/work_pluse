/**
 * Admin Attendance data loader. Runs only with the signed-in user's session (anon/publishable key),
 * so Supabase RLS decides what is visible: ADMIN/HR see all employees, others only their own rows.
 */
import { supabase } from '../../lib/supabase';
import { appSettingsService } from '../settings/appSettingsService';
import { buildAdminAttendanceDay } from './adminAttendanceRules';
import { companyDateStr } from '../../utils/companyDate';

const SHIFT_FIELDS = 'name, start_time, end_time, crosses_midnight, break_duration_minutes, required_hours';

export const adminAttendanceService = {
  async getDay(date: string) {
    const errors: string[] = [];
    const check = (label: string, r: { error: any }) => { if (r.error) errors.push(`${label}: ${r.error.message}`); };
    const today = companyDateStr();

    const [settings, employees, attendance, assignments, leaves, wfh, live, faceRegs] = await Promise.all([
      appSettingsService.loadSettings(),
      supabase.from('employees').select('id, employee_code, first_name, last_name, status, department_id, office_id, departments(name), offices(name, geofence_radius), role:role_id(name)'),
      supabase.from('attendance').select(`*, shift_templates(${SHIFT_FIELDS})`).eq('attendance_date', date),
      supabase.from('shift_assignments').select(`employee_id, effective_date, end_date, shift_templates(${SHIFT_FIELDS})`).lte('effective_date', date),
      supabase.from('leave_requests').select('employee_id, start_date, end_date, is_half_day, half_day_type, status, leave_types(name)').eq('status', 'APPROVED').lte('start_date', date).gte('end_date', date),
      supabase.from('wfh_requests').select('employee_id, request_date, status').eq('status', 'APPROVED').eq('request_date', date),
      supabase.from('employee_live_locations').select('employee_id, last_seen_at, location_status, location_context, accuracy_meters, distance_from_office_meters'),
      supabase.from('face_registrations').select('employee_id, registration_status, is_active, registered_at'),
    ]);
    check('employees', employees); check('attendance', attendance); check('shift_assignments', assignments);
    check('leave_requests', leaves); check('wfh_requests', wfh); check('employee_live_locations', live); check('face_registrations', faceRegs);

    // Verification links for this day's attendance records
    const attIds = (attendance.data || []).map((a: any) => a.id);
    let clockInEvents: any[] = [];
    let locationEvents: any[] = [];
    let faceEvents: any[] = [];
    if (attIds.length) {
      const ev = await supabase.from('attendance_events').select('attendance_id, event_type, source, event_at, metadata').in('attendance_id', attIds).eq('event_type', 'CLOCK_IN');
      check('attendance_events', ev);
      clockInEvents = ev.data || [];
      const locIds = clockInEvents.map(e => e.metadata?.locationVerificationId).filter(Boolean);
      const faceIds = clockInEvents.map(e => e.metadata?.faceVerificationEventId).filter(Boolean);
      const [loc, face] = await Promise.all([
        locIds.length
          ? supabase.from('location_verification_events').select('id, result, distance_from_office_meters, geofence_radius_meters, accuracy_meters, verified_at, failure_reason').in('id', locIds)
          : Promise.resolve({ data: [], error: null } as any),
        supabase.from('face_verification_events').select('id, attendance_id, verification_type, result, verified_at')
          .or([`attendance_id.in.(${attIds.join(',')})`, faceIds.length ? `id.in.(${faceIds.join(',')})` : null].filter(Boolean).join(',')),
      ]);
      check('location_verification_events', loc); check('face_verification_events', face);
      locationEvents = loc.data || [];
      faceEvents = face.data || [];
    }

    const day = buildAdminAttendanceDay({
      date,
      today,
      nowMs: Date.now(),
      graceMinutes: settings.gracePeriodMins ?? 0,
      requireFaceVerification: !!settings.requireFaceVerification,
      employees: employees.data || [],
      attendance: attendance.data || [],
      shiftAssignments: assignments.data || [],
      leaves: leaves.data || [],
      wfh: wfh.data || [],
      liveLocations: live.data || [],
      clockInEvents,
      locationEvents,
      faceRegistrations: faceRegs.data || [],
      faceEvents,
    });

    return { ...day, isToday: date === today, errors };
  },
};
