import { supabase } from '../../lib/supabase';
import { calculateHaversineDistance } from '../../utils/geofence';
import { notificationService } from '../notifications/notificationService';
import { qaTimeService } from '../qa/qaTimeService';
import { initialStability, nextStability, isReadingTimeAcceptable, type GeofenceSide, type StabilityState } from './geofenceStability';
import { classifyLocation, isUsableReading, shouldPersistCheck, isExplicitCheck, liveStatusFor, isPlausibleFix, shouldRecordTrackingProblem, hasTrackingGap, type TrackingProblem } from './locationRules';
import { selectCurrentAttendance } from '../attendance/currentAttendance';
import { companyDateStr, previousDateStr } from '../../utils/companyDate';
import { loadNativeBackgroundPlugin, nativeErrorToProblem, nativeToGeo, NATIVE_WATCHER_OPTIONS, type NativeBackgroundPlugin } from './nativeBackgroundLocation';

export interface GeolocationResult {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  timestamp: number | null;
  error?: string;
  status: 'SUCCESS' | 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN_ERROR';
}

export type VerificationResult = 'INSIDE' | 'OUTSIDE' | 'UNKNOWN' | 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'LOW_ACCURACY' | 'ERROR' | 'WFH';

/**
 * What this device's GPS watcher is currently able to do, for the employee screens.
 * ACTIVE = the last reading was a usable fix. The other states are GPS problems: they are
 * shown and recorded as diagnostics but never treated as being outside the office.
 */
export type TrackingStatus = 'IDLE' | 'ACTIVE' | TrackingProblem;
export interface TrackingState { status: TrackingStatus; since: number | null; message: string | null }

export interface LocationVerificationResponse {
  eventId: string | null;
  result: VerificationResult;
  distance?: number;
  radius?: number;
  error?: Error;
}

