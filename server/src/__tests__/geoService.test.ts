import { describe, it, expect, beforeEach } from 'vitest';
// @ts-ignore
import RedisMock from 'ioredis-mock';
import { GeoService, type LocationPing } from '../redis/geoService.js';

describe('GeoService', () => {
  let mockRedis: any;
  let geoService: GeoService;
  const geoStore = new Map<string, { lat: number; lng: number }>();

  beforeEach(() => {
    mockRedis = new RedisMock();
    geoStore.clear();

    // ioredis-mock does not implement Redis GEO commands, so we attach mock implementations
    const origPipeline = mockRedis.pipeline.bind(mockRedis);
    mockRedis.pipeline = () => {
      const p = origPipeline();
      p.geoadd = (key: string, lng: number, lat: number, member: string) => {
        geoStore.set(member, { lat, lng });
        return p;
      };
      p.zrem = (key: string, member: string) => {
        geoStore.delete(member);
        return p;
      };
      return p;
    };

    mockRedis.geopos = async (key: string, member: string) => {
      const pos = geoStore.get(member);
      if (!pos) return [null];
      return [[pos.lng.toString(), pos.lat.toString()]];
    };

    mockRedis.zrem = async (key: string, member: string) => {
      geoStore.delete(member);
      return 1;
    };

    geoService = new GeoService(mockRedis);
  });

  it('records live location ping in Redis', async () => {
    const ping: LocationPing = {
      employeeId: 'EMP-YUVARAJ',
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 5.2,
      speed: 1.2,
      batteryLevel: 88,
      timestamp: new Date().toISOString(),
    };

    const success = await geoService.recordPing(ping);
    expect(success).toBe(true);

    const location = await geoService.getEmployeeLocation('EMP-YUVARAJ');
    expect(location).not.toBeNull();
    expect(location?.employeeId).toBe('EMP-YUVARAJ');
    expect(location?.latitude).toBeCloseTo(12.9716, 3);
    expect(location?.longitude).toBeCloseTo(77.5946, 3);
    expect(location?.batteryLevel).toBe(88);
  });

  it('returns null when querying employee with no ping', async () => {
    const location = await geoService.getEmployeeLocation('NONEXISTENT-EMP');
    expect(location).toBeNull();
  });

  it('removes employee from active tracking upon checkout', async () => {
    const ping: LocationPing = {
      employeeId: 'EMP-TEMP',
      latitude: 13.0827,
      longitude: 80.2707,
      timestamp: new Date().toISOString(),
    };

    await geoService.recordPing(ping);
    expect(await geoService.getEmployeeLocation('EMP-TEMP')).not.toBeNull();

    await geoService.removeEmployee('EMP-TEMP');
    expect(await geoService.getEmployeeLocation('EMP-TEMP')).toBeNull();
  });
});
