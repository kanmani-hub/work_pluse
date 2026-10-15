import { describe, it, expect, vi, beforeEach } from 'vitest';
import { missingClockOutService, MCO_NOT_SET_UP, mcoErrorMessage } from './missingClockOutService';
import { supabase } from '../../lib/supabase';
import { attendanceService } from './attendanceService';
import { globalSettingsService } from '../settings/globalSettingsService';
import { companyDateStr } from '../../utils/companyDate';

// The database functions (PROPOSED_missing_clock_out_workflow.sql) are tested against PostgreSQL
// separately. Here a small in-memory stand-in records what the app sends and returns what the real
// functions return, so the app's own checks, error handling and "no false success" rules are tested.
vi.mock('./attendanceService', () => ({ attendanceService: { getCurrentEmployeeId: vi.fn() } }));
vi.mock('../settings/globalSettingsService', () => ({ globalSettingsService: { loadSettings: vi.fn() } }));
vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, rpcCalls: [], failRead: {}, missing: new Set(), rpcResult: {} };
  const from = (t: string) => {
    const q: any = { t, op: 'select', filters: [], payload: null, one: false };
    const run = () => {
      if (db.missing.has(t)) return { data: null, error: { code: '42P01', message: `relation "${t}" does not exist` } };
      if (db.failRead[t]) return { data: null, error: { code: '08006', message: 'connection lost' } };
      const rows = db.tables[t] || [];
      const hit = rows.filter((r: any) => q.filters.every((f: (r: any) => boolean) => f(r)));
      if (q.op === 'update') { hit.forEach((r: any) => Object.assign(r, q.payload)); return { data: hit.map((r: any) => ({ id: r.id })), error: null }; }
      if (q.one) return { data: hit[0] ? { ...hit[0] } : null, error: null };
      return { data: hit.map((r: any) => ({ ...r })), error: null };
    };
    const b: any = {
      select: () => b, order: () => b,
      update: (p: any) => { q.op = 'update'; q.payload = p; return b; },
      eq: (c: string, v: any) => { q.filters.push((r: any) => r[c] === v); return b; },
      gte: (c: string, v: any) => { q.filters.push((r: any) => r[c] >= v); return b; },
      lte: (c: string, v: any) => { q.filters.push((r: any) => r[c] <= v); return b; },
      in: (c: string, v: any[]) => { q.filters.push((r: any) => v.includes(r[c])); return b; },
      is: (c: string, v: any) => { q.filters.push((r: any) => (r[c] ?? null) === v); return b; },
      not: (c: string, _op: string, v: any) => { q.filters.push((r: any) => (r[c] ?? null) !== v); return b; },
      maybeSingle: () => { q.one = true; return b; },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
  const rpc = async (name: string, args: any) => {
    db.rpcCalls.push({ name, args });
    const r = db.rpcResult[name];
    return typeof r === 'function' ? r(args) : r ?? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  };
  return { supabase: { from, rpc, __db: db } };
});

const db = (supabase as any).__db;
const DATE = companyDateStr(Date.now() - 2 * 86_400_000);
const ist = (t: string) => new Date(`${DATE}T${t}:00+05:30`).toISOString();
const SHIFT = { id: 's1', name: 'Day', start_time: '09:00', end_time: '17:00', required_hours: 8, crosses_midnight: false };
const ATT = { id: 'a1', employee_id: 'e1', attendance_date: DATE, clock_in_at: ist('09:00'), clock_out_at: null, required_hours: 8, is_half_day: false, status: 'IN_PROGRESS', shift_template: SHIFT };

beforeEach(() => {
  vi.clearAllMocks();
  (attendanceService.getCurrentEmployeeId as any).mockResolvedValue('e1');
  (globalSettingsService.loadSettings as any).mockResolvedValue({ updated_at: 'x', app: { autoClockOutGraceHours: 4 }, payroll: { missingClockOutMaxAdditionalHours: 3 } });
  db.tables = { attendance: [{ ...ATT }], attendance_breaks: [], leave_requests: [], overtime_requests: [], payroll_adjustments: [], audit_logs: [], attendance_events: [] };
  db.rpcCalls = []; db.failRead = {}; db.missing = new Set(); db.rpcResult = {};
});

