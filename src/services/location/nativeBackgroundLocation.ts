/**
 * Optional native (Android) background location source.
 *
 * STATUS: the native side is NOT installed in this project yet. This adapter only switches on when a
 * Capacitor plugin named "BackgroundGeolocation" is present in the native app
 * (e.g. @capacitor-community/background-geolocation, which runs an Android foreground service with a
 * persistent notification). Until then `loadNativeBackgroundPlugin()` returns null and WorkPulse keeps
 * using browser geolocation, which only works while the app is open on screen.
 * See docs/BACKGROUND_LOCATION.md for the exact remaining native steps.
 *
 * Whatever the source, readings go through the same locationService.verifyCurrentLocation() rules:
 * plausibility, accuracy, reading-time window, jitter confirmation, WFH, attendance checks.
 */
import type { GeolocationResult } from './locationService';
import type { TrackingProblem } from './locationRules';

export const NATIVE_PLUGIN_NAME = 'BackgroundGeolocation';

/** Shape of the plugin API this adapter relies on (addWatcher / removeWatcher). */
export interface NativeLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  time?: number | null;     // ms since epoch, from the device
  simulated?: boolean;      // mock-location app / emulator
}
export interface NativeLocationError { code?: string; message?: string }
export interface NativeBackgroundPlugin {
  addWatcher(
    options: { backgroundTitle?: string; backgroundMessage?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    callback: (location?: NativeLocation, error?: NativeLocationError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

export const NATIVE_WATCHER_OPTIONS = {
  // Text of the persistent notification Android shows while the foreground service runs
  backgroundTitle: 'WorkPulse attendance',
  backgroundMessage: 'Your location is used during your shift to detect when you leave or return to the office.',
  requestPermissions: true,
  stale: false,          // never deliver an old cached fix as current
  distanceFilter: 10,    // metres between updates
};

/** Returns the native plugin when it really exists on this device, otherwise null (browser fallback). */
export async function loadNativeBackgroundPlugin(): Promise<NativeBackgroundPlugin | null> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable(NATIVE_PLUGIN_NAME)) return null;
    return registerPlugin<NativeBackgroundPlugin>(NATIVE_PLUGIN_NAME);
  } catch {
    return null;
  }
}

/** Plugin error → the same tracking problems the browser watcher reports. Never an "exit". */
export function nativeErrorToProblem(error: NativeLocationError | null | undefined): TrackingProblem {
  if (error?.code === 'NOT_AUTHORIZED') return 'LOCATION_DENIED';
  return 'LOCATION_UNAVAILABLE';
}

/**
 * Plugin fix → GeolocationResult. A simulated (mock) location is refused as a GPS error, so it can
 * never start or end a break. Everything else is validated later by verifyCurrentLocation.
 */
export function nativeToGeo(location: NativeLocation): GeolocationResult {
  if (location.simulated) {
    return { latitude: null, longitude: null, accuracy: null, timestamp: location.time ?? null, status: 'UNKNOWN_ERROR', error: 'Simulated (mock) location refused' };
  }
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    timestamp: typeof location.time === 'number' ? location.time : null,
    status: 'SUCCESS',
  };
}
