import { supabase } from '../../lib/supabase';

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

    const { error } = await (supabase.from('permission_requests') as any)
      .update({
        status,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        reviewer_remarks: remarks || null
      })
      .eq('id', id);

    return { error };
  }
};
