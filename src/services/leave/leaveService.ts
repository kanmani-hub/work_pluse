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
      .single() as any;

    return { data, error };
  },

  async cancelLeaveRequest(id: string) {
    const empId = await this.getCurrentEmployeeId();
    if (!empId) return { error: new Error('Unauthorized') };

    const { data: existingData } = await supabase
      .from('leave_requests')
      .select('id, status, employee_id')
      .eq('id', id)
      .single() as any;

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

  async getAllLeaveBalances() {
    const { data, error } = await supabase
      .from('leave_balances')
      .select('*, employees!inner(first_name, last_name, employee_code, departments(name)), leave_types!inner(name, code)')
      .eq('year', new Date().getFullYear());
    return { data, error };
  },


  async reviewLeaveRequest(id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED', remarks?: string) {
    const adminId = await this.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    const { error } = await (supabase.from('leave_requests') as any)
      .update({
        status,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        reviewer_remarks: remarks || null
      })
      .eq('id', id);

    if (error) return { error };

    // --- AUDIT LOG ---
    import('../audit/auditService').then(({ auditService }) => {
      auditService.recordAuditLog({
        action: status,
        module: 'Leave',
        entity_type: 'leave_requests',
        entity_id: id,
        description: `Leave request ${status.toLowerCase()}`,
        metadata: { remarks }
      });
    });

    if (status === 'APPROVED') {
       // --- SANDWICH LEAVE CALCULATION ---
       // This triggers on approval of any leave to evaluate potential sandwich scenarios around the newly approved leave dates.
       try {
           const { globalSettingsService } = await import('../settings/globalSettingsService');
           const settings = await globalSettingsService.loadSettings();
           const appSettings = settings.app;

           if (appSettings?.enableSandwichLeave) {
               // Get the leave request details to find employee and dates
               const { data: currentLeave } = await supabase.from('leave_requests').select('*').eq('id', id).single() as any;
               
               if (currentLeave) {
                   const curLeaveAny = currentLeave as any;
                   const empId = (currentLeave as any).employee_id;
                   
                   // Helper to format Date as YYYY-MM-DD
                   const fmt = (d: Date) => {
                       const tzOffset = (d.getTimezoneOffset() * 60000);
                       return new Date(d.getTime() - tzOffset).toISOString().split('T')[0];
                   };
                   
                   // Fetch all APPROVED leaves for this employee within a window (e.g. -14 to +14 days)
                   const startWin = new Date((currentLeave as any).start_date);
                   startWin.setDate(startWin.getDate() - 14);
                   const endWin = new Date((currentLeave as any).end_date);
                   endWin.setDate(endWin.getDate() + 14);

                   const { data: approvedLeaves } = await supabase
                       .from('leave_requests')
                       .select('*')
                       .eq('employee_id', empId)
                       .eq('status', 'APPROVED')
                       .gte('start_date', fmt(startWin))
                       .lte('end_date', fmt(endWin));
                       
                   if (approvedLeaves) {
                       // Find weekly offs based on global settings
                       const weeklyOffDays = appSettings.weeklyOff || ['Saturday', 'Sunday'];
                       
                       // A set of all dates that are approved leaves
                       const leaveDates = new Set<string>();
                       approvedLeaves.forEach((l: any) => {
                           let cur = new Date(l.start_date);
                           let end = new Date(l.end_date);
                           while(cur <= end) {
                               leaveDates.add(fmt(cur));
                               cur.setDate(cur.getDate() + 1);
                           }
                       });

                       // Check dates around the current leave
                       // We check 3 days before start and 3 days after end to find non-working days sandwiched by leaves
                       let checkDates = [];
                       for(let i=1; i<=5; i++) {
                           let before = new Date((currentLeave as any).start_date);
                           before.setDate(before.getDate() - i);
                           checkDates.push(before);
                           
                           let after = new Date((currentLeave as any).end_date);
                           after.setDate(after.getDate() + i);
                           checkDates.push(after);
                       }
                       
                       for (let d of checkDates) {
                           const dStr = fmt(d);
                           const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
                           
                           // If it's a weekly off (non-working day)
                           if (weeklyOffDays.includes(dayName) && !leaveDates.has(dStr)) {
                               // Is it sandwiched?
                               // Handle multiple contiguous weekly offs (e.g. Sat + Sun).
                               
                               // Check previous days until we hit a working day
                               let prev = new Date(d);
                               prev.setDate(prev.getDate() - 1);
                               while(weeklyOffDays.includes(prev.toLocaleDateString('en-US', { weekday: 'long' }))) {
                                   prev.setDate(prev.getDate() - 1);
                               }
                               const prevWorkingStr = fmt(prev);

                               // Check next days until we hit a working day
                               let next = new Date(d);
                               next.setDate(next.getDate() + 1);
                               while(weeklyOffDays.includes(next.toLocaleDateString('en-US', { weekday: 'long' }))) {
                                   next.setDate(next.getDate() + 1);
                               }
                               const nextWorkingStr = fmt(next);
                               
                               if (leaveDates.has(prevWorkingStr) && leaveDates.has(nextWorkingStr)) {
                                   // Sandwiched!
                                   // Insert/Update attendance as SANDWICH LOP
                                   
                                   const { data: existingAtt } = await supabase
                                       .from('attendance')
                                       .select('id')
                                       .eq('employee_id', empId)
                                       .eq('attendance_date', dStr)
                                       .maybeSingle() as any;
                                       
                                   if (existingAtt) {
                                       await (supabase.from('attendance') as any).update({
                                           status: 'SANDWICH LOP',
                                           notes: 'Leave before and after weekly off.'
                                       }).eq('id', existingAtt.id);
                                   } else {
                                       await supabase.from('attendance').insert({
                                           employee_id: empId,
                                           attendance_date: dStr,
                                           status: 'SANDWICH LOP',
                                           notes: 'Leave before and after weekly off.',
                                           absence_minutes: 480 // 8 hours LOP
                                       } as any);
                                   }
                               }
                           }
                       }
                   }
               }
           }
       } catch (e) {
           console.error('Sandwich calculation failed:', e);
       }
    }

    return { error };
  }

};
