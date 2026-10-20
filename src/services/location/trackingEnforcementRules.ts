/**
 * Pure rules for Tracking Warning and Automatic Break Policy.
 *
 * Requirements:
 * 1. Distinguishes confirmed violations (permission denied, GPS disabled, stale updates)
 *    from transient timeouts, network disconnection, and unverified offline states.
 * 2. Does NOT treat a single missed GPS update, old device timestamp, or network timeout
 *    as proof of deliberate noncompliance.
 * 3. Enforces safeguards: employee must be clocked in, not clocked out, not WFH, and not
 *    already on break.
 * 4. Generates uniquely identifiable tracking-incident IDs.
 * 5. Uses trusted server timestamps and rejects implausible future-dated readings.
 */
import { freshnessTimes, isFresh, TRACKING_STALE_MINUTES, FUTURE_TOLERANCE_MINUTES } from './trackingStatus';

export type TrackingViolationType = 'LOCATION_PERMISSION_DENIED' | 'GPS_DISABLED' | 'TRACKING_STALE';

export type TrackingCondition =
  | 'PERMISSION_DENIED'
  | 'GPS_UNAVAILABLE'
  | 'UPDATES_STALE'
  | 'DEVICE_OFFLINE'
  | 'TRANSIENT_TIMEOUT'
  | 'NOT_CLOCKED_IN'
  | 'CLOCKED_OUT'
  | 'ALREADY_ON_BREAK'
  | 'WFH_EXEMPT'
  | 'TRACKING_OK';

export interface EnforcementEvaluationInput {
  geoStatus?: string | null;
  failureReason?: string | null;
  isOnline: boolean;
  isClockedIn: boolean;
  isClockedOut: boolean;
  hasActiveBreak: boolean;
  isWfh: boolean;
  lastSeenAt?: string | null;
  serverReceivedAt?: string | null;
  serverNowMs: number;
  staleMinutes?: number;
}

export interface EnforcementEvaluationResult {
  condition: TrackingCondition;
  isConfirmedViolation: boolean;
  shouldTriggerAutomaticBreak: boolean;
  violationType: TrackingViolationType | null;
  reason: string;
  isOffline: boolean;
  isUnverified: boolean;
  shouldQueueDeviceWarning: boolean;
}

/** Check if a failure reason or message indicates a transient timeout rather than disabled hardware */
export function isTimeoutError(reason?: string | null): boolean {
  if (!reason) return false;
  return /time\s?out|timed out|timeout expired|request timed out/i.test(reason);
}

/**
 * Pure evaluation of tracking state for policy enforcement.
 * Never throws, produces deterministic outcomes.
 */
