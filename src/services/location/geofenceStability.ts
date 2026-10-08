/**
 * Geofence stability: decides when an inside/outside change is real.
 * Protects against GPS jitter at the boundary so breaks do not start/end repeatedly.
 *
 * - Only usable readings count (successful GPS, accuracy <= LOW_ACCURACY_METERS, known distance).
 *   Denied/unavailable/low-accuracy readings never change the state (no fake "outside").
 * - Hysteresis: inside when distance <= radius; outside only when distance > radius + buffer.
 *   Readings in between keep the current state.
 * - A change is confirmed only after CONFIRM_READINGS consecutive readings on the new side.
 *   The confirmed transition time is the time of the FIRST reading of that run.
 */

export type GeofenceSide = 'INSIDE' | 'OUTSIDE';

export const LOW_ACCURACY_METERS = 150;
export const BOUNDARY_BUFFER_METERS = 20;
export const CONFIRM_READINGS = 2;

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
  if (r.distanceMeters > r.radiusMeters + BOUNDARY_BUFFER_METERS) return 'OUTSIDE';
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
