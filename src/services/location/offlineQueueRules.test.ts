import { describe, it, expect } from 'vitest';
import {
  createReading, checkSession, timestampFlags, isHistoryOnly, enqueue, backoffDelayMs, nextBatch,
  classifyUploadError, applyUploadResults, shouldUpdateLive, newestReading, historyRow, DEFAULT_RETRY,
  type LocationReading,
} from './offlineQueueRules';

const T0 = new Date('2026-10-10T04:00:00Z').getTime(); // 09:30 IST
const iso = (m: number) => new Date(T0 + m * 60_000).toISOString();
let n = 0;
const id = () => `id-${++n}`;
const reading = (recMin: number, extra: Partial<LocationReading> = {}): LocationReading => ({
  ...createReading({ employeeId: 'e1', attendanceId: 'a1', latitude: 13.05, longitude: 80.21, accuracyMeters: 12, recordedAt: iso(recMin) }, id, T0 + recMin * 60_000),
  ...extra,
});

describe('queue model', () => {
  it('each reading gets its own id, device time, zero attempts', () => {
    const a = reading(0), b = reading(0);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ recordedAt: iso(0), attempts: 0, nextAttemptAt: null, flags: [] });
    expect(createReading({ employeeId: 'e', attendanceId: 'a', latitude: 1, longitude: 1, accuracyMeters: 250, recordedAt: iso(0) }, id, T0).flags).toEqual(['LOW_ACCURACY']);
  });
  it('the same reading is never queued twice', () => {
    const r = reading(0);
    const q1 = enqueue([], r, T0).queue;
    const res = enqueue(q1, r, T0);
    expect(res.added).toBe(false); expect(res.queue.length).toBe(1);
  });
  it('size limit removes the OLDEST and reports them (nothing silent)', () => {
    let q: LocationReading[] = [];
    const all = [reading(3), reading(1), reading(2)];
    let overflow: LocationReading[] = [];
    for (const r of all) { const res = enqueue(q, r, T0 + 10 * 60_000, { maxItems: 2, maxAgeHours: 72 }); q = res.queue; overflow = overflow.concat(res.overflow); }
    expect(q.map(x => x.recordedAt)).toEqual([iso(2), iso(3)]);
    expect(overflow.map(x => x.recordedAt)).toEqual([iso(1)]);
  });
  it('readings older than the age limit are expired and reported', () => {
    const old = reading(-80 * 60);
    const res = enqueue([old], reading(0), T0, { maxItems: 100, maxAgeHours: 72 });
    expect(res.expired.map(x => x.id)).toEqual([old.id]); expect(res.queue.length).toBe(1);
  });
});

describe('session boundaries (clock-in / clock-out, incl. automatic clock-out)', () => {
  const s = { attendanceId: 'a1', clockInAt: iso(0), clockOutAt: iso(480) };
  it('inside the session is OK; small clock drift tolerated', () => {
    expect(checkSession(reading(10), s)).toBe('OK');
    expect(checkSession(reading(-1), s)).toBe('OK');
    expect(checkSession(reading(481), s)).toBe('OK');
  });
  it('before clock-in / after clock-out / other session / invalid are not uploaded', () => {
    expect(checkSession(reading(-10), s)).toBe('BEFORE_CLOCK_IN');
    expect(checkSession(reading(500), s)).toBe('AFTER_CLOCK_OUT');
    expect(checkSession(reading(10, { attendanceId: 'a2' }), s)).toBe('WRONG_SESSION');
    expect(checkSession(reading(10, { latitude: 120 }), s)).toBe('INVALID');
    expect(checkSession(reading(10, { recordedAt: 'nope' }), s)).toBe('INVALID');
  });
  it('an open session has no upper bound', () => {
    expect(checkSession(reading(900), { ...s, clockOutAt: null })).toBe('OK');
  });
});

describe('timestamps', () => {
  it('future and recorded-after-queued times are flagged for review; the stored time is unchanged', () => {
    const r = reading(30, { queuedAt: iso(0) });
    const f = timestampFlags(r, T0);
    expect(f).toContain('FUTURE_TIMESTAMP'); expect(f).toContain('RECORDED_AFTER_QUEUED');
    expect(r.recordedAt).toBe(iso(30));
  });
  it('late uploads are history-only (no retroactive breaks / geofence alerts)', () => {
    const r = reading(0);
    expect(isHistoryOnly(r, T0 + 60_000)).toBe(false);
    expect(isHistoryOnly(r, T0 + 30 * 60_000)).toBe(true);
    expect(timestampFlags(r, T0 + 30 * 60_000)).toContain('LATE_UPLOAD');
  });
});

