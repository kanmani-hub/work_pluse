import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { locationService } from './locationService';

// Business rule 2026-10-28: tracking explicitly OFF (location permission turned off) is reported at once.
// Synthetic browser objects only; the server decision is covered by supabase/tests/autobreak (OFF1–OFF4).
vi.mock('../attendance/breakService', () => ({ breakService: { handleAutoBreakTransition: vi.fn(async () => ({ action: 'NONE', complete: true })) } }));
vi.mock('../notifications/notificationService', () => ({ notificationService: { notifyGeofenceEvent: vi.fn(), notifyEmployee: vi.fn(async () => {}) } }));
vi.mock('../audit/auditService', () => ({ auditService: { recordAuditLog: vi.fn(async () => ({})) } }));
vi.mock('../qa/qaTimeService', () => ({ qaTimeService: { isEnabled: false, now: () => Date.now(), getIsoString: () => new Date().toISOString(), getRealToSimulatedInterval: (x: number) => x } }));
vi.mock('../../lib/supabase', () => {
  const q: any = { select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, insert: () => q, update: () => q, upsert: () => q,
    single: () => q, maybeSingle: () => q, then: (res: any) => Promise.resolve({ data: null, error: null }).then(res) };
  return { supabase: { from: () => q, rpc: vi.fn(async () => ({ data: { action: 'NONE' }, error: null })), auth: { getUser: async () => ({ data: { user: null }, error: null }) } } };
});

const realNavigator = (globalThis as any).navigator;
const setNavigator = (nav: any) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
const flush = () => new Promise(r => setTimeout(r, 0));

function browser(permissionState: string | null) {
  const status = permissionState === null ? null : { state: permissionState, onchange: null as null | (() => void) };
  const nav: any = {
    onLine: true,
    geolocation: { watchPosition: vi.fn(() => 7), clearWatch: vi.fn(), getCurrentPosition: vi.fn() },
  };
  if (status) nav.permissions = { query: vi.fn(async () => status) };
  setNavigator(nav);
  return { nav, status };
}

let report: any; let resume: any;
beforeEach(() => {
  locationService.stopLiveTracking();
  report = vi.spyOn(locationService, 'reportTrackingProblem').mockResolvedValue(undefined as any);
  resume = vi.spyOn(locationService, 'handleResume').mockResolvedValue(undefined as any);
});
afterEach(() => {
  locationService.stopLiveTracking();
  vi.restoreAllMocks();
  setNavigator(realNavigator);
});

describe('location permission turned off = confirmed tracking OFF', () => {
  it('permission switched off while tracking → reported at once as LOCATION_DENIED (no waiting for the GPS watcher)', async () => {
    const { status } = browser('granted');
    locationService._startBrowserWatch();
    await flush();
    expect(report).not.toHaveBeenCalled();
    status!.state = 'denied';
    status!.onchange!();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('LOCATION_DENIED', 'Location permission was turned off');
  });

  it('already denied when tracking starts → reported at once', async () => {
    browser('denied');
    locationService._startBrowserWatch();
    await flush();
    expect(report).toHaveBeenCalledWith('LOCATION_DENIED', expect.any(String));
  });

  it('"prompt" (not decided yet) is not tracking OFF → nothing reported', async () => {
    const { status } = browser('prompt');
    locationService._startBrowserWatch();
    await flush();
    status!.onchange!();
    expect(report).not.toHaveBeenCalled();
  });

  it('permission granted again after OFF → tracking resumes at once (a fresh location then ends the break per policy)', async () => {
    const { status } = browser('granted');
    locationService._startBrowserWatch();
    await flush();
    locationService._setTrackingState('LOCATION_DENIED' as any, 'off');
    status!.state = 'granted';
    status!.onchange!();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('no Permissions API (older WebView) → no error; the watcher error stays the signal', async () => {
    const { nav } = browser(null);
    expect(() => locationService._startBrowserWatch()).not.toThrow();
    await flush();
    expect(nav.geolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it('stopping tracking detaches the listener (no report after clock-out)', async () => {
    const { status } = browser('granted');
    locationService._startBrowserWatch();
    await flush();
    locationService.stopLiveTracking();
    expect(status!.onchange).toBeNull();
  });
});
