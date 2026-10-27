import { getRedisClient } from '../redis/client.js';
import { geoService, type LocationPing } from '../redis/geoService.js';
import { getSupabase } from './supabase.js';

/**
 * GPS breadcrumb buffer: pings are queued in Redis and written in batches to the existing
 * employee_location_history table (security / integration fix MS-4).
 *
 * Before: batches went to a table that does not exist (live_tracking_breadcrumbs); every failed batch
 * was pushed back in reverse order and retried forever, and in "mock mode" (no database) batches were
 * popped and discarded while reporting success.
 *
 * Now:
 *   - target: employee_location_history (history only). The live row (employee_live_locations), which
 *     drives the automatic-break rules, is NOT written here, so this service cannot start or end breaks.
 *   - the queue is bounded (MAX_QUEUE); when full, ingestPing reports 'degraded' instead of dropping.
 *   - a failed batch goes back to the FRONT of the queue in its original order, with an attempt counter;
 *     after MAX_ATTEMPTS it moves to a dead-letter list (kept, never silently dropped) and is logged.
 *   - malformed queue items go to the dead-letter list too.
 *   - without a database connection nothing is popped (no data loss, nothing reported as persisted).
 */
export const GPS_QUEUE_KEY = 'queue:gps_breadcrumbs';
export const GPS_DEAD_KEY = 'queue:gps_breadcrumbs:dead';
const BATCH_SIZE = 50;
export const MAX_ATTEMPTS = 5;
export const MAX_QUEUE = 50_000;
const MAX_DEAD = 10_000;

interface QueuedPing extends LocationPing { attempts?: number; receivedAt?: string }

/** Server-side time bound for a client timestamp: never in the future, never older than 10 minutes. */
export function clampPingTime(clientIso: string | undefined, now = Date.now()): string {
  const t = clientIso ? Date.parse(clientIso) : NaN;
  if (!Number.isFinite(t) || t > now || t < now - 10 * 60_000) return new Date(now).toISOString();
  return new Date(t).toISOString();
}

export function toHistoryRow(p: QueuedPing) {
  return {
    employee_id: p.employeeId,
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy_meters: typeof p.accuracy === 'number' && p.accuracy >= 0 ? p.accuracy : null,
    location_status: 'REPORTED',
    location_context: 'UNKNOWN',
    recorded_at: p.timestamp,
    source: 'MICROSERVICE',
    metadata: { speed: p.speed ?? null, heading: p.heading ?? null, battery_level: p.batteryLevel ?? null, received_at: p.receivedAt ?? null },
  };
}

export class TrackingBufferService {
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  async ingestPing(ping: LocationPing): Promise<boolean> {
    const redis = getRedisClient();
    await geoService.recordPing(ping);
    try {
      const len = await redis.llen(GPS_QUEUE_KEY);
      if (len >= MAX_QUEUE) {
        console.warn(`[TrackingBuffer] Queue full (${len}); ping kept only in the live view`);
        return false;
      }
      await redis.rpush(GPS_QUEUE_KEY, JSON.stringify({ ...ping, attempts: 0, receivedAt: new Date().toISOString() }));
      return true;
    } catch (err: any) {
      console.warn('[TrackingBuffer] Error queuing GPS ping:', err.message);
      return false;
    }
  }

  startBackgroundFlusher(intervalSeconds = 15): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(async () => {
      await this.flushBreadcrumbs();
    }, intervalSeconds * 1000);
    console.log(`[TrackingBuffer] Background GPS flusher started (interval: ${intervalSeconds}s)`);
  }

  stopBackgroundFlusher(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      console.log('[TrackingBuffer] Background GPS flusher stopped');
    }
  }

  /** Returns the number of breadcrumbs written to the database in this run. */
  async flushBreadcrumbs(): Promise<number> {
    if (this.isFlushing) return 0;
    const supabase = getSupabase();
    if (!supabase) return 0;   // keep everything queued: nothing is written, nothing is dropped
    this.isFlushing = true;
    const redis = getRedisClient();
    try {
      const raw = await redis.lpop(GPS_QUEUE_KEY, BATCH_SIZE);
      const items: string[] = Array.isArray(raw) ? (raw as string[]) : raw ? [raw as string] : [];
      if (items.length === 0) return 0;

      const pings: QueuedPing[] = [];
      for (const str of items) {
        try { pings.push(JSON.parse(str)); }
        catch { await this.deadLetter(str, 'malformed'); }
      }
      if (!pings.length) return 0;

      const { error } = await supabase.from('employee_location_history').insert(pings.map(toHistoryRow));
      if (!error) return pings.length;

      console.warn('[TrackingBuffer] Batch insert failed, will retry:', error.message);
      const retry: string[] = [];
      for (const p of pings) {
        const attempts = (p.attempts ?? 0) + 1;
        if (attempts >= MAX_ATTEMPTS) await this.deadLetter(JSON.stringify({ ...p, attempts }), error.message);
        else retry.push(JSON.stringify({ ...p, attempts }));
      }
      // back to the front of the queue in the original order (LPUSH reverses, so push reversed)
      if (retry.length) await redis.lpush(GPS_QUEUE_KEY, ...retry.reverse());
      return 0;
    } catch (err: any) {
      console.error('[TrackingBuffer] Unexpected flush error:', err.message);
      return 0;
    } finally {
      this.isFlushing = false;
    }
  }

  private async deadLetter(item: string, reason: string): Promise<void> {
    const redis = getRedisClient();
    console.error(`[TrackingBuffer] Moving a breadcrumb to ${GPS_DEAD_KEY} (${reason})`);
    await redis.rpush(GPS_DEAD_KEY, item);
    await redis.ltrim(GPS_DEAD_KEY, -MAX_DEAD, -1);
  }
}

export const trackingBufferService = new TrackingBufferService();
