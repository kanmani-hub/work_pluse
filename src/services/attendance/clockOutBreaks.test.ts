import { describe, it, expect, vi, beforeEach } from 'vitest';
import { attendanceService } from './attendanceService';
import { auditService } from '../audit/auditService';
import { supabase } from '../../lib/supabase';
import { companyDateStr } from '../../utils/companyDate';

// Clock-out and open breaks: a failed break read or two or more open breaks never lead to a
// clock-out (no break is closed, nothing is double counted); one open AUTOMATIC break is closed
// at clock-out as before. In-memory tables; `failSelect` fails the n-th SELECT on a table.
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({ data: {}, error: null })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn(() => Promise.resolve()) } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { getIsoString: () => new Date().toISOString(), now: () => Date.now() } }));
vi.mock('../settings/globalSettingsService', () => ({
  globalSettingsService: { loadSettings: vi.fn(async () => ({ app: { breakDurationMins: 60 }, payroll: { enableBreakOverrunDetection: true } })) },
}));
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, seq: 0, failSelect: [] as { table: string; nth: number }[], selects: {} as Record<string, number> };
  const from = (t: string) => {
    const q: any = { op: 'select', filters: [], payload: null, one: null };
    const rows = () => (db.tables[t] ||= []);
    const match = (r: any) => q.filters.every(([op, c, v]: any) => (op === 'eq' ? r[c] === v : op === 'is' ? (r[c] ?? null) === v : true));
    const withJoins = (r: any) => (t === 'attendance' ? { ...r, shift_template: (db.tables.shift_templates || []).find((s: any) => s.id === r.shift_template_id) ?? null } : { ...r });
    const run = () => {
      if (q.op === 'select') {
        db.selects[t] = (db.selects[t] || 0) + 1;
        if (db.failSelect.some((f: any) => f.table === t && f.nth === db.selects[t])) return { data: null, error: { code: 'XX000', message: `read of ${t} failed (simulated)` } };
      }
      let out: any[];
      if (q.op === 'insert') { const r = { id: `${t}-${++db.seq}`, ...q.payload }; rows().push(r); out = [r]; }
      else if (q.op === 'update') { out = rows().filter(match); out.forEach((r: any) => Object.assign(r, q.payload)); out = out.map(withJoins); }
      else out = rows().filter(match).map(withJoins);
      if (q.one === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not exactly one row' } };
      if (q.one === 'maybe') return out.length > 1 ? { data: null, error: { code: 'PGRST116', message: 'multiple rows' } } : { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };
    const b: any = {
      select: () => b,
      insert: (p: any) => { q.op = 'insert'; q.payload = p; return b; },
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: any) => { q.filters.push(['eq', c, v]); return b; },
      is: (c: string, v: any) => { q.filters.push(['is', c, v]); return b; },
      in: () => b, order: () => b, limit: () => b,
      single: () => { q.one = 'single'; return b; },
      maybeSingle: () => { q.one = 'maybe'; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  const auth = { getUser: async () => ({ data: { user: { id: 'auth-A' } }, error: null }) };
  return { supabase: { from, auth, __db: db } };
});

const db = (supabase as any).__db;
const H = 3600e3;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const brk = (id: string, startedAgo: number, endedAgo: number | null, type = 'AUTO_GPS') => ({
  id, attendance_id: 'att1', employee_id: 'empA', break_type: type, started_at: ago(startedAgo),
  ended_at: endedAgo === null ? null : ago(endedAgo), duration_minutes: endedAgo === null ? null : Math.floor((startedAgo - endedAgo) / 60000),
});
function setup(breaks: any[]) {
  db.tables = {
    profiles: [{ auth_user_id: 'auth-A', employee_id: 'empA' }],
    shift_templates: [{ id: 'day', crosses_midnight: false, break_duration_minutes: 60 }],
    attendance: [{ id: 'att1', employee_id: 'empA', attendance_date: companyDateStr(), clock_in_at: ago(9 * H), clock_out_at: null,
      shift_template_id: 'day', status: 'ON_BREAK', late_minutes: 0, required_hours: 8, break_minutes: 0, break_overrun_minutes: 0 }],
    attendance_breaks: breaks, attendance_events: [],
  };
  db.seq = 0; db.failSelect = []; db.selects = {};
}
const att = () => db.tables.attendance[0];
const open = () => db.tables.attendance_breaks.filter((b: any) => !b.ended_at);
const auditActions = () => (auditService.recordAuditLog as any).mock.calls.map((c: any[]) => c[0].action);

beforeEach(() => {
  vi.clearAllMocks();
  (auditService.recordAuditLog as any).mockImplementation(async () => ({ data: {}, error: null }));
});

describe('clock-out with open breaks', () => {
  it('two open automatic breaks → refused, nothing closed, not clocked out, audit attempted', async () => {
    setup([brk('b1', 2 * H, null), brk('b2', H, null)]);
    const r = await attendanceService.clockOut('att1');
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch(/2 breaks are open for this attendance/);
    expect(open()).toHaveLength(2);
    expect(att().clock_out_at).toBeNull();
    expect(att().break_minutes).toBe(0);
    expect(auditActions().includes('CLOCK_OUT_BLOCKED_MULTIPLE_OPEN_BREAKS')).toBe(true);
  });
  it('a manual and an automatic break open → refused the same way', async () => {
    setup([brk('m1', 2 * H, null, 'REGULAR'), brk('a1', H, null)]);
    const r = await attendanceService.clockOut('att1');
    expect(r.error?.message).toMatch(/2 breaks are open/);
    expect(open()).toHaveLength(2);
    expect(att().clock_out_at).toBeNull();
  });
  it('the refusal stands even when the audit log cannot be written', async () => {
    setup([brk('b1', 2 * H, null), brk('b2', H, null)]);
    (auditService.recordAuditLog as any).mockImplementation(async () => ({ data: null, error: { message: 'audit insert denied' } }));
    const r = await attendanceService.clockOut('att1');
    expect(r.error?.message).toMatch(/2 breaks are open/);
    expect(open()).toHaveLength(2);
  });
  it('breaks cannot be read → refused, still clocked in', async () => {
    setup([brk('b1', H, null)]);
    db.failSelect = [{ table: 'attendance_breaks', nth: 1 }];
    const r = await attendanceService.clockOut('att1');
    expect(r.error?.message).toMatch(/Your breaks could not be checked/);
    expect(att().clock_out_at).toBeNull();
    expect(open()).toHaveLength(1);
  });
  it('one open automatic break → closed at clock-out and counted once (unchanged behaviour)', async () => {
    setup([brk('b0', 6 * H, 6 * H - 20 * 60e3, 'REGULAR'), brk('b1', 30 * 60e3, null)]);
    const r = await attendanceService.clockOut('att1');
    expect(r.error).toBeNull();
    expect(open()).toHaveLength(0);
    expect(att().clock_out_at === null).toBe(false);
    expect(att().break_minutes).toBe(50);
  });
  it('no open break → normal clock-out', async () => {
    setup([brk('b0', 6 * H, 6 * H - 45 * 60e3, 'REGULAR')]);
    const r = await attendanceService.clockOut('att1');
    expect(r.error).toBeNull();
    expect(att().break_minutes).toBe(45);
  });
});
