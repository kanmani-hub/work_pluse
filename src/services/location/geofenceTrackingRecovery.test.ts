import { describe, it, expect, vi, beforeEach } from 'vitest';
import { locationService } from './locationService';
import { supabase } from '../../lib/supabase';
import { breakService } from '../attendance/breakService';
import { companyDateStr } from '../../utils/companyDate';

// Location loss, app restarts and baselines around Auto Break, through locationService
// (in-memory tables; breakService is mocked so only the START / END decision is observed).
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
  // report_tracking_event (automatic-break tracking): the server decides; here it records nothing
  const rpc = vi.fn(async (_fn: string, _args: any) => ({ data: { action: 'NONE' }, error: null }));
  return { supabase: { from, rpc, auth: { getUser: async () => ({ data: { user: null }, error: null }) }, __db: db } };
});

const db = (supabase as any).__db;
const transition = breakService.handleAutoBreakTransition as unknown as ReturnType<typeof vi.fn>;
const OFFICE = { lat: 13.0, lng: 80.0 };
const metersNorth = (m: number) => OFFICE.lat + m / 111_320;
const YESTERDAY_EVENING = () => new Date(Date.now() - 14 * 3600e3).toISOString();

function setup(opts: { liveStatus?: string | null; clockedIn?: boolean; office?: boolean } = {}) {
  const today = companyDateStr();
  db.tables = {
    offices: [{ id: 'off1', name: 'HQ', latitude: OFFICE.lat, longitude: OFFICE.lng, geofence_radius: 50, is_active: true }],
    employees: [{ id: 'empA', first_name: 'A', employee_code: 'EMP-A', office_id: opts.office === false ? null : 'off1' }],
    wfh_requests: [],
    attendance: opts.clockedIn === false ? [] : [{ id: 'attA', employee_id: 'empA', attendance_date: today, clock_in_at: new Date(Date.now() - 3600e3).toISOString(), clock_out_at: null }],
    employee_live_locations: opts.liveStatus === null ? [] : [{ id: 'liveA', employee_id: 'empA', location_status: opts.liveStatus ?? 'INSIDE_GEOFENCE', last_seen_at: YESTERDAY_EVENING() }],
    employee_location_history: [], geofence_events: [], location_verification_events: [],
  };
  restartApp();
}
/** A page refresh / app restart: nothing in memory survives, only the database. */
function restartApp() {
  (locationService as any)._stability.clear();
  (locationService as any)._trackingProblem = null;
  (locationService as any)._trackingState = undefined;
  locationService.getCurrentEmployeeId = async () => 'empA';
}
async function reading(metersFromOffice: number, opts: { atMs?: number; accuracy?: number | null; lat?: number; lng?: number; type?: 'LOCATION_CHECK' | 'CLOCK_IN' } = {}) {
  return locationService.verifyCurrentLocation(opts.type ?? 'LOCATION_CHECK', {
    geo: {
      latitude: opts.lat ?? metersNorth(metersFromOffice), longitude: opts.lng ?? OFFICE.lng,
      accuracy: opts.accuracy === undefined ? 10 : opts.accuracy, timestamp: opts.atMs ?? Date.now(), status: 'SUCCESS',
    } as any,
  });
}
async function gpsFailure(status: 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'TIMEOUT') {
  return locationService.verifyCurrentLocation('LOCATION_CHECK', {
    geo: { latitude: null, longitude: null, accuracy: null, timestamp: null, status, error: 'simulated' } as any,
  });
}
const live = () => db.tables.employee_live_locations[0];
const calls = (t: 'START' | 'END') => transition.mock.calls.filter(c => c[1] === t);

beforeEach(() => transition.mockClear());

describe('location switched off / unavailable is never an exit', () => {
  it('before any exit: GPS off or denied → no break, geofence side and last-seen time unchanged', async () => {
    setup({ liveStatus: 'INSIDE_GEOFENCE' });
    const before = { ...live() };
    for (const s of ['LOCATION_UNAVAILABLE', 'LOCATION_DENIED', 'TIMEOUT'] as const) await gpsFailure(s);
    expect(transition).not.toHaveBeenCalled();
    expect(live().location_status).toBe('INSIDE_GEOFENCE');
    expect(live().last_seen_at).toBe(before.last_seen_at);
  });

  it('the failure itself is recorded as a diagnostic (verification event), never as a location', async () => {
    setup();
    await gpsFailure('LOCATION_DENIED');
    expect(db.tables.location_verification_events.map((e: any) => e.result)).toEqual(['LOCATION_DENIED']);
    expect(db.tables.employee_location_history).toHaveLength(0);
  });

  it('after a confirmed exit: losing location keeps the break open (no invented return)', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE' }); // break already started earlier
    await gpsFailure('LOCATION_UNAVAILABLE');
    await gpsFailure('LOCATION_DENIED');
    expect(calls('END')).toHaveLength(0);
    expect(live().location_status).toBe('OUTSIDE_GEOFENCE');
  });
});

