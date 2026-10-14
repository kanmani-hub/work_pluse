import { describe, it, expect, vi, beforeEach } from 'vitest';
import { breakService } from './breakService';
import { attendanceService } from './attendanceService';
import { classifyOpenBreaks } from './breakRules';
import { supabase } from '../../lib/supabase';
import { globalSettingsService } from '../settings/globalSettingsService';
import { auditService } from '../audit/auditService';
import { runBreakAction, REFRESH_FAILED_MESSAGE } from './breakActionFlow';
import { companyDateStr } from '../../utils/companyDate';

// Regression tests for D1 (no extra break after a failed / ambiguous active-break check),
// D2 (a failed read never overwrites attendance break totals) and R2–R6 (failed WFH / allowance
// reads, failed totals / status / event writes, manual END lookup). In-memory tables; `failSelect`
// / `failWrite` make the n-th SELECT / write (insert or update) on a table fail like a
// network / PostgREST error.
vi.mock('./attendanceService', () => ({ attendanceService: { getCurrentEmployeeId: vi.fn() } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({ data: {}, error: null })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn(() => Promise.resolve()) } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { getIsoString: () => new Date().toISOString() } }));
vi.mock('../settings/globalSettingsService', () => ({
  globalSettingsService: { loadSettings: vi.fn(async () => ({ app: { breakDurationMins: 60 }, payroll: { enableBreakOverrunDetection: true } })) },
}));
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, seq: 0, failSelect: [] as { table: string; nth: number }[], selects: {} as Record<string, number>, failWrite: [] as { table: string; nth: number }[], writes: {} as Record<string, number> };
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
      if (q.op === 'insert') { const r = { id: `${t}-${++db.seq}`, ...q.payload }; rows().push(r); out = [r]; }
      else if (q.op === 'update') { out = rows().filter(match); out.forEach((r: any) => Object.assign(r, q.payload)); out = out.map(withJoins); }
      else out = rows().filter(match).map(withJoins);
      if (q.one === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
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
const H = 3600e3;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const brk = (id: string, startedAgo: number, endedAgo: number | null, extra: any = {}) => ({
  id, attendance_id: 'att1', employee_id: 'empA', break_type: 'AUTO_GPS', started_at: ago(startedAgo),
  ended_at: endedAgo === null ? null : ago(endedAgo), duration_minutes: endedAgo === null ? null : Math.floor((startedAgo - endedAgo) / 60000), ...extra,
});
function setup(breaks: any[], attendance: any = {}) {
  db.tables = {
    shift_templates: [{ id: 'day', crosses_midnight: false, break_duration_minutes: 60 }],
    attendance: [{ id: 'att1', employee_id: 'empA', attendance_date: companyDateStr(), clock_in_at: ago(5 * H), clock_out_at: null,
      shift_template_id: 'day', status: 'WORKING', late_minutes: 0, break_minutes: 0, break_overrun_minutes: 0, ...attendance }],
    attendance_breaks: breaks, attendance_events: [], wfh_requests: [],
  };
  db.seq = 0; db.failSelect = []; db.selects = {}; db.failWrite = []; db.writes = {};
}
const open = () => db.tables.attendance_breaks.filter((b: any) => !b.ended_at);
const att = () => db.tables.attendance[0];

beforeEach(() => {
  vi.clearAllMocks();
  (attendanceService.getCurrentEmployeeId as any).mockResolvedValue('empA');
  (globalSettingsService.loadSettings as any).mockImplementation(async () => ({ app: { breakDurationMins: 60 }, payroll: { enableBreakOverrunDetection: true } }));
  (auditService.recordAuditLog as any).mockImplementation(async () => ({ data: {}, error: null }));
});

describe('classifyOpenBreaks (D1 rule)', () => {
  it('a failed read is an ERROR, never "no break"', () => {
    expect(classifyOpenBreaks(null, { message: 'timeout' })).toEqual({ kind: 'ERROR', message: 'timeout' });
    expect(classifyOpenBreaks(null, null)).toEqual({ kind: 'ERROR', message: 'no data returned' });
  });
  it('0 / 1 / several open breaks', () => {
    expect(classifyOpenBreaks([], null)).toEqual({ kind: 'NONE' });
    expect(classifyOpenBreaks([{ id: 'a' }], null)).toEqual({ kind: 'ONE', active: { id: 'a' } });
    expect(classifyOpenBreaks([{ id: 'a' }, { id: 'b' }], null)).toEqual({ kind: 'MULTIPLE', count: 2 });
  });
});

describe('D1: automatic break never inserts a second break after a failed or ambiguous check', () => {
  it('normal exit: exactly one AUTO_GPS break is started', async () => {
    setup([]);
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
    expect(r.action).toBe('STARTED');
    expect(open()).toHaveLength(1);
  });
  it('active-break lookup fails → ERROR, nothing inserted', async () => {
    setup([brk('b1', H, null)]);
    db.failSelect = [{ table: 'attendance_breaks', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
    expect(r.action).toBe('ERROR');
    expect(r.reason).toMatch(/ACTIVE_BREAK_CHECK_FAILED/);
    expect(db.tables.attendance_breaks).toHaveLength(1);
  });
  it('two open breaks → ERROR MULTIPLE_ACTIVE_BREAKS on START and END, nothing inserted or closed', async () => {
    setup([brk('b1', 2 * H, null), brk('b2', H, null)]);
    const s: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
    expect(s).toMatchObject({ action: 'ERROR', reason: 'MULTIPLE_ACTIVE_BREAKS', count: 2 });
    const e: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(e).toMatchObject({ action: 'ERROR', reason: 'MULTIPLE_ACTIVE_BREAKS' });
    expect(db.tables.attendance_breaks).toHaveLength(2);
    expect(open()).toHaveLength(2);
  });
  it('repeated exits while a break is active do not add breaks', async () => {
    setup([brk('b1', H, null)]);
    for (let i = 0; i < 3; i++) {
      const r: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
      expect(r).toMatchObject({ action: 'NONE', reason: 'BREAK_ALREADY_ACTIVE' });
    }
    expect(db.tables.attendance_breaks).toHaveLength(1);
  });
});

describe('D1: manual break never inserts a second break after a failed or ambiguous check', () => {
  it('lookup fails → clear error, nothing inserted', async () => {
    setup([]);
    db.failSelect = [{ table: 'attendance_breaks', nth: 1 }];
    const r = await breakService.startBreak('att1');
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch(/Could not check for an active break/);
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });
  it('two open breaks → error, nothing inserted', async () => {
    setup([brk('b1', 2 * H, null, { break_type: 'REGULAR' }), brk('b2', H, null, { break_type: 'REGULAR' })]);
    const r = await breakService.startBreak('att1');
    expect(r.error?.message).toMatch(/2 breaks are open/);
    expect(db.tables.attendance_breaks).toHaveLength(2);
  });
  it('one open break → "already active", nothing inserted', async () => {
    setup([brk('b1', H, null, { break_type: 'REGULAR' })]);
    const r = await breakService.startBreak('att1');
    expect(r.error?.message).toBe('A break is already active.');
    expect(db.tables.attendance_breaks).toHaveLength(1);
  });
});

describe('D2: a failed read never overwrites attendance break totals', () => {
  // 45 min completed earlier + a 30 min automatic break now = 75 min (allowed 60 → overrun 15)
  const earlier = () => brk('b0', 4 * H, 4 * H - 45 * 60e3, { break_type: 'REGULAR' });
  it('normal automatic END: totals recalculated (75 min, overrun 15)', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null)], { status: 'ON_BREAK', break_minutes: 45 });
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(r).toMatchObject({ action: 'ENDED', totalsUpdated: true, actual: 75, overrun: 15 });
    expect(att()).toMatchObject({ break_minutes: 75, break_overrun_minutes: 15, status: 'WORKING' });
  });
  it('automatic END but the breaks re-read fails: break closed, totals untouched, status no longer ON_BREAK', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null)], { status: 'ON_BREAK', break_minutes: 45, break_overrun_minutes: 0 });
    db.failSelect = [{ table: 'attendance_breaks', nth: 2 }]; // 1st = active-break lookup, 2nd = totals
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(r).toMatchObject({ action: 'ENDED', totalsUpdated: false });
    expect(r.reason).toMatch(/BREAK_TOTALS_NOT_UPDATED/);
    expect(open()).toHaveLength(0);
    expect(att()).toMatchObject({ break_minutes: 45, break_overrun_minutes: 0, status: 'WORKING' });
  });
  it('manual END but the attendance re-read fails: totals and status untouched, error reported (no false success)', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK', break_minutes: 45, break_overrun_minutes: 0 });
    db.failSelect = [{ table: 'attendance', nth: 1 }];
    const r = await breakService.endBreak('att1');
    expect(r.data?.id).toBe('b1'); // the break that WAS ended is returned, together with the error
    expect(r.error?.message).toMatch(/break totals could not be updated/);
    expect(open()).toHaveLength(0);
    expect(att()).toMatchObject({ break_minutes: 45, break_overrun_minutes: 0, status: 'ON_BREAK' });
  });
  it('late arrival stays LATE when only the status can be restored', async () => {
    setup([brk('b1', 30 * 60e3, null)], { status: 'ON_BREAK', late_minutes: 20, break_minutes: 10 });
    db.failSelect = [{ table: 'attendance_breaks', nth: 2 }];
    await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(att()).toMatchObject({ break_minutes: 10, status: 'LATE' });
  });
});

