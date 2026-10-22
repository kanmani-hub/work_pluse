import { createApp } from './app.js';
import { env } from './config/env.js';
import { pingRedis, closeRedis } from './redis/client.js';
import { trackingBufferService } from './services/trackingBufferService.js';

const app = createApp();

const server = app.listen(env.PORT, async () => {
  console.log(`====================================================`);
  console.log(`🚀 WorkPulse Node.js + Redis Microservice`);
  console.log(`📡 Listening on http://localhost:${env.PORT}`);
  console.log(`🌍 Environment: ${env.NODE_ENV}`);
  console.log(`🔑 Redis URL: ${env.REDIS_URL}`);
  console.log(`====================================================`);

  // Initial connection test
  const ping = await pingRedis();
  if (ping.ok) {
    console.log(`[Redis] Initial ping successful (${ping.latencyMs}ms)`);
  } else {
    console.warn(`[Redis] Initial ping failed: ${ping.error}. Server running in degraded fallback mode.`);
  }

  // Start GPS flusher
  trackingBufferService.startBackgroundFlusher(env.GEO_BUFFER_FLUSH_INTERVAL_SECONDS);
});

// Graceful shutdown handling
let isShuttingDown = false;

async function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

  // Stop background intervals
  trackingBufferService.stopBackgroundFlusher();

  // Flush any pending GPS pings before exiting
  try {
    const flushed = await trackingBufferService.flushBreadcrumbs();
    console.log(`[Server] Final buffer flush: persisted ${flushed} breadcrumbs`);
  } catch (err: any) {
    console.warn('[Server] Error during final breadcrumbs flush:', err.message);
  }

  // Close HTTP server to stop accepting new requests
  server.close(async () => {
    console.log('[Server] HTTP server closed');

    // Close Redis connection
    await closeRedis();

    console.log('[Server] Graceful shutdown completed. Exiting process.');
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => {
    console.error('[Server] Forced exit after shutdown timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
