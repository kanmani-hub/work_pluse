import { describe, it, expect } from 'vitest';
import {
  resolveCallerRole,
  decideEmployeeDeletion,
  runEmployeeDeletion,
  HISTORY_TABLES,
  type DeletionPorts,
  type DbResult,
} from './employeeAdminRules';

const ok = <T>(data: T, count?: number): DbResult<T> => ({ data, error: null, count });
const err = (message: string, code?: string): DbResult<any> => ({ data: null, error: { message, code } });

const ADMIN_AUTH = 'aaaaaaaa-0000-0000-0000-000000000001';
const ADMIN_EMP = 'eeeeeeee-0000-0000-0000-00000000000a';
const TARGET = 'eeeeeeee-0000-0000-0000-000000000001';
const TARGET_AUTH = 'aaaaaaaa-0000-0000-0000-000000000002';

const adminProfile = { auth_user_id: ADMIN_AUTH, employee_id: ADMIN_EMP, is_active: true, roles: { name: 'ADMIN' }, employees: { status: 'ACTIVE' } };
const hrProfile = { ...adminProfile, roles: { name: 'HR' } };

/** In-memory fake of the database ports, recording every write. */
function fakePorts(over: Partial<DeletionPorts> & { history?: Record<string, number>; targetRole?: string } = {}) {
  const calls: string[] = [];
  const history = over.history ?? {};
  const ports: DeletionPorts = {
    loadCallerProfile: async () => ok(adminProfile),
    loadTargetEmployee: async (id) => ok({ id, role_id: 'r', roles: { name: over.targetRole ?? 'EMPLOYEE' } }),
    loadTargetProfile: async () => ok({ id: 'p-target', auth_user_id: TARGET_AUTH, role_id: 'r', is_active: true, roles: { name: over.targetRole ?? 'EMPLOYEE' } }),
    countRows: async (table) => ok(null, history[table] ?? 0),
    deleteProfile: async (id) => { calls.push(`deleteProfile:${id}`); return ok(null); },
    restoreProfile: async (p) => { calls.push(`restoreProfile:${p.id}`); return ok(null); },
    deleteEmployee: async (id) => { calls.push(`deleteEmployee:${id}`); return ok(null); },
    deleteAuthUser: async (id) => { calls.push(`deleteAuthUser:${id}`); return ok(null); },
    ...over,
  };
  return { ports, calls };
}

describe('resolveCallerRole (C1: role only from an active profile)', () => {
  it('ADMIN with an active profile and ACTIVE employee', () => {
    expect(resolveCallerRole(adminProfile)).toBe('ADMIN');
  });
  it('no profile → no role, whatever the email (no email fallback exists)', () => {
    expect(resolveCallerRole(null)).toBeNull();
    expect(resolveCallerRole(undefined)).toBeNull();
  });
  it('inactive profile → no role', () => {
    expect(resolveCallerRole({ ...adminProfile, is_active: false })).toBeNull();
  });
  it('deactivated employee → no role (status INACTIVE or legacy "Inactive")', () => {
    expect(resolveCallerRole({ ...adminProfile, employees: { status: 'INACTIVE' } })).toBeNull();
    expect(resolveCallerRole({ ...adminProfile, employees: { status: 'Inactive' } })).toBeNull();
  });
  it('unknown role name → no role (fail closed)', () => {
    expect(resolveCallerRole({ ...adminProfile, roles: { name: 'Super User' } })).toBeNull();
  });
  it('aliases and array joins are understood', () => {
    expect(resolveCallerRole({ ...adminProfile, roles: [{ name: 'hr manager' }] })).toBe('HR');
    expect(resolveCallerRole({ ...adminProfile, roles: { name: 'System Admin' }, employees: [{ status: 'active' }] })).toBe('ADMIN');
  });
});

describe('decideEmployeeDeletion (C3 / R2)', () => {
  const base = {
    callerRole: 'ADMIN' as const,
    callerEmployeeId: ADMIN_EMP,
    callerAuthUserId: ADMIN_AUTH,
    targetEmployeeId: TARGET,
    target: { exists: true, isAdmin: false, authUserId: TARGET_AUTH },
    historyTables: [] as string[],
  };
  it('allows an ADMIN to delete an employee with no history', () => {
    expect(decideEmployeeDeletion(base)).toEqual({ allowed: true });
  });
  it('HR is forbidden (403)', () => {
    expect(decideEmployeeDeletion({ ...base, callerRole: 'HR' })).toMatchObject({ allowed: false, status: 403, code: 'FORBIDDEN' });
  });
  it('EMPLOYEE and unauthenticated callers are forbidden', () => {
    expect(decideEmployeeDeletion({ ...base, callerRole: 'EMPLOYEE' })).toMatchObject({ status: 403 });
    expect(decideEmployeeDeletion({ ...base, callerRole: null })).toMatchObject({ status: 403 });
  });
  it('refuses self-deletion by employee id or by auth user id', () => {
    expect(decideEmployeeDeletion({ ...base, targetEmployeeId: ADMIN_EMP })).toMatchObject({ code: 'SELF_DELETE' });
    expect(decideEmployeeDeletion({ ...base, target: { ...base.target, authUserId: ADMIN_AUTH } })).toMatchObject({ code: 'SELF_DELETE' });
  });
  it('refuses to delete an ADMIN', () => {
    expect(decideEmployeeDeletion({ ...base, target: { ...base.target, isAdmin: true } })).toMatchObject({ status: 409, code: 'ADMIN_TARGET' });
  });
  it('refuses when there is any history and says to deactivate', () => {
    const d = decideEmployeeDeletion({ ...base, historyTables: ['payroll', 'audit_logs'] });
    expect(d).toMatchObject({ allowed: false, status: 409, code: 'HAS_HISTORY' });
    if (!d.allowed) expect(d.message).toMatch(/deactivate/i);
  });
  it('404 when the employee does not exist', () => {
    expect(decideEmployeeDeletion({ ...base, target: { exists: false, isAdmin: false } })).toMatchObject({ status: 404 });
  });
});

