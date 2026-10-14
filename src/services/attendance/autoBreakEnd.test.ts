import { describe, it, expect, vi, beforeEach } from 'vitest';
import { breakService } from './breakService';
import { supabase } from '../../lib/supabase';
import { notificationService } from '../notifications/notificationService';
import { companyDateStr } from '../../utils/companyDate';

// Auto Break END on a confirmed return inside the office, and the attendance totals it writes.
// Same in-memory table harness as autoBreakStart.test.ts: failSelect / failWrite make the n-th
// read / write on a table fail like a PostgREST error. Synthetic data only.
vi.mock('./attendanceService', () => ({ attendanceService: { getCurrentEmployeeId: vi.fn(async () => 'empA') } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({ data: {}, error: null })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn(() => Promise.resolve()) } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { isEnabled: false, getIsoString: () => new Date().toISOString(), now: () => Date.now() } }));
vi.mock('../settings/globalSettingsService', () => ({
  globalSettingsService: { loadSettings: async () => ({ app: { breakDurationMins: 60 }, payroll: { enableBreakOverrunDetection: true } }) },
}));
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, seq: 0, failSelect: [], selects: {}, failWrite: [], writes: {} };
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
      if (q.op === 'update' && db.beforeUpdate) { const f = db.beforeUpdate; db.beforeUpdate = null; f(t); }
      let out: any[];
      if (q.op === 'insert') { const r = { id: `${t}-${++db.seq}`, ...q.payload }; rows().push(r); out = [r]; }
      else if (q.op === 'delete') {
        // RLS that forbids a DELETE makes it match 0 rows WITHOUT an error
        out = db.rlsDenies?.includes(`delete:${t}`) ? [] : rows().filter(match);
        db.tables[t] = rows().filter((r: any) => !out.includes(r));
      }
      else if (q.op === 'update' && db.rlsDenies?.includes(`update:${t}`)) out = [];
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
      delete: () => { q.op = 'delete'; return b; },
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

function setup(opts: { breaks?: any[]; lateMinutes?: number; storedBreakMinutes?: number } = {}) {
  db.tables = {
    shift_templates: [{ id: 'day', crosses_midnight: false, break_duration_minutes: 80 }],
    attendance: [{
      id: 'attA', employee_id: 'empA', attendance_date: companyDateStr(), clock_in_at: ago(480 * MIN), clock_out_at: null,
      shift_template_id: 'day', status: 'ON_BREAK', late_minutes: opts.lateMinutes ?? 0,
      break_minutes: opts.storedBreakMinutes ?? 30, break_overrun_minutes: 0, created_at: ago(480 * MIN),
    }],
    attendance_breaks: opts.breaks ?? [
      { id: 'b-done', attendance_id: 'attA', employee_id: 'empA', break_type: 'AUTO_GPS', started_at: ago(300 * MIN), ended_at: ago(270 * MIN), duration_minutes: 30 },
      { id: 'b-open', attendance_id: 'attA', employee_id: 'empA', break_type: 'AUTO_GPS', started_at: ago(100 * MIN), ended_at: null, duration_minutes: null },
    ],
    attendance_events: [],
  };
  db.seq = 0; db.failSelect = []; db.selects = {}; db.failWrite = []; db.writes = {}; db.beforeUpdate = null; db.rlsDenies = [];
}
const brk = (id: string) => db.tables.attendance_breaks.find((b: any) => b.id === id);
const att = () => db.tables.attendance[0];

beforeEach(() => vi.clearAllMocks());