describe('retry and upload results', () => {
  it('delays grow and are capped', () => {
    expect([1, 2, 3].map(a => backoffDelayMs(a))).toEqual([15_000, 30_000, 60_000]);
    expect(backoffDelayMs(50)).toBe(DEFAULT_RETRY.maxMs);
  });
  it('errors are classified: duplicate = already uploaded, network = retry, permission = held', () => {
    expect(classifyUploadError(null)).toBe('SAVED');
    expect(classifyUploadError({ code: '23505' })).toBe('DUPLICATE');
    expect(classifyUploadError({ message: 'Failed to fetch' })).toBe('RETRY');
    expect(classifyUploadError({ status: 503 })).toBe('RETRY');
    expect(classifyUploadError({ status: 429 })).toBe('RETRY');
    expect(classifyUploadError({ code: '42501' })).toBe('REJECTED');
    expect(classifyUploadError({ status: 400 })).toBe('REJECTED');
  });
  it('saved and duplicate leave; retry is rescheduled; rejected is held for review, never dropped', () => {
    const [a, b, c, d] = [reading(1), reading(2), reading(3), reading(4)];
    const res = applyUploadResults([a, b, c, d], { [a.id]: { outcome: 'SAVED' }, [b.id]: { outcome: 'DUPLICATE' }, [c.id]: { outcome: 'RETRY', error: 'offline' }, [d.id]: { outcome: 'REJECTED', error: 'RLS' } }, T0);
    expect(res.uploaded).toEqual([a.id, b.id]);
    expect(res.queue.map(x => x.id)).toEqual([c.id]);
    expect(res.queue[0]).toMatchObject({ attempts: 1, lastError: 'offline', nextAttemptAt: new Date(T0 + 15_000).toISOString() });
    expect(res.heldForReview.map(x => x.id)).toEqual([d.id]);
  });
  it('too many failed attempts → held for review', () => {
    const r = reading(1, { attempts: DEFAULT_RETRY.maxAttempts - 1 });
    expect(applyUploadResults([r], { [r.id]: { outcome: 'RETRY' } }, T0).heldForReview.length).toBe(1);
  });
  it('batches are due readings in recorded order (offline backlog uploads oldest first)', () => {
    const later = reading(5), early = reading(1), notDue = reading(3, { nextAttemptAt: iso(60) });
    expect(nextBatch([later, notDue, early], T0 + 10 * 60_000).map(x => x.id)).toEqual([early.id, later.id]);
    expect(nextBatch([later, early], T0 + 10 * 60_000, 1).map(x => x.id)).toEqual([early.id]);
  });
});

describe('newest reading wins for the live location', () => {
  it('an older queued reading never overwrites a newer live location', () => {
    expect(shouldUpdateLive(iso(10), iso(5))).toBe(false);
    expect(shouldUpdateLive(iso(10), iso(10))).toBe(false);
    expect(shouldUpdateLive(iso(10), iso(11))).toBe(true);
    expect(shouldUpdateLive(null, iso(1))).toBe(true);
    expect(shouldUpdateLive(iso(10), 'bad')).toBe(false);
  });
  it('only the newest reading of a batch is a live-location candidate', () => {
    const a = reading(3), b = reading(9), c = reading(1);
    expect(newestReading([a, b, c])?.id).toBe(b.id); expect(newestReading([])).toBe(null);
  });
});

describe('history row for the existing table', () => {
  it('keeps the client id (duplicate-safe), device time and flags; source MOBILE', () => {
    const r = reading(0);
    const row = historyRow(r, { officeId: 'o1', distanceMeters: 5, locationStatus: 'INSIDE_GEOFENCE', locationContext: 'OFFICE' }, T0 + 30 * 60_000, '1.0.0');
    expect(row).toMatchObject({ id: r.id, recorded_at: iso(0), source: 'MOBILE', employee_id: 'e1', attendance_id: 'a1' });
    expect(row.metadata).toMatchObject({ device_recorded_at: iso(0), history_only: true, needs_review: false, upload_attempts: 1 });
    expect((row as any).created_at).toBe(undefined); // server receive time is set by the database
  });
});
