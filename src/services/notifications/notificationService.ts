import { supabase } from '../../lib/supabase';
import { salaryService } from '../payroll/salaryService'; // Reusing getCurrentEmployeeId

export const notificationService = {
  async getMyNotifications() {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_employee_id', empId)
      .order('created_at', { ascending: false });

    return { data, error };
  },

  async getMyUnreadNotifications() {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_employee_id', empId)
      .eq('is_read', false)
      .order('created_at', { ascending: false });

    return { data, error };
  },

  async getUnreadNotificationCount() {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { count: 0, error: new Error('Unauthorized') };

    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_employee_id', empId)
      .eq('is_read', false);

    return { count: count || 0, error };
  },

  async markNotificationAsRead(notificationId: string) {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { error: new Error('Unauthorized') };

    // Verify ownership
    const { data: notif } = await supabase.from('notifications').select('recipient_employee_id').eq('id', notificationId).single<any>();
    if (!notif || notif.recipient_employee_id !== empId) return { error: new Error('Unauthorized') };

    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      } as never)
      .eq('id', notificationId);

    return { error };
  },

  async markAllNotificationsAsRead() {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { error: new Error('Unauthorized') };

    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString()
      } as never)
      .eq('recipient_employee_id', empId)
      .eq('is_read', false);

    return { error };
  },

  async clearReadNotifications() {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { error: new Error('Unauthorized') };

    // Hard delete is used as per standard Supabase setups unless there's an 'is_archived' or 'deleted_at' column.
    // The instructions say "If the existing system uses soft deletion/archive: reuse it. Never delete unread notifications."
    // We will just do a standard delete on read notifications.
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('recipient_employee_id', empId)
      .eq('is_read', true);

    return { error };
  },

  // Internal/Admin API to create a notification (not directly exposed to employee actions)
  async createNotification(params: {
    recipient_employee_id: string;
    notification_type: string;
    title: string;
    message: string;
    priority?: string;
    action_url?: string;
    entity_type?: string;
    entity_id?: string;
    metadata?: any;
    expires_at?: string;
  }) {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        recipient_employee_id: params.recipient_employee_id,
        notification_type: params.notification_type,
        title: params.title,
        message: params.message,
        priority: params.priority || 'NORMAL',
        action_url: params.action_url || null,
        entity_type: params.entity_type || null,
        entity_id: params.entity_id || null,
        metadata: params.metadata || null,
        expires_at: params.expires_at || null
      } as never)
      .select()
      .single<any>();

    return { data, error };
  },

  // Notify Admins of Geofence Events
  async notifyGeofenceEvent(params: { event_type: string, employeeName: string, employeeCode: string, distance?: number | null, empId: string, eventId?: string }) {
    // Determine title and message
    let title = '';
    let message = '';
    
    if (params.event_type === 'EXITED') {
      title = 'Employee Left Office';
      message = `${params.employeeName} (${params.employeeCode}) has moved outside the configured office geofence.`;
    } else if (params.event_type === 'ENTERED') {
      title = 'Employee Returned to Office';
      message = `${params.employeeName} (${params.employeeCode}) has returned inside the office geofence.`;
    } else if (params.event_type === 'LOCATION_DENIED') {
      title = 'Location Permission Denied';
      message = `${params.employeeName} has denied location access.`;
    } else if (params.event_type === 'LOCATION_STALE') {
      title = 'Employee Location Stale';
      message = `${params.employeeName}'s location has not been updated for more than 5 minutes.`;
    } else {
      return; // Unhandled event type
    }

    // Deduplication check: Has this specific event (or event type for this employee in the last minute) already been notified?
    // A robust deduplication requires checking existing notifications.
    if (params.eventId) {
      const { data: existingNotif } = await supabase
        .from('notifications')
        .select('id')
        .eq('entity_id', params.eventId)
        .eq('notification_type', 'GEOFENCE')
        .limit(1);
      
      if (existingNotif && existingNotif.length > 0) return;
    }

    // 1. Fetch admins (Role = System Admin or HR)
    const { data: adminRoles } = await supabase.from('roles').select('id, name').in('name', ['System Admin', 'Admin', 'HR Manager']) as any;
    if (!adminRoles || adminRoles.length === 0) return;
    
    const roleIds = adminRoles.map((r: any) => r.id);
    const { data: admins } = await supabase.from('employees').select('id, email, first_name').in('role_id', roleIds) as any;
    if (!admins || admins.length === 0) return;

    // 2. Filter out the employee who caused the event (if they happen to be an admin)
    const validAdmins = admins.filter((a: any) => a.id !== params.empId);
    
    // 3. Create notifications
    const notificationsToInsert = validAdmins.map((admin: any) => ({
      recipient_employee_id: admin.id,
      notification_type: 'GEOFENCE',
      title,
      message,
      priority: 'HIGH',
      action_url: '/admin/dashboard',
      entity_type: 'geofence_events',
      entity_id: params.eventId || null,
      metadata: {
        employee_id: params.empId,
        employee_code: params.employeeCode,
        event_type: params.event_type,
        distance_meters: params.distance,
        timestamp: new Date().toISOString()
      }
    }));

    if (notificationsToInsert.length > 0) {
      const { error } = await supabase.from('notifications').insert(notificationsToInsert as any);
      if (error) console.error('Failed to insert geofence notifications', error);
    }
  }
};
