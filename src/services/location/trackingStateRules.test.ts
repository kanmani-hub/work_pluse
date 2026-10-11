import { describe, it, expect } from 'vitest';
import { trackingState } from './trackingStateRules';

const NOW = new Date('2026-10-10T06:42:00Z').getTime(); // 12:12 PM IST
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('admin tracking state', () => {
  it('LIVE only when both the reading and the server update are fresh', () => {
    const v = trackingState({ deviceRecordedAt: ago(2), serverReceivedAt: ago(2), distanceMeters: 5 }, NOW);
    expect(v).toMatchObject({ state: 'LIVE', isCurrent: true, label: 'Live — updated 2 min ago' });
    expect(v.distanceText).toBe('5 m from office (recorded 12:10 PM)');
  });
  it('PAUSED when nothing arrived recently and the device is not reporting tracking (website)', () => {
    const v = trackingState({ deviceRecordedAt: ago(21), serverReceivedAt: ago(21), isTracking: false }, NOW);
    expect(v).toMatchObject({ state: 'PAUSED', isCurrent: false, label: 'Location paused — last seen 21 min ago' });
  });
  it('OFFLINE when the device reports tracking but nothing reached the server', () => {
    const v = trackingState({ deviceRecordedAt: ago(117), serverReceivedAt: ago(117), isTracking: true }, NOW);
    expect(v.state).toBe('OFFLINE'); expect(v.label).toBe('Offline — last server update 10:15 AM');
  });
  it('DELAYED_SYNC: received just now but recorded long ago → never shown as current', () => {
    const v = trackingState({ deviceRecordedAt: ago(40), serverReceivedAt: ago(1), isTracking: true }, NOW);
    expect(v).toMatchObject({ state: 'DELAYED_SYNC', isCurrent: false });
    expect(v.label).toBe('Delayed sync — recorded 11:32 AM, received 12:11 PM');
  });
  it('NO_LOCATION; missing server time falls back to device time', () => {
    expect(trackingState({ deviceRecordedAt: null, serverReceivedAt: null }, NOW)).toMatchObject({ state: 'NO_LOCATION', distanceText: '—' });
    expect(trackingState({ deviceRecordedAt: ago(3), serverReceivedAt: null }, NOW).state).toBe('LIVE');
  });
  it('pending count shown only when reported', () => {
    expect(trackingState({ deviceRecordedAt: ago(1), serverReceivedAt: ago(1) }, NOW).pendingText).toBe(null);
    expect(trackingState({ deviceRecordedAt: ago(1), serverReceivedAt: ago(1), pendingCount: 12 }, NOW).pendingText).toBe('12 readings waiting to sync');
  });
  it('boundary: exactly 15 minutes is still fresh, 16 is not', () => {
    expect(trackingState({ deviceRecordedAt: ago(15), serverReceivedAt: ago(15) }, NOW).state).toBe('LIVE');
    expect(trackingState({ deviceRecordedAt: ago(16), serverReceivedAt: ago(16) }, NOW).state).toBe('PAUSED');
  });
});
