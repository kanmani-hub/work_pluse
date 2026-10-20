import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { locationService, type GeolocationResult } from './locationService';
import { supabase } from '../../lib/supabase';
import { breakService } from '../attendance/breakService';
import { companyDateStr } from '../../utils/companyDate';

// Employee device → database: failed writes, retries, reading times, heartbeat, visibility, cleanup.
// In-memory tables with injectable failures; fake GPS. No device, network or real database is used.
vi.mock('../attendance/breakService', () => ({ breakService: { handleAutoBreakTransition: vi.fn(async (_e: string, t: string) => ({ action: t === 'START' ? 'STARTED' : 'ENDED', breakId: 'b', complete: true })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyGeofenceEvent: vi.fn(), notifyEmployee: vi.fn(async () => {}) } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({})) } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { isEnabled: false, now: () => Date.now(), getIsoString: () => new Date().toISOString(), getRealToSimulatedInterval: (x: number) => x } }));
vi.mock('../../lib/supabase', () => {
  // fail['table:op'] = number of next calls that return an error (network / server failure)
  const db: any = { tables: {}, seq: 0, fail: {} as Record<string, number> };
  const from = (t: string) => {
    const q: any = { op: 'select', filters: [], payload: null, one: null };
    const rows = () => (db.tables[t] ||= []);
    const match = (r: any) => q.filters.every(([op, c, v]: any) => op === 'eq' ? r[c] === v : op === 'in' ? v.includes(r[c]) : op === 'is' ? (r[c] ?? null) === v : true);
    const join = (r: any) => {
      if (t === 'employees') return { ...r, offices: (db.tables.offices || []).find((o: any) => o.id === r.office_id) ?? null };
      if (t === 'attendance') return { ...r, shift_template: { crosses_midnight: false } };
      return { ...r };
    };
    const run = () => {
      const key = `${t}:${q.op}`;
      if (db.fail[key] > 0) { db.fail[key]--; return { data: null, error: { message: `simulated ${q.op} failure on ${t}` } }; }
      let out: any[];
      if (q.op === 'insert') { const r = { id: `${t}-${++db.seq}`, ...q.payload }; rows().push(r); out = [r]; }
      else if (q.op === 'update') { out = rows().filter(match); out.forEach((r: any) => Object.assign(r, q.payload)); }
      else out = rows().filter(match).map(join);
      if (q.one === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'rows' } };
      if (q.one === 'maybe') return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };
    const b: any = {
      select: () => b, order: () => b, limit: () => b,
      insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: any) => { q.filters.push(['eq', c, v]); return b; },
      in: (c: string, v: any[]) => { q.filters.push(['in', c, v]); return b; },
      is: (c: string, v: any) => { q.filters.push(['is', c, v]); return b; },
      single: () => { q.one = 'single'; return b; },
      maybeSingle: () => { q.one = 'maybe'; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  return { supabase: { from, auth: { getUser: async () => ({ data: { user: null }, error: null }) }, __db: db } };
});

const db = (supabase as any).__db;
const transition = breakService.handleAutoBreakTransition as unknown as ReturnType<typeof vi.fn>;
const OFFICE = { lat: 13.0, lng: 80.0 };
const metersNorth = (m: number) => OFFICE.lat + m / 111_320;
const MIN = 60_000;
const realNavigator = (globalThis as any).navigator;
const realDocument = (globalThis as any).document;
const ls: any = locationService;

function setup(opts: { liveStatus?: string; lastSeenMsAgo?: number; noLiveRow?: boolean } = {}) {
  db.fail = {};
  db.tables = {
    offices: [{ id: 'off1', name: 'HQ', latitude: OFFICE.lat, longitude: OFFICE.lng, geofence_radius: 50, is_active: true }],
    employees: [{ id: 'empA', first_name: 'A', employee_code: 'EMP-A', office_id: 'off1' }],
    wfh_requests: [],
    attendance: [{ id: 'attA', employee_id: 'empA', attendance_date: companyDateStr(), clock_in_at: new Date(Date.now() - 300 * MIN).toISOString(), clock_out_at: null }],
    employee_live_locations: opts.noLiveRow ? [] : [{ id: 'liveA', employee_id: 'empA', location_status: opts.liveStatus ?? 'INSIDE_GEOFENCE', last_seen_at: new Date(Date.now() - (opts.lastSeenMsAgo ?? 10_000)).toISOString() }],
    employee_location_history: [], geofence_events: [], location_verification_events: [],
  };
  ls.stopLiveTracking();
  ls._stability.clear(); ls._lastSeenBeforePending.clear();
  ls._trackingProblem = null; ls._trackingState = undefined;
  ls._lastReadingMs = null; ls._lastUpdate = 0; ls._lastResumeRefresh = 0; ls._pendingReadings = [];
  ls._lastPositionMs = 0; ls._lastHeartbeatMs = 0;
  ls.LOCATION_TRACKING_INTERVAL_MS = 0; // no throttling in tests
  locationService.getCurrentEmployeeId = async () => 'empA';
  setNavigator({ onLine: true });
}
function setNavigator(nav: any) { Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true }); }
function setVisibility(state: 'visible' | 'hidden') { Object.defineProperty(globalThis, 'document', { value: { visibilityState: state }, configurable: true, writable: true }); }
const reading = (m: number, atMs: number): GeolocationResult => ({ latitude: metersNorth(m), longitude: OFFICE.lng, accuracy: 10, timestamp: atMs, status: 'SUCCESS' });
const live = () => db.tables.employee_live_locations[0];
const calls = (t: 'START' | 'END') => transition.mock.calls.filter(c => c[1] === t);

