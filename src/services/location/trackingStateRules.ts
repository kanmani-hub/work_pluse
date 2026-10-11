/**
 * Location tracking state shown to the admin (pure, unit-tested).
 *
 * Two clocks, from EXISTING columns of employee_live_locations:
 *   deviceRecordedAt = last_seen_at  (when the phone/browser took the reading)
 *   serverReceivedAt = updated_at    (when the server stored it; set by the database trigger)
 * is_tracking = the device says tracking is running (mobile app, Phase 3; the website leaves it false).
 *
 *   LIVE          device reading and server update both within the stale window → current location
 *   DELAYED_SYNC  server update is recent but the reading itself is old → uploaded late, NOT current
 *   OFFLINE       no server update within the window while the device reports tracking → likely no internet
 *   PAUSED        no server update within the window and the device is not reporting tracking
 *                 (app/tab closed, screen locked, permission or GPS off)
 *   NO_LOCATION   nothing ever received
 * Only LIVE is presented as the employee's current location.
 */
import { LIVE_STALE_MINUTES } from './liveTrackingRules';

export type TrackingState = 'LIVE' | 'DELAYED_SYNC' | 'OFFLINE' | 'PAUSED' | 'NO_LOCATION';

export interface TrackingStateInput {
  deviceRecordedAt: string | null | undefined;
  serverReceivedAt: string | null | undefined;
  isTracking?: boolean | null;
  pendingCount?: number | null;     // only when the device reports it; never guessed
  distanceMeters?: number | null;   // from the recorded location
}

export interface TrackingStateView {
  state: TrackingState;
  isCurrent: boolean;
  label: string;                    // e.g. "Offline — last server update 10:15 AM"
  deviceAgeMinutes: number | null;
  serverAgeMinutes: number | null;
  deviceTime: string;               // IST clock time or "—"
  serverTime: string;
  distanceText: string;             // "5 m from office (recorded 11:51 AM)"
  pendingText: string | null;
}

const MIN = 60_000;
const valid = (iso: string | null | undefined) => !!iso && Number.isFinite(new Date(iso).getTime());
const ageMin = (iso: string | null | undefined, nowMs: number) => (valid(iso) ? Math.max(0, Math.floor((nowMs - new Date(iso as string).getTime()) / MIN)) : null);
export const istClock = (iso: string | null | undefined) =>
  valid(iso) ? new Date(iso as string).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
const ago = (m: number) => (m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`);

export function trackingState(input: TrackingStateInput, nowMs: number, staleMinutes = LIVE_STALE_MINUTES): TrackingStateView {
  const deviceAge = ageMin(input.deviceRecordedAt, nowMs);
  // Without a server receive time, fall back to the device time (older rows / partial data)
  const serverIso = valid(input.serverReceivedAt) ? input.serverReceivedAt : input.deviceRecordedAt;
  const serverAge = ageMin(serverIso, nowMs);
  const deviceTime = istClock(input.deviceRecordedAt);
  const serverTime = istClock(serverIso);
  const pendingText = typeof input.pendingCount === 'number' ? `${input.pendingCount} reading${input.pendingCount === 1 ? '' : 's'} waiting to sync` : null;
  const distanceText = input.distanceMeters === null || input.distanceMeters === undefined || deviceAge === null
    ? '—' : `${Math.round(input.distanceMeters)} m from office (recorded ${deviceTime})`;

  let state: TrackingState;
  let label: string;
  if (deviceAge === null) {
    state = 'NO_LOCATION'; label = 'No location received';
  } else if ((serverAge as number) > staleMinutes) {
    if (input.isTracking) { state = 'OFFLINE'; label = `Offline — last server update ${serverTime}`; }
    else { state = 'PAUSED'; label = `Location paused — last seen ${ago(deviceAge)}`; }
  } else if (deviceAge > staleMinutes) {
    state = 'DELAYED_SYNC'; label = `Delayed sync — recorded ${deviceTime}, received ${serverTime}`;
  } else {
    state = 'LIVE'; label = `Live — updated ${ago(deviceAge)}`;
  }
  return { state, isCurrent: state === 'LIVE', label, deviceAgeMinutes: deviceAge, serverAgeMinutes: serverAge, deviceTime, serverTime, distanceText, pendingText };
}
