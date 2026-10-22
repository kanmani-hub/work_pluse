import { Router } from 'express';
import { pingRedis, isConnected } from '../redis/client.js';
import { getSupabase } from '../services/supabase.js';

const router = Router();

router.get('/', async (req, res) => {
  const redisHealth = await pingRedis(1500);
  const supabase = getSupabase();

  let supabaseStatus = 'not_configured';
  if (supabase) {
    try {
      const { error } = await supabase.from('payroll_rules').select('count', { count: 'exact', head: true });
      supabaseStatus = error ? `error: ${error.message}` : 'connected';
    } catch (e: any) {
      supabaseStatus = `error: ${e.message}`;
    }
  }

  const isHealthy = redisHealth.ok;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    services: {
      redis: {
        connected: isConnected(),
        ping: redisHealth.ok ? 'PONG' : 'FAIL',
        latencyMs: redisHealth.latencyMs,
        error: redisHealth.error,
      },
      supabase: {
        status: supabaseStatus,
      },
      process: {
        nodeVersion: process.version,
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    },
  });
});

router.get('/redis', async (req, res) => {
  const redisHealth = await pingRedis();
  res.status(redisHealth.ok ? 200 : 503).json(redisHealth);
});

export default router;