beforeEach(() => transition.mockClear());
afterEach(() => {
  locationService.stopLiveTracking();
  setNavigator(realNavigator);
  Object.defineProperty(globalThis, 'document', { value: realDocument, configurable: true, writable: true });
});

describe('failed database writes are retried, never lost silently', () => {
  it('live-location update fails → "not saved" state; the retry saves the reading with its own measured time', async () => {
    setup({ lastSeenMsAgo: 5 * MIN });
    const t1 = Date.now() - 30_000;
    db.fail['employee_live_locations:update'] = 1;
    await locationService.ingestReading(reading(10, t1));
    expect(locationService.getTrackingState().status).toBe('SYNC_FAILED');
    expect(ls._retryQueue).toHaveLength(1);
    expect(db.tables.location_verification_events).toHaveLength(1);    // the check itself was stored
    expect(db.tables.employee_location_history).toHaveLength(0);       // history waits for the retry

    await locationService.retryFailedWrites();
    expect(locationService.getTrackingState().status).toBe('ACTIVE');
    expect(ls._retryQueue).toHaveLength(0);
    expect(db.tables.location_verification_events).toHaveLength(1);    // not stored twice
    expect(db.tables.employee_location_history).toHaveLength(1);
    expect(live().last_seen_at).toBe(new Date(t1).toISOString());      // the reading time, not the retry time
    expect(db.tables.employee_location_history[0].recorded_at).toBe(new Date(t1).toISOString());
  });

  it('the check itself cannot be stored → nothing is written now; the retry stores everything once', async () => {
    setup();
    db.fail['location_verification_events:insert'] = 1;
    await locationService.ingestReading(reading(10, Date.now() - 5_000));
    expect(db.tables.location_verification_events).toHaveLength(0);
    expect(locationService.getTrackingState().status).toBe('SYNC_FAILED');
    await locationService.retryFailedWrites();
    expect(db.tables.location_verification_events).toHaveLength(1);
    expect(db.tables.employee_location_history).toHaveLength(1);
  });

  it('a retried reading is never counted twice towards leaving the office (no false automatic break)', async () => {
    setup();
    db.fail['employee_live_locations:update'] = 1;
    await locationService.ingestReading(reading(90, Date.now() - 20_000));   // first outside fix: not saved
    await locationService.retryFailedWrites();                                // same fix again
    expect(calls('START')).toHaveLength(0);                                   // one real outside fix ≠ an exit
    await locationService.ingestReading(reading(92, Date.now() - 10_000));   // second real outside fix
    expect(calls('START')).toHaveLength(1);
  });

  it('retries keep failing → back-off grows and readings stay queued in order (bounded)', async () => {
    setup();
    db.fail['employee_live_locations:update'] = 100;
    await locationService.ingestReading(reading(10, Date.now() - 20_000));
    await locationService.ingestReading(reading(11, Date.now() - 10_000));
    expect(ls._retryQueue.map((e: any) => e.geo.timestamp)).toEqual([...ls._retryQueue.map((e: any) => e.geo.timestamp)].sort());
    expect(ls._retryAttempt).toBe(1);
    expect(ls._retryTimer).not.toBeNull();
    for (let i = 0; i < 40; i++) await locationService.ingestReading(reading(10, Date.now() + i));
    expect(ls._retryQueue.length).toBeLessThanOrEqual(ls.MAX_PENDING_READINGS);
  });

  it('a failed new-row insert is retried too', async () => {
    setup({ noLiveRow: true });
    db.fail['employee_live_locations:insert'] = 1;
    await locationService.ingestReading(reading(10, Date.now() - 5_000));
    expect(db.tables.employee_live_locations).toHaveLength(0);
    await locationService.retryFailedWrites();
    expect(db.tables.employee_live_locations).toHaveLength(1);
  });
});