const events = () => db.tables.attendance_events || [];
const used = (mins: number) => brk('u1', 4 * H, 4 * H - mins * 60e3, { break_type: 'REGULAR' });

describe('R2: automatic START and the approved-WFH check', () => {
  const wfh = (status = 'APPROVED') => ({ id: 'w1', employee_id: 'empA', request_date: companyDateStr(), status });
  it('WFH lookup fails → ERROR WFH_CHECK_FAILED, no break inserted', async () => {
    setup([]); db.tables.wfh_requests = [wfh()];
    db.failSelect = [{ table: 'wfh_requests', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
    expect(r.action).toBe('ERROR');
    expect(r.reason).toMatch(/WFH_CHECK_FAILED/);
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });
  it('approved WFH day → no automatic break', async () => {
    setup([]); db.tables.wfh_requests = [wfh()];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
    expect(r).toMatchObject({ action: 'NONE', reason: 'WFH' });
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });
  it('successful lookup with no approved WFH (only a pending one) → break started', async () => {
    setup([]); db.tables.wfh_requests = [wfh('PENDING')];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
    expect(r.action).toBe('STARTED');
    expect(open()).toHaveLength(1);
  });
});

describe('R3: manual START when the break allowance cannot be verified', () => {
  it('attendance read for the allowance fails → refused, nothing inserted', async () => {
    setup([]);
    db.failSelect = [{ table: 'attendance', nth: 2 }]; // 1st = attendance check, 2nd = allowance
    const r = await breakService.startBreak('att1');
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch(/allowance could not be checked \(attendance/);
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });
  it('earlier-breaks read fails → refused, nothing inserted', async () => {
    setup([used(30)]);
    db.failSelect = [{ table: 'attendance_breaks', nth: 2 }]; // 1st = open-break check, 2nd = earlier breaks
    const r = await breakService.startBreak('att1');
    expect(r.error?.message).toMatch(/allowance could not be checked \(earlier breaks/);
    expect(db.tables.attendance_breaks).toHaveLength(1);
  });
  it('settings cannot be loaded → refused, nothing inserted', async () => {
    setup([]);
    (globalSettingsService.loadSettings as any).mockImplementation(async () => { throw new Error('settings offline'); });
    const r = await breakService.startBreak('att1');
    expect(r.error?.message).toMatch(/allowance could not be checked \(settings: settings offline/);
    expect(db.tables.attendance_breaks).toHaveLength(0);
  });
  it('allowance fully used (60/60) → refused as before', async () => {
    setup([used(60)]);
    const r = await breakService.startBreak('att1');
    expect(r.error?.message).toBe('You have already exhausted your allowed break duration for today.');
    expect(db.tables.attendance_breaks).toHaveLength(1);
  });
  it('allowance partly used (30/60) → break started', async () => {
    setup([used(30)]);
    const r = await breakService.startBreak('att1');
    expect(r.error).toBeNull();
    expect(open()).toHaveLength(1);
  });
});

describe('R4: totals are reported as updated only when the write succeeded', () => {
  const earlier = () => brk('b0', 4 * H, 4 * H - 45 * 60e3, { break_type: 'REGULAR' });
  it('manual END, totals write fails → error, ended break returned, totals untouched', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK', break_minutes: 45, break_overrun_minutes: 0 });
    db.failWrite = [{ table: 'attendance', nth: 1 }];
    const r = await breakService.endBreak('att1');
    expect(r.data?.id).toBe('b1');
    expect(r.error?.message).toMatch(/Your break was ended, but the attendance break totals could not be updated \(attendance totals could not be saved/);
    expect(open()).toHaveLength(0);
    expect(att()).toMatchObject({ break_minutes: 45, break_overrun_minutes: 0 });
  });
  it('retrying END after that failure repairs totals and status once, without double counting', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK', break_minutes: 45 });
    db.failWrite = [{ table: 'attendance', nth: 1 }];
    await breakService.endBreak('att1');
    expect(att()).toMatchObject({ break_minutes: 45, status: 'ON_BREAK' });
    db.failWrite = [];
    const again = await breakService.endBreak('att1');
    expect(again.error?.message).toBe('No active break found.');
    expect(db.tables.attendance_breaks).toHaveLength(2);
    expect(att()).toMatchObject({ break_minutes: 75, break_overrun_minutes: 15, status: 'WORKING' });
    await breakService.endBreak('att1'); // a third click changes nothing more
    expect(att()).toMatchObject({ break_minutes: 75, break_overrun_minutes: 15, status: 'WORKING' });
  });
  it('a stray END click while not on break writes nothing', async () => {
    setup([earlier()], { status: 'WORKING', break_minutes: 45 });
    await breakService.endBreak('att1');
    expect(db.writes.attendance || 0).toBe(0);
  });
  it('manual END, everything saved → success and correct totals (unchanged behaviour)', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK', break_minutes: 45 });
    const r = await breakService.endBreak('att1');
    expect(r.error).toBeNull();
    expect(r.data?.id).toBe('b1');
    expect(att()).toMatchObject({ break_minutes: 75, break_overrun_minutes: 15, status: 'WORKING' });
  });
  it('automatic END, totals write fails → totalsUpdated false with the reason', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null)], { status: 'ON_BREAK', break_minutes: 45 });
    db.failWrite = [{ table: 'attendance', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(r).toMatchObject({ action: 'ENDED', totalsUpdated: false, statusUpdated: false });
    expect(r.reason).toMatch(/BREAK_TOTALS_NOT_UPDATED: attendance totals could not be saved/);
    expect(open()).toHaveLength(0);
    expect(att().break_minutes).toBe(45);
    db.failWrite = [];
    const again: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(again).toMatchObject({ action: 'NONE', reason: 'NO_ACTIVE_AUTO_BREAK', reconciled: true });
    expect(att()).toMatchObject({ break_minutes: 75, status: 'WORKING' });
  });
});

describe('R5: START follow-up writes are checked; the break is kept and a retry repairs the status', () => {
  it('manual START, status write fails → break kept, error reported', async () => {
    setup([]);
    db.failWrite = [{ table: 'attendance', nth: 1 }];
    const r = await breakService.startBreak('att1');
    expect(r.data === null).toBe(false);
    expect(r.error?.message).toMatch(/Your break has started, but attendance status not set to On Break/);
    expect(open()).toHaveLength(1);
    expect(att().status).toBe('WORKING');
  });
  it('a retry repairs the status without adding a break', async () => {
    setup([]);
    db.failWrite = [{ table: 'attendance', nth: 1 }];
    await breakService.startBreak('att1');
    db.failWrite = [];
    const again = await breakService.startBreak('att1');
    expect(again.error?.message).toBe('A break is already active.');
    expect(open()).toHaveLength(1);
    expect(att().status).toBe('ON_BREAK');
  });
  it('manual START, event log fails → break kept, error reported', async () => {
    setup([]);
    db.failWrite = [{ table: 'attendance_events', nth: 1 }];
    const r = await breakService.startBreak('att1');
    expect(r.error?.message).toMatch(/break start event not logged/);
    expect(open()).toHaveLength(1);
    expect(att().status).toBe('ON_BREAK');
  });
  it('manual START, everything saved → no error, status and event written', async () => {
    setup([]);
    const r = await breakService.startBreak('att1');
    expect(r.error).toBeNull();
    expect(att().status).toBe('ON_BREAK');
    expect(events()).toHaveLength(1);
  });
  it('automatic START, status write fails → STARTED but not complete; the next exit repairs it', async () => {
    setup([]);
    db.failWrite = [{ table: 'attendance', nth: 1 }];
    const r: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
    expect(r).toMatchObject({ action: 'STARTED', complete: false });
    expect(r.reason).toMatch(/STATUS_NOT_UPDATED/);
    db.failWrite = [];
    const again: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date().toISOString());
    expect(again).toMatchObject({ action: 'NONE', reason: 'BREAK_ALREADY_ACTIVE', statusRepaired: true });
    expect(open()).toHaveLength(1);
    expect(att().status).toBe('ON_BREAK');
  });
});

