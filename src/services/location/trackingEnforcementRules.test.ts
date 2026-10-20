import { describe, it, expect } from 'vitest';
import {
  evaluateTrackingEnforcement,
  generateTrackingIncidentId,
  validateServerTimestamp,
  isTrackingRecovered,
  isTimeoutError,
  formatIncidentAuditDescription,
  type EnforcementEvaluationInput,
} from './trackingEnforcementRules';

describe('Tracking Enforcement Pure Rules', () => {
  const baseInput: EnforcementEvaluationInput = {
    geoStatus: 'SUCCESS',
    failureReason: null,
    isOnline: true,
    isClockedIn: true,
    isClockedOut: false,
    hasActiveBreak: false,
    isWfh: false,
    lastSeenAt: new Date(1700000000000).toISOString(),
    serverReceivedAt: new Date(1700000000000).toISOString(),
    serverNowMs: 1700000000000 + 60_000, // 1 minute later
    staleMinutes: 15,
  };

  describe('Attendance and Break Safeguards', () => {
    it('does not enforce break if employee is not clocked in', () => {
      const res = evaluateTrackingEnforcement({ ...baseInput, isClockedIn: false, geoStatus: 'LOCATION_DENIED' });
      expect(res.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.condition).toBe('NOT_CLOCKED_IN');
      expect(res.isConfirmedViolation).toBe(false);
    });

    it('does not enforce break if employee has already clocked out', () => {
      const res = evaluateTrackingEnforcement({ ...baseInput, isClockedOut: true, geoStatus: 'LOCATION_DENIED' });
      expect(res.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.condition).toBe('CLOCKED_OUT');
      expect(res.isConfirmedViolation).toBe(false);
    });

    it('does not enforce break if employee is on approved WFH', () => {
      const res = evaluateTrackingEnforcement({ ...baseInput, isWfh: true, geoStatus: 'LOCATION_DENIED' });
      expect(res.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.condition).toBe('WFH_EXEMPT');
      expect(res.isConfirmedViolation).toBe(false);
    });

    it('does not create duplicate break if employee is already on an active break', () => {
      const res = evaluateTrackingEnforcement({ ...baseInput, hasActiveBreak: true, geoStatus: 'LOCATION_DENIED' });
      expect(res.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.condition).toBe('ALREADY_ON_BREAK');
      expect(res.isConfirmedViolation).toBe(false);
    });
  });

  describe('Offline and Network Disconnection', () => {
    it('does not treat offline state as deliberate noncompliance', () => {
      const res = evaluateTrackingEnforcement({
        ...baseInput,
        isOnline: false,
        geoStatus: 'LOCATION_UNAVAILABLE',
      });
      expect(res.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.condition).toBe('DEVICE_OFFLINE');
      expect(res.isOffline).toBe(true);
      expect(res.isUnverified).toBe(true);
      expect(res.shouldQueueDeviceWarning).toBe(true);
      expect(res.isConfirmedViolation).toBe(false);
    });
  });

  describe('Transient Glitches vs Confirmed Violations', () => {
    it('does not treat a single timeout as proof of deliberate noncompliance', () => {
      const res = evaluateTrackingEnforcement({
        ...baseInput,
        geoStatus: 'TIMEOUT',
        failureReason: 'Geolocation request timed out',
      });
      expect(res.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.condition).toBe('TRANSIENT_TIMEOUT');
      expect(res.isConfirmedViolation).toBe(false);
    });

    it('detects timeout from failure reason string', () => {
      expect(isTimeoutError('User request timed out')).toBe(true);
      expect(isTimeoutError('Timeout expired')).toBe(true);
      expect(isTimeoutError('User denied Geolocation')).toBe(false);
      expect(isTimeoutError(null)).toBe(false);

      const res = evaluateTrackingEnforcement({
        ...baseInput,
        geoStatus: 'LOCATION_UNAVAILABLE',
        failureReason: 'Location request timed out after 15000ms',
      });
      expect(res.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.condition).toBe('TRANSIENT_TIMEOUT');
    });

    it('confirms violation when location permission is explicitly denied', () => {
      const res = evaluateTrackingEnforcement({
        ...baseInput,
        geoStatus: 'LOCATION_DENIED',
        failureReason: 'User denied Geolocation',
      });
      expect(res.shouldTriggerAutomaticBreak).toBe(true);
      expect(res.condition).toBe('PERMISSION_DENIED');
      expect(res.violationType).toBe('LOCATION_PERMISSION_DENIED');
      expect(res.isConfirmedViolation).toBe(true);
    });

    it('confirms violation when GPS hardware is disabled or unavailable', () => {
      const res = evaluateTrackingEnforcement({
        ...baseInput,
        geoStatus: 'LOCATION_UNAVAILABLE',
        failureReason: 'Location provider disabled',
      });
      expect(res.shouldTriggerAutomaticBreak).toBe(true);
      expect(res.condition).toBe('GPS_UNAVAILABLE');
      expect(res.violationType).toBe('GPS_DISABLED');
      expect(res.isConfirmedViolation).toBe(true);
    });

    it('confirms violation when location updates are stale beyond the configured threshold', () => {
      const serverNow = 1700000000000 + 20 * 60_000; // 20 min later (threshold is 15 min)
      const res = evaluateTrackingEnforcement({
        ...baseInput,
        serverNowMs: serverNow,
        staleMinutes: 15,
      });
      expect(res.shouldTriggerAutomaticBreak).toBe(true);
      expect(res.condition).toBe('UPDATES_STALE');
      expect(res.violationType).toBe('TRACKING_STALE');
      expect(res.isConfirmedViolation).toBe(true);
    });

    it('returns TRACKING_OK when updates are fresh and valid', () => {
      const serverNow = 1700000000000 + 5 * 60_000; // 5 min later (within 15 min threshold)
      const res = evaluateTrackingEnforcement({
        ...baseInput,
        serverNowMs: serverNow,
        staleMinutes: 15,
      });
      expect(res.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.condition).toBe('TRACKING_OK');
      expect(res.isConfirmedViolation).toBe(false);
    });
  });

  describe('Deterministic Incident Identifiers', () => {
    it('generates consistent, uniquely identifiable incident IDs', () => {
      const id1 = generateTrackingIncidentId('emp-12345678-abcd', 'att-87654321-wxyz', 1700000000000);
      const id2 = generateTrackingIncidentId('emp-12345678-abcd', 'att-87654321-wxyz', 1700000000000);
      expect(id1).toBe(id2);
      expect(id1).toContain('TRK-INC-');
      expect(id1).toContain('emp12345');
      expect(id1).toContain('att87654');
    });

    it('formats audit description with incident ID and reason', () => {
      const desc = formatIncidentAuditDescription(
        'LOCATION_PERMISSION_DENIED',
        'TRK-INC-123',
        'User toggled permission off',
      );
      expect(desc).toContain('Location Permission Denied');
      expect(desc).toContain('TRK-INC-123');
      expect(desc).toContain('User toggled permission off');
    });
  });

  describe('Server Timestamp Trust and Validation', () => {
    it('uses device timestamp when valid and not in the future', () => {
      const now = 1700000000000;
      const deviceTime = now - 30_000;
      const res = validateServerTimestamp(deviceTime, now);
      expect(res.valid).toBe(true);
      expect(res.corrected).toBe(false);
      expect(new Date(res.timestampIso).getTime()).toBe(deviceTime);
    });

    it('rejects implausible future-dated device timestamps and clamps to server time', () => {
      const now = 1700000000000;
      const futureDeviceTime = now + 10 * 60_000; // 10 minutes ahead
      const res = validateServerTimestamp(futureDeviceTime, now);
      expect(res.valid).toBe(false);
      expect(res.corrected).toBe(true);
      expect(new Date(res.timestampIso).getTime()).toBe(now);
    });

    it('handles null or invalid device timestamp safely', () => {
      const now = 1700000000000;
      const res = validateServerTimestamp(null, now);
      expect(res.valid).toBe(true);
      expect(res.corrected).toBe(true);
      expect(new Date(res.timestampIso).getTime()).toBe(now);
    });
  });

  describe('Recovery Evaluation', () => {
    it('identifies tracking recovery when transitioning from violation to fresh state', () => {
      expect(isTrackingRecovered('PERMISSION_DENIED', true)).toBe(true);
      expect(isTrackingRecovered('GPS_UNAVAILABLE', true)).toBe(true);
      expect(isTrackingRecovered('UPDATES_STALE', true)).toBe(true);
      expect(isTrackingRecovered('DEVICE_OFFLINE', true)).toBe(true);
      expect(isTrackingRecovered('TRACKING_OK', true)).toBe(false);
      expect(isTrackingRecovered(null, true)).toBe(false);
      expect(isTrackingRecovered('PERMISSION_DENIED', false)).toBe(false);
    });
  });
});