describe('employee cases and corrections', () => {
  it('case 5: an open day after the shift is listed as a missing clock-out that can be corrected', async () => {
    const { data, error } = await missingClockOutService.getMyCases();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ canSubmit: true, request: null, detection: { state: 'MISSING_CLOCK_OUT' } });
    expect(data![0].attendance.clock_out_at).toBeNull(); // nothing assumed
  });

  it('case 6: the preview of a claim is unverified and nothing is written', async () => {
    const { data } = await missingClockOutService.previewClaim('a1', ist('19:00'));
    expect(data).toMatchObject({ ok: true, verified: false, eligibleHours: 2 });
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.tables.attendance[0].clock_out_at).toBeNull();
  });

  it('submit goes through the database function with the claimed time; nothing is changed directly', async () => {
    db.rpcResult.submit_missing_clock_out_request = { data: 'req1', error: null };
    const r = await missingClockOutService.submit('a1', ist('19:00'), 2, 'Release build and smoke tests');
    expect(r).toEqual({ data: 'req1', error: null });
    expect(db.rpcCalls).toEqual([{ name: 'submit_missing_clock_out_request', args: { p_attendance_id: 'a1', p_claimed_clock_out: ist('19:00'), p_requested_hours: 2, p_reason: 'Release build and smoke tests' } }]);
    expect(db.tables.attendance[0].clock_out_at).toBeNull();
  });

  it('case 4: more than the limit cannot be requested, with a clear message (and no call)', async () => {
    const r = await missingClockOutService.submit('a1', ist('21:30'), 4.5, 'Release build and smoke tests');
    expect(r.error?.message).toBe('You can request at most 3 hours (limit 3 h for a missing clock-out).');
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('case 10: a second submission for the same day is refused (shown as ineligible, and the database refusal is passed on)', async () => {
    db.tables.overtime_requests = [{ id: 'req1', attendance_id: 'a1', employee_id: 'e1', request_type: 'MISSING_CLOCK_OUT', status: 'PENDING', work_date: DATE, created_at: 'x' }];
    const { data } = await missingClockOutService.getMyCases();
    expect(data![0]).toMatchObject({ canSubmit: false, cannotSubmitReason: 'A correction for this day is pending.' });
    db.rpcResult.submit_missing_clock_out_request = { data: null, error: { code: '23505', message: 'A request already exists for this day.' } };
    const r = await missingClockOutService.submit('a1', ist('19:00'), 1, 'Release build and smoke tests');
    expect(r).toEqual({ data: null, error: new Error('A request already exists for this day.') });
  });

  it('case 14: a failed read is an error, never "no missing clock-outs" or zero hours', async () => {
    db.failRead.attendance = true;
    expect(await missingClockOutService.getMyCases()).toEqual({ data: null, error: new Error('Unable to load your attendance.') });
    db.failRead = { overtime_requests: true };
    expect((await missingClockOutService.getMyCases()).data).toBeNull();
    db.failRead = { attendance_breaks: true };
    expect(await missingClockOutService.previewClaim('a1', ist('19:00'))).toEqual({ data: null, error: new Error('Breaks could not be loaded.') });
    (globalSettingsService.loadSettings as any).mockResolvedValue(null);
    expect((await missingClockOutService.getMyCases()).error?.message).toBe('Company settings could not be loaded. Please try again.');
  });

  it('case 14: a failed write is reported, never shown as success', async () => {
    db.rpcResult.submit_missing_clock_out_request = { data: null, error: { code: '08006', message: 'connection lost' } };
    expect((await missingClockOutService.submit('a1', ist('19:00'), 1, 'Release build and smoke tests')).error?.message).toBe('Your correction could not be submitted. Please try again.');
    db.rpcResult.submit_missing_clock_out_request = { data: null, error: null };
    expect((await missingClockOutService.submit('a1', ist('19:00'), 1, 'Release build and smoke tests')).error?.message).toBe('Your correction could not be submitted. Please try again.');
  });

  it('not set up yet: open days are still listed, actions say so', async () => {
    db.missing = new Set(['payroll_adjustments']);
    const r = await missingClockOutService.getMyCases();
    expect(r.error?.message).toBe(MCO_NOT_SET_UP);
    expect(r.data).toHaveLength(1);
    expect((await missingClockOutService.submit('a1', ist('19:00'), 1, 'Release build and smoke tests')).error?.message).toBe(MCO_NOT_SET_UP);
  });

  it('case 16: no location is read anywhere in the workflow', async () => {
    const tables = new Set<string>();
    const orig = supabase.from;
    (supabase as any).from = (t: string) => { tables.add(t); return orig(t); };
    await missingClockOutService.getMyCases();
    await missingClockOutService.previewClaim('a1', ist('19:00'));
    (supabase as any).from = orig;
    expect([...tables].some(t => /location|gps/i.test(t))).toBe(false);
  });
});

