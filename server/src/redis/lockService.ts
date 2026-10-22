import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { getRedisClient } from './client.js';

// Safe lock release script: only delete if the token matches the lock's value
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface LockOptions {
  ttlMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export class LockService {
  private customClient?: Redis;

  constructor(client?: Redis) {
    this.customClient = client;
  }

  private get client(): Redis {
    return this.customClient || getRedisClient();
  }

  /**
   * Attempt to acquire an exclusive lock.
   * Returns a lock token if acquired, or null if lock is currently held.
   */
  async acquire(lockKey: string, ttlMs = 5000): Promise<string | null> {
    const key = `lock:${lockKey}`;
    const token = randomUUID();

    try {
      // SET key value NX PX ttlMs
      const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');
      if (result === 'OK') {
        return token;
      }
      return null;
    } catch (err: any) {
      console.warn(`[LockService] Failed to acquire lock for "${lockKey}":`, err.message);
      return null;
    }
  }

  /**
   * Safely release an acquired lock using Lua script to verify token ownership.
   */
  async release(lockKey: string, token: string): Promise<boolean> {
    const key = `lock:${lockKey}`;
    try {
      const res = await this.client.eval(RELEASE_LOCK_LUA, 1, key, token);
      return res === 1;
    } catch (err: any) {
      console.warn(`[LockService] Failed to release lock for "${lockKey}":`, err.message);
      return false;
    }
  }

  /**
   * Acquire a lock, execute an async function, and guarantee release in a finally block.
   */
  async withLock<T>(
    lockKey: string,
    action: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const { ttlMs = 5000, retryAttempts = 3, retryDelayMs = 200 } = options;

    let token: string | null = null;
    let attempts = 0;

    while (attempts <= retryAttempts) {
      token = await this.acquire(lockKey, ttlMs);
      if (token) break;

      attempts++;
      if (attempts <= retryAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    if (!token) {
      return {
        success: false,
        error: `Could not acquire lock for resource "${lockKey}" after ${attempts} attempts. Resource is locked.`,
      };
    }

    try {
      const result = await action();
      return { success: true, result };
    } finally {
      await this.release(lockKey, token);
    }
  }
}

export const lockService = new LockService();
