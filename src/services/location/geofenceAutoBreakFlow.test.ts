import { describe, it, expect, vi, beforeEach } from 'vitest';
import { locationService } from './locationService';
import { supabase } from '../../lib/supabase';
import { breakService } from '../attendance/breakService';
import { companyDateStr } from '../../utils/companyDate';

// GPS reading → geofence decision → Auto Break START, per employee, through locationService
// (in-memory tables; the break service itself is covered in autoBreakStart.test.ts).
vi.mock('../attendance/breakService', () => ({ breakService: { handleAutoBreakTransition: vi.fn(async () => ({ action: 'STARTED', breakId: 'b', complete: true })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyGeofenceEvent: vi.fn(), notifyEmployee: vi.fn(async () => {}) } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({})) } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { isEnabled: false, now: () => Date.now(), getIsoString: () => new Date().toISOString(), getRealToSimulatedInterval: (x: number) => x } }));
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, seq: 0, failSelect: {} as Record<string, boolean> };
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
      if (q.op === 'select' && db.failSelect[t]) return { data: null, error: { code: 'XX000', message: `read of ${t} failed (simulated)` } };
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
const start = breakService.handleAutoBreakTransition as unknown as ReturnType<typeof vi.fn>;
const OFFICE = { lat: 13.0, lng: 80.0 };
const metersNorth = (m: number) => OFFICE.lat + m / 111_320; // ~1 degree latitude = 111.32 km

function setup(employees: string[], opts: { radius?: number; liveStatus?: string | null } = {}) {
  const today = companyDateStr();
  db.tables = {
    offices: [{ id: 'off1', name: 'HQ', latitude: OFFICE.lat, longitude: OFFICE.lng, geofence_radius: opts.radius ?? 50, is_active: true }],
    employees: employees.map(e => ({ id: e, first_name: e, employee_code: e.toUpperCase(), office_id: 'off1' })),
    wfh_requests: [],
    attendance: employees.map(e => ({ id: `att-${e}`, employee_id: e, attendance_date: today, clock_in_at: new Date(Date.now() - 3600e3).toISOString(), clock_out_at: null })),
    employee_live_locations: opts.liveStatus === null ? [] : employees.map(e => ({ id: `live-${e}`, employee_id: e, location_status: opts.liveStatus ?? 'INSIDE_GEOFENCE' })),
    employee_location_history: [], geofence_events: [], location_verification_events: [],
  };
  db.failSelect = {};
  (locationService as any)._stability.clear();
}
async function readingFor(emp: string, metersFromOffice: number, opts: { atMs?: number; accuracy?: number } = {}) {
  locationService.getCurrentEmployeeId = async () => emp;
  return locationService.verifyCurrentLocation('LOCATION_CHECK', {
    geo: { latitude: metersNorth(metersFromOffice), longitude: OFFICE.lng, accuracy: opts.accuracy ?? 10, timestamp: opts.atMs ?? Date.now(), status: 'SUCCESS' } as any,
  });
}
const liveStatus = (emp: string) => db.tables.employee_live_locations.find((l: any) => l.employee_id === emp)?.location_status;

beforeEach(() => start.mockClear());

describe('geofence exit → Auto Break START (no grace period)', () => {
  it('inside the office: no break', async () => {
    setup(['empA']);
    for (let i = 0; i < 3; i++) await readingFor('empA', 20);
    expect(start).not.toHaveBeenCalled();
    expect(liveStatus('empA')).toBe('INSIDE_GEOFENCE');
  });

  it('confirmed exit calls START immediately with the first outside reading time', async () => {
    setup(['empA']);
    const t1 = Date.now() - 10_000;
    await readingFor('empA', 90, { atMs: t1 });
    expect(start).not.toHaveBeenCalled();             // one reading may be jitter
    await readingFor('empA', 95, { atMs: Date.now() });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('empA', 'START', new Date(t1).toISOString(), { isWfhContext: false });
    expect(liveStatus('empA')).toBe('OUTSIDE_GEOFENCE');
    expect(db.tables.geofence_events.map((g: any) => g.event_type)).toEqual(['EXITED']);
  });

  it('50 m office: 65 m away is now an exit (the old fixed 20 m buffer needed > 70 m)', async () => {
    setup(['empA'], { radius: 50 });
    await readingFor('empA', 65);
    await readingFor('empA', 65);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('three employees are processed independently', async () => {
    setup(['empA', 'empB', 'empC']);
    await readingFor('empA', 90); await readingFor('empB', 20); await readingFor('empC', 90);
    await readingFor('empA', 90); await readingFor('empB', 20); await readingFor('empC', 90);
    expect(start.mock.calls.map(c => c[0]).sort()).toEqual(['empA', 'empC']);
    expect(liveStatus('empB')).toBe('INSIDE_GEOFENCE');
  });

  it('repeated outside readings after the exit do not start another break', async () => {
    setup(['empA']);
    for (let i = 0; i < 5; i++) await readingFor('empA', 90);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('poor accuracy for a 50 m office (±90 m) does not create a false exit', async () => {
    setup(['empA'], { radius: 50 });
    for (let i = 0; i < 4; i++) await readingFor('empA', 120, { accuracy: 90 });
    expect(start).not.toHaveBeenCalled();
    expect(liveStatus('empA')).toBe('INSIDE_GEOFENCE');
  });

  it('stale readings (delayed 30 min) do not move the geofence or start a break', async () => {
    setup(['empA']);
    const old = Date.now() - 30 * 60_000;
    await readingFor('empA', 90, { atMs: old });
    await readingFor('empA', 90, { atMs: old + 10_000 });
    expect(start).not.toHaveBeenCalled();
    expect(liveStatus('empA')).toBe('INSIDE_GEOFENCE');
    expect(db.tables.employee_location_history).toHaveLength(2); // still kept as history
  });

  it('startup policy: no previous geofence state → first reading is the baseline, no break even if outside', async () => {
    setup(['empA'], { liveStatus: null });
    await readingFor('empA', 300);
    await readingFor('empA', 300);
    expect(start).not.toHaveBeenCalled();
  });

  it('WFH lookup fails → ERROR result, no geofence decision, no break', async () => {
    setup(['empA']);
    db.failSelect.wfh_requests = true;
    const r1 = await readingFor('empA', 90);
    const r2 = await readingFor('empA', 90);
    expect(r1.result).toBe('ERROR');
    expect(r2.error?.message).toMatch(/WFH status could not be checked/);
    expect(start).not.toHaveBeenCalled();
  });

  it('live-location read fails → no geofence decision, no break, no duplicate live row', async () => {
    setup(['empA']);
    db.failSelect.employee_live_locations = true;
    await readingFor('empA', 90);
    await readingFor('empA', 90);
    expect(start).not.toHaveBeenCalled();
    expect(db.tables.employee_live_locations).toHaveLength(1);
  });

  it('approved WFH: being away from the office never starts a break', async () => {
    setup(['empA']);
    db.tables.wfh_requests.push({ id: 'w', employee_id: 'empA', request_date: companyDateStr(), status: 'APPROVED' });
    await readingFor('empA', 5000);
    await readingFor('empA', 5000);
    expect(start).not.toHaveBeenCalled();
  });
});
