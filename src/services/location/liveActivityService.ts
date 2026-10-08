/**
 * Live Activity Logs data access. Read-only, runs with the signed-in admin's session (RLS applies).
 * Initial load: today's latest events (company date). Updates: Supabase Realtime triggers an
 * incremental fetch of rows newer than the last seen event (no interval polling).
 */
import { supabase } from '../../lib/supabase';
import { companyDateStr } from '../../utils/companyDate';
import { fromAttendanceEvent, fromBreak, fromGeofenceEvent, fromLocationEvent, type LiveActivityLog } from './liveActivityRules';

const EMP = 'employee:employee_id(first_name, last_name, employee_code)';
const PER_SOURCE_LIMIT = 50;

export type LiveActivityConnection = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

/** Start of the company day (IST) as an ISO instant. */
export const startOfCompanyDayIso = (dateStr = companyDateStr()) => new Date(`${dateStr}T00:00:00+05:30`).toISOString();

/** Load events with a timestamp >= sinceIso from every source, converted to LiveActivityLog. */
export async function fetchActivitySince(sinceIso: string): Promise<{ logs: LiveActivityLog[]; errors: string[] }> {
  const [ev, brStart, brEnd, geo, loc] = await Promise.all([
    supabase.from('attendance_events').select(`id, attendance_id, employee_id, event_type, event_at, source, ${EMP}`)
      .in('event_type', ['CLOCK_IN', 'CLOCK_OUT', 'AUTO_LOGOUT']).gte('event_at', sinceIso).order('event_at', { ascending: false }).limit(PER_SOURCE_LIMIT),
    supabase.from('attendance_breaks').select(`id, attendance_id, employee_id, break_type, started_at, ended_at, duration_minutes, ${EMP}`)
      .gte('started_at', sinceIso).order('started_at', { ascending: false }).limit(PER_SOURCE_LIMIT),
    supabase.from('attendance_breaks').select(`id, attendance_id, employee_id, break_type, started_at, ended_at, duration_minutes, ${EMP}`)
      .gte('ended_at', sinceIso).order('ended_at', { ascending: false }).limit(PER_SOURCE_LIMIT),
    supabase.from('geofence_events').select(`id, employee_id, event_type, occurred_at, latitude, longitude, distance_from_office_meters, geofence_radius_meters, ${EMP}`)
      .gte('occurred_at', sinceIso).order('occurred_at', { ascending: false }).limit(PER_SOURCE_LIMIT),
    supabase.from('location_verification_events').select(`id, employee_id, verification_type, result, verified_at, latitude, longitude, accuracy_meters, distance_from_office_meters, ${EMP}`)
      .gte('verified_at', sinceIso).order('verified_at', { ascending: false }).limit(PER_SOURCE_LIMIT * 2),
  ]);
  const errors = [ev, brStart, brEnd, geo, loc].filter(r => r.error).map(r => (r.error as any).message as string);
  const logs: LiveActivityLog[] = [];
  (ev.data || []).forEach((r: any) => { const l = fromAttendanceEvent(r); if (l) logs.push(l); });
  [...(brStart.data || []), ...(brEnd.data || [])].forEach((r: any) => logs.push(...fromBreak(r).filter(l => new Date(l.timestamp).getTime() >= new Date(sinceIso).getTime())));
  (geo.data || []).forEach((r: any) => { const l = fromGeofenceEvent(r); if (l) logs.push(l); });
  (loc.data || []).forEach((r: any) => { const l = fromLocationEvent(r); if (l) logs.push(l); });
  return { logs, errors };
}

/**
 * Subscribe to Realtime changes that signal new activity. Calls onChange (debounced by the caller)
 * and reports the real channel status. Returns a cleanup function.
 * Note: in this project's migrations only `attendance` and `employee_live_locations` are in the
 * supabase_realtime publication; the event tables are subscribed too so they work once published.
 */
export function subscribeToActivity(onChange: () => void, onStatus: (s: LiveActivityConnection) => void) {
  const channel = supabase.channel('admin:live_activity_logs');
  const tables = ['attendance', 'employee_live_locations', 'attendance_events', 'attendance_breaks', 'geofence_events', 'location_verification_events'];
  tables.forEach(table => {
    channel.on('postgres_changes' as any, { event: '*', schema: 'public', table }, () => onChange());
  });
  onStatus('connecting');
  channel.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') onStatus('live');
    else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') onStatus('reconnecting');
    else if (status === 'CLOSED') onStatus('disconnected');
  });
  return () => { supabase.removeChannel(channel); };
}
