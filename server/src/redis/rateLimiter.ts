import type { Request, Response, NextFunction } from 'express';
import { getRedisClient, isConnected } from './client.js';

export interface RateLimiterOptions {
  windowSeconds: number;
  maxRequests: number;
  keyPrefix?: string;
  keyGenerator?: (req: Request) => string;
  message?: string;
  failOpen?: boolean;
  client?: any;
}

/**
 * Creates an Express sliding-window rate limiter middleware backed by Redis Sorted Sets (ZSET).
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const {
    windowSeconds,
    maxRequests,
    keyPrefix = 'rl:',
    keyGenerator = (req: Request) => {
      // Use employee ID if authenticated, or IP address as fallback
      const employeeId = (req as any).user?.employee_id || (req as any).user?.id;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
      return employeeId ? `user:${employeeId}` : `ip:${ip}`;
    },
    message = 'Too many requests. Please try again later.',
    failOpen = true,
    client: customClient,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const isReady = customClient ? true : isConnected();

    // If Redis is not connected and failOpen is enabled, bypass limiter with warning header
    if (!isReady && failOpen) {
      res.setHeader('X-RateLimit-Degraded', 'true');
      return next();
    }

    const redis = customClient || getRedisClient();
    const identifier = keyGenerator(req);
    const key = `${keyPrefix}${identifier}`;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    try {
      // Atomic pipeline using Redis ZSET
      // 1. Remove old requests outside the sliding window
      // 2. Count current entries in window
      // 3. Add current request
      // 4. Set TTL
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      pipeline.zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 8)}`);
      pipeline.expire(key, windowSeconds);

      const results = await pipeline.exec();
      if (!results) {
        if (failOpen) return next();
        res.status(500).json({ error: 'Rate limiter pipeline failed' });
        return;
      }

      // results[1][1] is the result of zcard (count before adding this request)
      const currentCount = Number(results[1][1] || 0);
      const remaining = Math.max(0, maxRequests - currentCount - 1);
      const resetTime = Math.ceil((now + windowMs) / 1000);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetTime);

      if (currentCount >= maxRequests) {
        const retryAfterSeconds = Math.max(1, Math.ceil(windowSeconds - (now % windowMs) / 1000));
        res.setHeader('Retry-After', retryAfterSeconds);

        res.status(429).json({
          status: 429,
          error: 'Too Many Requests',
          message,
          retryAfterSeconds,
        });
        return;
      }

      next();
    } catch (err: any) {
      console.warn(`[RateLimiter] Error for key "${key}":`, err.message);
      if (failOpen) {
        res.setHeader('X-RateLimit-Degraded', 'true');
        return next();
      }
      res.status(500).json({ error: 'Rate limit evaluation error' });
    }
  };
}
