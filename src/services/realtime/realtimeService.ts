import { supabase } from '../../lib/supabase';

/** Makes each employee-breaks subscription a distinct channel (see subscribeToMyBreaks). */
let myBreaksChannelSeq = 0;

export const realtimeService = {
  /**
   * Subscribe to notifications for the current user
   */
  subscribeToNotifications(
    employeeId: string, 
    callback: (payload: any) => void,
    /** Distinct per subscriber (e.g. 'header', 'page') so two views never share/replace one channel */
    key: string = 'header',
    /** Called on every (re)subscribe, e.g. to fetch notifications missed while disconnected */
    onSubscribed?: () => void
  ) {
    if (!employeeId) return null;
    
    // Server-side filter: only this employee's rows are streamed (RLS applies as well)
    return supabase
      .channel(`notifications:emp_${employeeId}:${key}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_employee_id=eq.${employeeId}`
        },
        (payload) => callback(payload)
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_employee_id=eq.${employeeId}`
        },
        (payload) => callback(payload)
      )
      .subscribe((status: string, err?: any) => {
        if (import.meta.env?.DEV) console.info(`[Realtime] notifications:${key} for ${employeeId} → ${status}`, err?.message ?? '');
        if (status === 'SUBSCRIBED') onSubscribed?.();
      });
  },

  /**
   * Admin: Subscribe to all wfh_requests changes
   */
  subscribeToAdminWFH(callback: (payload: any) => void) {
    return supabase
      .channel('admin:wfh')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wfh_requests' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to all leave_requests changes
   */
  subscribeToAdminLeave(callback: (payload: any) => void) {
    return supabase
      .channel('admin:leave')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to all permission_requests changes
   */
  subscribeToAdminPermission(callback: (payload: any) => void) {
    return supabase
      .channel('admin:permission')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'permission_requests' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to attendance changes
   */
  subscribeToAdminAttendance(callback: (payload: any) => void) {
    return supabase
      .channel('admin:attendance')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to live locations
   */
  subscribeToLiveLocations(callback: (payload: any) => void, onStatus?: (status: string) => void) {
    return supabase
      .channel('admin:live_locations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_live_locations' }, callback)
      // SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED — lets the page show when live updates stop
      .subscribe((status: string) => onStatus?.(status));
  },

  /**
   * Admin: Subscribe to location history
   */
  subscribeToLocationHistory(callback: (payload: any) => void) {
    return supabase
      .channel('admin:location_history')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'employee_location_history' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to geofence events
   */
  subscribeToGeofenceEvents(callback: (payload: any) => void) {
    return supabase
      .channel('admin:geofence_events')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'geofence_events' }, callback)
      .subscribe();
  },

  /**
   * Employee: Subscribe to their own payroll changes
   */
  subscribeToMyPayroll(employeeId: string, callback: (payload: any) => void) {
    if (!employeeId) return null;
    return supabase
      .channel(`payroll:emp_${employeeId}`)
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'payroll', filter: `employee_id=eq.${employeeId}` },
        callback
      )
      .subscribe();
  },

  /**
   * Admin: Subscribe to all payroll changes
   */
  subscribeToAdminPayroll(callback: (payload: any) => void) {
    return supabase
      .channel('admin:payroll')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payroll' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to all attendance breaks
   */
  subscribeToAdminBreaks(callback: (payload: any) => void) {
    return supabase
      .channel('admin:breaks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_breaks' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to all overtime request changes
   */
  subscribeToAdminOvertime(callback: (payload: any) => void) {
    return supabase
      .channel('admin:overtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'overtime_requests' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to salary structure changes
   */
  subscribeToAdminSalary(callback: (payload: any) => void) {
    return supabase
      .channel('admin:salary_structures')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'salary_structures' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to roster/shift assignment changes
   */
  subscribeToAdminRoster(callback: (payload: any) => void) {
    return supabase
      .channel('admin:roster_assignments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roster_assignments' }, callback)
      .subscribe();
  },

  /**
   * Admin: Subscribe to all changes that impact attendance and payroll calculations:
   * payroll, attendance, breaks, overtime, salary, and roster shifts.
   */
  subscribeToPayrollImpactUpdates(callback: (payload: any) => void) {
    const channels = [
      this.subscribeToAdminPayroll(callback),
      this.subscribeToAdminAttendance(callback),
      this.subscribeToAdminBreaks(callback),
      this.subscribeToAdminOvertime(callback),
      this.subscribeToAdminSalary(callback),
      this.subscribeToAdminRoster(callback),
    ].filter(Boolean);

    return {
      unsubscribe: () => {
        channels.forEach(ch => this.unsubscribe(ch));
      }
    };
  },

  /**
   * Employee: Subscribe to their own breaks
   */
  subscribeToMyBreaks(employeeId: string, callback: (payload: any) => void) {
    if (!employeeId) return null;
    // supabase.channel(topic) returns the EXISTING channel when one with the same topic is still
    // registered (e.g. a previous subscriber's channel that is subscribed or still being removed —
    // removeChannel() is asynchronous). Adding .on('postgres_changes') to a channel that is already
    // joined/joining throws. Each call therefore gets its own topic; the listener is still
    // registered before subscribe() and the server-side employee filter is unchanged.
    return supabase
      .channel(`breaks:emp_${employeeId}:${++myBreaksChannelSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_breaks', filter: `employee_id=eq.${employeeId}` }, callback)
      .subscribe();
  },

  /**
   * Generic unsubscribe method
   */
  unsubscribe(channel: any) {
    if (channel) {
      supabase.removeChannel(channel);
    }
  }
};
