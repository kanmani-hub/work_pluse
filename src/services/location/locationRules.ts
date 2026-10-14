/**
 * Pure location rules used by locationService.verifyCurrentLocation.
 * Same decisions the service already made inline, moved here so they are unit-tested.
 *
 *  - GPS denied / unavailable / timeout / low accuracy  → never OUTSIDE (no fake violation)
 *  - Approved WFH today                                  → WFH (office geofence not applied)
 *  - distance <= radius                                  → INSIDE, otherwise OUTSIDE
 *  Jitter / boundary hysteresis is handled by geofenceStability (not duplicated here).
 */
import { LOW_ACCURACY_METERS } from './geofenceStability';
import { LIVE_STALE_MINUTES } from './liveTrackingRules';

/**
 * A "successful" GPS fix that cannot be a real position is treated as a GPS error:
 * non-numeric / out-of-range coordinates, exactly 0,0 (no fix), or a non-finite / negative accuracy.
 * (A missing accuracy is allowed here; geofenceStability never lets such a reading confirm an exit.)
 */
export function isPlausibleFix(latitude: unknown, longitude: unknown, accuracyMeters: unknown): boolean {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
  if (latitude === 0 && longitude === 0) return false;
  if (accuracyMeters !== null && accuracyMeters !== undefined) {
    if (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters < 0) return false;
  }
  return true;
}

export type TrackingProblem = 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN_ERROR';

/**
 * GPS watcher errors are recorded as diagnostics (location_verification_events) when the problem
 * changes, and again only after the Live Tracking stale window, never every 10 seconds.
 */
export const TRACKING_PROBLEM_REPEAT_MS = LIVE_STALE_MINUTES * 60_000;
export function shouldRecordTrackingProblem(
  last: { status: TrackingProblem; recordedAtMs: number } | null,
  status: TrackingProblem,
  nowMs: number,
): boolean {
  if (!last || last.status !== status) return true;
  return nowMs - last.recordedAtMs >= TRACKING_PROBLEM_REPEAT_MS;
}

export type GeoStatus = 'SUCCESS' | 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN_ERROR';
export type LocationResult = 'INSIDE' | 'OUTSIDE' | 'UNKNOWN' | 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'LOW_ACCURACY' | 'ERROR' | 'WFH';
export type OfficeState = 'OK' | 'MISSING' | 'INACTIVE';

export function classifyLocation(input: {
  geoStatus: GeoStatus;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  radiusMeters: number;
  isWfh: boolean;
  office: OfficeState;
}): { result: LocationResult; failureReason: string | null } {
  const { geoStatus, accuracyMeters, distanceMeters, radiusMeters, isWfh, office } = input;

  if (geoStatus !== 'SUCCESS') {
    if (isWfh) return { result: 'WFH', failureReason: null };
    if (geoStatus === 'LOCATION_DENIED') return { result: 'LOCATION_DENIED', failureReason: 'Location permission denied' };
    if (geoStatus === 'LOCATION_UNAVAILABLE' || geoStatus === 'TIMEOUT') return { result: 'LOCATION_UNAVAILABLE', failureReason: 'Location unavailable' };
    return { result: 'ERROR', failureReason: 'Location error' };
  }
  if (accuracyMeters !== null && accuracyMeters > LOW_ACCURACY_METERS) {
    return { result: isWfh ? 'WFH' : 'LOW_ACCURACY', failureReason: 'GPS accuracy too low' };
  }
  if (office === 'MISSING') return { result: isWfh ? 'WFH' : 'ERROR', failureReason: 'No office has been assigned to your employee profile.' };
  if (office === 'INACTIVE') return { result: isWfh ? 'WFH' : 'ERROR', failureReason: 'Assigned office is inactive.' };
  if (distanceMeters === null) return { result: isWfh ? 'WFH' : 'ERROR', failureReason: 'Distance unavailable' };
  if (isWfh) return { result: 'WFH', failureReason: null };
  if (distanceMeters <= radiusMeters) return { result: 'INSIDE', failureReason: null };
  return { result: 'OUTSIDE', failureReason: `Distance: ${Math.round(distanceMeters)}m (Allowed: ${radiusMeters}m)` };
}

/** Only a successful, accurate reading with a geofence answer may update live location / history. */
export function isUsableReading(geoStatus: GeoStatus, result: LocationResult): boolean {
  return geoStatus === 'SUCCESS' && (result === 'INSIDE' || result === 'OUTSIDE' || result === 'WFH');
}

/**
 * Background LOCATION_CHECKs (GPS watcher, page checks) are stored only while the employee
 * is clocked in. Off-duty readings are not written: no off-duty tracking, no needless writes.
 * Clock-in / clock-out verifications are always stored (they are the attendance evidence).
 */
export function shouldPersistCheck(type: 'CLOCK_IN' | 'CLOCK_OUT' | 'LOCATION_CHECK', hasOpenAttendance: boolean): boolean {
  return type !== 'LOCATION_CHECK' || hasOpenAttendance;
}

/** Audit log / admin notifications only for explicit clock-in/out verifications, not every 10 s check. */
export const isExplicitCheck = (type: 'CLOCK_IN' | 'CLOCK_OUT' | 'LOCATION_CHECK') => type !== 'LOCATION_CHECK';

export const liveStatusFor = (result: LocationResult): 'WFH' | 'INSIDE_GEOFENCE' | 'OUTSIDE_GEOFENCE' =>
  result === 'WFH' ? 'WFH' : result === 'OUTSIDE' ? 'OUTSIDE_GEOFENCE' : 'INSIDE_GEOFENCE';

/**
 * A confirmed return is "after a tracking gap" when the device had not reported a usable reading for
 * longer than the Live Tracking stale window before the first reading on the new side.
 * Unknown previous time (no earlier reading) is also a gap: nothing shows when the return happened.
 */
export function hasTrackingGap(lastSeenBeforeMs: number | null, firstNewSideMs: number): boolean {
  if (lastSeenBeforeMs === null || !Number.isFinite(lastSeenBeforeMs)) return true;
  return firstNewSideMs - lastSeenBeforeMs > LIVE_STALE_MINUTES * 60_000;
}