describe('R6: manual END distinguishes failed lookup, none, several and one active break', () => {
  it('lookup fails → clear error, nothing updated', async () => {
    setup([brk('b1', H, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK' });
    db.failSelect = [{ table: 'attendance_breaks', nth: 1 }];
    const r = await breakService.endBreak('att1');
    expect(r.error?.message).toMatch(/Could not check for an active break .* Nothing was changed/);
    expect(open()).toHaveLength(1);
    expect(db.writes.attendance_breaks || 0).toBe(0);
  });
  it('no active break → "No active break found."', async () => {
    setup([]);
    const r = await breakService.endBreak('att1');
    expect(r.error?.message).toBe('No active break found.');
  });
  it('two active breaks → error, neither is ended', async () => {
    setup([brk('b1', 2 * H, null, { break_type: 'REGULAR' }), brk('b2', H, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK' });
    const r = await breakService.endBreak('att1');
    expect(r.error?.message).toMatch(/2 breaks are open for this attendance. No break was ended/);
    expect(open()).toHaveLength(2);
  });
  it('exactly one active break → ended', async () => {
    setup([brk('b1', 20 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK' });
    const r = await breakService.endBreak('att1');
    expect(r.error).toBeNull();
    expect(open()).toHaveLength(0);
    expect(att()).toMatchObject({ break_minutes: 20, status: 'WORKING' });
  });
});

describe('settings cannot be loaded while a break ends', () => {
  const earlier = () => brk('b0', 4 * H, 4 * H - 45 * 60e3, { break_type: 'REGULAR' });
  const settingsDown = () => (globalSettingsService.loadSettings as any).mockImplementation(async () => { throw new Error('settings offline'); });
  const settingsUp = () => (globalSettingsService.loadSettings as any).mockImplementation(async () => ({ app: { breakDurationMins: 60 }, payroll: { enableBreakOverrunDetection: true } }));
  it('manual END → ended break + clear error, totals untouched, status restored from the attendance row', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK', break_minutes: 45, break_overrun_minutes: 0 });
    settingsDown();
    const r = await breakService.endBreak('att1');
    expect(r.data?.id).toBe('b1');
    expect(r.error?.message).toMatch(/break totals could not be calculated \(settings offline\)/);
    expect(open()).toHaveLength(0);
    expect(att()).toMatchObject({ break_minutes: 45, break_overrun_minutes: 0, status: 'WORKING' });
  });
  it('a late arrival stays LATE', async () => {
    setup([brk('b1', 30 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK', late_minutes: 15, break_minutes: 0 });
    settingsDown();
    await breakService.endBreak('att1');
    expect(att()).toMatchObject({ status: 'LATE', break_minutes: 0 });
  });
  it('retrying END once settings are back reconciles the totals once, without double counting', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK', break_minutes: 45 });
    settingsDown();
    await breakService.endBreak('att1');
    settingsUp();
    const again = await breakService.endBreak('att1');
    expect(again.error?.message).toBe('No active break found.');
    expect(att()).toMatchObject({ break_minutes: 75, break_overrun_minutes: 15, status: 'WORKING' });
    const writes = db.writes.attendance;
    await breakService.endBreak('att1');
    expect(db.writes.attendance).toBe(writes); // already consistent: nothing written again
  });
  it('automatic END → totalsUpdated false with the reason, status restored; the next entry reconciles', async () => {
    setup([earlier(), brk('b1', 30 * 60e3, null)], { status: 'ON_BREAK', break_minutes: 45 });
    settingsDown();
    const r: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(r).toMatchObject({ action: 'ENDED', totalsUpdated: false, statusUpdated: true });
    expect(r.reason).toMatch(/BREAK_TOTALS_NOT_UPDATED: break totals could not be calculated \(settings offline\)/);
    expect(att()).toMatchObject({ break_minutes: 45, status: 'WORKING' });
    settingsUp();
    const again: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(again).toMatchObject({ action: 'NONE', reason: 'NO_ACTIVE_AUTO_BREAK', reconciled: true, repaired: true });
    expect(att().break_minutes).toBe(75);
  });
});

describe('audit logging failures are diagnostics, never break failures', () => {
  const auditReturnsError = () => (auditService.recordAuditLog as any).mockImplementation(async () => ({ data: null, error: { code: '42501', message: 'audit insert denied' } }));
  const auditThrows = () => (auditService.recordAuditLog as any).mockImplementation(async () => { throw new Error('network down'); });
  it('manual START, audit returns an error → break started, no error, auditLogged false', async () => {
    setup([]); auditReturnsError();
    const r = await breakService.startBreak('att1');
    expect(r.error).toBeNull();
    expect(r.auditLogged).toBe(false);
    expect(open()).toHaveLength(1);
    expect(att().status).toBe('ON_BREAK');
  });
  it('manual END, audit throws → break ended and totals saved, no error, auditLogged false', async () => {
    setup([brk('b1', 20 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK' }); auditThrows();
    const r = await breakService.endBreak('att1');
    expect(r.error).toBeNull();
    expect(r.auditLogged).toBe(false);
    expect(att()).toMatchObject({ break_minutes: 20, status: 'WORKING' });
  });
  it('automatic START and END, audit fails → STARTED / ENDED complete, auditLogged false', async () => {
    setup([]); auditReturnsError();
    const s: any = await breakService.handleAutoBreakTransition('empA', 'START', new Date(Date.now() - 20 * 60e3).toISOString());
    expect(s).toMatchObject({ action: 'STARTED', complete: true, auditLogged: false });
    auditThrows();
    const e: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(e).toMatchObject({ action: 'ENDED', totalsUpdated: true, auditLogged: false });
  });
  it('audit succeeds → auditLogged true', async () => {
    setup([]);
    const r = await breakService.startBreak('att1');
    expect(r.auditLogged).toBe(true);
    const s: any = await breakService.handleAutoBreakTransition('empA', 'END', new Date().toISOString());
    expect(s.action).toBe('NONE');
  });
});

describe('dashboard break action: always reload, show the original error', () => {
  const refresher = (ok = true) => { const calls = { n: 0 }; return { calls, fn: async () => { calls.n++; return ok; } }; };
  it('START creates the break but the status cannot be saved → reloaded once, original error shown', async () => {
    setup([]); db.failWrite = [{ table: 'attendance', nth: 1 }];
    const r = refresher();
    const out = await runBreakAction(() => breakService.startBreak('att1'), r.fn);
    expect(r.calls.n).toBe(1);
    expect(out).toMatchObject({ operationFailed: true, refreshed: true });
    expect(out.message).toMatch(/^Your break has started, but attendance status not set to On Break/);
    expect(open()).toHaveLength(1);
  });
  it('END whose totals write fails → reloaded once, original error shown', async () => {
    setup([brk('b1', 20 * 60e3, null, { break_type: 'REGULAR' })], { status: 'ON_BREAK' }); db.failWrite = [{ table: 'attendance', nth: 1 }];
    const r = refresher();
    const out = await runBreakAction(() => breakService.endBreak('att1'), r.fn);
    expect(r.calls.n).toBe(1);
    expect(out.message).toMatch(/^Your break was ended, but the attendance break totals could not be updated/);
  });
  it('success → reloaded once, nothing to show (no success alert)', async () => {
    setup([]);
    const r = refresher();
    const out = await runBreakAction(() => breakService.startBreak('att1'), r.fn);
    expect(r.calls.n).toBe(1);
    expect(out).toEqual({ message: null, operationFailed: false, refreshed: true });
  });
  it('success but the reload fails → only the reload problem is shown', async () => {
    setup([]);
    const out = await runBreakAction(() => breakService.startBreak('att1'), refresher(false).fn);
    expect(out).toEqual({ message: REFRESH_FAILED_MESSAGE, operationFailed: false, refreshed: false });
  });
  it('the action throws → still reloaded, error and reload problem reported separately', async () => {
    const r = refresher(false);
    const out = await runBreakAction(async () => { throw new Error('network down'); }, r.fn);
    expect(r.calls.n).toBe(1);
    expect(out.message).toBe(`network down\n\n${REFRESH_FAILED_MESSAGE}`);
    expect(out.operationFailed).toBe(true);
  });
});

