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
  }
};
