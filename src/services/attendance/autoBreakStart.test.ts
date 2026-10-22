import { describe, it, expect, vi, beforeEach } from 'vitest';
import { breakService } from './breakService';
import { supabase } from '../../lib/supabase';
import { notificationService } from '../notifications/notificationService';
import { summarizeBreakDay } from './breakSummaryRules';
import { companyDateStr } from '../../utils/companyDate';

// Auto Break START / END on a confirmed geofence exit / return. Since migration 20261021120000 the break
// itself is created and closed by the database (geofence_auto_break, database time, server checks);
// those rules are tested against PostgreSQL in supabase/tests/autobreak/run_autobreak_db_tests.mjs.
// Here: the client calls the server correctly and never writes a break itself. In-memory tables;
// failSelect / failWrite make the n-th read / write on a table fail like a PostgREST error;
// uniqueOnInsert simulates the database refusing a second open break (23505).
vi.mock('./attendanceService', () => ({ attendanceService: { getCurrentEmployeeId: vi.fn() } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({ data: {}, error: null })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn(() => Promise.resolve()) } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { isEnabled: false, getIsoString: () => new Date().toISOString(), now: () => Date.now() } }));
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, seq: 0, failSelect: [], selects: {}, failWrite: [], writes: {}, uniqueOnInsert: false };
  const from = (t: string) => {
    const q: any = { op: 'select', filters: [], payload: null, one: null };
    const rows = () => (db.tables[t] ||= []);
    const match = (r: any) => q.filters.every(([op, c, v]: any) =>
      op === 'eq' ? r[c] === v : op === 'is' ? (r[c] ?? null) === v : op === 'in' ? v.includes(r[c]) : true);
    const withJoins = (r: any) => (t === 'attendance' ? { ...r, shift_template: (db.tables.shift_templates || []).find((s: any) => s.id === r.shift_template_id) ?? null } : { ...r });
    const run = () => {
      if (q.op === 'select') {
        db.selects[t] = (db.selects[t] || 0) + 1;
        if (db.failSelect.some((f: any) => f.table === t && f.nth === db.selects[t])) return { data: null, error: { code: 'XX000', message: `read of ${t} failed (simulated)` } };
      } else {
        db.writes[t] = (db.writes[t] || 0) + 1;
        if (db.failWrite.some((f: any) => f.table === t && f.nth === db.writes[t])) return { data: null, error: { code: 'XX000', message: `write to ${t} failed (simulated)` } };
      }
      let out: any[];
      if (q.op === 'insert') {
        if (t === 'attendance_breaks' && db.uniqueOnInsert) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        const r = { id: `${t}-${++db.seq}`, ...q.payload }; rows().push(r); out = [r];
      }
      else if (q.op === 'update') { out = rows().filter(match); out.forEach((r: any) => Object.assign(r, q.payload)); out = out.map(withJoins); }
      else out = rows().filter(match).map(withJoins);
      if (q.one === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'multiple (or no) rows' } };
      if (q.one === 'maybe') return out.length > 1 ? { data: null, error: { code: 'PGRST116', message: 'multiple rows' } } : { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };
    const b: any = {
      select: () => b,
      insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: any) => { q.filters.push(['eq', c, v]); return b; },
      is: (c: string, v: any) => { q.filters.push(['is', c, v]); return b; },
      in: (c: string, v: any[]) => { q.filters.push(['in', c, v]); return b; },
      order: () => b, limit: () => b,
      single: () => { q.one = 'single'; return b; },
      maybeSingle: () => { q.one = 'maybe'; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  return { supabase: { from, rpc: vi.fn(), __db: db } };
});

const db = (supabase as any).__db;
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const today = () => companyDateStr();

function attendanceRow(id: string, emp: string, extra: any = {}) {
  return { id, employee_id: emp, attendance_date: today(), clock_in_at: ago(240 * MIN), clock_out_at: null,
    shift_template_id: 'day', status: 'WORKING', late_minutes: 0, break_minutes: 0, break_overrun_minutes: 0, created_at: ago(240 * MIN), ...extra };
}
function setup(attendance: any[], breaks: any[] = [], wfh: any[] = []) {
  db.tables = {
    shift_templates: [{ id: 'day', crosses_midnight: false, break_duration_minutes: 60 }, { id: 'night', crosses_midnight: true, break_duration_minutes: 30 }],
    attendance, attendance_breaks: breaks, attendance_events: [], wfh_requests: wfh,
  };
  db.seq = 0; db.failSelect = []; db.selects = {}; db.failWrite = []; db.writes = {}; db.uniqueOnInsert = false;
}

beforeEach(() => vi.clearAllMocks());

const rpc = () => (supabase as any).rpc as any;