describe('HISTORY_TABLES covers the records that must be preserved', () => {
  it.each(['attendance', 'attendance_breaks', 'payroll', 'payslips', 'payroll_payments', 'salary_structures', 'audit_logs', 'leave_requests'])('%s', (t) => {
    expect(HISTORY_TABLES.map(h => h.table)).toContain(t);
  });
});

describe('runEmployeeDeletion flow', () => {
  it('rejects a malformed employee id without touching the database', async () => {
    const { ports, calls } = fakePorts();
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, '1; drop table employees');
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('HR calling the function directly gets 403 and nothing is deleted', async () => {
    const { ports, calls } = fakePorts({ loadCallerProfile: async () => ok(hrProfile) });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r).toMatchObject({ status: 403, body: { success: false, code: 'FORBIDDEN' } });
    expect(calls).toEqual([]);
  });

  it('a caller without a profile (e.g. admin@gmail.com) gets 403', async () => {
    const { ports, calls } = fakePorts({ loadCallerProfile: async () => ok(null as any) });
    expect((await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('self-deletion is refused', async () => {
    const { ports, calls } = fakePorts();
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, ADMIN_EMP);
    expect(r.body.code).toBe('SELF_DELETE');
    expect(calls).toEqual([]);
  });

  it('deleting an ADMIN is refused', async () => {
    const { ports, calls } = fakePorts({ targetRole: 'ADMIN' });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r.body.code).toBe('ADMIN_TARGET');
    expect(calls).toEqual([]);
  });

  it('an employee with payroll history is NOT deleted (409, deactivate instead)', async () => {
    const { ports, calls } = fakePorts({ history: { payroll: 3, attendance: 40 } });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r).toMatchObject({ status: 409, body: { code: 'HAS_HISTORY' } });
    expect(r.body.error).toMatch(/attendance/);
    expect(r.body.error).toMatch(/payroll/);
    expect(calls).toEqual([]);
  });

  it('a failed history lookup aborts with nothing deleted (never treated as "no history")', async () => {
    const { ports, calls } = fakePorts({ countRows: async (t) => (t === 'payslips' ? err('timeout') : ok(null, 0)) });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r).toMatchObject({ status: 500, body: { code: 'LOOKUP_FAILED' } });
    expect(calls).toEqual([]);
  });

  it('a missing optional table (overtime_requests) does not block', async () => {
    const { ports, calls } = fakePorts({ countRows: async (t) => (t === 'overtime_requests' ? err('relation does not exist', '42P01') : ok(null, 0)) });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r.status).toBe(200);
    expect(calls).toEqual(['deleteProfile:p-target', `deleteEmployee:${TARGET}`, `deleteAuthUser:${TARGET_AUTH}`]);
  });

  it('happy path: profile, then employee, then login account by stored id', async () => {
    const { ports, calls } = fakePorts();
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r).toEqual({ status: 200, body: { success: true } });
    expect(calls).toEqual(['deleteProfile:p-target', `deleteEmployee:${TARGET}`, `deleteAuthUser:${TARGET_AUTH}`]);
  });

  it('profile delete failure: stops, nothing else is deleted', async () => {
    const { ports, calls } = fakePorts({ deleteProfile: async () => err('boom') });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r).toMatchObject({ status: 500, body: { code: 'DELETE_FAILED' } });
    expect(calls).toEqual([]);
  });

  it('employee delete failure: the profile is restored and the login account is kept', async () => {
    const { ports, calls } = fakePorts({ deleteEmployee: async () => err('fk violation', '23503') });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r).toMatchObject({ status: 500, body: { code: 'DELETE_FAILED' } });
    expect(calls).toEqual(['deleteProfile:p-target', 'restoreProfile:p-target']);
  });

  it('employee delete failure AND restore failure is reported as a partial failure', async () => {
    const { ports } = fakePorts({ deleteEmployee: async () => err('x'), restoreProfile: async () => err('y') });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r.body.code).toBe('PARTIAL_FAILURE');
  });

  it('login-account removal failure still succeeds, with a warning', async () => {
    const { ports } = fakePorts({ deleteAuthUser: async () => err('auth down') });
    const r = await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.warning).toMatch(/login account/);
  });

  it('caller profile lookup error → 500, nothing deleted', async () => {
    const { ports, calls } = fakePorts({ loadCallerProfile: async () => err('db down') });
    expect((await runEmployeeDeletion(ports, ADMIN_AUTH, TARGET)).status).toBe(500);
    expect(calls).toEqual([]);
  });
});
