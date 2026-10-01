import { supabase } from '../../lib/supabase';
import { auditService } from '../audit/auditService';
import { notificationService } from '../notifications/notificationService';

export interface WFHRequestInput {
  employee_id: string;
  request_date: string; // YYYY-MM-DD
  reason: string;
}

export const wfhService = {
  /**
   * Employee: Get their own WFH requests
   */
  async getMyWFHRequests(empId: string) {
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('wfh_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('request_date', { ascending: false });

    return { data, error };
  },

  async createWFHRequest(input: WFHRequestInput) {
    const empId = input.employee_id;
    if (!empId) {
      return { data: null, error: new Error('Unauthorized') };
    }

    // Basic duplicate check (the DB also has a unique constraint)
    const { data: existing } = await supabase
      .from('wfh_requests')
      .select('id')
      .eq('employee_id', empId)
      .eq('request_date', input.request_date)
      .maybeSingle();

    if (existing) {
      return { data: null, error: new Error('A WFH request already exists for this date.') };
    }

    const { data, error } = await supabase
      .from('wfh_requests')
      .insert({
        employee_id: empId,
        request_date: input.request_date,
        reason: input.reason,
        status: 'PENDING'
      } as any)
      .select()
      .single<any>();

    if (error) {
       return { data: null, error };
    }

    if (!error && data) {
      await auditService.recordAuditLog({
        action: 'CREATE_WFH',
        module: 'WFH',
        entity_type: 'wfh_requests',
        entity_id: data.id,
        description: `Employee requested WFH for ${input.request_date}`
      });
    }

    return { data, error };
  },

  /**
   * Employee: Cancel a PENDING WFH request
   */
  async cancelWFHRequest(id: string, empId: string) {
    if (!empId) return { error: new Error('Unauthorized') };

    // Verify ownership and PENDING status
    const { data: existingData } = await supabase
      .from('wfh_requests')
      .select('id, status, employee_id')
      .eq('id', id)
      .single();

    const existing = existingData as any;
    if (!existing || existing.employee_id !== empId) {
      return { error: new Error('Request not found or unauthorized') };
    }
    if (existing.status !== 'PENDING') {
      return { error: new Error('Only PENDING requests can be cancelled by the employee') };
    }

    const { error } = await (supabase.from('wfh_requests') as any)
      .update({ status: 'CANCELLED' })
      .eq('id', id);

    if (!error) {
      await auditService.recordAuditLog({
        action: 'CANCEL_WFH',
        module: 'WFH',
        entity_type: 'wfh_requests',
        entity_id: id,
        description: `Employee cancelled their WFH request for ${existing.request_date || id}`,
        old_values: { status: 'PENDING' },
        new_values: { status: 'CANCELLED' }
      });
    }

    return { error };
  },

  /**
   * Admin/HR: Get all WFH requests
   */
  async getWFHRequests() {
    // Relying on RLS / role checks if configured, else just fetches all
    const { data: sessionData } = await supabase.auth.getSession();
    console.log('[ADMIN WFH DEBUG] authenticated user:', sessionData.session?.user?.id);
    console.log('[ADMIN WFH DEBUG] query starting');

    const { data, error } = await supabase
      .from('wfh_requests')
      .select('*, employees!wfh_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name))')
      .order('requested_at', { ascending: false });

    console.log('[ADMIN WFH DEBUG] query result data:', data);
    console.log('[ADMIN WFH DEBUG] query error:', error);
    if (data) {
      console.log('[ADMIN WFH DEBUG] rows returned:', data.length);
    }

    return { data, error };
  },

  /**
   * Admin/HR: Approve or Reject a WFH request
   */
  async reviewWFHRequest(id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED', adminId: string, remarks?: string) {
    if (!adminId) return { error: new Error('Unauthorized') };

    const { data: request } = await supabase.from('wfh_requests').select('*, employees!wfh_requests_employee_id_fkey(first_name, last_name)').eq('id', id).single() as any;

    const { error } = await (supabase.from('wfh_requests') as any)
      .update({
        status,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        reviewer_remarks: remarks || null
      })
      .eq('id', id);

    if (!error && request) {
      await auditService.recordAuditLog({
        action: `${status}_WFH`,
        module: 'WFH',
        entity_type: 'wfh_requests',
        entity_id: id,
        description: `Admin ${status.toLowerCase()} WFH request for ${request.employees?.first_name || 'Employee'} on ${request.request_date}`,
        old_values: { status: request.status },
        new_values: { status }
      });

      if (status === 'APPROVED' || status === 'REJECTED') {
        await notificationService.createNotification({
          recipient_employee_id: request.employee_id,
          notification_type: 'WFH',
          title: `WFH Request ${status.charAt(0) + status.slice(1).toLowerCase()}`,
          message: `Your WFH request for ${request.request_date} has been ${status.toLowerCase()}.${remarks ? ' Remarks: ' + remarks : ''}`,
          action_url: '/employee/wfh'
        });
      }
    }

    return { error };
  }
};
