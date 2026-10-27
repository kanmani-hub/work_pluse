import { describe, it, expect, vi, beforeEach } from 'vitest';

// Admin "Add Leave" / "Add Permission" save for real and only report what the database stored.
// Every awaited query takes the next queued response; calls are recorded for assertions.
const calls: { table: string; ops: [string, any[]][] }[] = [];
let responses: any[] = [];
function builder(table: string) {
  const rec = { table, ops: [] as [string, any[]][] };
  calls.push(rec);
  const b: any = {};
  for (const op of ['select', 'eq', 'neq', 'in', 'lte', 'gte', 'insert', 'update', 'single', 'maybeSingle', 'order', 'limit']) {
    b[op] = (...args: any[]) => { rec.ops.push([op, args]); return b; };
  }
  b.then = (res: any, rej: any) => Promise.resolve(responses.length ? responses.shift() : { data: null, error: null }).then(res, rej);
  return b;
}
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    auth: { getUser: async () => ({ data: { user: { id: 'u-admin' } }, error: null }) },
    rpc: vi.fn(async () => ({ data: 1, error: null })),
  },
}));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(() => Promise.resolve({ data: {}, error: null })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn(async () => true), notifyAdmins: vi.fn(async () => ({ count: 1, error: null })) } }));

import { permissionService } from './permissionService';
import { leaveService } from '../leave/leaveService';

const perm = { permission_date: '2026-11-05', start_time: '10:00', end_time: '11:00', reason: 'doctor' };
const leave = { leave_type_id: 'lt', start_date: '2026-11-02', end_date: '2026-11-03', is_half_day: false, reason: 'family' };

describe('admin creates requests for an employee', () => {
  beforeEach(() => { calls.length = 0; responses = []; vi.spyOn(permissionService, 'getCurrentEmployeeId').mockResolvedValue('e-admin'); vi.spyOn(leaveService, 'getCurrentEmployeeId').mockResolvedValue('e-admin'); });

  it('permission: validation errors are returned before anything is sent', async () => {
    expect((await permissionService.createPermissionForEmployee('', perm, false)).error?.message).toMatch(/employee/);
    expect((await permissionService.createPermissionForEmployee('e1', { ...perm, end_time: '09:00' }, false)).error?.message).toMatch(/after start/);
    expect((await permissionService.createPermissionForEmployee('e1', { ...perm, reason: ' ' }, false)).error?.message).toMatch(/reason/);
    expect(calls).toHaveLength(0);
  });

  it('permission: an overlapping active permission is refused, nothing inserted', async () => {
    responses = [{ data: [{ id: 'x', start_time: '10:30:00', end_time: '12:00:00', status: 'APPROVED' }], error: null }];
    const r = await permissionService.createPermissionForEmployee('e1', perm, true);
    expect(r.error?.message).toMatch(/overlaps an existing approved permission/);
    expect(calls.some((c) => c.ops.some(([op]) => op === 'insert'))).toBe(false);
  });

  it('permission: a failed overlap check is not treated as "no overlap"', async () => {
    responses = [{ data: null, error: { message: 'network down' } }];
    const r = await permissionService.createPermissionForEmployee('e1', perm, false);
    expect(r.error?.message).toMatch(/could not be checked/);
  });

  it('permission: saved as pending when not approving', async () => {
    responses = [{ data: [], error: null }, { data: { id: 'p1', status: 'PENDING' }, error: null }];
    const r = await permissionService.createPermissionForEmployee('e1', perm, false);
    expect(r).toEqual({ data: { id: 'p1', status: 'PENDING' }, error: null });
    const ins = calls.find((c) => c.ops.some(([op]) => op === 'insert'))!;
    expect(ins.ops.find(([op]) => op === 'insert')![1][0]).toMatchObject({ employee_id: 'e1', status: 'PENDING', duration_minutes: 60 });
  });

  it('permission: database rejection is reported, never success', async () => {
    responses = [{ data: [], error: null }, { data: null, error: { message: 'new row violates row-level security policy' } }];
    const r = await permissionService.createPermissionForEmployee('e1', perm, false);
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch(/row-level security/);
  });

  it('permission: "approve now" is confirmed by reading back the stored status', async () => {
    // overlap, insert, review: before-read, update(changed rows), notification read, then the confirming read
    responses = [{ data: [], error: null }, { data: { id: 'p1', status: 'PENDING' }, error: null }];
    vi.spyOn(permissionService, 'reviewPermissionRequest').mockResolvedValueOnce({ error: null } as any);
    responses.push({ data: { status: 'PENDING' }, error: null });   // the database did NOT store the approval
    const r = await permissionService.createPermissionForEmployee('e1', perm, true);
    expect(r.error?.message).toMatch(/Saved as PENDING, but approval failed/);
    expect(r.data?.status).toBe('PENDING');
  });

  it('permission: approved when the database confirms it', async () => {
    responses = [{ data: [], error: null }, { data: { id: 'p1', status: 'PENDING' }, error: null }];
    vi.spyOn(permissionService, 'reviewPermissionRequest').mockResolvedValueOnce({ error: null } as any);
    responses.push({ data: { status: 'APPROVED' }, error: null });
    const r = await permissionService.createPermissionForEmployee('e1', perm, true);
    expect(r).toEqual({ data: { id: 'p1', status: 'APPROVED' }, error: null });
  });

  it('employee request: overlap blocks the insert (B-11)', async () => {
    vi.spyOn(permissionService, 'getCurrentEmployeeId').mockResolvedValue('e1');
    responses = [{ data: [{ id: 'x', start_time: '09:00', end_time: '10:30', status: 'PENDING' }], error: null }];
    const r = await permissionService.createPermissionRequest(perm);
    expect(r.error?.message).toMatch(/overlaps an existing pending permission/);
    expect(calls.some((c) => c.ops.some(([op]) => op === 'insert'))).toBe(false);
  });

  it('leave: half day must be one date; overlap refused; failed check reported', async () => {
    expect((await leaveService.createLeaveForEmployee('e1', { ...leave, is_half_day: true, half_day_type: 'FIRST_HALF' }, false)).error?.message).toMatch(/same date/);
    responses = [{ data: [{ id: 'l0' }], error: null }];
    expect((await leaveService.createLeaveForEmployee('e1', leave, false)).error?.message).toMatch(/overlapping/);
    responses = [{ data: null, error: { message: 'timeout' } }];
    expect((await leaveService.createLeaveForEmployee('e1', leave, false)).error?.message).toMatch(/could not be checked/);
  });

  it('leave: approval failure leaves it pending and says so', async () => {
    responses = [{ data: [], error: null }, { data: { id: 'l1', status: 'PENDING' }, error: null }];
    vi.spyOn(leaveService, 'reviewLeaveRequest').mockResolvedValueOnce({ error: new Error('You can only cancel your own PENDING request; approval is done by HR') } as any);
    responses.push({ data: { status: 'PENDING' }, error: null });
    const r = await leaveService.createLeaveForEmployee('e1', leave, true);
    expect(r.error?.message).toMatch(/Saved as PENDING, but approval failed: You can only cancel/);
  });
});