describe('confirmed return → Auto Break ends', () => {
  it('closes the open AUTO_GPS break at the return time and recalculates stored totals', async () => {
    setup();
    const returnAt = ago(10 * MIN);          // first inside reading, 90 min after the break started
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', returnAt);
    expect(r).toMatchObject({ action: 'ENDED', breakId: 'b-open', durationMinutes: 90, complete: true });
    expect(brk('b-open')).toMatchObject({ ended_at: returnAt, duration_minutes: 90 });
    // stored payroll values = completed breaks only: 30 + 90 = 120; allowed 80 (shift) → 40 overrun
    expect(att()).toMatchObject({ break_minutes: 120, break_overrun_minutes: 40, status: 'WORKING' });
    expect(db.tables.attendance_events.map((e: any) => e.event_type)).toEqual(['BREAK_END']);
    expect(notificationService.notifyEmployee).toHaveBeenCalledTimes(1);
  });

  it('a late arrival stays LATE after the break', async () => {
    setup({ lateMinutes: 12 });
    await breakService.handleAutoBreakTransition('empA', 'END', ago(MIN));
    expect(att().status).toBe('LATE');
  });

  it('a repeated inside event cannot close the same break twice (end time is not moved)', async () => {
    setup();
    const firstReturn = ago(10 * MIN);
    await breakService.handleAutoBreakTransition('empA', 'END', firstReturn);
    const again: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(MIN));
    expect(again.action).toBe('NONE');
    expect(brk('b-open').ended_at).toBe(firstReturn);
    expect(db.tables.attendance_events).toHaveLength(1);
  });

  it('closed concurrently by another tab between the read and the update → reported as already ended, not an error', async () => {
    setup();
    // the other tab closes the break just before our update reaches the database
    db.beforeUpdate = () => { Object.assign(brk('b-open'), { ended_at: ago(6 * MIN), duration_minutes: 94 }); };
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(5 * MIN));
    expect(r.action).toBe('NONE');
    expect(r.reason).toBe('BREAK_ALREADY_ENDED');
    expect(brk('b-open').duration_minutes).toBe(94);
    expect(db.tables.attendance_events).toHaveLength(0);
  });

  it('a manual break is never ended by returning inside', async () => {
    setup({ breaks: [{ id: 'm1', attendance_id: 'attA', employee_id: 'empA', break_type: 'REGULAR', started_at: ago(20 * MIN), ended_at: null }] });
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(MIN));
    expect(r).toMatchObject({ action: 'NONE', reason: 'NO_ACTIVE_AUTO_BREAK' });
    expect(brk('m1').ended_at).toBeNull();
  });

  it('no open break → nothing written', async () => {
    setup({ breaks: [] });
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(MIN));
    expect(r).toMatchObject({ action: 'NONE', reason: 'NO_ACTIVE_AUTO_BREAK' });
    expect(db.writes).toEqual({});
  });
});

