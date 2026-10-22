import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import { createApp } from '../app.js';

describe('Authentication & Authorization Guards', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe('Unauthenticated Access (Missing Bearer Token)', () => {
    it('allows public health endpoint without auth', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      // 200 or 503 depending on redis, but NEVER 401
      expect(res.status).not.toBe(401);
    });

    it('rejects /api/cache/stats with 401', async () => {
      const res = await fetch(`${baseUrl}/api/cache/stats`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('rejects /api/payroll/daily-report with 401', async () => {
      const res = await fetch(`${baseUrl}/api/payroll/daily-report?date=2026-10-21`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('rejects /api/attendance/punch with 401', async () => {
      const res = await fetch(`${baseUrl}/api/attendance/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: 'EMP-001',
          workDate: '2026-10-21',
          punchType: 'check_in',
        }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects /api/tracking/ping with 401', async () => {
      const res = await fetch(`${baseUrl}/api/tracking/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: 'EMP-001',
          latitude: 12.97,
          longitude: 77.59,
        }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects /api/tracking/employee/:id with 401', async () => {
      const res = await fetch(`${baseUrl}/api/tracking/employee/EMP-001`);
      expect(res.status).toBe(401);
    });

    it('rejects /api/tracking/nearby with 401', async () => {
      const res = await fetch(`${baseUrl}/api/tracking/nearby?lat=12.97&lng=77.59`);
      expect(res.status).toBe(401);
    });
  });

  describe('Role-Based Authorization & IDOR Protection', () => {
    it('forbids normal employee from accessing admin cache stats', async () => {
      const res = await fetch(`${baseUrl}/api/cache/stats`, {
        headers: { Authorization: 'Bearer dev-employee-token' },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Forbidden');
    });

    it('forbids normal employee from accessing payroll daily report', async () => {
      const res = await fetch(`${baseUrl}/api/payroll/daily-report?date=2026-10-21`, {
        headers: { Authorization: 'Bearer dev-employee-token' },
      });
      expect(res.status).toBe(403);
    });

    it('prevents employee from clocking in for another employee (IDOR)', async () => {
      const res = await fetch(`${baseUrl}/api/attendance/punch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer dev-employee-token', // Bound to EMP-001
        },
        body: JSON.stringify({
          employeeId: 'EMP-OTHER-VICTIM', // Attempt to punch for someone else
          workDate: '2026-10-21',
          punchType: 'check_in',
        }),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain('Cannot clock in/out on behalf of another employee');
    });

    it('prevents employee from submitting GPS ping for another employee (IDOR)', async () => {
      const res = await fetch(`${baseUrl}/api/tracking/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer dev-employee-token', // Bound to EMP-001
        },
        body: JSON.stringify({
          employeeId: 'EMP-002',
          latitude: 12.97,
          longitude: 77.59,
        }),
      });
      expect(res.status).toBe(403);
    });

    it('prevents employee from tracking location of another employee', async () => {
      const res = await fetch(`${baseUrl}/api/tracking/employee/EMP-002`, {
        headers: { Authorization: 'Bearer dev-employee-token' },
      });
      expect(res.status).toBe(403);
    });

    it('allows admin to access cache stats', async () => {
      const res = await fetch(`${baseUrl}/api/cache/stats`, {
        headers: { Authorization: 'Bearer dev-admin-token' },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
    });

    it('allows admin to query payroll reports', async () => {
      const res = await fetch(`${baseUrl}/api/payroll/daily-report?date=2026-10-21`, {
        headers: { Authorization: 'Bearer dev-admin-token' },
      });
      expect(res.status).toBe(200);
    });
  });
});
