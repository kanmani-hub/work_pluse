import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The employee's device REPORTS tracking observations to the server (report_tracking_event); it never
// decides on a break. Covers: immediate report on change (zero grace), throttled repeats while the
// problem persists, timeouts reported as timeouts, offline vs reconnect distinguished, and a fresh
// reading taken after reconnecting (reconnect alone is not a location).
const reportEvent = vi.fn(async (_e: string, _o?: any) => ({ action: 'NONE' as const, reason: 'X' }));
vi.mock('./trackingEnforcementService', () => ({ trackingEnforcementService: { reportEvent: (e: string, o?: any) => reportEvent(e, o) } }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({}), auth: { getUser: async () => ({ data: { user: null }, error: null }) } } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyEmployee: vi.fn(), notifyGeofenceEvent: vi.fn() } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { isEnabled: false, now: () => Date.now(), getIsoString: () => new Date().toISOString() } }));

const { locationService } = await import('./locationService');

let online = true;
beforeEach(() => {
  reportEvent.mockClear();
  online = true;
  vi.stubGlobal('navigator', { get onLine() { return online; } });
  locationService._lastTrackingEvent = null;
  locationService._offlineSinceMs = null;
  locationService._trackingProblem = { status: 'LOCATION_DENIED', recordedAtMs: Date.now() }; // skip the diagnostic write
  vi.spyOn(locationService, 'verifyCurrentLocation').mockResolvedValue({ eventId: null, result: 'ERROR' } as any);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('GPS problems are reported to the server', () => {
  it('permission denied is reported immediately; repeats within a minute are not resent', async () => {
    await locationService.reportTrackingProblem('LOCATION_DENIED', 'User denied Geolocation');
    expect(reportEvent).toHaveBeenCalledTimes(1);
    expect(reportEvent).toHaveBeenCalledWith('LOCATION_DENIED', { message: 'User denied Geolocation', offlineSeconds: undefined });
    await locationService.reportTrackingProblem('LOCATION_DENIED', 'again');
    expect(reportEvent).toHaveBeenCalledTimes(1);
  });

  it('a different problem is reported at once; a timeout stays a timeout', async () => {
    await locationService.reportTrackingProblem('LOCATION_DENIED', 'x');
    await locationService.reportTrackingProblem('TIMEOUT', 'Timeout expired');
    expect(reportEvent.mock.calls.map((c) => c[0])).toEqual(['LOCATION_DENIED', 'TIMEOUT']);
  });

  it('after a usable fix the next problem is reported again immediately', async () => {
    await locationService.reportTrackingProblem('LOCATION_UNAVAILABLE', 'x');
    locationService._setTrackingState('ACTIVE', null);
    await locationService.reportTrackingProblem('LOCATION_UNAVAILABLE', 'x');
    expect(reportEvent).toHaveBeenCalledTimes(2);
  });

  it('a failed report is retried with the next observation', async () => {
    reportEvent.mockResolvedValueOnce({ action: 'ERROR', reason: 'Failed to fetch' } as any);
    await locationService.reportTrackingProblem('LOCATION_DENIED', 'x');
    await locationService.reportTrackingProblem('LOCATION_DENIED', 'x');
    expect(reportEvent).toHaveBeenCalledTimes(2);
  });

  it('nothing is sent while the browser is offline (the server-side stale check covers it)', async () => {
    online = false;
    await locationService.reportTrackingProblem('LOCATION_DENIED', 'x');
    expect(reportEvent).not.toHaveBeenCalled();
  });
});

describe('network loss and reconnection are distinguished', () => {
  it('offline → OFFLINE state; online → NETWORK_RECONNECTED with the offline duration, then a fresh reading', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    online = false;
    locationService.handleOffline();
    expect(locationService.getTrackingState().status).toBe('OFFLINE');
    vi.setSystemTime(new Date('2026-10-21T10:07:30Z'));
    online = true;
    const resume = vi.spyOn(locationService, 'handleResume').mockResolvedValue(undefined);
    await locationService.handleOnline();
    expect(reportEvent).toHaveBeenCalledWith('NETWORK_RECONNECTED', { message: null, offlineSeconds: 450 });
    expect(resume).toHaveBeenCalledTimes(1);           // a fresh location is requested; reconnecting alone proves nothing
    expect(locationService.getTrackingState().status).not.toBe('OFFLINE');
  });
});
