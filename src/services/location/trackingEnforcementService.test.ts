import { describe, it, expect, vi, beforeEach } from 'vitest';
import { breakService } from '../attendance/breakService';
import { trackingEnforcementService } from './trackingEnforcementService';
import { supabase } from '../../lib/supabase';
import { notificationService } from '../notifications/notificationService';
import { companyDateStr } from '../../utils/companyDate';

// Isolated In-Memory Supabase Mock
vi.mock('../attendance/attendanceService', () => ({
  attendanceService: { getCurrentEmployeeId: vi.fn() },
}));

vi.mock('../audit/auditService', () => ({
  auditService: { recordAuditLog: vi.fn(async () => ({ data: {}, error: null })) },
}));

vi.mock('../notifications/notificationService', () => ({
  notificationService: {
    notifyEmployee: vi.fn(() => Promise.resolve({ data: { id: 'n-1' }, error: null })),
    notifyAdmins: vi.fn(() => Promise.resolve({ data: [], error: null })),
  },
}));

vi.mock('../qa/qaTimeService', () => ({
  qaTimeService: {
    isEnabled: false,
    getIsoString: () => new Date().toISOString(),
    now: () => Date.now(),
  },
}));

vi.mock('../../lib/supabase', () => {
  const db: any = { tables: {}, seq: 0, failSelect: [], selects: {}, failWrite: [], writes: {}, uniqueOnInsert: false };
  const from = (t: string) => {
    const q: any = { op: 'select', filters: [], payload: null, one: null };
    const rows = () => (db.tables[t] ||= []);
    const match = (r: any) =>
      q.filters.every(([op, c, v]: any) =>
        op === 'eq'
          ? r[c] === v
          : op === 'is'
          ? (r[c] ?? null) === v
          : op === 'in'
          ? v.includes(r[c])
          : true,
      );
    const withJoins = (r: any) => {
      if (t === 'attendance') {
        const emp = (db.tables.employees || []).find((e: any) => e.id === r.employee_id) ?? null;
        const shift = (db.tables.shift_templates || []).find((s: any) => s.id === r.shift_template_id) ?? null;
        return { ...r, employee: emp, shift_template: shift };
      }
      return { ...r };
    };
    const run = () => {
      if (q.op === 'select') {
        db.selects[t] = (db.selects[t] || 0) + 1;
        if (db.failSelect.some((f: any) => f.table === t && f.nth === db.selects[t])) {
          return { data: null, error: { code: 'XX000', message: `read of ${t} failed (simulated)` } };
        }
      } else {
        db.writes[t] = (db.writes[t] || 0) + 1;
        if (db.failWrite.some((f: any) => f.table === t && f.nth === db.writes[t])) {
          return { data: null, error: { code: 'XX000', message: `write to ${t} failed (simulated)` } };
        }
      }
      let out: any[];
      if (q.op === 'insert') {
        if (t === 'attendance_breaks' && db.uniqueOnInsert) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        const r = { id: `${t}-${++db.seq}`, ...q.payload };
        rows().push(r);
        out = [r];
      } else if (q.op === 'update') {
        out = rows().filter(match);
        out.forEach((r: any) => Object.assign(r, q.payload));
        out = out.map(withJoins);
      } else if (q.op === 'delete') {
        const indices: number[] = [];
        rows().forEach((r: any, idx: number) => {
          if (match(r)) indices.push(idx);
        });
        out = [];
        indices.reverse().forEach((idx) => {
          out.push(rows().splice(idx, 1)[0]);
        });
      } else {
        out = rows().filter(match).map(withJoins);
      }
      if (q.one === 'single') {
        return out.length === 1
          ? { data: out[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'multiple (or no) rows' } };
      }
      if (q.one === 'maybe') {
        return out.length > 1
          ? { data: null, error: { code: 'PGRST116', message: 'multiple rows' } }
          : { data: out[0] ?? null, error: null };
      }
      return { data: out, error: null };
    };
    const b: any = {
      select: () => b,
      insert: (p: any) => {
        q.op = 'insert';
        q.payload = p;
        return b;
      },
      update: (p: any) => {
        q.op = 'update';
        q.payload = p;
        return b;
      },
      delete: () => {
        q.op = 'delete';
        return b;
      },
      eq: (c: string, v: any) => {
        q.filters.push(['eq', c, v]);
        return b;
      },
      is: (c: string, v: any) => {
        q.filters.push(['is', c, v]);
        return b;
      },
      in: (c: string, v: any[]) => {
        q.filters.push(['in', c, v]);
        return b;
      },
      order: () => b,
      limit: () => b,
      single: () => {
        q.one = 'single';
        return b;
      },
      maybeSingle: () => {
        q.one = 'maybe';
        return b;
      },
      then: (res: any, rej: any) => Promise.resolve().then(run).then(res, rej),
    };
    return b;
  };
    const auth = {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'admin-user-id' } },
        error: null,
      })),
    };
    return {
      supabase: {
        from,
        rpc: vi.fn(async () => ({ data: null, error: { message: 'function not found (simulated)' } })),
        channel: () => ({ on: () => ({ subscribe: () => {} }) }),
        auth,
        __db: db,
      },
    };
});

