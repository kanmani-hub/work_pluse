/**
 * Geofence stability: decides when an inside/outside change is real.
 * Protects against GPS jitter at the boundary so breaks do not start/end repeatedly.
 *
 * - Only usable readings count (successful GPS, accuracy <= LOW_ACCURACY_METERS, known distance).
 *   Denied/unavailable/low-accuracy readings never change the state (no fake "outside").
 * - Hysteresis: inside when distance <= radius; outside only when distance > radius + buffer, where
 *   the buffer scales with the office radius (boundaryBufferMeters): 20 % of the radius, at least
 *   5 m and at most 20 m. A 40 m office → 8 m, 50 m → 10 m, 100 m and larger → 20 m (unchanged).
 *   Readings in between keep the current state.
 * - An OUTSIDE reading must also be precise enough for that office (maxExitAccuracyMeters): its GPS
 *   accuracy may not exceed the radius (min 25 m, max LOW_ACCURACY_METERS). A ±90 m reading cannot
 *   show that someone left a 50 m office. Such readings are ignored (they neither confirm nor reset).
 * - A change is confirmed only after CONFIRM_READINGS consecutive readings on the new side
 *   (jitter confirmation, ~one tracking interval; this is NOT a grace period).
 *   The confirmed transition time is the time of the FIRST reading of that run.
 * - Readings whose own timestamp is older / newer than READING_TIME_TOLERANCE_MS compared with the
 *   current time are not used for geofence decisions (isReadingTimeAcceptable): delayed or
 *   fabricated timestamps never start or end a break. The tolerance (15 min) is the same window the
 *   proposed server-side attendance guard uses for employee-submitted times.
 */

export type GeofenceSide = 'INSIDE' | 'OUTSIDE';

export const LOW_ACCURACY_METERS = 150;
/** Largest boundary buffer (used for offices of 100 m radius and more). */
export const BOUNDARY_BUFFER_METERS = 20;
export const MIN_BOUNDARY_BUFFER_METERS = 5;
export const MIN_EXIT_ACCURACY_METERS = 25;
export const CONFIRM_READINGS = 2;
export const READING_TIME_TOLERANCE_MS = 15 * 60 * 1000;

/** Hysteresis band outside the radius: 20 % of the radius, clamped to 5–20 m. */
export function boundaryBufferMeters(radiusMeters: number): number {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return MIN_BOUNDARY_BUFFER_METERS;
  return Math.min(BOUNDARY_BUFFER_METERS, Math.max(MIN_BOUNDARY_BUFFER_METERS, Math.round(radiusMeters * 0.2)));
}

/** Worst GPS accuracy that may still confirm an exit: the radius, clamped to 25–150 m. */
export function maxExitAccuracyMeters(radiusMeters: number): number {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return MIN_EXIT_ACCURACY_METERS;
  return Math.min(LOW_ACCURACY_METERS, Math.max(MIN_EXIT_ACCURACY_METERS, radiusMeters));
}

/** A reading's own timestamp must be within the tolerance of now (not stale, not in the future). */
export function isReadingTimeAcceptable(readingAtMs: number | null | undefined, nowMs: number, toleranceMs = READING_TIME_TOLERANCE_MS): boolean {
  if (typeof readingAtMs !== 'number' || !Number.isFinite(readingAtMs)) return false;
  return Math.abs(nowMs - readingAtMs) <= toleranceMs;
}

export interface GeofenceReading {
  ok: boolean; // GPS success
  distanceMeters: number | null;
  radiusMeters: number;
  accuracyMeters: number | null;
  atMs: number;
}

export interface StabilityState {
  confirmed: GeofenceSide | null; // last confirmed side (from the live-location row)
  pendingSide: GeofenceSide | null;
  pendingCount: number;
  pendingSinceMs: number | null;
}

export const initialStability = (confirmed: GeofenceSide | null): StabilityState => ({ confirmed, pendingSide: null, pendingCount: 0, pendingSinceMs: null });

/** Classify one reading: INSIDE, OUTSIDE, or null when unusable / inside the hysteresis band. */
export function classifyReading(r: GeofenceReading, current: GeofenceSide | null): GeofenceSide | null {
  if (!r.ok || r.distanceMeters === null || r.distanceMeters === undefined) return null;
  if (r.accuracyMeters !== null && r.accuracyMeters > LOW_ACCURACY_METERS) return null;
  if (r.distanceMeters <= r.radiusMeters) return 'INSIDE';
  if (r.distanceMeters > r.radiusMeters + boundaryBufferMeters(r.radiusMeters)) {
    // An exit needs a reading whose precision is KNOWN and good enough for this office's size
    // (a reading without an accuracy value can still keep someone inside, but never take them out)
    const acc = r.accuracyMeters;
    if (typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0 || acc > maxExitAccuracyMeters(r.radiusMeters)) return null;
    return 'OUTSIDE';
  }
  return current; // in the buffer band: keep whatever we had
}

export interface StabilityResult {
  state: StabilityState;
  transition: { from: GeofenceSide | null; to: GeofenceSide; atMs: number } | null;
  usable: boolean;
}

export function nextStability(state: StabilityState, r: GeofenceReading): StabilityResult {
  const side = classifyReading(r, state.confirmed);
  if (side === null) return { state, transition: null, usable: false };

  // First ever usable reading: adopt it as confirmed without a transition
  if (state.confirmed === null) return { state: initialStability(side), transition: null, usable: true };

  if (side === state.confirmed) return { state: initialStability(state.confirmed), transition: null, usable: true };

  const count = state.pendingSide === side ? state.pendingCount + 1 : 1;
  const since = state.pendingSide === side && state.pendingSinceMs !== null ? state.pendingSinceMs : r.atMs;
  if (count >= CONFIRM_READINGS) {
    return { state: initialStability(side), transition: { from: state.confirmed, to: side, atMs: since }, usable: true };
  }
  return { state: { confirmed: state.confirmed, pendingSide: side, pendingCount: count, pendingSinceMs: since }, transition: null, usable: true };
}
