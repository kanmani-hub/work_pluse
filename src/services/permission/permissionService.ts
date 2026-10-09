import { supabase } from '../../lib/supabase';
import { auditService } from '../audit/auditService';
import { notificationService } from '../notifications/notificationService';
import { permissionReviewed } from '../notifications/notificationRules';

export interface PermissionRequestInput {
  permission_date: string; // YYYY-MM-DD
  start_time: string;      // HH:MM
  end_time: string;        // HH:MM
  reason: string;
}

export const permissionService = {
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

  calculateDurationMinutes(startTime: string, endTime: string): number {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;
    return Math.max(0, endTotal - startTotal);
  },

  async getMyPermissionRequests() {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('permission_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('requested_at', { ascending: false });

    return { data, error };
  },

  async createPermissionRequest(input: PermissionRequestInput) {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const duration_minutes = this.calculateDurationMinutes(input.start_time, input.end_time);
    if (duration_minutes <= 0) {
      return { data: null, error: new Error('End time must be after start time') };
    }

    const { data, error } = await supabase
      .from('permission_requests')
      .insert({
        employee_id: empId,
        permission_date: input.permission_date,
        start_time: input.start_time,
        end_time: input.end_time,
        duration_minutes,
        reason: input.reason,
        status: 'PENDING'
      } as any)
      .select()
      .single();

    if (!(error) && data) {
      auditService.recordAuditLog({
        action: 'PERMISSION_REQUEST_CREATED',
        module: 'PERMISSION',
        entity_type: 'permission_requests',
        entity_id: (data as any).id,
        description: `Permission request submitted for ${input.permission_date} (${input.start_time}–${input.end_time}, ${duration_minutes} min).`,
        new_values: { permission_date: input.permission_date, start_time: input.start_time, end_time: input.end_time, duration_minutes }
      }).catch(e => console.error('[AUDIT] PERMISSION_REQUEST_CREATED failed:', e));

      notificationService.notifyAdmins({
        notification_type: 'PERMISSION',
        title: 'New Permission Request',
        message: `An employee submitted a permission request for ${input.permission_date} (${input.start_time}–${input.end_time}).`,
        priority: 'NORMAL',
        action_url: '/admin/permission',
        entity_type: 'permission_requests',
        entity_id: (data as any).id
      }).catch(e => console.error('[NOTIFY] Admin permission notification failed:', e));
    }

    return { data, error };
  },

  async cancelPermissionRequest(id: string) {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { error: new Error('Unauthorized') };

    const { data: existingData } = await supabase
      .from('permission_requests')
      .select('id, status, employee_id')
      .eq('id', id)
      .single();

    const existing = existingData as any;
    if (!existing || existing.employee_id !== empId) {
      return { error: new Error('Request not found or unauthorized') };
    }
    if (existing.status !== 'PENDING') {
      return { error: new Error('Only PENDING requests can be cancelled') };
    }

    const { error } = await (supabase.from('permission_requests') as any)
      .update({ status: 'CANCELLED' })
      .eq('id', id);

    return { error };
  },

  async getPermissionRequests() {
    const { data, error } = await supabase
      .from('permission_requests')
      .select('*, employees!permission_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name))')
      .order('requested_at', { ascending: false });

    return { data, error };
  },

  async reviewPermissionRequest(id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED', remarks?: string) {
    const adminId = await this.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    // Fetch before update for notification
    const { data: req } = await supabase
      .from('permission_requests')
      .select('employee_id, permission_date, start_time, end_time')
      .eq('id', id)
      .single() as any;

    // Only a real status change counts (double click / second tab: nothing changes, no repeat notification)
    const { data: changedRows, error } = await (supabase.from('permission_requests') as any)
      .update({
        status,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        reviewer_remarks: remarks || null
      })
      .eq('id', id)
      .neq('status', status)
      .select('id');

    if (!error && (!changedRows || changedRows.length === 0)) return { error: null };

    if (!error) {
      auditService.recordAuditLog({
        action: status === 'APPROVED' ? 'PERMISSION_APPROVED' : status === 'REJECTED' ? 'PERMISSION_REJECTED' : 'PERMISSION_CANCELLED',
        module: 'PERMISSION',
        entity_type: 'permission_requests',
        entity_id: id,
        description: `Permission request ${status.toLowerCase()} by admin.`,
        metadata: { remarks }
      }).catch(e => console.error('[AUDIT] Permission review audit failed:', e));

      if (req) {
        await notificationService.notifyEmployee(req.employee_id, permissionReviewed({
          id, status, date: req.permission_date, start: req.start_time, end: req.end_time, remarks,
        }));
      }
    }

    return { error };
  }
};