describe('network loss and recovery', () => {
  it('offline readings are kept and replayed with their measured times when the network returns', async () => {
    setup({ lastSeenMsAgo: 5 * MIN });
    setNavigator({ onLine: false });
    const t1 = Date.now() - 50_000;
    await locationService.ingestReading(reading(10, t1));
    expect(db.tables.employee_location_history).toHaveLength(0);
    setNavigator({ onLine: true });
    await locationService.flushPendingReadings();
    expect(db.tables.employee_location_history[0].recorded_at).toBe(new Date(t1).toISOString());
    expect(live().last_seen_at).toBe(new Date(t1).toISOString());   // not reset to the reconnect time
  });

  it('last_seen_at never moves backwards when an older reading arrives late', async () => {
    setup();
    const newer = Date.now() - 5_000;
    await locationService.ingestReading(reading(10, newer));
    ls._lastReadingMs = null; // simulate a second source delivering an older reading
    await locationService.ingestReading(reading(10, newer - 60_000));
    expect(live().last_seen_at).toBe(new Date(newer).toISOString());
  });

  it('a device time ahead of the clock is capped at now (a future time would never go stale)', async () => {
    setup();
    const before = Date.now();
    await locationService.ingestReading(reading(10, Date.now() + 60_000));
    expect(new Date(live().last_seen_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(live().last_seen_at).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('foreground heartbeat and tab visibility', () => {
  // getCurrentLocation is stubbed per test (another test file replaces it on the shared singleton)
  function stubFix(result: 'ok' | 'denied' = 'ok') {
    const fn = vi.fn(async (_opts?: { fresh?: boolean }): Promise<GeolocationResult> => result === 'ok'
      ? { latitude: metersNorth(10), longitude: OFFICE.lng, accuracy: 12, timestamp: Date.now(), status: 'SUCCESS' }
      : { latitude: null, longitude: null, accuracy: null, timestamp: null, status: 'LOCATION_DENIED', error: 'User denied Geolocation' });
    locationService.getCurrentLocation = fn as any;
    return fn;
  }

  it('visible page with no position for a minute → one FRESH fix is requested and saved', async () => {
    setup();
    setVisibility('visible');
    const fix = stubFix();
    ls._lastPositionMs = Date.now() - 2 * MIN;
    await locationService.heartbeat();
    expect(fix).toHaveBeenCalledTimes(1);
    expect(fix.mock.calls[0][0]).toEqual({ fresh: true });   // maximumAge 0: a real new measurement
    expect(db.tables.employee_location_history).toHaveLength(1);
  });

  it('hidden page → no request (a browser cannot track in the background; nothing is invented)', async () => {
    setup();
    setVisibility('hidden');
    const fix = stubFix();
    ls._lastPositionMs = Date.now() - 10 * MIN;
    await locationService.heartbeat();
    expect(fix).not.toHaveBeenCalled();
    expect(db.tables.employee_location_history).toHaveLength(0);
  });

  it('recent position → no extra request; repeated heartbeats are spaced out', async () => {
    setup();
    setVisibility('visible');
    const fix = stubFix();
    ls._lastPositionMs = Date.now() - 10_000;
    await locationService.heartbeat();
    expect(fix).not.toHaveBeenCalled();
    ls._lastPositionMs = Date.now() - 5 * MIN;
    await locationService.heartbeat();
    await locationService.heartbeat();
    expect(fix).toHaveBeenCalledTimes(1);
  });

  it('heartbeat with permission denied → reported as a problem, last_seen_at unchanged', async () => {
    setup();
    setVisibility('visible');
    stubFix('denied');
    const seenBefore = live().last_seen_at;
    ls._lastPositionMs = Date.now() - 2 * MIN;
    await locationService.heartbeat();
    expect(locationService.getTrackingState().status).toBe('LOCATION_DENIED');
    expect(db.tables.location_verification_events.map((e: any) => e.result)).toEqual(['LOCATION_DENIED']);
    expect(live().last_seen_at).toBe(seenBefore);
  });
});

describe('one watcher, one heartbeat, full cleanup', () => {
  it('starting twice creates one watcher and one heartbeat; stopping clears timers and queues', async () => {
    setup();
    const watchPosition = vi.fn(() => 7);
    const clearWatch = vi.fn();
    setNavigator({ onLine: true, geolocation: { watchPosition, clearWatch, getCurrentPosition: vi.fn() } });
    locationService.startLiveTracking({ loadNative: async () => null });
    locationService.startLiveTracking({ loadNative: async () => null });
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    expect(watchPosition).toHaveBeenCalledTimes(1);
    const hb = ls._heartbeatTimer;
    expect(hb).not.toBeNull();
    ls._startHeartbeat();
    expect(ls._heartbeatTimer).toBe(hb);

    db.fail['employee_live_locations:update'] = 5;
    await locationService.ingestReading(reading(10, Date.now() - 5_000));
    expect(ls._retryQueue).toHaveLength(1);

    locationService.stopLiveTracking();
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(ls._heartbeatTimer).toBeNull();
    expect(ls._retryTimer).toBeNull();
    expect(ls._retryQueue).toHaveLength(0);
    expect(locationService.getTrackingState().status).toBe('IDLE');
  });
});

describe('geofence status needs valid coordinates', () => {
  it('a valid reading inside the radius is stored as inside', async () => {
    setup({ liveStatus: 'INSIDE_GEOFENCE' });
    await locationService.ingestReading(reading(10, Date.now() - 1_000));
    expect(live().location_status).toBe('INSIDE_GEOFENCE');
  });

  it('impossible coordinates (0,0 / out of range) are refused: no live update, never "inside"', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE' });
    const seenBefore = live().last_seen_at;
    await locationService.verifyCurrentLocation('LOCATION_CHECK', { geo: { latitude: 0, longitude: 0, accuracy: 5, timestamp: Date.now(), status: 'SUCCESS' } });
    await locationService.verifyCurrentLocation('LOCATION_CHECK', { geo: { latitude: 123, longitude: 80, accuracy: 5, timestamp: Date.now(), status: 'SUCCESS' } });
    expect(live().location_status).toBe('OUTSIDE_GEOFENCE');
    expect(live().last_seen_at).toBe(seenBefore);
    expect(db.tables.employee_location_history).toHaveLength(0);
    expect(db.tables.location_verification_events.every((e: any) => e.result === 'ERROR')).toBe(true);
  });
});
