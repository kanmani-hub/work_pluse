import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { locationService } from './locationService';
import { supabase } from '../../lib/supabase';
import { breakService } from '../attendance/breakService';
import { companyDateStr } from '../../utils/companyDate';
import { nativeErrorToProblem, nativeToGeo, NATIVE_WATCHER_OPTIONS, type NativeBackgroundPlugin, type NativeLocation } from './nativeBackgroundLocation';

// Reading sources around the geofence: native background plugin (fake), browser watcher (fake),
// offline queue, resume refresh and tracking-gap returns. In-memory tables; breakService mocked so
// only the START / END decisions are observed. No device, network or database is used.
vi.mock('../attendance/breakService', () => ({ breakService: { handleAutoBreakTransition: vi.fn(async (_e: string, t: string) => ({ action: t === 'START' ? 'STARTED' : 'ENDED', breakId: 'b', complete: true })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyGeofenceEvent: vi.fn(), notifyEmployee: vi.fn(async () => {}) } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({})) } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { isEnabled: false, now: () => Date.now(), getIsoString: () => new Date().toISOString(), getRealToSimulatedInterval: (x: number) => x } }));
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, seq: 0 };
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

function setup(opts: { liveStatus?: string; lastSeenMsAgo?: number } = {}) {
  db.tables = {
    offices: [{ id: 'off1', name: 'HQ', latitude: OFFICE.lat, longitude: OFFICE.lng, geofence_radius: 50, is_active: true }],
    employees: [{ id: 'empA', first_name: 'A', employee_code: 'EMP-A', office_id: 'off1' }],
    wfh_requests: [],
    attendance: [{ id: 'attA', employee_id: 'empA', attendance_date: companyDateStr(), clock_in_at: new Date(Date.now() - 300 * MIN).toISOString(), clock_out_at: null }],
    employee_live_locations: [{ id: 'liveA', employee_id: 'empA', location_status: opts.liveStatus ?? 'INSIDE_GEOFENCE', last_seen_at: new Date(Date.now() - (opts.lastSeenMsAgo ?? 10_000)).toISOString() }],
    employee_location_history: [], geofence_events: [], location_verification_events: [],
  };
  const ls: any = locationService;
  ls.stopLiveTracking();
  ls._stability.clear(); ls._lastSeenBeforePending.clear();
  ls._trackingProblem = null; ls._trackingState = undefined;
  ls._lastReadingMs = null; ls._lastUpdate = 0; ls._lastResumeRefresh = 0; ls._pendingReadings = [];
  ls.LOCATION_TRACKING_INTERVAL_MS = 0; // no throttling in tests
  locationService.getCurrentEmployeeId = async () => 'empA';
  setNavigator({ onLine: true });
}
function setNavigator(nav: any) { Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true }); }
const fix = (m: number, atMs = Date.now(), extra: Partial<NativeLocation> = {}): NativeLocation => ({ latitude: metersNorth(m), longitude: OFFICE.lng, accuracy: 10, time: atMs, ...extra });
const live = () => db.tables.employee_live_locations[0];
const calls = (t: 'START' | 'END') => transition.mock.calls.filter(c => c[1] === t);
const flush = () => new Promise(r => setTimeout(r, 0));

/** Fake native plugin: records options and lets the test push locations / errors. */
function fakePlugin(opts: { failAdd?: boolean } = {}) {
  let cb: ((l?: NativeLocation, e?: any) => void) | null = null;
  const plugin = {
    added: [] as any[], removed: [] as string[],
    addWatcher: vi.fn(async (options: any, callback: any) => { if (opts.failAdd) throw new Error('plugin error'); plugin.added.push(options); cb = callback; return 'w1'; }),
    removeWatcher: vi.fn(async ({ id }: { id: string }) => { plugin.removed.push(id); }),
    emit: async (l?: NativeLocation, e?: any) => { cb?.(l, e); for (let i = 0; i < 20; i++) await flush(); },
  };
  return plugin as unknown as NativeBackgroundPlugin & typeof plugin;
}
async function startWith(plugin: any) {
  locationService.startLiveTracking({ loadNative: async () => plugin });
  for (let i = 0; i < 10; i++) await flush();
}

