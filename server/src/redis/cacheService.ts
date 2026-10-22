import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { getRedisClient, isConnected } from './client.js';

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  connected: boolean;
  totalKeysApprox?: number;
}

class CacheService {
  private customClient?: Redis;
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private deletes = 0;

  constructor(client?: Redis) {
    this.customClient = client;
  }

  private get client(): Redis {
    return this.customClient || getRedisClient();
  }

  private isClientReady(): boolean {
    if (this.customClient) {
      return this.customClient.status === 'ready' || this.customClient.status === undefined;
    }
    return isConnected();
  }

  /**
   * Fetch a deserialized JSON value by key
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isClientReady()) {
      this.misses++;
      return null;
    }

    try {
      const raw = await this.client.get(key);
      if (!raw) {
        this.misses++;
        return null;
      }
      this.hits++;
      return JSON.parse(raw) as T;
    } catch (err: any) {
      console.warn(`[CacheService] Error reading key "${key}":`, err.message);
      this.misses++;
      return null;
    }
  }

  /**
   * Set a serialized JSON value with TTL
   */
  async set<T>(key: string, value: T, ttlSeconds: number = env.CACHE_DEFAULT_TTL_SECONDS): Promise<boolean> {
    if (!this.isClientReady()) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds > 0) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
      this.sets++;
      return true;
    } catch (err: any) {
      console.warn(`[CacheService] Error writing key "${key}":`, err.message);
      return false;
    }
  }

  /**
   * Cache-aside pattern: Check Redis first, fallback to fetchFn() on cache miss.
   * If Redis is down, executes fetchFn() directly to ensure high availability.
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number = env.CACHE_DEFAULT_TTL_SECONDS
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss: execute supplier
    const freshData = await fetchFn();

    // Cache asynchronously or synchronously
    if (freshData !== undefined && freshData !== null) {
      await this.set(key, freshData, ttlSeconds);
    }

    return freshData;
  }

  /**
   * Delete a single key
   */
  async del(key: string): Promise<boolean> {
    try {
      const deletedCount = await this.client.del(key);
      if (deletedCount > 0) this.deletes++;
      return deletedCount > 0;
    } catch (err: any) {
      console.warn(`[CacheService] Error deleting key "${key}":`, err.message);
      return false;
    }
  }

  /**
   * Scan and delete keys matching a pattern (non-blocking SCAN)
   */
  async delByPattern(pattern: string): Promise<number> {
    try {
      let cursor = '0';
      let totalDeleted = 0;
      const prefix = (this.client as any).options?.keyPrefix || '';
      const matchPattern = prefix ? `${prefix}${pattern}` : pattern;

      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', matchPattern, 'COUNT', 100);
        cursor = nextCursor;

        if (keys.length > 0) {
          const prefix = (this.client as any).options?.keyPrefix || '';
          const pipeline = this.client.pipeline();
          keys.forEach((k: string) => {
            const strippedKey = prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k;
            pipeline.del(strippedKey);
          });
          const results = await pipeline.exec();
          const batchDeleted = results ? results.reduce((acc, curr) => acc + (Number(curr[1]) || 0), 0) : keys.length;
          totalDeleted += batchDeleted;
          this.deletes += batchDeleted;
        }
      } while (cursor !== '0');

      return totalDeleted;
    } catch (err: any) {
      console.warn(`[CacheService] Error deleting pattern "${pattern}":`, err.message);
      return 0;
    }
  }

  /**
   * Flush all keys with the configured prefix
   */
  async flushPrefix(): Promise<number> {
    return this.delByPattern('*');
  }

  /**
   * Return cache telemetry statistics
   */
  async getStats(): Promise<CacheStats> {
    let totalKeysApprox: number | undefined;
    try {
      const info = await this.client.dbsize();
      totalKeysApprox = info;
    } catch {
      // Ignored if offline
    }

    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      deletes: this.deletes,
      connected: this.isClientReady(),
      totalKeysApprox,
    };
  }

  /**
   * Reset internal in-memory counters
   */
  resetCounters(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.deletes = 0;
  }
}

// Singleton export
export const cacheService = new CacheService();
export { CacheService };
