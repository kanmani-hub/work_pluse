import { supabase } from '../../lib/supabase';
import { calculateHaversineDistance } from '../../utils/geofence';
import { notificationService } from '../notifications/notificationService';
import { qaTimeService } from '../qa/qaTimeService';

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
   * Promise wrapper for browser geolocation API
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
        resolve({
          latitude: null, longitude: null, accuracy: null, timestamp: null,
          status: 'LOCATION_UNAVAILABLE', error: 'Geolocation not supported'
        });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
            status: 'SUCCESS'
          });
        },
        (error) => {
          let status: GeolocationResult['status'] = 'UNKNOWN_ERROR';
          if (error.code === error.PERMISSION_DENIED) status = 'LOCATION_DENIED';
          if (error.code === error.POSITION_UNAVAILABLE) status = 'LOCATION_UNAVAILABLE';
          if (error.code === error.TIMEOUT) status = 'TIMEOUT';

          resolve({
            latitude: null, longitude: null, accuracy: null, timestamp: null,
            status, error: error.message
          });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
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

    // 6. Create verification event
    const nowIso = new Date().toISOString();
    // @ts-ignore
    const { data: eventResult, error: insertErr } = await (supabase.from('location_verification_events') as any)
      .insert({
        employee_id: empId,
        office_id: employeeData?.offices?.id || null,
        verification_type: type,
        result: result,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy_meters: geo.accuracy,
        distance_from_office_meters: distance || null,
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

    // 7. Update Live Location (if GPS successful)
    if (geo.status === 'SUCCESS') {
      const locContext = isWfh ? 'WFH' : 'OFFICE';
      
      // UPSERT equivalent using RPC or just ignore error for now. 
      // The schema has employee_id UNIQUE on live_locations.
      // @ts-ignore
      const { data: existingLiveLoc } = await supabase
        .from('employee_live_locations')
        .select('id')
        .eq('employee_id', empId)
        .maybeSingle() as any;
        
      if (existingLiveLoc) {
        const oldStatus = existingLiveLoc.location_status;
        const newStatus = result === 'WFH' ? 'WFH' : (result === 'OUTSIDE' ? 'OUTSIDE_GEOFENCE' : 'INSIDE_GEOFENCE');

        if (oldStatus && oldStatus !== newStatus) {
          if (oldStatus === 'INSIDE_GEOFENCE' && newStatus === 'OUTSIDE_GEOFENCE') {
            import('../audit/auditService').then(({ auditService }) => {
              auditService.recordAuditLog({ action: 'GEOFENCE_LEFT', module: 'SECURITY', description: 'Employee left the geofenced area.' });
            });
            import('../attendance/breakService').then(({ breakService }) => {
              breakService.handleAutoBreakTransition(empId, 'START', geo.timestamp ? new Date(geo.timestamp).toISOString() : nowIso).catch(console.error);
            });
          } else if (oldStatus === 'OUTSIDE_GEOFENCE' && newStatus === 'INSIDE_GEOFENCE') {
            import('../audit/auditService').then(({ auditService }) => {
              auditService.recordAuditLog({ action: 'GEOFENCE_RETURNED', module: 'SECURITY', description: 'Employee returned to the geofenced area.' });
            });
            import('../attendance/breakService').then(({ breakService }) => {
              breakService.handleAutoBreakTransition(empId, 'END', geo.timestamp ? new Date(geo.timestamp).toISOString() : nowIso).catch(console.error);
            });
          }
        }

        // @ts-ignore
        await (supabase.from('employee_live_locations') as any).update({
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_meters: geo.accuracy,
          distance_from_office_meters: distance || null,
          location_status: newStatus,
          location_context: locContext,
          last_seen_at: nowIso,
          source: 'WEB'
        }).eq('id', existingLiveLoc.id);

        // Always write history record (the sender controls the interval)
        const { error: histErr } = await (supabase.from('employee_location_history') as any).insert({
          employee_id: empId,
          office_id: employeeData?.offices?.id || null,
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_meters: geo.accuracy,
          distance_from_office_meters: distance || null,
          location_status: newStatus,
          location_context: locContext,
          recorded_at: nowIso,
          source: 'WEB'
        });
        if (histErr) console.error('[HISTORY INSERT ERROR]', histErr);

        if ((oldStatus === 'INSIDE_GEOFENCE' && newStatus === 'OUTSIDE_GEOFENCE') || (oldStatus === 'OUTSIDE_GEOFENCE' && newStatus === 'INSIDE_GEOFENCE')) {
          const eventType = newStatus === 'INSIDE_GEOFENCE' ? 'ENTERED' : 'EXITED';
          // Insert into geofence_events
          const { data: eventData } = await (supabase.from('geofence_events') as any).insert({
            employee_id: empId,
            office_id: employeeData?.offices?.id || null,
            event_type: eventType,
            latitude: geo.latitude,
            longitude: geo.longitude,
            distance_from_office_meters: distance || null,
            geofence_radius_meters: radius,
            occurred_at: nowIso,
            source: 'WEB'
          }).select('id').single();

          if (eventData) {
            notificationService.notifyGeofenceEvent({
              event_type: eventType,
              employeeName: employeeData?.first_name || 'Employee',
              employeeCode: employeeData?.employee_code || 'Unknown',
              distance: distance || null,
              empId: empId,
              eventId: eventData.id
            });
          }
          // Also insert into location_history
          await (supabase.from('employee_location_history') as any).insert({
             employee_id: empId,
             office_id: employeeData?.offices?.id || null,
             latitude: geo.latitude,
             longitude: geo.longitude,
             accuracy_meters: geo.accuracy,
             distance_from_office_meters: distance || null,
             location_status: newStatus,
             location_context: locContext,
             recorded_at: nowIso,
             source: 'WEB'
          });
        }
      } else {
        // @ts-ignore
        await (supabase.from('employee_live_locations') as any).insert({
          employee_id: empId,
          office_id: employeeData?.offices?.id || null,
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_meters: geo.accuracy,
          distance_from_office_meters: distance || null,
          location_status: result === 'WFH' ? 'WFH' : (result === 'OUTSIDE' ? 'OUTSIDE_GEOFENCE' : 'INSIDE_GEOFENCE'),
          location_context: locContext,
          is_tracking: false,
          last_seen_at: nowIso,
          source: 'WEB'
        });

        // Insert initial history
        await (supabase.from('employee_location_history') as any).insert({
          employee_id: empId,
          office_id: employeeData?.offices?.id || null,
          latitude: geo.latitude,
          longitude: geo.longitude,
          accuracy_meters: geo.accuracy,
          distance_from_office_meters: distance || null,
          location_status: result === 'WFH' ? 'WFH' : (result === 'OUTSIDE' ? 'OUTSIDE_GEOFENCE' : 'INSIDE_GEOFENCE'),
          location_context: locContext,
          recorded_at: nowIso,
          source: 'WEB'
        });

        // Geofence event
        if (result === 'INSIDE') {
          const { data: eventData } = await (supabase.from('geofence_events') as any).insert({
            employee_id: empId,
            office_id: employeeData?.offices?.id || null,
            event_type: 'ENTERED',
            latitude: geo.latitude,
            longitude: geo.longitude,
            distance_from_office_meters: distance || null,
            geofence_radius_meters: radius,
            occurred_at: nowIso,
            source: 'WEB'
          }).select('id').single();

          if (eventData) {
            notificationService.notifyGeofenceEvent({
              event_type: 'ENTERED',
              employeeName: employeeData?.first_name || 'Employee',
              employeeCode: employeeData?.employee_code || 'Unknown',
              distance: distance || null,
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
