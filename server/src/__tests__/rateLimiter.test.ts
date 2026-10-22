import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response } from 'express';
// @ts-ignore
import RedisMock from 'ioredis-mock';
import type { Server } from 'http';
import { createRateLimiter } from '../redis/rateLimiter.js';

describe('Sliding-Window Rate Limiter', () => {
  let server: Server;
  let baseUrl: string;

  describe('When Redis is unavailable (Fail-open resilience)', () => {
    beforeEach(async () => {
      const app = express();
      // createRateLimiter will notice isConnected() is false
      const limiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 3,
        failOpen: true,
      });

      app.get('/test-endpoint', limiter, (req: Request, res: Response) => {
        res.json({ success: true });
      });

      await new Promise<void>((resolve) => {
        server = app.listen(0, () => {
          const addr = server.address() as any;
          baseUrl = `http://localhost:${addr.port}`;
          resolve();
        });
      });
    });

    it('fails open without throwing 500 and injects X-RateLimit-Degraded header', async () => {
      const res = await fetch(`${baseUrl}/test-endpoint`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-ratelimit-degraded')).toBe('true');
      const body = await res.json();
      expect(body.success).toBe(true);

      // Even after 10 requests, it never blocks critical user operations when Redis is down
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${baseUrl}/test-endpoint`);
        expect(response.status).toBe(200);
      }
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  });

  describe('Active Redis Sliding-Window with Mock Redis', () => {
    let mockRedis: any;

    beforeEach(async () => {
      mockRedis = new RedisMock();
      await mockRedis.flushall();
      const app = express();

      const limiter = createRateLimiter({
        windowSeconds: 60,
        maxRequests: 3,
        client: mockRedis,
        keyGenerator: () => 'test-user',
        message: 'Rate limit exceeded',
      });

      app.get('/limited', limiter, (req: Request, res: Response) => {
        res.json({ message: 'allowed' });
      });

      await new Promise<void>((resolve) => {
        server = app.listen(0, () => {
          const addr = server.address() as any;
          baseUrl = `http://localhost:${addr.port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('enforces limit: allows 3 requests then blocks 4th with 429 and headers', async () => {
      const r1 = await fetch(`${baseUrl}/limited`);
      expect(r1.status).toBe(200);
      expect(r1.headers.get('x-ratelimit-remaining')).toBe('2');

      const r2 = await fetch(`${baseUrl}/limited`);
      expect(r2.status).toBe(200);
      expect(r2.headers.get('x-ratelimit-remaining')).toBe('1');

      const r3 = await fetch(`${baseUrl}/limited`);
      expect(r3.status).toBe(200);
      expect(r3.headers.get('x-ratelimit-remaining')).toBe('0');

      const r4 = await fetch(`${baseUrl}/limited`);
      expect(r4.status).toBe(429);
      expect(r4.headers.get('retry-after')).toBeTruthy();
      const body4 = await r4.json();
      expect(body4.error).toBe('Too Many Requests');
    });

    it('handles concurrent requests deterministically', async () => {
      // 5 concurrent requests fired at the exact same millisecond
      const responses = await Promise.all([
        fetch(`${baseUrl}/limited`),
        fetch(`${baseUrl}/limited`),
        fetch(`${baseUrl}/limited`),
        fetch(`${baseUrl}/limited`),
        fetch(`${baseUrl}/limited`),
      ]);

      const statuses = responses.map((r) => r.status);
      const okCount = statuses.filter((s) => s === 200).length;
      const limitedCount = statuses.filter((s) => s === 429).length;

      expect(okCount).toBe(3);
      expect(limitedCount).toBe(2);
    });
  });
});
