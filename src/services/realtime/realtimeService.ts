import { supabase } from '../../lib/supabase';

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
  subscribeToLiveLocations(callback: (payload: any) => void) {
    return supabase
      .channel('admin:live_locations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_live_locations' }, callback)
      .subscribe();
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
   * Employee: Subscribe to their own breaks
   */
  subscribeToMyBreaks(employeeId: string, callback: (payload: any) => void) {
    if (!employeeId) return null;
    return supabase
      .channel(`breaks:emp_${employeeId}`)
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
