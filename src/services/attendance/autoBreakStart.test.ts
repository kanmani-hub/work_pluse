import { describe, it, expect, vi, beforeEach } from 'vitest';
import { breakService } from './breakService';
import { supabase } from '../../lib/supabase';
import { notificationService } from '../notifications/notificationService';
import { summarizeBreakDay } from './breakSummaryRules';
import { companyDateStr, previousDateStr } from '../../utils/companyDate';

// Auto Break START on a confirmed geofence exit (no grace period). In-memory tables;
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
  return { supabase: { from, __db: db } };
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
const breaksOf = (attId: string) => db.tables.attendance_breaks.filter((b: any) => b.attendance_id === attId);
const att = (id: string) => db.tables.attendance.find((a: any) => a.id === id);

beforeEach(() => vi.clearAllMocks());

describe('confirmed exit → Auto Break starts immediately', () => {
  it('creates one AUTO_GPS break started at the exit time, attendance ON_BREAK, event logged', async () => {
    setup([attendanceRow('attA', 'empA')]);
    const exitAt = ago(20_000);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', exitAt);
    expect(r).toMatchObject({ action: 'STARTED', complete: true });
    expect(breaksOf('attA')).toHaveLength(1);
    expect(breaksOf('attA')[0]).toMatchObject({ break_type: 'AUTO_GPS', started_at: exitAt, employee_id: 'empA' });
    expect(att('attA').status).toBe('ON_BREAK');
    expect(db.tables.attendance_events.map((e: any) => e.event_type)).toEqual(['BREAK_START']);
    expect(notificationService.notifyEmployee).toHaveBeenCalledTimes(1);
  });

  it('several employees exiting get their own breaks on their own attendance', async () => {
    setup([attendanceRow('attA', 'empA'), attendanceRow('attB', 'empB'), attendanceRow('attC', 'empC')]);
    await breakService.handleAutoBreakTransition('empA', 'START', ago(30_000));
    await breakService.handleAutoBreakTransition('empB', 'START', ago(10_000));
    expect(breaksOf('attA')).toHaveLength(1);
    expect(breaksOf('attB')).toHaveLength(1);
    expect(breaksOf('attC')).toHaveLength(0);
    expect(breaksOf('attA')[0].employee_id).toBe('empA');
    expect(breaksOf('attB')[0].employee_id).toBe('empB');
    expect(att('attC').status).toBe('WORKING');
  });

  it('an exit recorded before clock-in is clamped to the clock-in time', async () => {
    const clockIn = ago(5 * MIN);
    setup([attendanceRow('attA', 'empA', { clock_in_at: clockIn })]);
    await breakService.handleAutoBreakTransition('empA', 'START', ago(10 * MIN));
    expect(breaksOf('attA')[0].started_at).toBe(clockIn);
  });

  it("overnight shift: the break attaches to last night's open attendance", async () => {
    setup([attendanceRow('attN', 'empA', { attendance_date: previousDateStr(today()), shift_template_id: 'night' })]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(MIN));
    expect(r.action).toBe('STARTED');
    expect(breaksOf('attN')).toHaveLength(1);
  });

  it("yesterday's day-shift attendance left open is not used (no break on a stale day)", async () => {
    setup([attendanceRow('attOld', 'empA', { attendance_date: previousDateStr(today()) })]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(MIN));
    expect(r).toMatchObject({ action: 'NONE', reason: 'STALE_OPEN_ATTENDANCE' });
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });
});

describe('no invalid or duplicate breaks', () => {
  it('not clocked in → no break', async () => {
    setup([attendanceRow('attA', 'empA', { clock_out_at: ago(MIN) })]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r).toMatchObject({ action: 'NONE', reason: 'NOT_CLOCKED_IN' });
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });

  it('an existing open break is not duplicated (repeated exit events)', async () => {
    setup([attendanceRow('attA', 'empA')]);
    await breakService.handleAutoBreakTransition('empA', 'START', ago(20_000));
    const again: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(again).toMatchObject({ action: 'NONE', reason: 'BREAK_ALREADY_ACTIVE' });
    expect(breaksOf('attA')).toHaveLength(1);
  });

  it('an open manual break blocks an automatic one', async () => {
    setup([attendanceRow('attA', 'empA', { status: 'ON_BREAK' })], [{ id: 'm1', attendance_id: 'attA', employee_id: 'empA', break_type: 'MANUAL', started_at: ago(5 * MIN), ended_at: null }]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r.reason).toBe('BREAK_ALREADY_ACTIVE');
    expect(breaksOf('attA')).toHaveLength(1);
  });

  it('concurrent START refused by the database (23505) → reported as already active, nothing else written', async () => {
    setup([attendanceRow('attA', 'empA')]);
    db.uniqueOnInsert = true;
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r).toMatchObject({ action: 'NONE', reason: 'BREAK_ALREADY_ACTIVE' });
    expect(att('attA').status).toBe('WORKING');
    expect(db.tables.attendance_events).toHaveLength(0);
  });

  it('approved WFH → no automatic break', async () => {
    setup([attendanceRow('attA', 'empA')], [], [{ id: 'w1', employee_id: 'empA', request_date: today(), status: 'APPROVED' }]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r).toMatchObject({ action: 'NONE', reason: 'WFH' });
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });
});

describe('failures never produce a false break or false success', () => {
  it('attendance read fails → ERROR (not "not clocked in"), no break', async () => {
    setup([attendanceRow('attA', 'empA')]);
    db.failSelect = [{ table: 'attendance', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r.action).toBe('ERROR');
    expect(r.reason).toMatch(/ATTENDANCE_CHECK_FAILED/);
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });

  it('open-break check fails → ERROR, no break', async () => {
    setup([attendanceRow('attA', 'empA')]);
    db.failSelect = [{ table: 'attendance_breaks', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r.action).toBe('ERROR');
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });

  it('WFH check fails → ERROR, no break (a failed check is not "no WFH")', async () => {
    setup([attendanceRow('attA', 'empA')]);
    db.failSelect = [{ table: 'wfh_requests', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r.action).toBe('ERROR');
    expect(r.reason).toMatch(/WFH_CHECK_FAILED/);
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });

  it('break insert fails → ERROR, attendance untouched', async () => {
    setup([attendanceRow('attA', 'empA')]);
    db.failWrite = [{ table: 'attendance_breaks', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r.action).toBe('ERROR');
    expect(att('attA').status).toBe('WORKING');
    expect(notificationService.notifyEmployee).not.toHaveBeenCalled();
  });

  it('status write fails → break kept, reported as incomplete (not plain success)', async () => {
    setup([attendanceRow('attA', 'empA')]);
    db.failWrite = [{ table: 'attendance', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r).toMatchObject({ action: 'STARTED', complete: false });
    expect(r.reason).toMatch(/STATUS_NOT_UPDATED/);
    expect(breaksOf('attA')).toHaveLength(1);
  });

  it('event write fails → reported as incomplete', async () => {
    setup([attendanceRow('attA', 'empA')]);
    db.failWrite = [{ table: 'attendance_events', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', ago(10_000));
    expect(r).toMatchObject({ action: 'STARTED', complete: false });
    expect(r.reason).toMatch(/EVENT_NOT_LOGGED/);
  });

  it.each([
    ['delayed by 20 minutes', () => ago(20 * MIN)],
    ['20 minutes in the future', () => new Date(Date.now() + 20 * MIN).toISOString()],
    ['unparseable', () => 'not-a-time'],
  ])('transition time %s → ERROR, nothing written', async (_label, t) => {
    setup([attendanceRow('attA', 'empA')]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', t());
    expect(r.action).toBe('ERROR');
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
