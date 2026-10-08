/**
 * Admin Live Tracking status: work status comes from today's attendance and breaks;
 * location only describes where the employee is. A stale location never changes work status.
 */
export type LiveWorkStatus = 'Working' | 'On Break' | 'WFH' | 'Outside Geofence' | 'Offline' | 'Clocked Out';

export function deriveLiveWorkStatus(
  live: { location_status?: string | null; location_context?: string | null },
  attendance: { status?: string | null; clock_in_at?: string | null; clock_out_at?: string | null } | null | undefined,
  hasActiveBreak: boolean,
): LiveWorkStatus {
  if (!attendance || !attendance.clock_in_at) return 'Offline';
  if (attendance.clock_out_at) return 'Clocked Out';
  if (hasActiveBreak || attendance.status === 'ON_BREAK') return 'On Break';
  if (live.location_context === 'WFH') return 'WFH';
  if (live.location_status === 'OUTSIDE_GEOFENCE') return 'Outside Geofence';
  return 'Working';
}
