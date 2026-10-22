import { getRedisClient } from '../redis/client.js';
import { geoService, type LocationPing } from '../redis/geoService.js';
import { getSupabase } from './supabase.js';

const GPS_QUEUE_KEY = 'queue:gps_breadcrumbs';
const BATCH_SIZE = 50;

export class TrackingBufferService {
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  /**
   * Ingest an incoming GPS ping:
   * 1. Updates live Geospatial index in Redis for immediate UI queries.
   * 2. Pushes ping into Redis persistent queue for batch writing to PostgreSQL.
   */
  async ingestPing(ping: LocationPing): Promise<boolean> {
    const redis = getRedisClient();

    // 1. Update live Geo index
    await geoService.recordPing(ping);

    // 2. Push to queue for batch persistence
    try {
      await redis.rpush(GPS_QUEUE_KEY, JSON.stringify(ping));
      return true;
    } catch (err: any) {
      console.warn('[TrackingBuffer] Error queuing GPS ping:', err.message);
      return false;
    }
  }

  /**
   * Start periodic background flusher to write breadcrumbs from Redis to Supabase
   */
  startBackgroundFlusher(intervalSeconds = 15): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(async () => {
      await this.flushBreadcrumbs();
    }, intervalSeconds * 1000);

    console.log(`[TrackingBuffer] Background GPS flusher started (interval: ${intervalSeconds}s)`);
  }

  /**
   * Stop background flusher
   */
  stopBackgroundFlusher(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      console.log('[TrackingBuffer] Background GPS flusher stopped');
    }
  }

  /**
   * Drains up to BATCH_SIZE items from Redis queue and bulk-inserts into Supabase
   */
  async flushBreadcrumbs(): Promise<number> {
    if (this.isFlushing) return 0;
    this.isFlushing = true;

    try {
      const redis = getRedisClient();
      const rawItems = await redis.lpop(GPS_QUEUE_KEY, BATCH_SIZE);
      const itemsList: string[] = Array.isArray(rawItems) ? (rawItems as string[]) : rawItems ? [rawItems as string] : [];

      if (itemsList.length === 0) {
        return 0;
      }

      const pings: LocationPing[] = itemsList
        .map((str: string) => {
          try {
            return JSON.parse(str);
          } catch {
            return null;
          }
        })
        .filter((item: any): item is LocationPing => item !== null);

      const supabase = getSupabase();
      if (!supabase) {
        // Mock mode: log batch count
        console.log(`[TrackingBuffer] Flushed ${pings.length} breadcrumbs (Supabase mock mode)`);
        return pings.length;
      }

      // Map to database column schema
      const rows = pings.map((p) => ({
        employee_id: p.employeeId,
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        speed: p.speed,
        heading: p.heading,
        battery_level: p.batteryLevel,
        recorded_at: p.timestamp,
        created_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from('live_tracking_breadcrumbs').insert(rows);
      if (error) {
        console.warn('[TrackingBuffer] Supabase batch insert error, re-queuing:', error.message);
        // Put back in Redis to prevent data loss
        if (itemsList.length > 0) {
          await redis.lpush(GPS_QUEUE_KEY, ...itemsList);
        }
        return 0;
      }

      console.log(`[TrackingBuffer] Successfully persisted ${rows.length} GPS breadcrumbs to database`);
      return rows.length;
    } catch (err: any) {
      console.error('[TrackingBuffer] Unexpected flush error:', err.message);
      return 0;
    } finally {
      this.isFlushing = false;
    }
  }
}

export const trackingBufferService = new TrackingBufferService();