describe('geofence transitions are delegated to the server (geofence_auto_break)', () => {
  it('START → calls the server with the transition; the result is mapped; the browser writes nothing', async () => {
    setup([attendanceRow('attA', 'empA')]);
    rpc().mockResolvedValueOnce({ data: { action: 'STARTED', break_id: 'srv-1', started_at: 'srv-time', reason: 'GEOFENCE_EXIT' }, error: null });
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(rpc()).toHaveBeenCalledWith('geofence_auto_break', { p_transition: 'START', p_tracking_gap_last_seen: null });
    expect(r).toEqual({ action: 'STARTED', breakId: 'srv-1', startedAt: 'srv-time', complete: true });
    expect(db.writes).toEqual({});
    expect(notificationService.notifyEmployee).not.toHaveBeenCalled();   // the server notifies once
  });

  it('END with a tracking gap passes the last-seen time; ENDED carries the server totals', async () => {
    setup([attendanceRow('attA', 'empA')]);
    rpc().mockResolvedValueOnce({ data: { action: 'ENDED', break_id: 'srv-1', duration_minutes: 42, actual: 102, allowed: 60, overrun: 42, tracking_gap: true }, error: null });
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(10_000), { trackingGap: { lastSeenAt: 'last-seen-iso' } });
    expect(rpc()).toHaveBeenCalledWith('geofence_auto_break', { p_transition: 'END', p_tracking_gap_last_seen: 'last-seen-iso' });
    expect(r).toMatchObject({ action: 'ENDED', breakId: 'srv-1', durationMinutes: 42, totalsUpdated: true, actual: 102, overrun: 42, trackingGap: true });
  });

  it('server "no break" decisions are passed through (WFH, already active, not clocked in, after shift end)', async () => {
    setup([attendanceRow('attA', 'empA')]);
    for (const reason of ['WFH', 'BREAK_ALREADY_ACTIVE', 'NOT_CLOCKED_IN', 'AFTER_SHIFT_END', 'NO_ACTIVE_AUTO_BREAK']) {
      rpc().mockResolvedValueOnce({ data: { action: 'NONE', reason }, error: null });
      const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
      expect(r).toEqual({ action: 'NONE', reason });
    }
    expect(db.writes).toEqual({});
  });

  it('a WFH context known on the device skips the call for START', async () => {
    setup([attendanceRow('attA', 'empA')]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000), { isWfhContext: true });
    expect(r).toEqual({ action: 'NONE', reason: 'WFH' });
    expect(rpc()).not.toHaveBeenCalled();
  });

  it('server refusal or unreachable server → ERROR (never a false break or false success)', async () => {
    setup([attendanceRow('attA', 'empA')]);
    rpc().mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    expect((await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000))).action).toBe('ERROR');
    rpc().mockRejectedValueOnce(new Error('Failed to fetch'));
    expect((await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000))).action).toBe('ERROR');
    rpc().mockResolvedValueOnce({ data: { action: 'STARTED' }, error: null });   // malformed
    expect((await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000))).action).toBe('ERROR');
    expect(db.writes).toEqual({});
  });

  it.each([
    ['delayed by 20 minutes', () => ago(20 * MIN)],
    ['20 minutes in the future', () => new Date(Date.now() + 20 * MIN).toISOString()],
    ['unparseable', () => 'not-a-time'],
  ])('transition time %s → ERROR, the server is not called, nothing written', async (_label, t) => {
    setup([attendanceRow('attA', 'empA')]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', t());
    expect(r.action).toBe('ERROR');
    expect(rpc()).not.toHaveBeenCalled();
    expect(db.writes).toEqual({});
  });
});

describe('Admin Breaks summary is per employee and per attendance day', () => {
  it('A (completed auto break), B (completed manual break), C (active break), D (none) are summarised independently', () => {
    const now = Date.now();
    const mk = (id: string, breaks: any[]) => ({ id, attendance_date: today(), clock_out_at: null, shift_template: { break_duration_minutes: 30 }, attendance_breaks: breaks });
    const A = mk('A', [{ id: 'a1', break_type: 'AUTO_GPS', started_at: ago(120 * MIN), ended_at: ago(80 * MIN), duration_minutes: 40 }]);
    const B = mk('B', [{ id: 'b1', break_type: 'MANUAL', started_at: ago(90 * MIN), ended_at: ago(70 * MIN), duration_minutes: 20 },
                       { id: 'b2', break_type: 'AUTO_GPS', started_at: ago(50 * MIN), ended_at: ago(45 * MIN), duration_minutes: 5 }]);
    const C = mk('C', [{ id: 'c1', break_type: 'AUTO_GPS', started_at: ago(10 * MIN), ended_at: null }]);
    const D = mk('D', []);
    const [sa, sb, sc, sd] = [A, B, C, D].map(x => summarizeBreakDay(x, 60, now));
    expect(sa).toMatchObject({ totalMins: 40, excessMins: 10, status: 'EXCESS' });
    expect(sb).toMatchObject({ totalMins: 25, excessMins: 0 });
    expect(sc.status).toBe('ON_BREAK');
    expect(sc.totalMins).toBeGreaterThanOrEqual(9);
    expect(sd.status).toBe('NO_BREAKS');
  });
});
