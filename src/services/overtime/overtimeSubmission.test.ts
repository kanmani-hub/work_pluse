import { describe, it, expect, vi, beforeEach } from 'vitest';
import { overtimeService, OT_NOT_SET_UP } from './overtimeService';
import { attendanceService } from '../attendance/attendanceService';
import { auditService } from '../audit/auditService';
import { notificationService } from '../notifications/notificationService';

vi.mock('../attendance/attendanceService');
vi.mock('../audit/auditService');
vi.mock('../notifications/notificationService');

interface MockDbState {
  attendanceRows: any[];
  breaks: any[];
  leaves: any[];
  activeRequests: any[];
  insertResult: any;
  insertError: any;
  insertedPayload: any;
  cancelResult: any;
  cancelError: any;
}

const mockDb: MockDbState = {
  attendanceRows: [],
  breaks: [],
  leaves: [],
  activeRequests: [],
  insertResult: null,
  insertError: null,
  insertedPayload: null,
  cancelResult: null,
  cancelError: null,
};

vi.mock('../../lib/supabase', () => {
  const from = (t: string) => {
    const q: any = { table: t, filters: [], inFilters: [] };
    const builder: any = {
      select: () => builder,
      insert: (payload: any) => {
        mockDb.insertedPayload = payload;
        return {
          select: () => ({
            single: () => Promise.resolve({
              data: mockDb.insertError ? null : (mockDb.insertResult || { id: 'ot-new', ...payload }),
              error: mockDb.insertError,
            }),
          }),
        };
      },
      update: (_payload: any) => ({
        eq: (_col: string, _val: any) => ({
          eq: (_col2: string, _val2: any) => ({
            eq: () => ({
              select: () => Promise.resolve({
                data: mockDb.cancelError ? null : mockDb.cancelResult,
                error: mockDb.cancelError,
              }),
            }),
          }),
        }),
      }),
      eq: (col: string, val: any) => {
        q.filters.push([col, val]);
        return builder;
      },
      in: (col: string, vals: any[]) => {
        q.inFilters.push([col, vals]);
        return builder;
      },
      order: () => builder,
      gte: () => builder,
      then: (resolve: any, reject: any) => {
        if (t === 'attendance') {
          return Promise.resolve({ data: mockDb.attendanceRows, error: null }).then(resolve, reject);
        }
        if (t === 'attendance_breaks') {
          return Promise.resolve({ data: mockDb.breaks, error: null }).then(resolve, reject);
        }
        if (t === 'leave_requests') {
          return Promise.resolve({ data: mockDb.leaves, error: null }).then(resolve, reject);
        }
        if (t === 'overtime_requests') {
          return Promise.resolve({ data: mockDb.activeRequests, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return { supabase: { from } };
});

const validAttendance = {
  id: 'att-101',
  employee_id: 'emp-1',
  attendance_date: '2026-10-10',
  clock_in_at: '2026-10-10T09:00:00+05:30',
  clock_out_at: '2026-10-10T20:00:00+05:30',
  required_hours: 8,
  is_half_day: false,
  status: 'PRESENT',
  is_auto_logged_out: false,
  worked_hours: 10,
  shift_template: {
    id: 'shift-1',
    name: 'General Shift',
    start_time: '09:00:00',
    end_time: '18:00:00',
    required_hours: 8,
    crosses_midnight: false,
  },
};

const validBreak = {
  attendance_id: 'att-101',
  started_at: '2026-10-10T13:00:00+05:30',
  ended_at: '2026-10-10T14:00:00+05:30',
  duration_minutes: 60,
  break_type: 'LUNCH',
};

beforeEach(() => {
  vi.clearAllMocks();
  (attendanceService.getCurrentEmployeeId as any).mockResolvedValue('emp-1');
  (auditService.recordAuditLog as any).mockResolvedValue({ data: null, error: null });
  (notificationService.notifyAdmins as any).mockResolvedValue({ data: null, error: null });

  mockDb.attendanceRows = [validAttendance];
  mockDb.breaks = [validBreak];
  mockDb.leaves = [];
  mockDb.activeRequests = [];
  mockDb.insertResult = null;
  mockDb.insertError = null;
  mockDb.insertedPayload = null;
  mockDb.cancelResult = [{ id: 'ot-101' }];
  mockDb.cancelError = null;
});

describe('overtimeService.createRequest - Successful Submission', () => {
  it('creates an overtime request with valid inputs and notifies admins', async () => {
    // 09:00 to 20:00 = 11h span, 1h break = 10h worked. 8h required = 2h eligible OT.
    const res = await overtimeService.createRequest('att-101', 1.5, 'Deployment support');

    expect(res.error).toBeNull();
    expect(res.data).toBeDefined();
    expect(mockDb.insertedPayload).toMatchObject({
      employee_id: 'emp-1',
      attendance_id: 'att-101',
      shift_id: 'shift-1',
      work_date: '2026-10-10',
      requested_overtime_hours: 1.5,
      eligible_overtime_hours: 2,
      employee_reason: 'Deployment support',
      status: 'PENDING',
    });

    expect(auditService.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'OT_REQUEST_CREATED',
        module: 'OVERTIME',
        entity_type: 'overtime_requests',
      })
    );

    expect(notificationService.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_type: 'OVERTIME',
        title: 'New Overtime Request',
      })
    );
  });

  it('rounds requested hours to 2 decimal places', async () => {
    const res = await overtimeService.createRequest('att-101', 1.25, 'Bug fixes for release');
    expect(res.error).toBeNull();
    expect(mockDb.insertedPayload.requested_overtime_hours).toBe(1.25);
  });
});

describe('overtimeService.createRequest - Validation Failures', () => {
  it('rejects 0 requested hours', async () => {
    const res = await overtimeService.createRequest('att-101', 0, 'Production issue');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('Requested overtime must be more than 0 hours.');
  });

  it('rejects negative requested hours', async () => {
    const res = await overtimeService.createRequest('att-101', -1.5, 'Production issue');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('Requested overtime must be more than 0 hours.');
  });

  it('rejects hours exceeding potential eligible overtime', async () => {
    // Potential is 2.0h, requesting 2.5h
    const res = await overtimeService.createRequest('att-101', 2.5, 'Extended testing');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('You can request at most 2 hours for this day.');
  });

  it('rejects numbers with more than 2 decimal places', async () => {
    const res = await overtimeService.createRequest('att-101', 1.333, 'Data migration');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('Use at most 2 decimal places.');
  });

  it('rejects missing or short reason (<3 characters)', async () => {
    const res1 = await overtimeService.createRequest('att-101', 1.0, '');
    expect(res1.error?.message).toBe('Please give a reason for the overtime.');

    const res2 = await overtimeService.createRequest('att-101', 1.0, '  ok ');
    expect(res2.error?.message).toBe('Please give a reason for the overtime.');
  });

  it('rejects request if employee has not clocked out yet', async () => {
    mockDb.attendanceRows = [{ ...validAttendance, clock_out_at: null }];
    const res = await overtimeService.createRequest('att-101', 1.0, 'Working late');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('There is no overtime available for this day.');
  });

  it('rejects request if worked time did not exceed scheduled hours', async () => {
    // 09:00 to 18:00 with 1h break = 8h worked, exactly 8h required
    mockDb.attendanceRows = [{ ...validAttendance, clock_out_at: '2026-10-10T18:00:00+05:30' }];
    const res = await overtimeService.createRequest('att-101', 1.0, 'Normal shift');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('There is no overtime available for this day.');
  });

  it('returns Attendance record not found if attendance row does not exist', async () => {
    mockDb.attendanceRows = [];
    const res = await overtimeService.createRequest('unknown-att', 1.0, 'Overtime');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('Attendance record not found.');
  });
});

describe('overtimeService.createRequest - Duplicate Requests', () => {
  it('blocks request if a PENDING or APPROVED request already exists in active check', async () => {
    mockDb.activeRequests = [{ id: 'existing-ot', status: 'PENDING' }];
    const res = await overtimeService.createRequest('att-101', 1.0, 'Duplicate try');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('An overtime request already exists for this day.');
    expect(mockDb.insertedPayload).toBeNull();
  });

  it('handles unique constraint violation code 23505 gracefully', async () => {
    mockDb.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const res = await overtimeService.createRequest('att-101', 1.0, 'Race condition duplicate');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('An overtime request already exists for this day.');
  });
});

describe('overtimeService.createRequest - Database Errors & Permissions', () => {
  it('maps missing table error 42P01 to OT_NOT_SET_UP message', async () => {
    mockDb.insertError = { code: '42P01', message: 'relation overtime_requests does not exist' };
    const res = await overtimeService.createRequest('att-101', 1.0, 'Server migration missing');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe(OT_NOT_SET_UP);
  });

  it('maps missing table error PGRST205 to OT_NOT_SET_UP message', async () => {
    mockDb.insertError = { code: 'PGRST205', message: "could not find table 'overtime_requests'" };
    const res = await overtimeService.createRequest('att-101', 1.0, 'Schema cache missing');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe(OT_NOT_SET_UP);
  });

  it('maps RLS / permission error 42501 to user-friendly permission error', async () => {
    mockDb.insertError = { code: '42501', message: 'permission denied for table overtime_requests' };
    const res = await overtimeService.createRequest('att-101', 1.0, 'No write permission');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('You are not allowed to do this.');
  });

  it('returns session expired when getCurrentEmployeeId returns null', async () => {
    (attendanceService.getCurrentEmployeeId as any).mockResolvedValue(null);
    const res = await overtimeService.createRequest('att-101', 1.0, 'Anonymous attempt');
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe('Your session has expired. Please sign in again.');
  });

  it('cancels request only when session is valid and status is PENDING', async () => {
    mockDb.cancelResult = [{ id: 'ot-101' }];
    const res = await overtimeService.cancelMyRequest('ot-101');
    expect(res.error).toBeNull();
  });

  it('rejects cancellation when request is not found or not PENDING', async () => {
    mockDb.cancelResult = [];
    const res = await overtimeService.cancelMyRequest('ot-approved');
    expect(res.error?.message).toBe('Only a pending request can be cancelled.');
  });
});
