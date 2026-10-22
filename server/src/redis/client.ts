import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';

let redisClient: Redis | null = null;
let isRedisConnected = false;

export function createRedisClient(customOptions?: Partial<RedisOptions>): Redis {
  const options: RedisOptions = {
    keyPrefix: env.REDIS_KEY_PREFIX,
    connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    enableOfflineQueue: false, // Critical: reject immediately when offline instead of hanging requests
    lazyConnect: true,
    retryStrategy(times) {
      if (env.NODE_ENV === 'test') {
        return null; // Don't retry during test runs without redis
      }
      if (times > env.REDIS_MAX_RECONNECT_ATTEMPTS) {
        console.warn(`[Redis] Max reconnection attempts (${env.REDIS_MAX_RECONNECT_ATTEMPTS}) reached. Proceeding in degraded mode.`);
        return null; // Stop retrying
      }
      const delay = Math.min(times * 200, 3000);
      console.log(`[Redis] Reconnecting attempt #${times} in ${delay}ms...`);
      return delay;
    },
    ...customOptions,
  };

  if (env.REDIS_PASSWORD) {
    options.password = env.REDIS_PASSWORD;
  }

  const client = new Redis(env.REDIS_URL, options);

  client.on('connect', () => {
    console.log('[Redis] Connecting to Redis server at', env.REDIS_URL);
  });

  client.on('ready', () => {
    isRedisConnected = true;
    console.log('[Redis] Connection ready and established successfully');
  });

  client.on('error', (err: any) => {
    isRedisConnected = false;
    // Log concisely without throwing uncaught exceptions
    console.error('[Redis] Connection error:', err.message);
  });

  client.on('close', () => {
    isRedisConnected = false;
    console.warn('[Redis] Connection closed');
  });

  client.on('reconnecting', () => {
    isRedisConnected = false;
  });

  client.on('end', () => {
    isRedisConnected = false;
    console.warn('[Redis] Connection ended');
  });

  return client;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = createRedisClient();
  }
  return redisClient;
}

/**
 * Checks whether Redis is currently reachable and responding to PING.
 */
export async function pingRedis(timeoutMs = 2000): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const client = getRedisClient();
  const start = Date.now();

  try {
    const pingPromise = client.ping();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis ping timed out')), timeoutMs)
    );

    const result = await Promise.race([pingPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;

    return {
      ok: result === 'PONG',
      latencyMs,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Unknown Redis error',
    };
  }
}

export function isConnected(): boolean {
  return isRedisConnected && redisClient?.status === 'ready';
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      console.log('[Redis] Connection gracefully closed');
    } catch (err: any) {
      console.warn('[Redis] Error during quit, disconnecting forcefully:', err.message);
      redisClient.disconnect();
    } finally {
      redisClient = null;
      isRedisConnected = false;
    }
  }
}