beforeEach(() => transition.mockClear());
afterEach(() => { locationService.stopLiveTracking(); setNavigator(realNavigator); });

describe('native background source (only when the plugin is installed)', () => {
  it('starts one native watcher with a visible notification text and permission request', async () => {
    setup();
    const p = fakePlugin();
    await startWith(p);
    expect(p.addWatcher).toHaveBeenCalledTimes(1);
    expect(p.added[0]).toMatchObject({ requestPermissions: true, stale: false });
    expect(p.added[0].backgroundMessage).toMatch(/location/i);
    expect(p.added[0]).toEqual(NATIVE_WATCHER_OPTIONS);
    locationService.startLiveTracking({ loadNative: async () => p }); // second start: ignored
    await flush();
    expect(p.addWatcher).toHaveBeenCalledTimes(1);
  });

  it('native readings go through the same exit rule: 2 outside fixes → one START at the first fix time', async () => {
    setup();
    const p = fakePlugin();
    await startWith(p);
    const t1 = Date.now() - 20_000;
    await p.emit(fix(90, t1));
    await p.emit(fix(92, t1 + 10_000));
    await p.emit(fix(95, t1 + 15_000));
    expect(calls('START')).toHaveLength(1);
    expect(calls('START')[0][2]).toBe(new Date(t1).toISOString());
  });

  it('a duplicate or out-of-order delivery (same/older device time) is ignored', async () => {
    setup();
    const p = fakePlugin();
    await startWith(p);
    const t = Date.now() - 5_000;
    await p.emit(fix(20, t));
    await p.emit(fix(20, t));           // duplicate
    await p.emit(fix(20, t - 60_000));  // older
    expect(db.tables.employee_location_history).toHaveLength(1);
  });

  it('permission denied in the native app → LOCATION_DENIED state + diagnostic, never an exit', async () => {
    setup();
    const p = fakePlugin();
    await startWith(p);
    await p.emit(undefined, { code: 'NOT_AUTHORIZED', message: 'Location permission denied' });
    expect(locationService.getTrackingState().status).toBe('LOCATION_DENIED');
    expect(db.tables.location_verification_events.map((e: any) => e.result)).toEqual(['LOCATION_DENIED']);
    expect(transition).not.toHaveBeenCalled();
    expect(live().location_status).toBe('INSIDE_GEOFENCE');
  });

  it('location switched off during an open break → break kept open, status unchanged', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE' });
    const p = fakePlugin();
    await startWith(p);
    await p.emit(undefined, { code: 'LOCATION_DISABLED', message: 'Location services are off' });
    expect(locationService.getTrackingState().status).toBe('LOCATION_UNAVAILABLE');
    expect(calls('END')).toHaveLength(0);
    expect(live().location_status).toBe('OUTSIDE_GEOFENCE');
  });

  it('a simulated (mock) location is refused and never stored or used', async () => {
    setup();
    const p = fakePlugin();
    await startWith(p);
    await p.emit(fix(500, Date.now(), { simulated: true }));
    await p.emit(fix(500, Date.now() + 1, { simulated: true }));
    expect(db.tables.employee_location_history).toHaveLength(0);
    expect(transition).not.toHaveBeenCalled();
  });

  it('stopping tracking removes the native watcher', async () => {
    setup();
    const p = fakePlugin();
    await startWith(p);
    locationService.stopLiveTracking();
    expect(p.removed).toEqual(['w1']);
    expect(locationService.getTrackingState().status).toBe('IDLE');
  });

  it('plugin present but failing to start → falls back to the browser watcher', async () => {
    setup();
    const watchPosition = vi.fn(() => 7);
    setNavigator({ onLine: true, geolocation: { watchPosition, clearWatch: vi.fn() } });
    await startWith(fakePlugin({ failAdd: true }));
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('no plugin (current app) → browser watcher, foreground only', async () => {
    setup();
    const watchPosition = vi.fn(() => 7);
    setNavigator({ onLine: true, geolocation: { watchPosition, clearWatch: vi.fn() } });
    await startWith(null);
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('error mapping and mock refusal are pure', () => {
    expect(nativeErrorToProblem({ code: 'NOT_AUTHORIZED' })).toBe('LOCATION_DENIED');
    expect(nativeErrorToProblem({ code: 'ANYTHING' })).toBe('LOCATION_UNAVAILABLE');
    expect(nativeErrorToProblem(null)).toBe('LOCATION_UNAVAILABLE');
    expect(nativeToGeo(fix(1, 5, { simulated: true })).status).toBe('UNKNOWN_ERROR');
    expect(nativeToGeo(fix(1, 5))).toMatchObject({ status: 'SUCCESS', timestamp: 5, accuracy: 10 });
  });
});

describe('temporary network loss and app resume', () => {
  it('offline readings are queued (nothing written), then replayed in order on reconnect', async () => {
    setup();
    setNavigator({ onLine: false });
    const t1 = Date.now() - 40_000;
    await locationService.ingestReading(nativeToGeo(fix(90, t1)));
    await locationService.ingestReading(nativeToGeo(fix(95, t1 + 10_000)));
    expect(db.tables.employee_location_history).toHaveLength(0);
    expect(transition).not.toHaveBeenCalled();
    setNavigator({ onLine: true });
    await locationService.flushPendingReadings();
    expect(calls('START')).toHaveLength(1);
    expect(calls('START')[0][2]).toBe(new Date(t1).toISOString()); // the real exit time, not the reconnect time
  });

  it('queued readings older than the accepted window are kept as history only (no break)', async () => {
    setup();
    setNavigator({ onLine: false });
    const old = Date.now() - 40 * MIN;
    await locationService.ingestReading(nativeToGeo(fix(90, old)));
    await locationService.ingestReading(nativeToGeo(fix(95, old + 10_000)));
    setNavigator({ onLine: true });
    await locationService.flushPendingReadings();
    expect(transition).not.toHaveBeenCalled();
    expect(db.tables.employee_location_history).toHaveLength(2);
  });

  it('resume takes a fresh reading at once; with the next one the return is confirmed', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE', lastSeenMsAgo: 10_000 });
    const resumeFix = fix(10, Date.now() - 2_000);
    locationService.getCurrentLocation = async () => nativeToGeo(resumeFix);
    await locationService.handleResume();
    await locationService.ingestReading(nativeToGeo(fix(12)));
    expect(calls('END')).toHaveLength(1);
    expect(calls('END')[0][2]).toBe(new Date(resumeFix.time as number).toISOString());
  });

  it('resume while GPS is off → shown as a tracking problem, no decision', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE' });
    locationService.getCurrentLocation = async () => ({ latitude: null, longitude: null, accuracy: null, timestamp: null, status: 'LOCATION_UNAVAILABLE', error: 'off' });
    await locationService.handleResume();
    expect(locationService.getTrackingState().status).toBe('LOCATION_UNAVAILABLE');
    expect(transition).not.toHaveBeenCalled();
  });
});

describe('return after a tracking gap is flagged, a normal walk-back is not', () => {
  it('phone silent for 3 h outside, then 2 inside readings → END with trackingGap.lastSeenAt', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE', lastSeenMsAgo: 180 * MIN });
    const lastSeen = live().last_seen_at;
    await locationService.ingestReading(nativeToGeo(fix(10, Date.now() - 5_000)));
    await locationService.ingestReading(nativeToGeo(fix(12)));
    expect(calls('END')).toHaveLength(1);
    expect(calls('END')[0][3]).toMatchObject({ trackingGap: { lastSeenAt: lastSeen } });
  });

  it('readings every 10 s while walking back → END without a gap flag', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE', lastSeenMsAgo: 10_000 });
    await locationService.ingestReading(nativeToGeo(fix(10, Date.now() - 5_000)));
    await locationService.ingestReading(nativeToGeo(fix(12)));
    expect(calls('END')).toHaveLength(1);
    expect(calls('END')[0][3].trackingGap).toBeUndefined();
  });
});
