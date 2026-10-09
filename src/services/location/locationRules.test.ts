import { describe, it, expect } from 'vitest';
import { classifyLocation, isUsableReading, shouldPersistCheck, isExplicitCheck, liveStatusFor } from './locationRules';
import { calculateHaversineDistance } from '../../utils/geofence';
import { initialStability, nextStability, classifyReading, BOUNDARY_BUFFER_METERS, type GeofenceReading } from './geofenceStability';
import { isLocationStale, LIVE_STALE_MINUTES } from './liveTrackingRules';

// Whitee Lotus
const OFFICE = { lat: 13.052815, lng: 80.200211 };
const RADIUS = 100;
// 1e-5 deg latitude ≈ 1.11 m
const north = (meters: number) => ({ lat: OFFICE.lat + meters / 111_195, lng: OFFICE.lng });

describe('distance (Haversine)', () => {
  it('is 0 at the office', () => {
    expect(calculateHaversineDistance(OFFICE.lat, OFFICE.lng, OFFICE.lat, OFFICE.lng)).toBe(0);
  });
  it('measures 50 m and 150 m within 1 m', () => {
    for (const m of [50, 100, 150]) {
      const p = north(m);
      const d = calculateHaversineDistance(p.lat, p.lng, OFFICE.lat, OFFICE.lng);
      expect(Math.abs(d - m) < 1).toBe(true);
    }
  });
});

const base = { geoStatus: 'SUCCESS' as const, accuracyMeters: 10, radiusMeters: RADIUS, isWfh: false, office: 'OK' as const };

describe('inside / outside 100 m', () => {
  it('inside 100 m → INSIDE', () => {
    expect(classifyLocation({ ...base, distanceMeters: 40 }).result).toBe('INSIDE');
  });
  it('exactly 100 m (boundary) → INSIDE', () => {
    expect(classifyLocation({ ...base, distanceMeters: 100 }).result).toBe('INSIDE');
  });
  it('100.1 m → OUTSIDE (single reading); stability decides if it is real', () => {
    expect(classifyLocation({ ...base, distanceMeters: 100.1 }).result).toBe('OUTSIDE');
  });
});

describe('GPS failure is never OUTSIDE', () => {
  for (const geoStatus of ['LOCATION_DENIED', 'LOCATION_UNAVAILABLE', 'TIMEOUT', 'UNKNOWN_ERROR'] as const) {
    it(`${geoStatus} → not OUTSIDE, not usable`, () => {
      const r = classifyLocation({ ...base, geoStatus, distanceMeters: null });
      expect(r.result === 'OUTSIDE').toBe(false);
      expect(isUsableReading(geoStatus, r.result)).toBe(false);
    });
  }
  it('low accuracy (> 150 m) → LOW_ACCURACY even if the point looks far away', () => {
    const r = classifyLocation({ ...base, accuracyMeters: 400, distanceMeters: 900 });
    expect(r.result).toBe('LOW_ACCURACY');
    expect(isUsableReading('SUCCESS', r.result)).toBe(false);
  });
});

describe('WFH bypass', () => {
  it('approved WFH far from the office → WFH (no geofence violation)', () => {
    expect(classifyLocation({ ...base, isWfh: true, distanceMeters: 12_000 }).result).toBe('WFH');
  });
  it('WFH with GPS failure → WFH, never an office violation', () => {
    expect(classifyLocation({ ...base, isWfh: true, geoStatus: 'LOCATION_DENIED', distanceMeters: null }).result).toBe('WFH');
    expect(classifyLocation({ ...base, isWfh: true, accuracyMeters: 500, distanceMeters: 50 }).result).toBe('WFH');
  });
  it('GPS failure without WFH does not turn into WFH', () => {
    expect(classifyLocation({ ...base, geoStatus: 'LOCATION_UNAVAILABLE', distanceMeters: null }).result).toBe('LOCATION_UNAVAILABLE');
  });
  it('live status mapping', () => {
    expect(liveStatusFor('WFH')).toBe('WFH');
    expect(liveStatusFor('OUTSIDE')).toBe('OUTSIDE_GEOFENCE');
    expect(liveStatusFor('INSIDE')).toBe('INSIDE_GEOFENCE');
  });
});