describe('the open break survives a refresh / restart and ends on a confirmed return', () => {
  it('stored OUTSIDE + restart + two inside readings → END at the first inside reading', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE' });
    restartApp();
    const firstInside = Date.now() - 15_000;
    await reading(10, { atMs: firstInside });
    expect(calls('END')).toHaveLength(0);       // one reading may be jitter
    await reading(12);
    expect(calls('END')).toHaveLength(1);
    expect(calls('END')[0][2]).toBe(new Date(firstInside).toISOString());
    expect(live().location_status).toBe('INSIDE_GEOFENCE');
  });

  it('a single inside reading before the app closes again does not end the break', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE' });
    await reading(10);
    restartApp();
    await reading(90);
    await reading(90);
    expect(calls('END')).toHaveLength(0);
    expect(calls('START')).toHaveLength(0);     // still the same open break, not a new one
  });
});

describe('clock-in sets a fresh baseline', () => {
  it("yesterday's OUTSIDE status + clock-in inside + app closed → today's exit still starts a break", async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE', clockedIn: false });
    await reading(10, { type: 'CLOCK_IN' });   // verified inside at clock-in, then the app is closed
    expect(live().location_status).toBe('INSIDE_GEOFENCE');
    expect(db.tables.geofence_events).toHaveLength(0); // baseline only: no "returned" event / notification
    expect(transition).not.toHaveBeenCalled();
    // clocked in; later the employee walks out with the app open
    db.tables.attendance.push({ id: 'attA', employee_id: 'empA', attendance_date: companyDateStr(), clock_in_at: new Date().toISOString(), clock_out_at: null });
    restartApp();
    await reading(90);
    await reading(90);
    expect(calls('START')).toHaveLength(1);
  });

  it('a clock-in reading that is outside (WFH or rejected) does not reset the baseline', async () => {
    setup({ liveStatus: 'OUTSIDE_GEOFENCE', clockedIn: false });
    await reading(300, { type: 'CLOCK_IN' });
    expect(live().location_status).toBe('OUTSIDE_GEOFENCE');
  });
});

describe('implausible or incomplete readings never decide an exit', () => {
  it('unknown accuracy (null) cannot confirm an exit', async () => {
    setup();
    await reading(90, { accuracy: null });
    await reading(90, { accuracy: null });
    expect(transition).not.toHaveBeenCalled();
    expect(live().location_status).toBe('INSIDE_GEOFENCE');
  });

  it.each([
    ['latitude out of range', { lat: 123.4 }],
    ['longitude out of range', { lng: -200 }],
    ['0,0 (no fix)', { lat: 0, lng: 0 }],
    ['negative accuracy', { accuracy: -5 }],
  ])('%s → no geofence decision, no break', async (_label, o: any) => {
    setup();
    await reading(90, o);
    await reading(90, o);
    expect(transition).not.toHaveBeenCalled();
    expect(live().location_status).toBe('INSIDE_GEOFENCE');
  });

  it('future-dated readings (+20 min) do not move the geofence', async () => {
    setup();
    const future = Date.now() + 20 * 60_000;
    await reading(90, { atMs: future });
    await reading(90, { atMs: future + 10_000 });
    expect(transition).not.toHaveBeenCalled();
  });

  it('no office assigned → ERROR result, no break', async () => {
    setup({ office: false });
    const r = await reading(5000);
    await reading(5000);
    expect(r.result).toBe('ERROR');
    expect(transition).not.toHaveBeenCalled();
  });
});

describe('tracking problems from the GPS watcher are recorded once, not every 10 seconds', () => {
  it('records on change of problem, exposes the state, and clears it on the next good reading', async () => {
    setup();
    await locationService.reportTrackingProblem('LOCATION_UNAVAILABLE', 'Position unavailable');
    await locationService.reportTrackingProblem('LOCATION_UNAVAILABLE', 'Position unavailable');
    await locationService.reportTrackingProblem('LOCATION_UNAVAILABLE', 'Position unavailable');
    expect(db.tables.location_verification_events.map((e: any) => e.result)).toEqual(['LOCATION_UNAVAILABLE']);
    expect(locationService.getTrackingState().status).toBe('LOCATION_UNAVAILABLE');
    await locationService.reportTrackingProblem('LOCATION_DENIED', 'User denied');
    expect(db.tables.location_verification_events.map((e: any) => e.result)).toEqual(['LOCATION_UNAVAILABLE', 'LOCATION_DENIED']);
    expect(locationService.getTrackingState().status).toBe('LOCATION_DENIED');
    await reading(10);
    expect(locationService.getTrackingState().status).toBe('ACTIVE');
    expect(transition).not.toHaveBeenCalled();
  });

  it('not clocked in → nothing is written (no off-duty tracking), state still shown to the employee', async () => {
    setup({ clockedIn: false });
    await locationService.reportTrackingProblem('LOCATION_DENIED', 'User denied');
    expect(db.tables.location_verification_events).toHaveLength(0);
    expect(locationService.getTrackingState().status).toBe('LOCATION_DENIED');
  });
});
