import { describe, it, expect, beforeEach } from 'vitest';
// @ts-ignore
import RedisMock from 'ioredis-mock';
import { CacheService } from '../redis/cacheService.js';

describe('CacheService', () => {
  let mockRedis: any;
  let cache: CacheService;

  beforeEach(() => {
    mockRedis = new RedisMock();
    cache = new CacheService(mockRedis);
  });

  it('sets and gets serialized JSON data', async () => {
    const payload = { employeeId: 'EMP001', name: 'Yuvaraj K', salary: 35000 };
    const success = await cache.set('test:employee:1', payload, 60);

    expect(success).toBe(true);

    const retrieved = await cache.get<typeof payload>('test:employee:1');
    expect(retrieved).toEqual(payload);
  });

  it('returns null on cache miss', async () => {
    const missing = await cache.get('nonexistent:key');
    expect(missing).toBeNull();
  });

  it('implements getOrSet cache-aside pattern', async () => {
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      return { reportId: 'RPT-123', totalDeductions: 500 };
    };

    // First call: cache miss, fetcher executed
    const res1 = await cache.getOrSet('test:report:123', fetcher, 60);
    expect(res1).toEqual({ reportId: 'RPT-123', totalDeductions: 500 });
    expect(callCount).toBe(1);

    // Second call: served from Redis cache, fetcher NOT called
    const res2 = await cache.getOrSet('test:report:123', fetcher, 60);
    expect(res2).toEqual({ reportId: 'RPT-123', totalDeductions: 500 });
    expect(callCount).toBe(1);
  });

  it('deletes keys correctly', async () => {
    await cache.set('temp:1', { a: 1 });
    const deleted = await cache.del('temp:1');
    expect(deleted).toBe(true);

    const val = await cache.get('temp:1');
    expect(val).toBeNull();
  });

  it('tracks stats for hits, misses, sets, and deletes', async () => {
    await cache.set('k1', 'val1');
    await cache.get('k1'); // hit
    await cache.get('k2'); // miss
    await cache.del('k1'); // delete

    const stats = await cache.getStats();
    expect(stats.sets).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.deletes).toBe(1);
  });
});
