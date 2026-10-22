import { describe, it, expect } from 'vitest';
import {
  isAutomaticBreak, isTrackingBreak, breakSourceLabel, autoBreakReasonLabel, breakEndedReasonLabel, recoveryInstruction,
  trackingStateView, mapAutoBreakResult, trackingEventFor, shouldSendTrackingEvent, TRACKING_EVENT_REPEAT_MS,
} from './automaticBreakRules';

describe('automatic vs manual breaks', () => {
  it('AUTO_GPS, AUTO_TRACKING and SYSTEM-sourced breaks are automatic; REGULAR is manual', () => {
    expect(isAutomaticBreak({ break_type: 'AUTO_GPS' })).toBe(true);
    expect(isAutomaticBreak({ break_type: 'AUTO_TRACKING' })).toBe(true);
    expect(isAutomaticBreak({ break_type: 'REGULAR', source: 'SYSTEM' })).toBe(true);
    expect(isAutomaticBreak({ break_type: 'REGULAR', source: 'EMPLOYEE' })).toBe(false);
    expect(isAutomaticBreak(null)).toBe(false);
    expect(isTrackingBreak({ break_type: 'AUTO_TRACKING' })).toBe(true);
    expect(isTrackingBreak({ break_type: 'AUTO_GPS' })).toBe(false);
  });
  it('source labels', () => {
    expect(breakSourceLabel({ break_type: 'AUTO_TRACKING', source: 'SYSTEM' })).toBe('Automatic');
    expect(breakSourceLabel({ break_type: 'REGULAR', source: 'EMPLOYEE' })).toBe('Manual');
    expect(breakSourceLabel({ break_type: 'REGULAR', source: 'ADMIN' })).toBe('Admin');
  });
  it('reason labels, including rows created before the reason column existed', () => {
    expect(autoBreakReasonLabel({ break_type: 'AUTO_TRACKING', reason: 'LOCATION_PERMISSION_DENIED' })).toBe('Location permission denied');
    expect(autoBreakReasonLabel({ break_type: 'AUTO_TRACKING', reason: 'NETWORK_DISCONNECTED' })).toBe('Network disconnected');
    expect(autoBreakReasonLabel({ break_type: 'AUTO_GPS', reason: null })).toBe('Left the office geofence');
    expect(autoBreakReasonLabel({ break_type: 'REGULAR' })).toBe('');
    expect(breakEndedReasonLabel({ ended_reason: 'TRACKING_RESTORED' })).toBe('Tracking restored');
    expect(breakEndedReasonLabel({ ended_reason: null })).toBe('');
  });
  it('recovery instructions never offer a manual "Resume Work" and say reconnecting alone is not enough', () => {
    expect(recoveryInstruction({ break_type: 'AUTO_TRACKING', reason: 'LOCATION_PERMISSION_DENIED' })).toMatch(/permission/i);
    expect(recoveryInstruction({ break_type: 'AUTO_TRACKING', reason: 'NETWORK_DISCONNECTED' })).toMatch(/reconnecting alone is not enough/);
    expect(recoveryInstruction({ break_type: 'AUTO_GPS' })).toMatch(/back inside the office/);
    for (const r of ['LOCATION_PERMISSION_DENIED', 'GPS_UNAVAILABLE', 'TRACKING_STALE']) {
      expect(recoveryInstruction({ break_type: 'AUTO_TRACKING', reason: r })).not.toMatch(/resume work button|press/i);
    }
  });
});

describe('server tracking state wording (explicit model, never a vague "not updating")', () => {
  it('each state has its own label', () => {
    const labels = ['TRACKING_OK', 'TRACKING_RESTORED', 'PERMISSION_DENIED', 'GPS_UNAVAILABLE', 'GPS_TIMEOUT', 'LOCATION_ERROR', 'WAITING_FOR_FIX', 'STALE']
      .map((s) => trackingStateView(s).label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain('Not updating');
    expect(trackingStateView('STALE').tone).toBe('stale');
    expect(trackingStateView('GPS_TIMEOUT').detail).toMatch(/does not start a break/);
    expect(trackingStateView(undefined).tone).toBe('unknown');
  });
});

describe('mapping server results', () => {
  it('STARTED / ENDED / NONE keep the shape existing callers use', () => {
    expect(mapAutoBreakResult({ action: 'STARTED', break_id: 'b1', started_at: 't' })).toEqual({ action: 'STARTED', breakId: 'b1', startedAt: 't', complete: true });
    const ended = mapAutoBreakResult({ action: 'ENDED', break_id: 'b1', duration_minutes: 12, actual: 70, allowed: 60, overrun: 10, tracking_gap: true });
    expect(ended).toMatchObject({ action: 'ENDED', breakId: 'b1', durationMinutes: 12, totalsUpdated: true, actual: 70, allowed: 60, overrun: 10, trackingGap: true });
    expect(mapAutoBreakResult({ action: 'NONE', reason: 'WFH' })).toEqual({ action: 'NONE', reason: 'WFH' });
  });
  it('missing or malformed results are errors, never success', () => {
    expect(mapAutoBreakResult(null).action).toBe('ERROR');
    expect(mapAutoBreakResult({ action: 'STARTED' }).action).toBe('ERROR');
    expect(mapAutoBreakResult({ weird: 1 }).action).toBe('ERROR');
  });
});

describe('device event reporting', () => {
  it('maps watcher problems to server events; timeouts stay timeouts', () => {
    expect(trackingEventFor('LOCATION_DENIED')).toBe('LOCATION_DENIED');
    expect(trackingEventFor('LOCATION_UNAVAILABLE')).toBe('LOCATION_UNAVAILABLE');
    expect(trackingEventFor('TIMEOUT')).toBe('TIMEOUT');
    expect(trackingEventFor('UNKNOWN_ERROR')).toBe('UNKNOWN_ERROR');
  });
  it('sends immediately on change (zero grace), then at most once a minute while it persists', () => {
    const t0 = 1_000_000;
    expect(shouldSendTrackingEvent(null, 'LOCATION_DENIED', t0)).toBe(true);
    const last = { event: 'LOCATION_DENIED', sentAtMs: t0 };
    expect(shouldSendTrackingEvent(last, 'LOCATION_DENIED', t0 + 10_000)).toBe(false);
    expect(shouldSendTrackingEvent(last, 'LOCATION_UNAVAILABLE', t0 + 10_000)).toBe(true);
    expect(shouldSendTrackingEvent(last, 'LOCATION_DENIED', t0 + TRACKING_EVENT_REPEAT_MS)).toBe(true);
  });
});
