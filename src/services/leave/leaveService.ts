import { supabase } from '../../lib/supabase';

export interface LeaveRequestInput {
  leave_type_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  is_half_day: boolean;
  half_day_type?: 'FIRST_HALF' | 'SECOND_HALF';
  reason: string;
}

export const leaveService = {
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

  calculateTotalDays(startDate: string, endDate: string, isHalfDay: boolean): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) return 0;
    
    // Simplistic diff. Note: Pending business rules for holidays, weekends, etc.
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    if (isHalfDay && diffDays === 1) {
      return 0.5;
    }
    return diffDays;
  },

  async getLeaveTypes() {
    const { data, error } = await supabase
      .from('leave_types')
      .select('*')
      .eq('is_active', true);
    return { data, error };
  },

  async getMyLeaveBalances() {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('leave_balances')
      .select('*, leave_types(name, code)')
      .eq('employee_id', empId)
      .eq('year', new Date().getFullYear());

    return { data, error };
  },

  async getMyLeaveRequests() {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('leave_requests')
      .select('*, leave_types(name)')
      .eq('employee_id', empId)
      .order('requested_at', { ascending: false });

    return { data, error };
  },

  async createLeaveRequest(input: LeaveRequestInput) {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const total_days = this.calculateTotalDays(input.start_date, input.end_date, input.is_half_day);
    if (total_days <= 0) {
      return { data: null, error: new Error('Invalid date range') };
    }

    if (input.is_half_day && !input.half_day_type) {
      return { data: null, error: new Error('Half day type required for half day requests') };
    }

    // Overlapping check
    const { data: overlaps } = await supabase
      .from('leave_requests')
      .select('id')
      .eq('employee_id', empId)
      .in('status', ['PENDING', 'APPROVED'])
      .lte('start_date', input.end_date)
      .gte('end_date', input.start_date);

    if (overlaps && overlaps.length > 0) {
      return { data: null, error: new Error('An overlapping active leave request already exists.') };
    }

    // NOTE: Leave balance pending_days update is NOT performed here via client update
    // as it is unsafe and prone to inconsistency without atomic server-side RPC/transactions.
    // Documented as pending business rule/backend trigger requirement.

    const { data, error } = await supabase
      .from('leave_requests')
      .insert({
        employee_id: empId,
        leave_type_id: input.leave_type_id,
        start_date: input.start_date,
        end_date: input.end_date,
        total_days,
        is_half_day: input.is_half_day,
        half_day_type: input.is_half_day ? input.half_day_type : null,
        reason: input.reason,
        status: 'PENDING'
      } as any)
      .select()
      .single();

    return { data, error };
  },

  async cancelLeaveRequest(id: string) {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { error: new Error('Unauthorized') };

    const { data: existingData } = await supabase
      .from('leave_requests')
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

    const { error } = await (supabase.from('leave_requests') as any)
      .update({ status: 'CANCELLED' })
      .eq('id', id);

    return { error };
  },

  async getLeaveRequests() {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*, employees!leave_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name)), leave_types(name)')
      .order('requested_at', { ascending: false });

    return { data, error };
  },

  async reviewLeaveRequest(id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED', remarks?: string) {
    const adminId = await this.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    // NOTE: Leave balance adjustments (used_days, pending_days, remaining_days)
    // must be performed atomically via DB triggers/RPC, not via multiple client queries.
    // Documented as pending business rule/backend trigger requirement.

    const { error } = await (supabase.from('leave_requests') as any)
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
