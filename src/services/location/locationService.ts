import { supabase } from '../../lib/supabase';
import { calculateHaversineDistance } from '../../utils/geofence';
import { notificationService } from '../notifications/notificationService';
import { qaTimeService } from '../qa/qaTimeService';
import { initialStability, nextStability, type GeofenceSide, type StabilityState } from './geofenceStability';

export interface GeolocationResult {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  timestamp: number | null;
  error?: string;
  status: 'SUCCESS' | 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN_ERROR';
}

export type VerificationResult = 'INSIDE' | 'OUTSIDE' | 'UNKNOWN' | 'LOCATION_DENIED' | 'LOCATION_UNAVAILABLE' | 'LOW_ACCURACY' | 'ERROR' | 'WFH';

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
  async verifyCurrentLocation(type: 'CLOCK_IN' | 'CLOCK_OUT' | 'LOCATION_CHECK'): Promise<LocationVerificationResponse> {
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

    // 2. Check if there's an approved WFH request today
    const localDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // Approximate local date
    const { data: wfhData } = await supabase
      .from('wfh_requests')
      .select('id, status')
      .eq('employee_id', empId)
      .eq('request_date', localDateStr)
      .eq('status', 'APPROVED')
      .maybeSingle() as any;

    const isWfh = !!wfhData;

    // 3. Obtain browser location
    const geo = await this.getCurrentLocation();
    
    // Default values if GPS fails
    let result: VerificationResult = isWfh ? 'WFH' : 'ERROR';
    let distance: number | undefined;
    let failureReason = geo.error || null;
    let radius = employeeData?.offices?.geofence_radius || 200;

    // We still log the location event even if GPS fails or if WFH is approved,
    // to keep an audit trail.

    if (geo.status !== 'SUCCESS') {
      if (geo.status === 'LOCATION_DENIED') result = 'LOCATION_DENIED';
      else if (geo.status === 'LOCATION_UNAVAILABLE' || geo.status === 'TIMEOUT') result = 'LOCATION_UNAVAILABLE';
      else result = 'ERROR';
      
      // If they are WFH, they might not need GPS for geofencing, but we still record they tried
      if (isWfh) result = 'WFH';
    } else {
      // 4. Validate accuracy
      if (geo.accuracy && geo.accuracy > 150) { // e.g., > 150m is low accuracy
        result = isWfh ? 'WFH' : 'LOW_ACCURACY';
        failureReason = 'GPS accuracy too low';
      } else {
        // 5. Check geofence
        const office = employeeData?.offices;
        if (!office) {
          result = isWfh ? 'WFH' : 'ERROR';
          failureReason = 'No office has been assigned to your employee profile.';
        } else if (!office.is_active) {
          result = isWfh ? 'WFH' : 'ERROR';
          failureReason = 'Assigned office is inactive.';
        } else {
          radius = office.geofence_radius || 200;
          distance = calculateHaversineDistance(
            geo.latitude!, geo.longitude!,
            office.latitude, office.longitude
          );

          if (distance <= radius) {
            result = isWfh ? 'WFH' : 'INSIDE';
          } else {
            result = isWfh ? 'WFH' : 'OUTSIDE';
            if (!isWfh) {
              failureReason = `Distance: ${Math.round(distance)}m (Allowed: ${radius}m)`;
            }
          }
        }
      }
    }

    // Ensure we do NOT store fake coordinates.
    // geo.latitude and geo.longitude are only from navigator.geolocation.

    // 6. Today's open attendance (links location records to the attendance where the schema supports it)
    const { data: openAttendance } = await supabase
      .from('attendance')
      .select('id')
      .eq('employee_id', empId)
      .eq('attendance_date', localDateStr)
      .is('clock_out_at', null)
      .maybeSingle() as any;
    const attendanceId: string | null = openAttendance?.id ?? null;

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

    import('../audit/auditService').then(({ auditService }) => {
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
    const usableReading = geo.status === 'SUCCESS' && (result === 'INSIDE' || result === 'OUTSIDE' || result === 'WFH');
    if (usableReading) {
      const locContext = isWfh ? 'WFH' : 'OFFICE';
      const readingStatus = result === 'WFH' ? 'WFH' : (result === 'OUTSIDE' ? 'OUTSIDE_GEOFENCE' : 'INSIDE_GEOFENCE');
      const readingAtMs = geo.timestamp ?? Date.now();

      const { data: existingLiveLoc } = await supabase
        .from('employee_live_locations')
        .select('id, location_status')
        .eq('employee_id', empId)
        .maybeSingle() as any;

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

        if (result === 'WFH') {
          this._stability.delete(empId);
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
          transition = step.transition;
          newStatus = step.state.confirmed === 'OUTSIDE' ? 'OUTSIDE_GEOFENCE' : step.state.confirmed === 'INSIDE' ? 'INSIDE_GEOFENCE' : existingLiveLoc.location_status;
        }

        // @ts-ignore
        await (supabase.from('employee_live_locations') as any).update({
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_meters: geo.accuracy,
          distance_from_office_meters: distance ?? null,
          location_status: newStatus,
          location_context: locContext,
          attendance_id: attendanceId,
          last_seen_at: nowIso,
          source: 'WEB'
        }).eq('id', existingLiveLoc.id);

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

          // Automatic break uses the confirmed transition time (first reading on the new side)
          const { breakService } = await import('../attendance/breakService');
          await breakService.handleAutoBreakTransition(empId, transition.to === 'OUTSIDE' ? 'START' : 'END', transitionIso, { isWfhContext: isWfh })
            .catch(e => console.error('[AUTO BREAK]', e));
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

    if (result === 'OUTSIDE' || result === 'LOCATION_DENIED' || result === 'LOW_ACCURACY' || result === 'ERROR' || result === 'LOCATION_UNAVAILABLE') {
      let msg = failureReason || 'Location verification failed.';
      if (result === 'LOCATION_DENIED') {
        msg = 'Location permission is required for office attendance. Please enable location access and try again.';
        notificationService.notifyGeofenceEvent({
          event_type: 'LOCATION_DENIED',
          employeeName: employeeData?.first_name || 'Employee',
          employeeCode: employeeData?.employee_code || 'Unknown',
          empId: empId,
          eventId: eventResult?.id
        });
      }
      if (result === 'OUTSIDE') msg = `You are outside the assigned office geofence. ${failureReason}`;
      if (result === 'LOW_ACCURACY') msg = 'GPS accuracy is too low to verify location.';
      return { eventId: eventResult?.id || null, result, distance, radius, error: new Error(msg) };
    }

    return { eventId: eventResult?.id || null, result, distance, radius, error: undefined };
  },

  _watchId: null as number | null,
  // Per-employee geofence stability (debounce) state for this browser session
  _stability: new Map<string, StabilityState>(),
  _lastUpdate: 0,
  _lastLat: null as number | null,
  _lastLon: null as number | null,
  
  // Configuration per user request
  LOCATION_TRACKING_INTERVAL_MS: 10000, // 10 seconds default

  startLiveTracking() {
    if (this._watchId !== null) return;
    
    if (qaTimeService.isEnabled) {
       // In QA mode, we just run an interval because mock location handles the data.
       this._watchId = window.setInterval(async () => {
         await this.verifyCurrentLocation('LOCATION_CHECK').catch(() => {});
       }, qaTimeService.getRealToSimulatedInterval(this.LOCATION_TRACKING_INTERVAL_MS)) as unknown as number;
       return;
    }

    if (!navigator.geolocation) return;
    
    this._watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        
        let shouldUpdate = false;
        if (now - this._lastUpdate >= this.LOCATION_TRACKING_INTERVAL_MS) {
          shouldUpdate = true;
        }

        if (shouldUpdate) {
          this._lastUpdate = now;
          this._lastLat = lat;
          this._lastLon = lon;
          // Silently verify and persist (which does live update + history insert)
          await this.verifyCurrentLocation('LOCATION_CHECK').catch(() => {});
        }
      },
      (error) => {
        console.warn('Live tracking error:', error);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: this.LOCATION_TRACKING_INTERVAL_MS }
    );
  },

  stopLiveTracking() {
    if (this._watchId !== null) {
      if (qaTimeService.isEnabled) {
          window.clearInterval(this._watchId);
      } else {
          navigator.geolocation.clearWatch(this._watchId);
      }
      this._watchId = null;
    }
  }
};