const db = (supabase as any).__db;
const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const today = () => companyDateStr();

function setupDb(opts: {
  attendance?: any[];
  breaks?: any[];
  employees?: any[];
  wfh?: any[];
} = {}) {
  (supabase.auth.getUser as any).mockResolvedValue({
    data: { user: { id: 'admin-user-id' } },
    error: null,
  });
  db.tables = {
    employees: opts.employees || [
      { id: 'emp-1', first_name: 'John', last_name: 'Doe', employee_code: 'WP-001', status: 'ACTIVE' },
    ],
    profiles: [
      { id: 'prof-admin', auth_user_id: 'admin-user-id', role_id: 'role-admin', is_active: true },
      { id: 'prof-hr', auth_user_id: 'hr-user-id', role_id: 'role-hr', is_active: true },
      { id: 'prof-emp', auth_user_id: 'emp-user-id', role_id: 'role-emp', is_active: true },
      { id: 'prof-inactive', auth_user_id: 'inactive-user-id', role_id: 'role-admin', is_active: false },
    ],
    roles: [
      { id: 'role-admin', name: 'ADMIN' },
      { id: 'role-hr', name: 'HR' },
      { id: 'role-emp', name: 'EMPLOYEE' },
    ],
    shift_templates: [
      { id: 'shift-1', name: 'Standard Day', break_duration_minutes: 60, crosses_midnight: false },
    ],
    attendance: opts.attendance || [
      {
        id: 'att-1',
        employee_id: 'emp-1',
        attendance_date: today(),
        clock_in_at: ago(120 * MIN),
        clock_out_at: null,
        shift_template_id: 'shift-1',
        status: 'WORKING',
        late_minutes: 0,
        break_minutes: 0,
        break_overrun_minutes: 0,
        created_at: ago(120 * MIN),
      },
    ],
    attendance_breaks: opts.breaks || [],
    attendance_events: [],
    wfh_requests: opts.wfh || [],
    audit_logs: [],
    notifications: [],
    employee_live_locations: [],
  };
  db.seq = 0;
  db.failSelect = [];
  db.selects = {};
  db.failWrite = [];
  db.writes = {};
  db.uniqueOnInsert = false;
}

/** A tracking break as the database creates it (report_tracking_event / process_stale_tracking). */
function seedAutoBreak(): { breakId: string } {
  const id = `attendance_breaks-${++db.seq}`;
  db.tables.attendance_breaks.push({ id, attendance_id: 'att-1', employee_id: 'emp-1', break_type: 'AUTO_TRACKING', source: 'SYSTEM',
    reason: 'LOCATION_PERMISSION_DENIED', started_at: ago(10 * MIN), ended_at: null, duration_minutes: null });
  return { breakId: id };
}

