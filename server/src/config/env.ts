import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from server directory or fallback to parent root if available
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174,http://localhost:3000'),

  // Redis configuration
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_KEY_PREFIX: z.string().default('wp:'),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().default(10000),
  REDIS_MAX_RECONNECT_ATTEMPTS: z.coerce.number().default(10),

  // Supabase (optional if standalone Redis caching proxy)
  // Fixed test tokens (dev-admin-token / dev-employee-token) in NODE_ENV=development only when true
  ALLOW_DEV_TOKENS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Express 'trust proxy' (e.g. 1 behind one reverse proxy); the client IP for rate limiting comes from it
  TRUST_PROXY: z.string().default('false'),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),

  // Caching defaults
  CACHE_DEFAULT_TTL_SECONDS: z.coerce.number().default(300),
  PAYROLL_CACHE_TTL_SECONDS: z.coerce.number().default(600),

  // Rate Limiting defaults
  RATE_LIMIT_PUNCH_WINDOW_SECONDS: z.coerce.number().default(60),
  RATE_LIMIT_PUNCH_MAX: z.coerce.number().default(5),
  RATE_LIMIT_API_WINDOW_SECONDS: z.coerce.number().default(60),
  RATE_LIMIT_API_MAX: z.coerce.number().default(100),

  // Geospatial buffer
  GEO_BUFFER_FLUSH_INTERVAL_SECONDS: z.coerce.number().default(15),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Invalid environment variables:', parsedEnv.error.format());
  throw new Error('Invalid environment configuration');
}

export const env = parsedEnv.data;

export const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
