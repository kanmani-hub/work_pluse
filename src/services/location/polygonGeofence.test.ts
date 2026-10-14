import { describe, it, expect } from 'vitest';
import { validatePolygon, isInsidePolygon, signedDistanceToPolygonMeters, polygonAsGeofenceDistance, type LatLng } from './polygonGeofence';
import { classifyReading, nextStability, initialStability } from './geofenceStability';

// PROPOSAL module (not wired into the app). Synthetic rectangle: NOT a real building's corners.
const BASE = { lat: 13.0, lng: 80.0 };
const mNorth = (m: number) => m / 111_320;
const mEast = (m: number) => m / (111_320 * Math.cos((BASE.lat * Math.PI) / 180));
const at = (eastM: number, northM: number): LatLng => ({ lat: BASE.lat + mNorth(northM), lng: BASE.lng + mEast(eastM) });
// 60 m × 20 m long, narrow building: a circle would either cut the ends or include the car park
const BUILDING: LatLng[] = [at(-30, -10), at(30, -10), at(30, 10), at(-30, 10)];

describe('boundary validation (no invented coordinates are accepted)', () => {
  it('a real rectangle is valid', () => expect(validatePolygon(BUILDING)).toEqual({ ok: true }));
  it.each([
    ['not a list', null],
    ['two points', [at(0, 0), at(10, 0)]],
    ['bad coordinate', [at(0, 0), { lat: 999, lng: 80 }, at(0, 10)]],
    ['0,0 placeholder', [{ lat: 0, lng: 0 }, at(10, 0), at(0, 10)]],
    ['crossing edges (bow-tie)', [at(-30, -10), at(30, 10), at(30, -10), at(-30, 10)]],
    ['tiny area', [at(0, 0), at(2, 0), at(0, 2)]],
  ])('%s → rejected', (_l, pts) => {
    expect(validatePolygon(pts as any).ok).toBe(false);
  });
});

describe('inside / outside the building, in metres', () => {
  it('centre and points near the long ends are inside (a 20 m circle would call the ends outside)', () => {
    expect(isInsidePolygon(at(0, 0), BUILDING)).toBe(true);
    expect(isInsidePolygon(at(28, 0), BUILDING)).toBe(true);
    expect(isInsidePolygon(at(-28, 5), BUILDING)).toBe(true);
  });
  it('15 m north of the long wall is outside by about 5 m', () => {
    expect(isInsidePolygon(at(0, 15), BUILDING)).toBe(false);
    expect(signedDistanceToPolygonMeters(at(0, 15), BUILDING)).toBeCloseTo(5, 0);
  });
  it('inside distances are negative (distance to the nearest wall)', () => {
    expect(signedDistanceToPolygonMeters(at(0, 0), BUILDING)).toBeCloseTo(-10, 0);
  });
});

describe('polygon plugs into the existing exit rule unchanged', () => {
  it('maps to circle-equivalent inputs: inside ⇔ distance ≤ radius', () => {
    const r = polygonAsGeofenceDistance(at(0, 0), BUILDING);
    expect(r.radiusMeters).toBeCloseTo(Math.sqrt(1200 / Math.PI), 0); // 60 × 20 m
    expect(r.distanceMeters).toBeLessThanOrEqual(r.radiusMeters);
    const out = polygonAsGeofenceDistance(at(0, 40), BUILDING);
    expect(out.distanceMeters - out.radiusMeters).toBeCloseTo(30, 0);
  });
  it('just outside the wall (inside the jitter buffer) does not exit; well outside with good accuracy does', () => {
    const near = polygonAsGeofenceDistance(at(0, 13), BUILDING);  // 3 m outside the wall
    expect(classifyReading({ ok: true, ...near, accuracyMeters: 8, atMs: 0 }, 'INSIDE')).toBe('INSIDE');
    const far = polygonAsGeofenceDistance(at(0, 40), BUILDING);   // 30 m outside
    const a = nextStability(initialStability('INSIDE'), { ok: true, ...far, accuracyMeters: 8, atMs: 1_000 });
    const b = nextStability(a.state, { ok: true, ...far, accuracyMeters: 8, atMs: 11_000 });
    expect(b.transition).toEqual({ from: 'INSIDE', to: 'OUTSIDE', atMs: 1_000 });
  });
});