export function evaluateTrackingEnforcement(input: EnforcementEvaluationInput): EnforcementEvaluationResult {
  const staleMinutes = input.staleMinutes ?? TRACKING_STALE_MINUTES;

  // Safeguard 1: Employee not clocked in
  if (!input.isClockedIn) {
    return {
      condition: 'NOT_CLOCKED_IN',
      isConfirmedViolation: false,
      shouldTriggerAutomaticBreak: false,
      violationType: null,
      reason: 'Employee is not clocked in; location tracking is not required.',
      isOffline: false,
      isUnverified: false,
      shouldQueueDeviceWarning: false,
    };
  }

  // Safeguard 2: Employee clocked out
  if (input.isClockedOut) {
    return {
      condition: 'CLOCKED_OUT',
      isConfirmedViolation: false,
      shouldTriggerAutomaticBreak: false,
      violationType: null,
      reason: 'Employee has clocked out; location tracking is not required.',
      isOffline: false,
      isUnverified: false,
      shouldQueueDeviceWarning: false,
    };
  }

  // Safeguard 3: Approved WFH is exempt from office tracking enforcement
  if (input.isWfh) {
    return {
      condition: 'WFH_EXEMPT',
      isConfirmedViolation: false,
      shouldTriggerAutomaticBreak: false,
      violationType: null,
      reason: 'Approved WFH attendance is exempt from office location tracking enforcement.',
      isOffline: false,
      isUnverified: false,
      shouldQueueDeviceWarning: false,
    };
  }

  // Safeguard 4: Employee already on break — prevent duplicate breaks
  if (input.hasActiveBreak) {
    return {
      condition: 'ALREADY_ON_BREAK',
      isConfirmedViolation: false,
      shouldTriggerAutomaticBreak: false,
      violationType: null,
      reason: 'Employee is already on an active break; duplicate break prevented.',
      isOffline: false,
      isUnverified: false,
      shouldQueueDeviceWarning: false,
    };
  }

  // Safeguard 5: Network disconnected / offline
  // If the device is offline, do NOT treat it as deliberate noncompliance.
  // Queue warning on device, record state as unverified, reconcile when online.
  if (!input.isOnline) {
    return {
      condition: 'DEVICE_OFFLINE',
      isConfirmedViolation: false,
      shouldTriggerAutomaticBreak: false,
      violationType: null,
      reason: 'Device network is disconnected. State recorded as unverified without penalizing employee.',
      isOffline: true,
      isUnverified: true,
      shouldQueueDeviceWarning: true,
    };
  }

  // Safeguard 6: Transient timeouts are NOT proof of deliberate noncompliance
  if (input.geoStatus === 'TIMEOUT' || isTimeoutError(input.failureReason)) {
    return {
      condition: 'TRANSIENT_TIMEOUT',
      isConfirmedViolation: false,
      shouldTriggerAutomaticBreak: false,
      violationType: null,
      reason: 'Transient GPS timeout; not treated as deliberate noncompliance.',
      isOffline: false,
      isUnverified: false,
      shouldQueueDeviceWarning: false,
    };
  }

  // Condition 1: Location permission denied (explicit user action)
  if (input.geoStatus === 'LOCATION_DENIED') {
    return {
      condition: 'PERMISSION_DENIED',
      isConfirmedViolation: true,
      shouldTriggerAutomaticBreak: true,
      violationType: 'LOCATION_PERMISSION_DENIED',
      reason: 'Location permission was denied on the employee device.',
      isOffline: false,
      isUnverified: false,
      shouldQueueDeviceWarning: false,
    };
  }

  // Condition 2: GPS unavailable or disabled (hardware disabled, not timeout)
  if (input.geoStatus === 'LOCATION_UNAVAILABLE') {
    return {
      condition: 'GPS_UNAVAILABLE',
      isConfirmedViolation: true,
      shouldTriggerAutomaticBreak: true,
      violationType: 'GPS_DISABLED',
      reason: input.failureReason || 'Location services or GPS hardware are unavailable or disabled.',
      isOffline: false,
      isUnverified: false,
      shouldQueueDeviceWarning: false,
    };
  }

  // Condition 3: Location updates stale while clocked in
  const { freshAt } = freshnessTimes({
    last_seen_at: input.lastSeenAt,
    updated_at: input.serverReceivedAt,
  });

  if (!isFresh(freshAt, input.serverNowMs, staleMinutes)) {
    return {
      condition: 'UPDATES_STALE',
      isConfirmedViolation: true,
      shouldTriggerAutomaticBreak: true,
      violationType: 'TRACKING_STALE',
      reason: `Location updates stopped and have been stale for more than ${staleMinutes} minutes.`,
      isOffline: false,
      isUnverified: false,
      shouldQueueDeviceWarning: false,
    };
  }

  // Condition 4: Tracking active, fresh, and within expected parameters
  return {
    condition: 'TRACKING_OK',
    isConfirmedViolation: false,
    shouldTriggerAutomaticBreak: false,
    violationType: null,
    reason: 'Location tracking is active and fresh.',
    isOffline: false,
    isUnverified: false,
    shouldQueueDeviceWarning: false,
  };
}

/**
 * Generate a uniquely identifiable tracking incident ID.
 * Format: TRK-INC-<emp8>-<att8>-<timestampMs>
 */
export function generateTrackingIncidentId(employeeId: string, attendanceId: string, timestampMs: number): string {
  const emp = employeeId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  const att = attendanceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  return `TRK-INC-${emp}-${att}-${timestampMs}`;
}

/**
 * Validate that timestamp is trusted and within acceptable limits.
 * Rejects future-dated timestamps (> FUTURE_TOLERANCE_MINUTES).
 */
export function validateServerTimestamp(
  deviceTimestamp: number | null | undefined,
  serverNowMs: number,
): { valid: boolean; timestampIso: string; corrected: boolean } {
  if (typeof deviceTimestamp !== 'number' || !Number.isFinite(deviceTimestamp)) {
    return { valid: true, timestampIso: new Date(serverNowMs).toISOString(), corrected: true };
  }

  // Future-dated check
  if (deviceTimestamp - serverNowMs > FUTURE_TOLERANCE_MINUTES * 60_000) {
    return { valid: false, timestampIso: new Date(serverNowMs).toISOString(), corrected: true };
  }

  // Replays older than 24 hours
  if (serverNowMs - deviceTimestamp > 86_400_000) {
    return { valid: true, timestampIso: new Date(serverNowMs).toISOString(), corrected: true };
  }

  return { valid: true, timestampIso: new Date(deviceTimestamp).toISOString(), corrected: false };
}

/**
 * Check whether tracking has recovered from an earlier tracking-loss condition.
 */
export function isTrackingRecovered(
  previousCondition: TrackingCondition | null | undefined,
  isCurrentReadingFresh: boolean,
): boolean {
  if (!previousCondition) return false;
  const violationStates: TrackingCondition[] = ['PERMISSION_DENIED', 'GPS_UNAVAILABLE', 'UPDATES_STALE', 'DEVICE_OFFLINE'];
  return violationStates.includes(previousCondition) && isCurrentReadingFresh;
}

/**
 * Format audit description for tracking incident.
 */
export function formatIncidentAuditDescription(
  violationType: TrackingViolationType,
  incidentId: string,
  reason: string,
): string {
  const typeLabel =
    violationType === 'LOCATION_PERMISSION_DENIED' ? 'Location Permission Denied'
    : violationType === 'GPS_DISABLED' ? 'GPS Unavailable / Disabled'
    : 'Location Tracking Stale';
  return `Tracking violation confirmed: ${typeLabel}. Automatic break initiated. Reason: ${reason}. Incident ID: ${incidentId}.`;
}
