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
  trackingEnforcementService.clearState();
}

describe('WorkPulse HR — Tracking Warning and Automatic Break Policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDb();
  });

  describe('Step 3: Warning and Immediate Automatic Break', () => {
    it('detects confirmed permission denied, sends warning, and immediately initiates automatic break', async () => {
      const res = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_DENIED',
        failureReason: 'User denied location permission',
        isOnline: true,
      });

      expect(res.decision.shouldTriggerAutomaticBreak).toBe(true);
      expect(res.decision.violationType).toBe('LOCATION_PERMISSION_DENIED');
      expect(res.breakResult?.action).toBe('STARTED');
      expect(res.breakResult?.breakId).toBeDefined();
      expect(res.breakResult?.incidentId).toContain('TRK-INC-');

      // Verify notification sent to employee
      expect(notificationService.notifyEmployee).toHaveBeenCalledTimes(1);
      const empNotificationCall = (notificationService.notifyEmployee as any).mock.calls[0];
      expect(empNotificationCall[0]).toBe('emp-1');
      expect(empNotificationCall[1].title).toContain('Tracking Unavailable');
      expect(empNotificationCall[1].notification_type).toBe('AUTOMATIC_BREAK');

      // Verify admin alert sent
      expect(notificationService.notifyAdmins).toHaveBeenCalledTimes(1);
      const adminAlertCall = (notificationService.notifyAdmins as any).mock.calls[0];
      expect(adminAlertCall[0].title).toContain('Tracking Enforcement: John Doe');

      // Verify database records
      const breaks = db.tables.attendance_breaks;
      expect(breaks).toHaveLength(1);
      expect(breaks[0]).toMatchObject({
        attendance_id: 'att-1',
        employee_id: 'emp-1',
        break_type: 'AUTO_TRACKING',
        ended_at: null,
      });

      // Verify attendance status set to ON_BREAK
      const att = db.tables.attendance[0];
      expect(att.status).toBe('ON_BREAK');

      // Verify attendance_events logged
      const events = db.tables.attendance_events;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        event_type: 'BREAK_START',
        metadata: expect.objectContaining({
          trigger: 'TRACKING_ENFORCEMENT',
          break_type: 'AUTO_TRACKING',
          violation_type: 'LOCATION_PERMISSION_DENIED',
        }),
      });
    });

    it('detects GPS disabled, sends warning, and immediately starts automatic break', async () => {
      const res = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_UNAVAILABLE',
        failureReason: 'Location provider disabled in system settings',
        isOnline: true,
      });

      expect(res.decision.shouldTriggerAutomaticBreak).toBe(true);
      expect(res.decision.violationType).toBe('GPS_DISABLED');
      expect(res.breakResult?.action).toBe('STARTED');

      const breaks = db.tables.attendance_breaks;
      expect(breaks).toHaveLength(1);
      expect(breaks[0].break_type).toBe('AUTO_TRACKING');
    });

    it('detects stale location updates while clocked in and initiates enforcement break', async () => {
      const lastSeen = ago(30 * MIN); // 30 mins ago (threshold 15 mins)
      const res = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'SUCCESS',
        lastSeenAt: lastSeen,
        serverReceivedAt: lastSeen,
        isOnline: true,
      });

      expect(res.decision.shouldTriggerAutomaticBreak).toBe(true);
      expect(res.decision.violationType).toBe('TRACKING_STALE');
      expect(res.breakResult?.action).toBe('STARTED');
    });

    it('does not block break creation if notification delivery fails', async () => {
      (notificationService.notifyEmployee as any).mockRejectedValueOnce(new Error('Network error sending push'));
      (notificationService.notifyAdmins as any).mockRejectedValueOnce(new Error('DB connection reset'));

      const res = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_DENIED',
        failureReason: 'Denied by user',
        isOnline: true,
      });

      // Break is still started despite notification failure
      expect(res.breakResult?.action).toBe('STARTED');
      expect(res.breakResult?.warningSent).toBe(false);
      expect(db.tables.attendance_breaks).toHaveLength(1);
      expect(db.tables.attendance[0].status).toBe('ON_BREAK');
    });
  });

  describe('Step 4: Concurrency and Duplicate Safeguards', () => {
    it('is idempotent: subsequent enforcement calls do not create duplicate breaks', async () => {
      // First call starts the break
      const first = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_DENIED',
        isOnline: true,
      });
      expect(first.breakResult?.action).toBe('STARTED');
      expect(db.tables.attendance_breaks).toHaveLength(1);

      // Second call while break is active
      const second = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_DENIED',
        isOnline: true,
      });
      expect(second.decision.shouldTriggerAutomaticBreak).toBe(false);
      expect(second.decision.condition).toBe('ALREADY_ON_BREAK');
      expect(second.breakResult).toBeUndefined();
      expect(db.tables.attendance_breaks).toHaveLength(1); // exactly one break
    });

    it('prevents duplicate breaks when breakService is called directly while a break is active', async () => {
      // Existing active break
      db.tables.attendance_breaks = [
        { id: 'brk-1', attendance_id: 'att-1', employee_id: 'emp-1', break_type: 'REGULAR', started_at: ago(10 * MIN), ended_at: null },
      ];
      db.tables.attendance[0].status = 'ON_BREAK';

      const res = await breakService.handleTrackingEnforcementBreak({
        employeeId: 'emp-1',
        violationType: 'LOCATION_PERMISSION_DENIED',
        reason: 'Location permission denied',
      });

      expect(res.action).toBe('NONE');
      expect(res.reason).toBe('BREAK_ALREADY_ACTIVE');
      expect(db.tables.attendance_breaks).toHaveLength(1); // no second break
    });

    it('gracefully handles database unique constraint violation (23505) under racing conditions', async () => {
      db.uniqueOnInsert = true; // database refuses second open break

      const res = await breakService.handleTrackingEnforcementBreak({
        employeeId: 'emp-1',
        violationType: 'LOCATION_PERMISSION_DENIED',
        reason: 'Location permission denied',
      });

      expect(res.action).toBe('NONE');
      expect(res.reason).toBe('BREAK_ALREADY_ACTIVE');
    });

    it('does not start a break if the employee has clocked out', async () => {
      db.tables.attendance[0].clock_out_at = ago(5 * MIN);
      db.tables.attendance[0].status = 'WORKING';

      const res = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_DENIED',
        isOnline: true,
      });

      expect(res.decision.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.decision.condition).toBe('CLOCKED_OUT');
      expect(db.tables.attendance_breaks).toHaveLength(0);
    });

    it('does not start a break if the employee is on approved WFH', async () => {
      db.tables.wfh_requests = [
        { id: 'wfh-1', employee_id: 'emp-1', request_date: today(), status: 'APPROVED' },
      ];

      const res = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_DENIED',
        isOnline: true,
      });

      expect(res.decision.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.decision.condition).toBe('WFH_EXEMPT');
      expect(db.tables.attendance_breaks).toHaveLength(0);
    });
  });

  describe('Step 5: Offline and Recovery Behavior', () => {
    it('handles offline device without penalizing employee as noncompliant', async () => {
      const res = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_UNAVAILABLE',
        isOnline: false,
      });

      expect(res.decision.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.decision.isOffline).toBe(true);
      expect(res.decision.isUnverified).toBe(true);
      expect(res.decision.shouldQueueDeviceWarning).toBe(true);
      expect(db.tables.attendance_breaks).toHaveLength(0);

      // Verify offline warning queued
      expect(notificationService.notifyEmployee).toHaveBeenCalledTimes(1);
      const call = (notificationService.notifyEmployee as any).mock.calls[0];
      expect(call[1].title).toContain('Offline: Location Tracking Paused');
    });

    it('does not treat transient timeouts as deliberate noncompliance', async () => {
      const res = await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'TIMEOUT',
        failureReason: 'Timeout expired waiting for GPS fix',
        isOnline: true,
      });

      expect(res.decision.shouldTriggerAutomaticBreak).toBe(false);
      expect(res.decision.condition).toBe('TRANSIENT_TIMEOUT');
      expect(db.tables.attendance_breaks).toHaveLength(0);
    });

    it('records recovery timestamp in audit log and notifies admin without auto-closing break', async () => {
      // 1. Initial violation occurs
      await trackingEnforcementService.evaluateAndEnforce({
        employeeId: 'emp-1',
        geoStatus: 'LOCATION_DENIED',
        isOnline: true,
      });
      expect(db.tables.attendance_breaks).toHaveLength(1);

      // 2. Tracking resumes with a fresh usable fix
      const recoveryTime = Date.now();
      await trackingEnforcementService.handleTrackingRecovered('emp-1', recoveryTime);

      // Admin was notified of recovery
      expect(notificationService.notifyAdmins).toHaveBeenCalledTimes(2); // 1 start + 1 recovery
      const recCall = (notificationService.notifyAdmins as any).mock.calls[1];
      expect(recCall[0].title).toContain('Tracking Resumed: John Doe');

      // The break was NOT silently deleted or closed
      const brk = db.tables.attendance_breaks[0];
      expect(brk.ended_at).toBeNull();
      expect(brk.break_type).toBe('AUTO_TRACKING');
    });
  });

  describe('Step 6: Payroll Safeguards and Auditable Break Correction', () => {
    it('allows admin to safely correct an erroneous tracking enforcement break without affecting payroll', async () => {
      // 1. Start an auto break
      const startRes = await breakService.handleTrackingEnforcementBreak({
        employeeId: 'emp-1',
        violationType: 'LOCATION_PERMISSION_DENIED',
        reason: 'False positive diagnostic trigger',
      });
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

      const startRes = await breakService.handleTrackingEnforcementBreak({
        employeeId: 'emp-1',
        violationType: 'GPS_DISABLED',
        reason: 'GPS glitch test',
      });

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
      const startRes = await breakService.handleTrackingEnforcementBreak({
        employeeId: 'emp-1',
        violationType: 'TRACKING_STALE',
        reason: 'Stale break test',
      });

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
