import { Redis } from 'ioredis';
import { getRedisClient } from './client.js';

export interface LocationPing {
  employeeId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  batteryLevel?: number;
  timestamp: string;
}

export interface EmployeeLiveLocation extends LocationPing {
  distanceMeters?: number;
}

const GEO_SET_KEY = 'geo:live_locations';
const META_KEY_PREFIX = 'geo:meta:';
const LIVE_EXPIRY_SECONDS = 3600; // 1 hour TTL for active status

export class GeoService {
  private customClient?: Redis;

  constructor(client?: Redis) {
    this.customClient = client;
  }

  private get client(): Redis {
    return this.customClient || getRedisClient();
  }

  /**
   * Record a live location ping in Redis Geospatial index and store telemetry metadata
   */
  async recordPing(ping: LocationPing): Promise<boolean> {
    try {
      const pipeline = this.client.pipeline();

      // GEOADD key longitude latitude member
      pipeline.geoadd(GEO_SET_KEY, ping.longitude, ping.latitude, ping.employeeId);

      // Store metadata in a companion hash
      const metaKey = `${META_KEY_PREFIX}${ping.employeeId}`;
      pipeline.hset(metaKey, {
        latitude: ping.latitude.toString(),
        longitude: ping.longitude.toString(),
        accuracy: (ping.accuracy ?? 0).toString(),
        speed: (ping.speed ?? 0).toString(),
        heading: (ping.heading ?? 0).toString(),
        batteryLevel: (ping.batteryLevel ?? 0).toString(),
        timestamp: ping.timestamp,
      });
      pipeline.expire(metaKey, LIVE_EXPIRY_SECONDS);

      await pipeline.exec();
      return true;
    } catch (err: any) {
      console.warn(`[GeoService] Failed to record ping for ${ping.employeeId}:`, err.message);
      return false;
    }
  }

  /**
   * Get an employee's latest coordinates and telemetry
   */
  async getEmployeeLocation(employeeId: string): Promise<EmployeeLiveLocation | null> {
    try {
      const metaKey = `${META_KEY_PREFIX}${employeeId}`;
      const [posList, meta] = await Promise.all([
        this.client.geopos(GEO_SET_KEY, employeeId),
        this.client.hgetall(metaKey),
      ]);

      const pos = posList?.[0];
      if (!pos || !pos[0] || !pos[1]) {
        return null;
      }

      return {
        employeeId,
        longitude: parseFloat(pos[0]),
        latitude: parseFloat(pos[1]),
        accuracy: meta.accuracy ? parseFloat(meta.accuracy) : undefined,
        speed: meta.speed ? parseFloat(meta.speed) : undefined,
        heading: meta.heading ? parseFloat(meta.heading) : undefined,
        batteryLevel: meta.batteryLevel ? parseFloat(meta.batteryLevel) : undefined,
        timestamp: meta.timestamp || new Date().toISOString(),
      };
    } catch (err: any) {
      console.warn(`[GeoService] Error fetching location for ${employeeId}:`, err.message);
      return null;
    }
  }

  /**
   * Find all active employees within a specified radius (in meters) of an office or geofence coordinate
   */
  async findEmployeesNearby(
    centerLat: number,
    centerLng: number,
    radiusMeters: number
  ): Promise<EmployeeLiveLocation[]> {
    try {
      // ioredis GEORADIUS or GEOSEARCH
      // With GEORADIUS: key longitude latitude radius m|km|ft|mi WITHCOORD WITHDIST ASC
      const results = (await this.client.georadius(
        GEO_SET_KEY,
        centerLng,
        centerLat,
        radiusMeters,
        'm',
        'WITHCOORD',
        'WITHDIST',
        'ASC'
      )) as Array<[string, string, [string, string]]>;

      if (!results || results.length === 0) {
        return [];
      }

      const locations: EmployeeLiveLocation[] = [];

      for (const item of results) {
        const employeeId = item[0];
        const dist = parseFloat(item[1]);
        const coords = item[2];

        locations.push({
          employeeId,
          longitude: parseFloat(coords[0]),
          latitude: parseFloat(coords[1]),
          distanceMeters: dist,
          timestamp: new Date().toISOString(),
        });
      }

      return locations;
    } catch (err: any) {
      console.warn('[GeoService] Error searching nearby employees:', err.message);
      return [];
    }
  }

  /**
   * Remove an employee from active tracking when they clock out
   */
  async removeEmployee(employeeId: string): Promise<boolean> {
    try {
      const pipeline = this.client.pipeline();
      pipeline.zrem(GEO_SET_KEY, employeeId);
      pipeline.del(`${META_KEY_PREFIX}${employeeId}`);
      await pipeline.exec();
      return true;
    } catch (err: any) {
      console.warn(`[GeoService] Error removing employee ${employeeId}:`, err.message);
      return false;
    }
  }
}

export const geoService = new GeoService();
