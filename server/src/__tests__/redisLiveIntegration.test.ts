import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRedisClient } from '../redis/client.js';
import { CacheService } from '../redis/cacheService.js';
import { LockService } from '../redis/lockService.js';
import { GeoService } from '../redis/geoService.js';
import { createRateLimiter } from '../redis/rateLimiter.js';
import express, { type Request, type Response } from 'express';
import type { Server } from 'http';

describe('Live Redis 7 Integration Tests', () => {
  let redisClient: ReturnType<typeof createRedisClient>;
  let cacheService: CacheService;
  let lockService: LockService;
  let geoService: GeoService;

  beforeAll(async () => {
    // Connect to live local Redis container with isolated test namespace
    redisClient = createRedisClient({
      keyPrefix: 'wp:test:int:',
    });

    // Wait for ready
    await redisClient.connect().catch(() => {});
    cacheService = new CacheService(redisClient);
    lockService = new LockService(redisClient);
    geoService = new GeoService(redisClient);
  });

  afterAll(async () => {
    // Non-destructive cleanup: only remove keys under test namespace wp:test:int:*
    try {
      await cacheService.delByPattern('*');
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
  });

  it('connects to live Redis and responds to PING with PONG', async () => {
    const pong = await redisClient.ping();
    expect(pong).toBe('PONG');
  });

  it('performs cache set, get, TTL check, and selective pattern deletion', async () => {
    const testData = { orgId: 'ORG-TEST', name: 'WorkPulse Live Test', count: 42 };
    const setOk = await cacheService.set('cache:test:1', testData, 30);
    expect(setOk).toBe(true);

    const retrieved = await cacheService.get<typeof testData>('cache:test:1');
    expect(retrieved).toEqual(testData);

    const ttl = await redisClient.ttl('cache:test:1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);

    // Delete matching pattern without touching any production keys
    const deleted = await cacheService.delByPattern('cache:test:*');
    expect(deleted).toBeGreaterThanOrEqual(1);

    const check = await cacheService.get('cache:test:1');
    expect(check).toBeNull();
  });

  it('enforces distributed mutual exclusion across concurrent lock requests', async () => {
    const lockKey = 'payroll-month-end-lock';

    const token1 = await lockService.acquire(lockKey, 3000);
    expect(token1).toBeTruthy();

    // Concurrent request: should be blocked
    const token2 = await lockService.acquire(lockKey, 3000);
    expect(token2).toBeNull();

    // Release token1 safely
    const released = await lockService.release(lockKey, token1!);
    expect(released).toBe(true);

    // Now second attempt can acquire
    const token3 = await lockService.acquire(lockKey, 3000);
    expect(token3).toBeTruthy();

    await lockService.release(lockKey, token3!);
  });

  it('executes real Redis Geospatial commands (GEOADD, GEOPOS, GEORADIUS)', async () => {
    const bangalorePing = {
      employeeId: 'EMP-LIVE-BLR',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 8,
      timestamp: new Date().toISOString(),
    };

    const recorded = await geoService.recordPing(bangalorePing);
    expect(recorded).toBe(true);

    const fetched = await geoService.getEmployeeLocation('EMP-LIVE-BLR');
    expect(fetched).not.toBeNull();
    expect(fetched?.employeeId).toBe('EMP-LIVE-BLR');
    expect(fetched?.latitude).toBeCloseTo(12.9716, 2);
    expect(fetched?.longitude).toBeCloseTo(77.5946, 2);

    // Search nearby within 10,000 meters (10 km) of Bangalore center
    const nearby = await geoService.findEmployeesNearby(12.972, 77.595, 10000);
    expect(nearby.some((e) => e.employeeId === 'EMP-LIVE-BLR')).toBe(true);

    // Search in Mumbai coords: should NOT find Bangalore employee
    const farAway = await geoService.findEmployeesNearby(19.076, 72.8777, 10000);
    expect(farAway.some((e) => e.employeeId === 'EMP-LIVE-BLR')).toBe(false);

    // Clean up
    await geoService.removeEmployee('EMP-LIVE-BLR');
  });

  it('enforces sliding-window rate limiting on live Redis', async () => {
    const app = express();
    const limiter = createRateLimiter({
      windowSeconds: 60,
      maxRequests: 2,
      client: redisClient,
      keyPrefix: 'rl:live:',
      keyGenerator: () => 'emp-test-live',
    });

    app.get('/punch-action', limiter, (req: Request, res: Response) => {
      res.json({ punched: true });
    });

    let liveServer: Server;
    let liveUrl: string;

    await new Promise<void>((resolve) => {
      liveServer = app.listen(0, () => {
        const addr = liveServer.address() as any;
        liveUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });

    try {
      const r1 = await fetch(`${liveUrl}/punch-action`);
      expect(r1.status).toBe(200);

      const r2 = await fetch(`${liveUrl}/punch-action`);
      expect(r2.status).toBe(200);

      // Third request within window must be rate-limited
      const r3 = await fetch(`${liveUrl}/punch-action`);
      expect(r3.status).toBe(429);
      expect(r3.headers.get('retry-after')).toBeTruthy();
      expect(r3.headers.get('x-ratelimit-remaining')).toBe('0');
    } finally {
      await new Promise<void>((resolve) => liveServer.close(() => resolve()));
      await redisClient.del('rl:live:emp-test-live');
    }
  });
});