describe('failed reads / writes while ending are explicit and never corrupt stored totals', () => {
  it('break list cannot be re-read for the totals → stored break_minutes is NOT overwritten with 0', async () => {
    setup({ storedBreakMinutes: 30 });
    // reads of attendance_breaks: 1st = open-break check, 2nd = totals recalculation
    db.failSelect = [{ table: 'attendance_breaks', nth: 2 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(10 * MIN));
    expect(brk('b-open').ended_at).not.toBeNull();       // the return itself is recorded
    expect(att().break_minutes).toBe(30);                 // previous value kept, not 0
    expect(r).toMatchObject({ action: 'ENDED', complete: false });
    expect(r.reason).toMatch(/TOTALS_NOT_RECALCULATED/);
  });

  it('attendance cannot be re-read for the totals → totals and status are not guessed', async () => {
    setup({ storedBreakMinutes: 30 });
    // reads of attendance: 1st = open attendance lookup, 2nd = totals recalculation
    db.failSelect = [{ table: 'attendance', nth: 2 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(10 * MIN));
    expect(att()).toMatchObject({ break_minutes: 30, status: 'ON_BREAK' });
    expect(r).toMatchObject({ action: 'ENDED', complete: false });
  });

  it('totals write fails → reported as incomplete (not plain success)', async () => {
    setup();
    db.failWrite = [{ table: 'attendance', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(10 * MIN));
    expect(r).toMatchObject({ action: 'ENDED', complete: false });
    expect(r.reason).toMatch(/TOTALS_NOT_SAVED/);
  });

  it('event write fails → reported as incomplete', async () => {
    setup();
    db.failWrite = [{ table: 'attendance_events', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(10 * MIN));
    expect(r).toMatchObject({ action: 'ENDED', complete: false });
    expect(r.reason).toMatch(/EVENT_NOT_LOGGED/);
  });

  it('break update fails → ERROR, totals untouched', async () => {
    setup({ storedBreakMinutes: 30 });
    db.failWrite = [{ table: 'attendance_breaks', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(10 * MIN));
    expect(r.action).toBe('ERROR');
    expect(brk('b-open').ended_at).toBeNull();
    expect(att().break_minutes).toBe(30);
  });
});

describe('manual and admin break end keep their rules but never write totals from a failed read', () => {
  it('manual end: totals read fails → break ended, stored total kept, error explains it', async () => {
    setup({ storedBreakMinutes: 30, breaks: [{ id: 'm1', attendance_id: 'attA', employee_id: 'empA', break_type: 'REGULAR', started_at: ago(20 * MIN), ended_at: null }] });
    // reads of attendance_breaks: 1st = active break lookup, 2nd = totals recalculation
    db.failSelect = [{ table: 'attendance_breaks', nth: 2 }];
    const r = await breakService.endBreak('attA');
    expect(brk('m1').ended_at).not.toBeNull();
    expect(att().break_minutes).toBe(30);
    expect(r.error?.message).toMatch(/break total could not be updated/i);
  });

  it('manual end (normal path) is unchanged: break closed, totals written, BREAK_END event', async () => {
    setup({ breaks: [{ id: 'm1', attendance_id: 'attA', employee_id: 'empA', break_type: 'REGULAR', started_at: ago(20 * MIN), ended_at: null }] });
    const r = await breakService.endBreak('attA');
    expect(r.error).toBeNull();
    expect(brk('m1').duration_minutes).toBe(20);
    expect(att()).toMatchObject({ break_minutes: 20, break_overrun_minutes: 0, status: 'WORKING' });
    expect(db.tables.attendance_events.map((e: any) => e.event_type)).toEqual(['BREAK_END']);
  });

  it('admin "End Break" on a break that already ended does not move its end time', async () => {
    setup();
    const endedAt = brk('b-done').ended_at;
    const r = await breakService.adminEndBreak('b-done', 'attA');
    expect(r.error?.message).toMatch(/already ended/i);
    expect(brk('b-done').ended_at).toBe(endedAt);
  });

  it('admin "End Break": totals read fails → error, stored total kept', async () => {
    setup({ storedBreakMinutes: 30 });
    db.failSelect = [{ table: 'attendance_breaks', nth: 2 }]; // 1st = break lookup, 2nd = totals
    const r = await breakService.adminEndBreak('b-open', 'attA');
    expect(brk('b-open').ended_at).not.toBeNull();
    expect(att().break_minutes).toBe(30);
    expect(r.error?.message).toMatch(/total could not be updated/i);
  });
});

describe('admin "Discard Session" reports what really happened', () => {
  it('DELETE refused by RLS (0 rows, no error) → the break is cancelled instead and totals recalculated', async () => {
    setup({ storedBreakMinutes: 30, breaks: [
      { id: 'b-done', attendance_id: 'attA', employee_id: 'empA', break_type: 'AUTO_GPS', started_at: ago(300 * MIN), ended_at: ago(270 * MIN), duration_minutes: 30 },
    ] });
    db.rlsDenies = ['delete:attendance_breaks'];
    const r = await breakService.adminDeleteBreak('b-done', 'attA');
    expect(r).toEqual({ success: true, error: null });
    expect(brk('b-done')).toMatchObject({ break_type: 'CANCELLED', duration_minutes: 0 });
    expect(att().break_minutes).toBe(0);
  });

  it('neither delete nor cancel changes a row → failure, not "discarded"', async () => {
    setup({ storedBreakMinutes: 30 });
    db.rlsDenies = ['delete:attendance_breaks', 'update:attendance_breaks'];
    const r = await breakService.adminDeleteBreak('b-done', 'attA');
    expect(r.success).toBe(false);
    expect(r.error?.message).toMatch(/could not be discarded/i);
    expect(brk('b-done').break_type).toBe('AUTO_GPS');
    expect(att().break_minutes).toBe(30);
  });

  it('normal delete → removed and totals recalculated', async () => {
    setup({ storedBreakMinutes: 30, breaks: [
      { id: 'b-done', attendance_id: 'attA', employee_id: 'empA', break_type: 'AUTO_GPS', started_at: ago(300 * MIN), ended_at: ago(270 * MIN), duration_minutes: 30 },
    ] });
    const r = await breakService.adminDeleteBreak('b-done', 'attA');
    expect(r).toEqual({ success: true, error: null });
    expect(brk('b-done')).toBeUndefined();
    expect(att()).toMatchObject({ break_minutes: 0, status: 'WORKING' });
  });
});

describe('return after a tracking gap is recorded with the break end', () => {
  it('END with trackingGap → BREAK_END event metadata says the real return time is unknown', async () => {
    setup();
    const lastSeen = ago(200 * MIN);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', ago(MIN), { trackingGap: { lastSeenAt: lastSeen } });
    expect(r).toMatchObject({ action: 'ENDED', trackingGap: true, complete: true });
    expect(db.tables.attendance_events[0].metadata).toMatchObject({ tracking_gap: true, last_seen_before_return: lastSeen, break_id: 'b-open' });
  });
  it('normal END → no gap fields', async () => {
    setup();
    await breakService.handleAutoBreakTransition('empA', 'END', ago(MIN));
    expect(db.tables.attendance_events[0].metadata.tracking_gap).toBeUndefined();
  });
});

describe('manual breaks: one open break, verified reads, automatic breaks not ended by the employee', () => {
  const manual = (extra: any = {}) => ({ id: 'm1', attendance_id: 'attA', employee_id: 'empA', break_type: 'REGULAR', started_at: ago(20 * MIN), ended_at: null, ...extra });

  it('employee cannot end an AUTO_GPS break from the service (only return, clock-out or admin)', async () => {
    setup();
    const r = await breakService.endBreak('attA');
    expect(r.error?.message).toMatch(/automatic break ends when you are detected back/i);
    expect(brk('b-open').ended_at).toBeNull();
  });

  it('two open breaks already exist → manual end refuses instead of guessing which one', async () => {
    setup({ breaks: [manual(), manual({ id: 'm2' })] });
    const r = await breakService.endBreak('attA');
    expect(r.error?.message).toMatch(/more than one open break/i);
    expect(brk('m1').ended_at).toBeNull();
  });

  it('start with two open rows present → refused (before: maybeSingle errored → null → a third break)', async () => {
    setup({ breaks: [manual(), manual({ id: 'm2' })] });
    att().status = 'WORKING';
    const r = await breakService.startBreak('attA');
    expect(r.error?.message).toMatch(/already active/i);
    expect(db.tables.attendance_breaks).toHaveLength(2);
  });

  it('start: open-break check fails → error, no break', async () => {
    setup({ breaks: [] });
    // reads of attendance_breaks: 1st = open-break check
    db.failSelect = [{ table: 'attendance_breaks', nth: 1 }];
    const r = await breakService.startBreak('attA');
    expect(r.error?.message).toMatch(/could not be checked/i);
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });

  it('start: used-minutes read fails → error (allowance not skipped silently), no break', async () => {
    setup({ breaks: [] });
    db.failSelect = [{ table: 'attendance_breaks', nth: 2 }];
    const r = await breakService.startBreak('attA');
    expect(r.error?.message).toMatch(/break time could not be checked/i);
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });

  it('start (normal path): one REGULAR break, status ON_BREAK, BREAK_START event', async () => {
    setup({ breaks: [] });
    att().status = 'WORKING';
    const r = await breakService.startBreak('attA');
    expect(r.error).toBeNull();
    expect(db.tables.attendance_breaks).toHaveLength(1);
    expect(db.tables.attendance_breaks[0]).toMatchObject({ break_type: 'REGULAR', employee_id: 'empA', attendance_id: 'attA' });
    expect(att().status).toBe('ON_BREAK');
    expect(db.tables.attendance_events.map((e: any) => e.event_type)).toEqual(['BREAK_START']);
  });

  it('start: allowance already used (cancelled breaks not counted) → refused', async () => {
    setup({ breaks: [
      { id: 'c1', attendance_id: 'attA', employee_id: 'empA', break_type: 'CANCELLED', started_at: ago(300 * MIN), ended_at: ago(300 * MIN), duration_minutes: 0 },
      { id: 'd1', attendance_id: 'attA', employee_id: 'empA', break_type: 'REGULAR', started_at: ago(200 * MIN), ended_at: ago(120 * MIN), duration_minutes: 80 },
    ] });
    const r = await breakService.startBreak('attA');
    expect(r.error?.message).toMatch(/exhausted/i);
  });

  it('admin end with an end time before the start → refused, nothing written', async () => {
    setup();
    const r = await breakService.adminEndBreak('b-open', 'attA', ago(500 * MIN));
    expect(r.error?.message).toMatch(/after the break started/i);
    expect(brk('b-open').ended_at).toBeNull();
  });
});