export const locationService = {
  qaMockLocation: null as { lat: number, lng: number } | null,
  
  setQaMockLocation(lat: number, lng: number) {
      this.qaMockLocation = { lat, lng };
  },
  
  clearQaMockLocation() {
      this.qaMockLocation = null;
  },

  /**
   * Helper to securely get current employee identity.
   */
  async getCurrentEmployeeId(): Promise<string | null> {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) return null;
    
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('employee_id')
      .eq('auth_user_id', authData.user.id)
      .single() as any;
      
    if (profErr || !profile?.employee_id) return null;
    return profile.employee_id;
  },

  /**
   * Admin: Get all live locations
   */
  async getAllLiveLocations() {
    try {
      const { data, error } = await supabase
        .from('employee_live_locations')
        .select(`
          *,
          employees (
            first_name,
            last_name,
            employee_code,
            departments (name),
            offices (id, name, latitude, longitude, geofence_radius)
          )
        `);
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching live locations:', error);
      return { data: null, error };
    }
  },

  /**
   * Promise wrapper for browser geolocation API.
   * Uses a two-phase strategy for Android mobile reliability:
   *   Phase 1: High accuracy with 15s timeout
   *   Phase 2 (fallback): Low accuracy with 10s timeout
   * Diagnostic logging uses safe prefixed tags for production debugging.
   */
  getCurrentLocation(): Promise<GeolocationResult> {
    return new Promise((resolve) => {
      if (qaTimeService.isEnabled && this.qaMockLocation) {
          resolve({
              latitude: this.qaMockLocation.lat,
              longitude: this.qaMockLocation.lng,
              accuracy: 5,
              timestamp: qaTimeService.now(),
              status: 'SUCCESS'
          });
          return;
      }

      if (!navigator.geolocation) {
        console.warn('[GPS] GPS_POSITION_UNAVAILABLE: Geolocation API not supported');
        resolve({
          latitude: null, longitude: null, accuracy: null, timestamp: null,
          status: 'LOCATION_UNAVAILABLE', error: 'Geolocation not supported'
        });
        return;
      }

      const handleSuccess = (position: GeolocationPosition) => {
        console.log(`[GPS] GPS_POSITION_RECEIVED: accuracy=${Math.round(position.coords.accuracy)}m, timestamp=${position.timestamp}, coords=available`);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
          status: 'SUCCESS'
        });
      };

      const handleError = (error: GeolocationPositionError, phase: string) => {
        let status: GeolocationResult['status'] = 'UNKNOWN_ERROR';
        if (error.code === error.PERMISSION_DENIED) {
          status = 'LOCATION_DENIED';
          console.warn(`[GPS] GPS_PERMISSION_DENIED (${phase}): ${error.message}`);
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          status = 'LOCATION_UNAVAILABLE';
          console.warn(`[GPS] GPS_POSITION_UNAVAILABLE (${phase}): ${error.message}`);
        } else if (error.code === error.TIMEOUT) {
          status = 'TIMEOUT';
          console.warn(`[GPS] GPS_TIMEOUT (${phase}): ${error.message}`);
        } else {
          console.warn(`[GPS] GPS_UNKNOWN_ERROR (${phase}): ${error.message}`);
        }
        return { status, message: error.message };
      };

      // Phase 1: High accuracy, generous timeout, allow 30s cache
      console.log('[GPS] GPS_REQUEST_STARTED: Phase 1 (highAccuracy=true, timeout=15000ms, maximumAge=30000ms)');
      navigator.geolocation.getCurrentPosition(
        handleSuccess,
        (error) => {
          const result = handleError(error, 'Phase1');
          
          // If permission denied, don't retry — it won't help
          if (result.status === 'LOCATION_DENIED') {
            resolve({
              latitude: null, longitude: null, accuracy: null, timestamp: null,
              status: result.status, error: result.message
            });
            return;
          }

          // Phase 2: Fallback to low accuracy (network/WiFi), shorter timeout
          console.log('[GPS] GPS_REQUEST_STARTED: Phase 2 fallback (highAccuracy=false, timeout=10000ms, maximumAge=60000ms)');
          navigator.geolocation.getCurrentPosition(
            handleSuccess,
            (error2) => {
              const result2 = handleError(error2, 'Phase2');
              resolve({
                latitude: null, longitude: null, accuracy: null, timestamp: null,
                status: result2.status, error: result2.message
              });
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    });
  },

  /**
   * Verify location and return event ID to be passed to attendance
   */
  async verifyCurrentLocation(
    type: 'CLOCK_IN' | 'CLOCK_OUT' | 'LOCATION_CHECK',
    opts: { geo?: GeolocationResult } = {},
  ): Promise<LocationVerificationResponse> {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { eventId: null, result: 'ERROR', error: new Error('Unauthorized') };

    // 1. Resolve Office
    // @ts-ignore
    const { data: employeeData, error: empErr } = await supabase
      .from('employees')
      .select(`
        first_name,
        employee_code,
        office_id,
        offices(id, name, latitude, longitude, geofence_radius, is_active)
      `)
      .eq('id', empId)
      .single() as any;

    if (empErr) return { eventId: null, result: 'ERROR', error: new Error('Database error') };

    // 2. Check if there's an approved WFH request today (company date)
    const localDateStr = companyDateStr();
    const { data: wfhData, error: wfhErr } = await supabase
      .from('wfh_requests')
      .select('id, status')
      .eq('employee_id', empId)
      .eq('request_date', localDateStr)
      .eq('status', 'APPROVED')
      .maybeSingle() as any;

    // A failed WFH lookup is not "no WFH": without knowing, no geofence decision (and no auto break) is made
    if (wfhErr) return { eventId: null, result: 'ERROR', error: new Error(`Your WFH status could not be checked (${wfhErr.message}). Please try again.`) };

    const isWfh = !!wfhData;

    // 3. Obtain location: the live-tracking watcher passes the position it just received,
    //    explicit checks (clock in/out) request a fresh one.
    //    A "successful" fix that cannot be a real position is handled as a GPS error.
    const rawGeo = opts.geo ?? await this.getCurrentLocation();
    const geo: GeolocationResult = rawGeo.status === 'SUCCESS' && !isPlausibleFix(rawGeo.latitude, rawGeo.longitude, rawGeo.accuracy)
      ? { latitude: null, longitude: null, accuracy: null, timestamp: rawGeo.timestamp, status: 'UNKNOWN_ERROR', error: 'Implausible GPS reading (invalid coordinates or accuracy)' }
      : rawGeo;
    this._setTrackingState(geo.status === 'SUCCESS' ? 'ACTIVE' : geo.status, geo.status === 'SUCCESS' ? null : (geo.error ?? null));

    // 4/5. Accuracy + geofence via the shared rules (GPS failure never means OUTSIDE; WFH bypasses the office geofence)
    const office = employeeData?.offices;
    let radius = office?.geofence_radius || 200;
    let distance: number | undefined;
    if (geo.status === 'SUCCESS' && office && office.is_active && geo.latitude !== null && geo.longitude !== null) {
      radius = office.geofence_radius || 200;
      distance = calculateHaversineDistance(geo.latitude, geo.longitude, office.latitude, office.longitude);
    }
    const classified = classifyLocation({
      geoStatus: geo.status,
      accuracyMeters: geo.accuracy,
      distanceMeters: distance ?? null,
      radiusMeters: radius,
      isWfh,
      office: !office ? 'MISSING' : !office.is_active ? 'INACTIVE' : 'OK',
    });
    const result: VerificationResult = classified.result;
    const failureReason: string | null = geo.error || classified.failureReason;

    // Ensure we do NOT store fake coordinates.
    // geo.latitude and geo.longitude are only from navigator.geolocation.

    // 6. Current open attendance: today's, or last night's overnight shift still in progress
    //    (the old query only looked at today's date, so overnight sessions lost their link after midnight)
    const { data: recentAttendance } = await supabase
      .from('attendance')
      .select('id, attendance_date, clock_in_at, clock_out_at, shift_template:shift_template_id(crosses_midnight)')
      .eq('employee_id', empId)
      .in('attendance_date', [localDateStr, previousDateStr(localDateStr)]) as any;
    const current = selectCurrentAttendance((recentAttendance || []) as any[], localDateStr, previousDateStr(localDateStr)) as any;
    const openAttendance = current && current.clock_in_at && !current.clock_out_at ? current : null;
    const attendanceId: string | null = openAttendance?.id ?? null;

    const buildResponse = (eventId: string | null): LocationVerificationResponse => {
      if (result === 'OUTSIDE' || result === 'LOCATION_DENIED' || result === 'LOW_ACCURACY' || result === 'ERROR' || result === 'LOCATION_UNAVAILABLE') {
        let msg = failureReason || 'Location verification failed.';
        if (result === 'LOCATION_DENIED') msg = 'Location permission is required for office attendance. Please enable location access and try again.';
        if (result === 'OUTSIDE') msg = `You are outside the assigned office geofence. ${classified.failureReason ?? ''}`.trim();
        if (result === 'LOW_ACCURACY') msg = 'GPS accuracy is too low to verify location.';
        if (result === 'LOCATION_UNAVAILABLE') msg = 'Unable to determine your location. Please make sure GPS is on and try again.';
        return { eventId, result, distance, radius, error: new Error(msg) };
      }
      return { eventId, result, distance, radius, error: undefined };
    };

    // Background checks are stored only while clocked in (no off-duty tracking, no needless writes)
    if (!shouldPersistCheck(type, !!openAttendance)) {
      return buildResponse(null);
    }

    // 7. Create verification event (records the explicit result, including DENIED / UNAVAILABLE / LOW_ACCURACY)
    const nowIso = new Date().toISOString();
    // @ts-ignore
    const { data: eventResult, error: insertErr } = await (supabase.from('location_verification_events') as any)
      .insert({
        employee_id: empId,
        attendance_id: attendanceId,
        office_id: employeeData?.offices?.id || null,
        verification_type: type,
        result: result,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy_meters: geo.accuracy,
        distance_from_office_meters: distance ?? null,
        geofence_radius_meters: radius,
        verified_at: nowIso,
        source: 'WEB',
        failure_reason: failureReason
      } as any)
      .select('id')
      .single();

    if (insertErr) {
      return { eventId: null, result: 'ERROR', error: new Error(insertErr.message) };
    }

    // Audit only explicit clock-in/out verifications (not every 10-second background check)
    if (isExplicitCheck(type)) import('../audit/auditService').then(({ auditService }) => {
      let actionStr = 'LOCATION_VERIFICATION_FAILED';
      if (result === 'INSIDE' || result === 'WFH') actionStr = 'LOCATION_VERIFICATION_SUCCESS';
      else if (result === 'LOCATION_DENIED') actionStr = 'LOCATION_DENIED';

      auditService.recordAuditLog({
        action: actionStr,
        module: 'SECURITY',
        entity_type: 'location_verification_events',
        entity_id: eventResult.id,
        description: `Location verification: ${result}`
      }).catch(e => console.error('[AUDIT]', e));
    });

    // 8. Update live location ONLY from a usable reading (INSIDE / OUTSIDE / WFH).
    //    Denied, unavailable, low-accuracy or no-office readings never change the geofence status
    //    and never refresh last_seen_at, so the admin sees an explicit stale state instead of a fake one.
    const usableReading = isUsableReading(geo.status, result);
    if (usableReading) {
      const locContext = isWfh ? 'WFH' : 'OFFICE';
      const readingStatus = liveStatusFor(result);
      const readingAtMs = geo.timestamp ?? Date.now();

      const { data: existingLiveLoc, error: liveLocErr } = await supabase
        .from('employee_live_locations')
        .select('id, location_status, last_seen_at')
        .eq('employee_id', empId)
        .maybeSingle() as any;

      // A failed read is not "no live row": no geofence transition (and no auto break) from this reading
      if (liveLocErr) {
        console.error('[GEOFENCE] live location could not be read; reading not used for geofence decisions', liveLocErr.message);
        return buildResponse(eventResult?.id || null);
      }

      const historyRow = {
        employee_id: empId,
        office_id: employeeData?.offices?.id || null,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy_meters: geo.accuracy,
        distance_from_office_meters: distance ?? null,
        location_status: readingStatus,
        location_context: locContext,
        recorded_at: nowIso,
        source: 'WEB'
      };

      if (existingLiveLoc) {
        // Confirmed side comes from the stored live row; the stability filter debounces jitter.
        const storedSide: GeofenceSide | null = existingLiveLoc.location_status === 'OUTSIDE_GEOFENCE' ? 'OUTSIDE' : existingLiveLoc.location_status === 'INSIDE_GEOFENCE' ? 'INSIDE' : null;
        let newStatus = readingStatus;
        let transition: { from: GeofenceSide | null; to: GeofenceSide; atMs: number } | null = null;

        // Delayed or future-dated readings (device clock / offline backlog) never move the geofence
        // state: they cannot start or end a break. They are still stored in the location history.
        const readingTimeOk = isReadingTimeAcceptable(readingAtMs, qaTimeService.now());
        if (!readingTimeOk) {
          console.warn('[GEOFENCE] reading time outside the accepted window; not used for geofence decisions', { readingAtMs });
        }

        if (result === 'WFH') {
          this._stability.delete(empId);
        } else if (!readingTimeOk) {
          newStatus = existingLiveLoc.location_status;
        } else if (type === 'CLOCK_IN' && !openAttendance && result === 'INSIDE') {
          // A clock-in verified inside the office is today's baseline. Without this, a status left
          // OUTSIDE from yesterday (e.g. clocked out during an automatic break) stays OUTSIDE if the
          // app is closed right after clock-in, and the first real exit of the day is never detected.
          // Baseline only: no ENTERED event and no break change (there is no open attendance yet).
          this._stability.set(empId, initialStability('INSIDE'));
          newStatus = 'INSIDE_GEOFENCE';
        } else {
          let state = this._stability.get(empId);
          if (!state || state.confirmed !== storedSide) state = initialStability(storedSide);
          const step = nextStability(state, {
            ok: true,
            distanceMeters: distance ?? null,
            radiusMeters: radius,
            accuracyMeters: geo.accuracy,
            atMs: readingAtMs,
          });
          this._stability.set(empId, step.state);
          // Remember when this device last reported BEFORE a possible side change started, so a return
          // detected only after a tracking gap (app closed / GPS off) can be flagged instead of trusted.
          if (step.state.pendingSide && step.state.pendingCount === 1) {
            const prevSeenMs = existingLiveLoc.last_seen_at ? new Date(existingLiveLoc.last_seen_at).getTime() : NaN;
            this._lastSeenBeforePending.set(empId, Number.isFinite(prevSeenMs) ? prevSeenMs : null);
          } else if (!step.state.pendingSide && !step.transition) {
            this._lastSeenBeforePending.delete(empId);
          }
          transition = step.transition;
          newStatus = step.state.confirmed === 'OUTSIDE' ? 'OUTSIDE_GEOFENCE' : step.state.confirmed === 'INSIDE' ? 'INSIDE_GEOFENCE' : existingLiveLoc.location_status;
        }

        // Compare-and-set on the status we read: if another tab/device changed it in the
        // meantime, this update matches no row and we do NOT emit a second ENTER/EXIT event.
        // @ts-ignore
        const { data: updatedRows } = await (supabase.from('employee_live_locations') as any).update({
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_meters: geo.accuracy,
          distance_from_office_meters: distance ?? null,
          location_status: newStatus,
          location_context: locContext,
          attendance_id: attendanceId,
          last_seen_at: nowIso,
          source: 'WEB'
        }).eq('id', existingLiveLoc.id).eq('location_status', existingLiveLoc.location_status).select('id');
        if (transition && (!updatedRows || updatedRows.length === 0)) {
          transition = null; // already handled elsewhere: no duplicate event / auto-break
        }

        const { error: histErr } = await (supabase.from('employee_location_history') as any).insert(historyRow);
        if (histErr) console.error('[HISTORY INSERT ERROR]', histErr);

        if (transition && transition.from !== null) {
          const transitionIso = new Date(transition.atMs).toISOString();
          const eventType = transition.to === 'INSIDE' ? 'ENTERED' : 'EXITED';
          const { data: eventData } = await (supabase.from('geofence_events') as any).insert({
            employee_id: empId,
            attendance_id: attendanceId,
            office_id: employeeData?.offices?.id || null,
            event_type: eventType,
            latitude: geo.latitude,
            longitude: geo.longitude,
            distance_from_office_meters: distance ?? null,
            geofence_radius_meters: radius,
            occurred_at: transitionIso,
            source: 'WEB'
          }).select('id').single();

          import('../audit/auditService').then(({ auditService }) => {
            auditService.recordAuditLog({
              action: eventType === 'EXITED' ? 'GEOFENCE_LEFT' : 'GEOFENCE_RETURNED',
              module: 'SECURITY',
              description: eventType === 'EXITED' ? 'Employee left the geofenced area.' : 'Employee returned to the geofenced area.'
            });
          });

          if (eventData) {
            notificationService.notifyGeofenceEvent({
              event_type: eventType,
              employeeName: employeeData?.first_name || 'Employee',
              employeeCode: employeeData?.employee_code || 'Unknown',
              distance: distance ?? null,
              empId: empId,
              eventId: eventData.id
            });
          }

          // Automatic break uses the confirmed transition time (first reading on the new side).
          // A return seen only after a tracking gap ends the break at the first inside reading (the only
          // time we know), and is flagged so the admin can see the real return may have been earlier.
          const prevSeenMs = this._lastSeenBeforePending.get(empId);
          this._lastSeenBeforePending.delete(empId);
          const trackingGap = transition.to === 'INSIDE' && hasTrackingGap(prevSeenMs ?? null, transition.atMs)
            ? { lastSeenAt: new Date(prevSeenMs as number).toISOString() } : undefined;
          const { breakService } = await import('../attendance/breakService');
          const breakResult: any = await breakService.handleAutoBreakTransition(empId, transition.to === 'OUTSIDE' ? 'START' : 'END', transitionIso, { isWfhContext: isWfh, ...(trackingGap ? { trackingGap } : {}) })
            .catch(e => { console.error('[AUTO BREAK]', e); return null; });
          // The employee already got "Automatic Break Started/Ended"; otherwise (e.g. manual break
          // active) tell them about the confirmed geofence change itself. Confirmed transitions only:
          // never for GPS failure, low accuracy or jitter.
          if (eventData?.id && breakResult && breakResult.action !== 'STARTED' && breakResult.action !== 'ENDED') {
            const { geofenceTransition } = await import('../notifications/notificationRules');
            await notificationService.notifyEmployee(empId, geofenceTransition({ eventId: eventData.id, to: transition.to }));
          }
        }
      } else {
        // @ts-ignore
        await (supabase.from('employee_live_locations') as any).insert({
          employee_id: empId,
          attendance_id: attendanceId,
          office_id: employeeData?.offices?.id || null,
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_meters: geo.accuracy,
          distance_from_office_meters: distance ?? null,
          location_status: readingStatus,
          location_context: locContext,
          is_tracking: false,
          last_seen_at: nowIso,
          source: 'WEB'
        });

        await (supabase.from('employee_location_history') as any).insert(historyRow);

        if (result === 'INSIDE') {
          const { data: eventData } = await (supabase.from('geofence_events') as any).insert({
            employee_id: empId,
            attendance_id: attendanceId,
            office_id: employeeData?.offices?.id || null,
            event_type: 'ENTERED',
            latitude: geo.latitude,
            longitude: geo.longitude,
            distance_from_office_meters: distance ?? null,
            geofence_radius_meters: radius,
            occurred_at: nowIso,
            source: 'WEB'
          }).select('id').single();

          if (eventData) {
            notificationService.notifyGeofenceEvent({
              event_type: 'ENTERED',
              employeeName: employeeData?.first_name || 'Employee',
              employeeCode: employeeData?.employee_code || 'Unknown',
              distance: distance ?? null,
              empId: empId,
              eventId: eventData.id
            });
          }
        }
      }
    }

    // Admins are told about denied location only on an explicit clock-in/out attempt
    // (the background check would otherwise notify them every 10 seconds).
    if (result === 'LOCATION_DENIED' && isExplicitCheck(type)) {
      notificationService.notifyGeofenceEvent({
        event_type: 'LOCATION_DENIED',
        employeeName: employeeData?.first_name || 'Employee',
        employeeCode: employeeData?.employee_code || 'Unknown',
        empId: empId,
        eventId: eventResult?.id
      });
    }

    return buildResponse(eventResult?.id || null);
  },

  // GPS watcher state for the employee screens (this device only; nothing here is a location)
  _trackingState: undefined as TrackingState | undefined,
  _trackingProblem: null as { status: TrackingProblem; recordedAtMs: number } | null,
  _trackingListeners: new Set<(s: TrackingState) => void>(),

  getTrackingState(): TrackingState {
    return this._trackingState ?? { status: 'IDLE', since: null, message: null };
  },

  onTrackingStateChange(listener: (s: TrackingState) => void): () => void {
    this._trackingListeners.add(listener);
    return () => { this._trackingListeners.delete(listener); };
  },

  _setTrackingState(status: TrackingStatus, message: string | null) {
    if (this._trackingState?.status === status) return;
    this._trackingState = { status, since: Date.now(), message };
    this._trackingListeners.forEach(l => { try { l(this._trackingState!); } catch { /* listener errors never stop tracking */ } });
  },

  /**
   * A GPS watcher error (permission denied, location off / no fix, timeout). Shown to the employee
   * at once; recorded as a diagnostic verification event (only while clocked in) when the problem
   * changes or persists past the stale window. It never changes the geofence side, never starts
   * or ends a break and never refreshes last_seen_at.
   */
  async reportTrackingProblem(status: TrackingProblem, message: string) {
    this._setTrackingState(status, message);
    const nowMs = Date.now();
    if (!shouldRecordTrackingProblem(this._trackingProblem, status, nowMs)) return;
    this._trackingProblem = { status, recordedAtMs: nowMs };
    console.warn(`[GPS] tracking problem recorded: ${status}`);
    await this.verifyCurrentLocation('LOCATION_CHECK', {
      geo: { latitude: null, longitude: null, accuracy: null, timestamp: nowMs, status, error: message },
    }).catch(() => {});
  },

  _watchId: null as number | null,
  // Per-employee geofence stability (debounce) state for this browser session
  _stability: new Map<string, StabilityState>(),
  // Per employee: last_seen_at before the current pending side change began (tracking-gap detection)
  _lastSeenBeforePending: new Map<string, number | null>(),
  _lastUpdate: 0,
  _lastLat: null as number | null,
  _lastLon: null as number | null,
  
  // Configuration per user request
  LOCATION_TRACKING_INTERVAL_MS: 10000, // 10 seconds default

  // ---- reading intake (browser watcher, native plugin, resume refresh, offline replay) ----
  _nativePlugin: null as NativeBackgroundPlugin | null,
  _nativeWatcherId: null as string | null,
  _trackingGeneration: 0,
  _starting: false,
  _lastReadingMs: null as number | null,
  _pendingReadings: [] as GeolocationResult[],
  _detachResume: null as null | (() => void),
  _lastResumeRefresh: 0,
  MAX_PENDING_READINGS: 30,

  /**
   * One entry point for every position, whatever produced it. Drops duplicates and out-of-order
   * deliveries (same or older device timestamp), throttles to the tracking interval, and keeps
   * readings taken while offline to replay in order once the network is back.
   */
  async ingestReading(geo: GeolocationResult, opts: { force?: boolean } = {}) {
    if (geo.status !== 'SUCCESS') return;
    const ts = typeof geo.timestamp === 'number' && Number.isFinite(geo.timestamp) ? geo.timestamp : null;
    if (ts !== null && this._lastReadingMs !== null && ts <= this._lastReadingMs) return; // duplicate / out of order
    const now = Date.now();
    if (!opts.force && now - this._lastUpdate < this.LOCATION_TRACKING_INTERVAL_MS) return;
    this._lastUpdate = now;
    if (ts !== null) this._lastReadingMs = ts;
    this._lastLat = geo.latitude;
    this._lastLon = geo.longitude;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Offline: keep the reading (bounded) instead of failing every request; replayed on reconnect.
      this._pendingReadings.push(geo);
      if (this._pendingReadings.length > this.MAX_PENDING_READINGS) this._pendingReadings.shift();
      return;
    }
    await this.verifyCurrentLocation('LOCATION_CHECK', { geo }).catch(() => {});
  },

  /**
   * Back online: replay queued readings oldest first. Each still passes the reading-time window, so a
   * reading older than that is only stored as history and never moves the geofence.
   */
  async flushPendingReadings() {
    const queued = this._pendingReadings.splice(0).sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    for (const geo of queued) await this.verifyCurrentLocation('LOCATION_CHECK', { geo }).catch(() => {});
  },

  /**
   * App back in the foreground / network back: replay the offline queue, then take one fresh reading
   * at once instead of waiting for the next watcher callback (an exit or return that happened while
   * the app was in the background is picked up as soon as the employee opens it). Also restarts the
   * browser watcher if it stopped (e.g. permission was denied and has since been granted).
   */
  async handleResume() {
    const now = Date.now();
    if (now - this._lastResumeRefresh < this.LOCATION_TRACKING_INTERVAL_MS) return;
    this._lastResumeRefresh = now;
    await this.flushPendingReadings();
    if (this._watchId === null && this._nativeWatcherId === null && !this._starting && this._detachResume) this._startBrowserWatch();
    const geo = await this.getCurrentLocation();
    if (geo.status === 'SUCCESS') await this.ingestReading(geo, { force: true });
    else await this.reportTrackingProblem(geo.status as TrackingProblem, geo.error || geo.status);
  },

  _attachResumeHandlers() {
    if (this._detachResume || typeof document === 'undefined' || typeof window === 'undefined') return;
    const onVisible = () => { if (document.visibilityState === 'visible') this.handleResume().catch(() => {}); };
    const onOnline = () => { this.handleResume().catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    this._detachResume = () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  },

  /**
   * Native background source (Android foreground service). Only used when the plugin is installed;
   * see nativeBackgroundLocation.ts. Plugin errors are tracking problems, never exits.
   */
  async startNativeTracking(plugin: NativeBackgroundPlugin): Promise<boolean> {
    const generation = this._trackingGeneration;
    try {
      const id = await plugin.addWatcher(NATIVE_WATCHER_OPTIONS, (location, error) => {
        if (error) {
          const problem = nativeErrorToProblem(error);
          console.warn(`[GPS] native tracking error: ${problem}`);
          this.reportTrackingProblem(problem, error.message || problem).catch(() => {});
          return;
        }
        if (!location) return;
        const geo = nativeToGeo(location);
        if (geo.status !== 'SUCCESS') {
          this.reportTrackingProblem('UNKNOWN_ERROR', geo.error || 'Invalid native location').catch(() => {});
          return;
        }
        this.ingestReading(geo).catch(() => {});
      });
      if (generation !== this._trackingGeneration) {
        // stopLiveTracking() ran while the watcher was being added: do not leave it running
        await plugin.removeWatcher({ id }).catch(() => {});
        return false;
      }
      this._nativePlugin = plugin;
      this._nativeWatcherId = id;
      console.log('[GPS] native background tracking started');
      return true;
    } catch (e: any) {
      console.warn('[GPS] native background tracking could not start; using browser geolocation', e?.message);
      return false;
    }
  },

  _startBrowserWatch() {
    if (this._watchId !== null || typeof navigator === 'undefined' || !navigator.geolocation) return;
    this._watchId = navigator.geolocation.watchPosition(
      (position) => {
        // Verify + persist using THIS position (no second GPS request per update)
        this.ingestReading({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
          status: 'SUCCESS',
        }).catch(() => {});
      },
      (error) => {
        const problem: TrackingProblem = error.code === error.PERMISSION_DENIED ? 'LOCATION_DENIED'
          : error.code === error.POSITION_UNAVAILABLE ? 'LOCATION_UNAVAILABLE'
          : error.code === error.TIMEOUT ? 'TIMEOUT' : 'UNKNOWN_ERROR';
        console.warn(`[GPS] live tracking error: ${problem}`);
        this.reportTrackingProblem(problem, error.message || problem).catch(() => {});
        // Permission denied ends this watch; clear it so the next startLiveTracking() or a resume
        // (clock in, opening Attendance/Dashboard, returning to the app) can start a new one.
        if (error.code === error.PERMISSION_DENIED && this._watchId !== null) {
          navigator.geolocation.clearWatch(this._watchId);
          this._watchId = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: this.LOCATION_TRACKING_INTERVAL_MS }
    );
  },

  /**
   * Start tracking for the signed-in employee: the native background source when the plugin is
   * installed, otherwise the browser watcher (foreground only — it does NOT run when the app is
   * closed or the screen is off).
   */
  startLiveTracking(opts: { loadNative?: () => Promise<NativeBackgroundPlugin | null> } = {}) {
    if (this._watchId !== null || this._nativeWatcherId !== null || this._starting) return;

    if (qaTimeService.isEnabled) {
       // In QA mode, we just run an interval because mock location handles the data.
       this._watchId = window.setInterval(async () => {
         await this.verifyCurrentLocation('LOCATION_CHECK').catch(() => {});
       }, qaTimeService.getRealToSimulatedInterval(this.LOCATION_TRACKING_INTERVAL_MS)) as unknown as number;
       return;
    }

    this._attachResumeHandlers();
    this._starting = true;
    const generation = this._trackingGeneration;
    (opts.loadNative ?? loadNativeBackgroundPlugin)()
      .catch(() => null)
      .then(async plugin => {
        const started = plugin ? await this.startNativeTracking(plugin) : false;
        this._starting = false;
        if (generation !== this._trackingGeneration) return; // stopped meanwhile
        if (!started) this._startBrowserWatch();
      });
  },

  stopLiveTracking() {
    this._trackingGeneration++;
    this._starting = false;
    if (this._watchId !== null) {
      if (qaTimeService.isEnabled) {
          window.clearInterval(this._watchId);
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
          navigator.geolocation.clearWatch(this._watchId);
      }
      this._watchId = null;
    }
    if (this._nativeWatcherId !== null && this._nativePlugin) {
      this._nativePlugin.removeWatcher({ id: this._nativeWatcherId }).catch(() => {});
    }
    this._nativeWatcherId = null;
    this._nativePlugin = null;
    if (this._detachResume) { this._detachResume(); this._detachResume = null; }
    this._pendingReadings = [];
    this._setTrackingState('IDLE', null);
  }
};
