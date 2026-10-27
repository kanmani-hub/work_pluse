import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
// @ts-ignore
import RedisMock from 'ioredis-mock';

// ---- shared mocks ------------------------------------------------------------------------------
const redis = new RedisMock();
vi.mock('../redis/client.js', () => ({
  getRedisClient: () => redis,
  isConnected: () => true,
  pingRedis: async () => ({ ok: true, latencyMs: 1 }),
  closeRedis: async () => {},
}));
vi.mock('../redis/geoService.js', () => ({ geoService: { recordPing: vi.fn(async () => true), getEmployeeLocation: vi.fn(), findNearby: vi.fn() } }));

let supabaseMock: any = null;
vi.mock('../services/supabase.js', () => ({ getSupabase: () => supabaseMock }));

import { mapProfileToIdentity, clearIdentityCache } from '../services/identity.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { trackingBufferService, clampPingTime, GPS_QUEUE_KEY, GPS_DEAD_KEY, MAX_ATTEMPTS } from '../services/trackingBufferService.js';
import { createApp } from '../app.js';

const profile = (role: string, extra: any = {}) => ({ employee_id: 'emp-uuid', is_active: true, roles: { name: role }, employees: { status: 'ACTIVE' }, ...extra });
function authSupabase(userMetadata: any, profileRow: any, profileError: any = null) {
  return {
    auth: { getUser: async () => ({ error: null, data: { user: { id: 'auth-1', email: 'e@example.com', app_metadata: {}, user_metadata: userMetadata } } }) },
    from: (t: string) => {
      expect(t).toBe('profiles');
      const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: profileRow, error: profileError }) };
      return b;
    },
  };
}
async function runAuth(token = 'real-jwt') {
  const req: any = { headers: { authorization: `Bearer ${token}` } };
  await authenticate(req, {} as any, () => {});
  let status = 200;
  const res: any = { status: (s: number) => { status = s; return res; }, json: () => res };
  if (req.user) requireRole('admin', 'super_admin')(req, res, () => {});
  return { user: req.user, adminStatus: req.user ? status : 401 };
}

describe('MS-1 identity comes from the database, never from user_metadata', () => {
  beforeEach(() => clearIdentityCache());

  it('maps an active profile to a role; inactive / missing / unknown give nothing', () => {
    expect(mapProfileToIdentity(profile('ADMIN'))).toEqual({ role: 'admin', employee_id: 'emp-uuid' });
    expect(mapProfileToIdentity(profile('HR'))).toEqual({ role: 'hr', employee_id: 'emp-uuid' });
    expect(mapProfileToIdentity(profile('EMPLOYEE', { is_active: false }))).toBeNull();
    expect(mapProfileToIdentity(profile('EMPLOYEE', { employees: { status: 'INACTIVE' } }))).toBeNull();
    expect(mapProfileToIdentity(profile('SUPERUSER'))).toBeNull();
    expect(mapProfileToIdentity(null)).toBeNull();
  });

  it('an employee who set user_metadata.role=admin and another employee_id stays an employee', async () => {
    supabaseMock = authSupabase({ role: 'admin', employee_id: 'VICTIM' }, profile('EMPLOYEE'));
    const r = await runAuth();
    expect(r.user).toMatchObject({ role: 'employee', employee_id: 'emp-uuid' });
    expect(r.adminStatus).toBe(403);
  });

  it('a real admin profile is admin', async () => {
    supabaseMock = authSupabase({}, profile('ADMIN'));
    const r = await runAuth();
    expect(r.user.role).toBe('admin');
    expect(r.adminStatus).toBe(200);
  });

  it('no profile, or a failed lookup, leaves the request unauthenticated (fail closed)', async () => {
    supabaseMock = authSupabase({ role: 'admin' }, null);
    expect((await runAuth()).user).toBeUndefined();
    clearIdentityCache();
    supabaseMock = authSupabase({ role: 'admin' }, null, { message: 'db down' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await runAuth()).user).toBeUndefined();
  });

  it('without the server key no identity can be verified', async () => {
    supabaseMock = null;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await runAuth()).user).toBeUndefined();
  });
});