const reading = (distanceMeters: number | null, atMs: number, accuracyMeters: number | null = 10, ok = true): GeofenceReading =>
  ({ ok, distanceMeters, radiusMeters: RADIUS, accuracyMeters, atMs });

describe('jitter protection (geofenceStability)', () => {
  it('readings in the 100–120 m band keep the current side (no flip)', () => {
    expect(classifyReading(reading(110, 0), 'INSIDE')).toBe('INSIDE');
    expect(classifyReading(reading(110, 0), 'OUTSIDE')).toBe('OUTSIDE');
    expect(classifyReading(reading(RADIUS + BOUNDARY_BUFFER_METERS + 1, 0), 'INSIDE')).toBe('OUTSIDE');
  });
  it('one outside reading does not exit; two consecutive do (EXIT at the first reading time)', () => {
    let s = initialStability('INSIDE');
    let step = nextStability(s, reading(180, 1000));
    expect(step.transition).toBe(null);
    step = nextStability(step.state, reading(185, 11000));
    expect(step.transition?.to).toBe('OUTSIDE');
    expect(step.transition?.from).toBe('INSIDE');
    expect(step.transition?.atMs).toBe(1000);
  });
  it('alternating in/out jitter never produces a transition', () => {
    let s = initialStability('INSIDE');
    const seq = [130, 60, 140, 50, 150, 40];
    let transitions = 0;
    seq.forEach((d, i) => { const st = nextStability(s, reading(d, i * 10000)); if (st.transition) transitions++; s = st.state; });
    expect(transitions).toBe(0);
  });
  it('ENTER after two consecutive inside readings', () => {
    let s = initialStability('OUTSIDE');
    let step = nextStability(s, reading(30, 0));
    step = nextStability(step.state, reading(25, 10000));
    expect(step.transition?.to).toBe('INSIDE');
  });
  it('no duplicate event: staying on the new side after a transition emits nothing', () => {
    let s = initialStability('INSIDE');
    s = nextStability(s, reading(200, 0)).state;
    const t = nextStability(s, reading(200, 10000));
    expect(t.transition?.to).toBe('OUTSIDE');
    const again = nextStability(t.state, reading(210, 20000));
    expect(again.transition).toBe(null);
  });
  it('GPS failure / low accuracy readings are ignored and do not reset or advance a pending exit', () => {
    let s = initialStability('INSIDE');
    s = nextStability(s, reading(200, 0)).state;
    const denied = nextStability(s, reading(null, 5000, null, false));
    expect(denied.usable).toBe(false);
    const low = nextStability(denied.state, reading(900, 7000, 400));
    expect(low.usable).toBe(false);
    expect(low.transition).toBe(null);
    const confirm = nextStability(low.state, reading(210, 10000));
    expect(confirm.transition?.to).toBe('OUTSIDE');
  });
});

describe('stale location', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  it(`older than ${LIVE_STALE_MINUTES} min (or never) is stale`, () => {
    expect(isLocationStale({ lastSeenAt: new Date(now - 5 * 60000).toISOString() }, now)).toBe(false);
    expect(isLocationStale({ lastSeenAt: new Date(now - 16 * 60000).toISOString() }, now)).toBe(true);
    expect(isLocationStale({ lastSeenAt: null }, now)).toBe(true);
  });
});

describe('write rules', () => {
  it('background checks are stored only while clocked in; clock checks always', () => {
    expect(shouldPersistCheck('LOCATION_CHECK', false)).toBe(false);
    expect(shouldPersistCheck('LOCATION_CHECK', true)).toBe(true);
    expect(shouldPersistCheck('CLOCK_IN', false)).toBe(true);
    expect(shouldPersistCheck('CLOCK_OUT', true)).toBe(true);
  });
  it('audit/notifications only for explicit clock checks', () => {
    expect(isExplicitCheck('LOCATION_CHECK')).toBe(false);
    expect(isExplicitCheck('CLOCK_IN')).toBe(true);
  });
});