describe('admin decisions', () => {
  const pending = () => ({ id: 'req1', attendance_id: 'a1', employee_id: 'e1', request_type: 'MISSING_CLOCK_OUT', status: 'PENDING', requested_overtime_hours: 2, work_date: DATE, created_at: 'x' });
  beforeEach(() => {
    (attendanceService.getCurrentEmployeeId as any).mockResolvedValue('admin1');
    db.tables.overtime_requests = [pending()];
  });

  it('case 7: approve sends the verified time and hours to the atomic database function', async () => {
    db.rpcResult.review_missing_clock_out_request = { data: { status: 'APPROVED', deduction_cancelled: 500 }, error: null };
    const r = await missingClockOutService.review('req1', 'APPROVED', ist('19:00'), 2, '');
    expect(r.error).toBeNull();
    expect(db.rpcCalls[0]).toEqual({ name: 'review_missing_clock_out_request', args: { p_request_id: 'req1', p_decision: 'APPROVED', p_verified_clock_out: ist('19:00'), p_approved_hours: 2, p_remarks: null } });
  });

  it('approval above what the verified time supports is refused before the call', async () => {
    const r = await missingClockOutService.review('req1', 'APPROVED', ist('18:00'), 2, '');
    expect(r.error?.message).toBe('Cannot approve more than 1 hours for the verified clock-out time (limit 3 h).');
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('case 8: reject needs a reason and sends no verified time or hours', async () => {
    expect((await missingClockOutService.review('req1', 'REJECTED', null, null, ' ')).error?.message).toBe('Please give a reason for rejecting.');
    db.rpcResult.review_missing_clock_out_request = { data: { status: 'REJECTED', deduction: 500 }, error: null };
    const r = await missingClockOutService.review('req1', 'REJECTED', null, null, 'Gate log shows 17:05');
    expect(r.data).toEqual({ status: 'REJECTED', deduction: 500 });
    expect(db.rpcCalls[0].args).toMatchObject({ p_decision: 'REJECTED', p_verified_clock_out: null, p_approved_hours: null, p_remarks: 'Gate log shows 17:05' });
  });

  it('case 11: deciding the same request twice is refused (no second reversal)', async () => {
    db.tables.overtime_requests = [{ ...pending(), status: 'APPROVED' }];
    expect((await missingClockOutService.review('req1', 'APPROVED', ist('19:00'), 2, '')).error?.message).toBe('This request has already been approved.');
    // a concurrent second click that passed the browser check is refused by the database
    db.tables.overtime_requests = [pending()];
    db.rpcResult.review_missing_clock_out_request = { data: null, error: { code: '23514', message: 'This request has already been approved.' } };
    expect((await missingClockOutService.review('req1', 'APPROVED', ist('19:00'), 2, '')).error?.message).toBe('This request has already been approved.');
  });

  it('case 12: an employee (or admin) cannot review their own request', async () => {
    (attendanceService.getCurrentEmployeeId as any).mockResolvedValue('e1');
    expect((await missingClockOutService.review('req1', 'APPROVED', ist('19:00'), 2, '')).error?.message).toBe('You cannot review your own request.');
    expect(db.rpcCalls).toHaveLength(0);
    // the database refuses it too (role / self-review), and that message is shown
    expect(mcoErrorMessage({ code: '42501', message: 'Only an administrator can review missing clock-out requests.' }, 'x')?.message).toBe('Only an administrator can review missing clock-out requests.');
  });

  it('admin list shows open days with duplicates and decided corrections', async () => {
    db.tables.attendance.push({ ...ATT, id: 'a2' });
    db.tables.attendance = db.tables.attendance.map((a: any) => ({ ...a, employee: { first_name: 'Test', last_name: 'User', employee_code: 'T1' } }));
    db.tables.overtime_requests = [];
    const r = await missingClockOutService.listCases();
    expect(r.error).toBeNull();
    expect(r.data!.map(c => c.attendance.id).sort()).toEqual(['a1', 'a2']);
    expect(r.data!.every(c => c.duplicateOpen)).toBe(true);
  });

  it('apply deduction needs a reason and reports a failed write', async () => {
    expect((await missingClockOutService.applyDeduction('a1', '')).error?.message).toBe('Please give a reason.');
    db.rpcResult.apply_missing_clock_out_deduction = { data: null, error: { code: '08006', message: 'x' } };
    expect((await missingClockOutService.applyDeduction('a1', 'No response after 7 days')).error?.message).toBe('The deduction could not be recorded. Please try again.');
  });

  it('audit trail read failure is reported, not shown as "no history"', async () => {
    db.failRead.audit_logs = true;
    const r = await missingClockOutService.getAuditTrail({ attendance: ATT, request: pending(), adjustments: [] });
    expect(r).toEqual({ data: null, error: new Error('The audit trail could not be loaded.') });
  });
});
