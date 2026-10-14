import { describe, it, expect } from 'vitest';
import {
  boundaryBufferMeters,
  maxExitAccuracyMeters,
  isReadingTimeAcceptable,
  classifyReading,
  initialStability,
  nextStability,
  READING_TIME_TOLERANCE_MS,
  type GeofenceReading,
} from './geofenceStability';

// Auto Break geofence exit rules (no grace period; jitter confirmation only).
const r = (distanceMeters: number | null, radiusMeters: number, atMs = 0, accuracyMeters: number | null = 10, ok = true): GeofenceReading =>
  ({ ok, distanceMeters, radiusMeters, accuracyMeters, atMs });

describe('boundary buffer scales with the office radius (was a fixed 20 m)', () => {
  it.each([
    [40, 8], [50, 10], [75, 15], [100, 20], [300, 20], [10, 5], [0, 5], [Number.NaN, 5],
  ])('radius %s m → buffer %s m', (radius, buffer) => {
    expect(boundaryBufferMeters(radius)).toBe(buffer);
  });

  it('50 m office: 58 m keeps the current side, 61 m is outside (before: needed > 70 m)', () => {
    expect(classifyReading(r(58, 50), 'INSIDE')).toBe('INSIDE');
    expect(classifyReading(r(61, 50), 'INSIDE')).toBe('OUTSIDE');
  });

  it('different offices use their own saved radius', () => {
    expect(classifyReading(r(130, 200), 'INSIDE')).toBe('INSIDE');       // 200 m office
    expect(classifyReading(r(130, 50), 'INSIDE')).toBe('OUTSIDE');       // 50 m office
    expect(classifyReading(r(219, 200), 'INSIDE')).toBe('INSIDE');       // inside 200 + 20 band
    expect(classifyReading(r(221, 200), 'INSIDE')).toBe('OUTSIDE');
  });
});

describe('GPS accuracy must be good enough to claim an exit', () => {
  it('worst accepted exit accuracy = radius, clamped to 25–150 m', () => {
    expect(maxExitAccuracyMeters(50)).toBe(50);
    expect(maxExitAccuracyMeters(10)).toBe(25);
    expect(maxExitAccuracyMeters(200)).toBe(150);
  });
  it('a ±90 m reading 120 m away cannot take an employee out of a 50 m office', () => {
    expect(classifyReading(r(120, 50, 0, 90), 'INSIDE')).toBe(null);
    const step = nextStability(initialStability('INSIDE'), r(120, 50, 0, 90));
    expect(step.usable).toBe(false);
    expect(step.transition).toBe(null);
  });
  it('a precise reading (±20 m) at the same place does count', () => {
    expect(classifyReading(r(120, 50, 0, 20), 'INSIDE')).toBe('OUTSIDE');
  });
  it('an imprecise INSIDE reading is still usable (it cannot start a break)', () => {
    expect(classifyReading(r(20, 50, 0, 90), 'OUTSIDE')).toBe('INSIDE');
  });
  it('readings worse than 150 m are never used', () => {
    expect(classifyReading(r(20, 50, 0, 151), 'OUTSIDE')).toBe(null);
  });
});

describe('exit is confirmed without any grace period', () => {
  it('inside readings never produce an exit', () => {
    let s = initialStability('INSIDE');
    for (let i = 0; i < 10; i++) {
      const step = nextStability(s, r(30, 50, i * 10_000));
      expect(step.transition).toBe(null);
      s = step.state;
    }
  });
  it('the 2nd consecutive outside reading confirms the exit at once, timed at the FIRST outside reading', () => {
    let s = initialStability('INSIDE');
    const first = nextStability(s, r(80, 50, 1_000));
    expect(first.transition).toBe(null);           // one reading may be GPS jitter
    const second = nextStability(first.state, r(85, 50, 11_000));
    expect(second.transition).toEqual({ from: 'INSIDE', to: 'OUTSIDE', atMs: 1_000 });
  });
  it('no time-based wait: two outside readings 1 second apart are enough', () => {
    const a = nextStability(initialStability('INSIDE'), r(80, 50, 0));
    const b = nextStability(a.state, r(80, 50, 1_000));
    expect(b.transition?.to).toBe('OUTSIDE');
  });
  it('a single outside reading followed by an inside one is jitter (no exit)', () => {
    const a = nextStability(initialStability('INSIDE'), r(80, 50, 0));
    const b = nextStability(a.state, r(20, 50, 10_000));
    expect(b.transition).toBe(null);
    expect(b.state.confirmed).toBe('INSIDE');
  });
});

describe('startup policy (no previously confirmed side)', () => {
  it('the first usable reading becomes the baseline: an employee already outside gets NO break at startup', () => {
    const step = nextStability(initialStability(null), r(500, 50, 0));
    expect(step.transition).toBe(null);
    expect(step.state.confirmed).toBe('OUTSIDE');
  });
  it('from that baseline, coming inside and leaving again is a real exit', () => {
    let s = nextStability(initialStability(null), r(500, 50, 0)).state;
    s = nextStability(s, r(10, 50, 10_000)).state;
    const enter = nextStability(s, r(10, 50, 20_000));
    expect(enter.transition?.to).toBe('INSIDE');
    const out1 = nextStability(enter.state, r(90, 50, 30_000));
    const out2 = nextStability(out1.state, r(90, 50, 40_000));
    expect(out2.transition).toEqual({ from: 'INSIDE', to: 'OUTSIDE', atMs: 30_000 });
  });
});

describe('reading timestamps are validated (separate from the exit rule)', () => {
  const now = Date.parse('2026-10-14T08:00:00Z');
  it(`accepts readings within ${READING_TIME_TOLERANCE_MS / 60000} minutes of now`, () => {
    expect(isReadingTimeAcceptable(now - 14 * 60_000, now)).toBe(true);
    expect(isReadingTimeAcceptable(now + 60_000, now)).toBe(true);
  });
  it('rejects delayed, future-dated and missing timestamps', () => {
    expect(isReadingTimeAcceptable(now - 16 * 60_000, now)).toBe(false);
    expect(isReadingTimeAcceptable(now + 20 * 60_000, now)).toBe(false);
    expect(isReadingTimeAcceptable(null, now)).toBe(false);
    expect(isReadingTimeAcceptable(Number.NaN, now)).toBe(false);
  });
});

describe('a reading must carry a known accuracy to confirm an exit', () => {
  it('missing / non-finite / negative accuracy outside the band → not usable for an exit', () => {
    for (const acc of [null, Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      expect(classifyReading(r(90, 50, 0, acc as any), 'INSIDE')).toBe(null);
    }
  });
  it('the same reading without accuracy still keeps an employee inside (it cannot start a break)', () => {
    expect(classifyReading(r(20, 50, 0, null), 'OUTSIDE')).toBe('INSIDE');
  });
  it('two outside readings without accuracy never produce a transition', () => {
    const a = nextStability(initialStability('INSIDE'), r(90, 50, 0, null));
    const b = nextStability(a.state, r(95, 50, 10_000, null));
    expect(b.transition).toBe(null);
    expect(b.state.confirmed).toBe('INSIDE');
  });
});