describe('MS-5 fixed test tokens', () => {
  afterAll(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it('are refused in development unless ALLOW_DEV_TOKENS=true, and always in production', async () => {
    for (const [nodeEnv, allow, expected] of [['development', 'false', false], ['development', 'true', true], ['production', 'true', false]] as const) {
      vi.resetModules();
      vi.stubEnv('NODE_ENV', nodeEnv);
      vi.stubEnv('ALLOW_DEV_TOKENS', allow);
      supabaseMock = null;
      const mod = await import('../middleware/auth.js');
      const req: any = { headers: { authorization: 'Bearer dev-admin-token' } };
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await mod.authenticate(req, {} as any, () => {});
      expect(!!req.user, `${nodeEnv}/${allow}`).toBe(expected);
    }
  });
});

describe('MS-6 CORS and MS-3 punch endpoint', () => {
  it('unknown origins get no CORS permission; configured origins do', async () => {
    const app = createApp();
    const server = app.listen(0);
    const port = (server.address() as any).port;
    try {
      const evil = await fetch(`http://localhost:${port}/`, { headers: { Origin: 'https://evil.example' } });
      expect(evil.headers.get('access-control-allow-origin')).toBeNull();
      const ok = await fetch(`http://localhost:${port}/`, { headers: { Origin: 'http://localhost:5173' } });
      expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      // punch: validated and authorised, but nothing is written (501), and the old fake "recorded" is gone
      const punch = await fetch(`http://localhost:${port}/api/attendance/punch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev-employee-token' },
        body: JSON.stringify({ employeeId: 'EMP-001', workDate: '2026-10-22', punchType: 'check_in' }),
      });
      expect(punch.status).toBe(501);
      expect((await punch.json()).message).toMatch(/Nothing was saved/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe('MS-4 GPS buffer: persisted to employee_location_history, retried in order, never silently dropped', () => {
  beforeEach(async () => { await redis.flushall(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  const ping = (id: string, t = new Date().toISOString()) => ({ employeeId: id, latitude: 12.9, longitude: 77.6, accuracy: 10, timestamp: t });
  const queued = async () => (await redis.lrange(GPS_QUEUE_KEY, 0, -1)).map((s: string) => JSON.parse(s));

  it('clamps client timestamps to the server clock', () => {
    const now = Date.parse('2026-10-22T10:00:00Z');
    expect(clampPingTime('2026-10-22T09:58:00Z', now)).toBe('2026-10-22T09:58:00.000Z');
    expect(clampPingTime('2026-10-22T11:00:00Z', now)).toBe('2026-10-22T10:00:00.000Z');   // future
    expect(clampPingTime('2026-10-22T08:00:00Z', now)).toBe('2026-10-22T10:00:00.000Z');   // too old
    expect(clampPingTime('garbage', now)).toBe('2026-10-22T10:00:00.000Z');
  });

  it('without a database nothing is popped or reported as persisted', async () => {
    supabaseMock = null;
    await trackingBufferService.ingestPing(ping('a'));
    expect(await trackingBufferService.flushBreadcrumbs()).toBe(0);
    expect(await queued()).toHaveLength(1);
  });

  it('writes a batch to employee_location_history', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    supabaseMock = { from: (t: string) => { expect(t).toBe('employee_location_history'); return { insert }; } };
    await trackingBufferService.ingestPing(ping('a'));
    await trackingBufferService.ingestPing(ping('b'));
    expect(await trackingBufferService.flushBreadcrumbs()).toBe(2);
    const rows = (insert.mock.calls[0] as any)[0];
    expect(rows.map((r: any) => r.employee_id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ source: 'MICROSERVICE', location_context: 'UNKNOWN', accuracy_meters: 10 });
    expect(await queued()).toHaveLength(0);
  });

  it('a failed batch returns to the front in the original order, then goes to the dead-letter list after the last attempt', async () => {
    supabaseMock = { from: () => ({ insert: async () => ({ error: { message: 'connection reset' } }) }) };
    await trackingBufferService.ingestPing(ping('a'));
    await trackingBufferService.ingestPing(ping('b'));
    expect(await trackingBufferService.flushBreadcrumbs()).toBe(0);
    let q = await queued();
    expect(q.map((p: any) => p.employeeId)).toEqual(['a', 'b']);
    expect(q.every((p: any) => p.attempts === 1)).toBe(true);
    for (let i = 1; i < MAX_ATTEMPTS; i++) await trackingBufferService.flushBreadcrumbs();
    q = await queued();
    const dead = (await redis.lrange(GPS_DEAD_KEY, 0, -1)).map((s: string) => JSON.parse(s));
    expect(q).toHaveLength(0);
    expect(dead.map((p: any) => p.employeeId)).toEqual(['a', 'b']);
  });

  it('malformed queue items are kept in the dead-letter list', async () => {
    supabaseMock = { from: () => ({ insert: async () => ({ error: null }) }) };
    await redis.rpush(GPS_QUEUE_KEY, '{not json');
    await trackingBufferService.flushBreadcrumbs();
    expect(await redis.lrange(GPS_DEAD_KEY, 0, -1)).toEqual(['{not json']);
  });
});
