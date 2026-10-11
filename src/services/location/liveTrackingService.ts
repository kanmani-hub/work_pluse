/**
 * Admin Live Tracking data loader (read-only, signed-in admin session → RLS applies).
 * Reads existing tables only; the geofence side is the stored live-location status.
 */
import { supabase } from '../../lib/supabase';
import { companyDateStr, previousDateStr } from '../../utils/companyDate';
import { buildLiveTrackingRows, type LiveTrackingInput } from './liveTrackingRules';

const SHIFT = 'name, start_time, end_time, crosses_midnight';

export async function loadLiveTrackingInput(): Promise<{ input: LiveTrackingInput; errors: string[] }> {
  const today = companyDateStr();
  const yesterday = previousDateStr(today);
  const [live, employees, attendance, wfh, assignments, geofence] = await Promise.all([
    supabase.from('employee_live_locations').select('id, employee_id, latitude, longitude, accuracy_meters, distance_from_office_meters, location_status, location_context, last_seen_at'),
    supabase.from('employees').select('id, employee_code, first_name, last_name, status, department_id, departments(name), office_id, offices(id, name, latitude, longitude, geofence_radius), role:role_id(name)'),
    supabase.from('attendance').select(`id, employee_id, attendance_date, status, clock_in_at, clock_out_at, break_minutes, shift_template:shift_template_id(${SHIFT})`).in('attendance_date', [today, yesterday]),
    supabase.from('wfh_requests').select('employee_id, request_date, status').eq('status', 'APPROVED').eq('request_date', today),
    supabase.from('shift_assignments').select(`employee_id, effective_date, end_date, shift_templates(${SHIFT})`).lte('effective_date', today),
    supabase.from('geofence_events').select('employee_id, event_type, occurred_at').gte('occurred_at', new Date(`${today}T00:00:00+05:30`).toISOString()).order('occurred_at', { ascending: true }),
  ]);
  const attIds = (attendance.data || []).map((a: any) => a.id);
  const breaks = attIds.length
    ? await supabase.from('attendance_breaks').select('id, attendance_id, employee_id, break_type, started_at, ended_at, duration_minutes').in('attendance_id', attIds)
    : { data: [], error: null } as any;
  const errors = [live, employees, attendance, wfh, assignments, geofence, breaks].filter((r: any) => r.error).map((r: any) => r.error.message);
  return {
    input: {
      today, yesterday,
      liveLocations: live.data || [],
      employees: employees.data || [],
      attendance: attendance.data || [],
      breaks: breaks.data || [],
      wfhToday: wfh.data || [],
      shiftAssignments: assignments.data || [],
      geofenceEvents: geofence.data || [],
    },
    errors,
  };
}

export { buildLiveTrackingRows };
