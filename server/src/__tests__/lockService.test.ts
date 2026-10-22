import { describe, it, expect, beforeEach } from 'vitest';
// @ts-ignore
import RedisMock from 'ioredis-mock';
import { LockService } from '../redis/lockService.js';

describe('LockService', () => {
  let mockRedis: any;
  let lockService: LockService;

  beforeEach(() => {
    mockRedis = new RedisMock();
    lockService = new LockService(mockRedis);
  });

  it('acquires and releases a lock successfully', async () => {
    const token = await lockService.acquire('test-resource', 5000);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    // Second acquire on the same key should fail because it is held
    const secondToken = await lockService.acquire('test-resource', 5000);
    expect(secondToken).toBeNull();

    // Release the lock
    const released = await lockService.release('test-resource', token!);
    expect(released).toBe(true);

    // Now it can be acquired again
    const thirdToken = await lockService.acquire('test-resource', 5000);
    expect(thirdToken).toBeTruthy();
  });

  it('does not release lock if token does not match', async () => {
    const token = await lockService.acquire('test-resource-wrong-token', 5000);
    expect(token).toBeTruthy();

    const released = await lockService.release('test-resource-wrong-token', 'wrong-token-uuid');
    expect(released).toBe(false);

    // Lock is still held
    const blocked = await lockService.acquire('test-resource-wrong-token', 5000);
    expect(blocked).toBeNull();
  });

  it('runs an action within withLock and releases automatically', async () => {
    let executed = false;

    const res = await lockService.withLock(
      'auto-lock-test',
      async () => {
        executed = true;
        return 'done';
      },
      { ttlMs: 2000 }
    );

    expect(res.success).toBe(true);
    expect(res.result).toBe('done');
    expect(executed).toBe(true);

    // Lock should be released now
    const token = await lockService.acquire('auto-lock-test', 2000);
    expect(token).toBeTruthy();
  });
});