describe('WorkPulse HR — Tracking Warning and Automatic Break Policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDb();
  });

  describe('device events are reported to the server; the browser never creates the break', () => {
    const rpc = () => (supabase as any).rpc as any;

    it('permission denied → report_tracking_event(LOCATION_DENIED); the server result is passed through', async () => {
      rpc().mockResolvedValueOnce({ data: { action: 'STARTED', break_id: 'b-1', reason: 'LOCATION_PERMISSION_DENIED', state: 'PERMISSION_DENIED' }, error: null });
      const res = await trackingEnforcementService.reportEvent('LOCATION_DENIED', { message: 'User denied Geolocation' });
      expect(rpc()).toHaveBeenCalledWith('report_tracking_event', { p_event: 'LOCATION_DENIED', p_message: 'User denied Geolocation', p_offline_seconds: null });
      expect(res).toEqual({ action: 'STARTED', breakId: 'b-1', reason: 'LOCATION_PERMISSION_DENIED', state: 'PERMISSION_DENIED' });
      // nothing written from the browser
      expect(db.tables.attendance_breaks).toHaveLength(0);
      expect(notificationService.notifyEmployee).not.toHaveBeenCalled();
    });

    it('timeout and server "no break" decisions come back as NONE with the server reason', async () => {
      rpc().mockResolvedValueOnce({ data: { action: 'NONE', reason: 'NOT_PROOF_OF_TRACKING_LOSS', state: 'GPS_TIMEOUT' }, error: null });
      const res = await trackingEnforcementService.reportEvent('TIMEOUT');
      expect(res.action).toBe('NONE');
      expect(res.reason).toBe('NOT_PROOF_OF_TRACKING_LOSS');
      expect(db.tables.attendance_breaks).toHaveLength(0);
    });

    it('network reconnect reports the offline duration (whole seconds, never negative)', async () => {
      rpc().mockResolvedValueOnce({ data: { action: 'NONE', reason: 'WAITING_FOR_FRESH_LOCATION', state: 'WAITING_FOR_FIX' }, error: null });
      await trackingEnforcementService.reportEvent('NETWORK_RECONNECTED', { offlineSeconds: 125.6 });
      expect(rpc()).toHaveBeenCalledWith('report_tracking_event', { p_event: 'NETWORK_RECONNECTED', p_message: null, p_offline_seconds: 126 });
      rpc().mockResolvedValueOnce({ data: { action: 'NONE' }, error: null });
      await trackingEnforcementService.reportEvent('NETWORK_RECONNECTED', { offlineSeconds: -5 });
      expect(rpc()).toHaveBeenLastCalledWith('report_tracking_event', { p_event: 'NETWORK_RECONNECTED', p_message: null, p_offline_seconds: 0 });
    });

    it('a refused or failed report is an ERROR, never a silent success', async () => {
      rpc().mockResolvedValueOnce({ data: null, error: { message: 'permission denied for function report_tracking_event' } });
      expect((await trackingEnforcementService.reportEvent('LOCATION_DENIED')).action).toBe('ERROR');
      rpc().mockRejectedValueOnce(new Error('Failed to fetch'));
      const res = await trackingEnforcementService.reportEvent('LOCATION_DENIED');
      expect(res).toEqual({ action: 'ERROR', reason: 'Failed to fetch' });
      rpc().mockResolvedValueOnce({ data: null, error: null });
      expect((await trackingEnforcementService.reportEvent('LOCATION_DENIED')).reason).toBe('NO_RESULT_FROM_SERVER');
    });

    it('admin fallback evaluation calls process_stale_tracking', async () => {
      rpc().mockResolvedValueOnce({ data: { checked: 3, started: 1 }, error: null });
      const res = await trackingEnforcementService.runStaleEvaluation();
      expect(rpc()).toHaveBeenCalledWith('process_stale_tracking');
      expect(res.data).toEqual({ checked: 3, started: 1 });
    });
  });

  describe('Step 6: Payroll Safeguards and Auditable Break Correction', () => {
    it('allows admin to safely correct an erroneous tracking enforcement break without affecting payroll', async () => {
      // 1. Start an auto break
      const startRes = seedAutoBreak();
      const breakId = startRes.breakId!;

      // 2. Admin corrects the erroneous break
      const correction = await trackingEnforcementService.correctIncidentBreak({
        breakId,
        attendanceId: 'att-1',
        reason: 'Device hardware glitch confirmed by admin review',
      });

      expect(correction.success).toBe(true);

      // Verify break is CANCELLED with 0 duration
      const brk = db.tables.attendance_breaks.find((b: any) => b.id === breakId);
      expect(brk.break_type).toBe('CANCELLED');
      expect(brk.duration_minutes).toBe(0);

      // Verify break event logged
      const cancelEvents = db.tables.attendance_events.filter((e: any) => e.event_type === 'BREAK_CORRECTION');
      expect(cancelEvents).toHaveLength(1);
      expect(cancelEvents[0].metadata.correction_reason).toContain('Device hardware glitch');

      // Verify attendance break_minutes remains 0 (no false payroll deduction)
      const att = db.tables.attendance[0];
      expect(att.break_minutes).toBe(0);
      expect(att.break_overrun_minutes).toBe(0);
    });

    it('allows HR role to correct tracking enforcement break', async () => {
      // Switch to HR user
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'hr-user-id' } },
        error: null,
      });

      const startRes = seedAutoBreak();

      const correction = await breakService.correctTrackingEnforcementBreak({
        breakId: startRes.breakId!,
        attendanceId: 'att-1',
        correctionReason: 'Verified office WiFi connection during event',
      });

      expect(correction.success).toBe(true);
      expect(correction.error).toBeNull();
    });

    it('rejects correction request if caller is not authenticated', async () => {
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: null },
        error: new Error('Session expired'),
      });

      const correction = await breakService.correctTrackingEnforcementBreak({
        breakId: 'some-break',
        attendanceId: 'att-1',
        correctionReason: 'Attempt by unauthenticated caller',
      });

      expect(correction.success).toBe(false);
      expect(correction.error?.message).toContain('Unauthorized: Authentication required');
    });

    it('rejects direct correction request if caller has EMPLOYEE role', async () => {
      // Direct call by employee via browser console or API
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'emp-user-id' } },
        error: null,
      });

      const correction = await breakService.correctTrackingEnforcementBreak({
        breakId: 'some-break',
        attendanceId: 'att-1',
        correctionReason: 'Employee attempting self-cancellation',
      });

      expect(correction.success).toBe(false);
      expect(correction.error?.message).toContain('Forbidden: Only Admin or HR roles are authorized');
    });

    it('rejects correction request if user profile is inactive', async () => {
      (supabase.auth.getUser as any).mockResolvedValue({
        data: { user: { id: 'inactive-user-id' } },
        error: null,
      });

      const correction = await breakService.correctTrackingEnforcementBreak({
        breakId: 'some-break',
        attendanceId: 'att-1',
        correctionReason: 'Attempt by inactive user',
      });

      expect(correction.success).toBe(false);
      expect(correction.error?.message).toContain('Unauthorized: Unable to verify caller identity or inactive account');
    });

    it('rejects correction request if reason is empty or whitespace only', async () => {
      const correction = await breakService.correctTrackingEnforcementBreak({
        breakId: 'some-break',
        attendanceId: 'att-1',
        correctionReason: '   ',
      });

      expect(correction.success).toBe(false);
      expect(correction.error?.message).toContain('A valid, non-empty correction reason is required');
    });

    it('rejects correction of unrelated manual break types like REGULAR or LUNCH', async () => {
      db.tables.attendance_breaks.push({
        id: 'manual-break-1',
        attendance_id: 'att-1',
        employee_id: 'emp-1',
        break_type: 'REGULAR',
        started_at: ago(60 * MIN),
        ended_at: ago(30 * MIN),
        duration_minutes: 30,
      });

      const correction = await breakService.correctTrackingEnforcementBreak({
        breakId: 'manual-break-1',
        attendanceId: 'att-1',
        correctionReason: 'Trying to cancel manual break',
      });

      expect(correction.success).toBe(false);
      expect(correction.error?.message).toContain("Cannot correct break with type 'REGULAR'");
    });

    it('rejects correction if break record does not match the specified attendance ID', async () => {
      const startRes = seedAutoBreak();

      const correction = await breakService.correctTrackingEnforcementBreak({
        breakId: startRes.breakId!,
        attendanceId: 'wrong-attendance-id',
        correctionReason: 'Scope mismatch test',
      });

      expect(correction.success).toBe(false);
      expect(correction.error?.message).toContain('Break record not found for the specified attendance');
    });
  });
});
