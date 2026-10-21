import { supabase } from '../../lib/supabase';
import { salaryService } from '../payroll/salaryService'; // Reusing getCurrentEmployeeId

export const auditService = {
  async getAuditLogs() {
    const { data, error } = await supabase
      .from('audit_logs')
      // Actor's role comes from employees.role_id → roles.name (audit_logs has no role column)
      .select('*, employees(id, first_name, last_name, employee_code, role:role_id(name))')
      .order('created_at', { ascending: false });

    return { data, error };
  },

  /**
   * Fetches all audit records in paginated batches of pageSize.
   * Ensures complete datasets without hitting silent 1000-row PostgREST limits.
   * If any batch fails, returns error immediately rather than silent incomplete data.
   */
  async getAllAuditLogs(pageSize = 1000) {
    let allData: any[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*, employees(id, first_name, last_name, employee_code, role:role_id(name))')
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        return { data: null, error };
      }

      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        allData = allData.concat(data);
        if (data.length < pageSize) {
          hasMore = false;
        } else {
          from += pageSize;
        }
      }
    }

    return { data: allData, error: null };
  },

  async getAuditLogById(id: string) {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*, employees(id, first_name, last_name, employee_code)')
      .eq('id', id)
      .single<any>();

    return { data, error };
  },

  // Internal function to create audit log
  async recordAuditLog(params: {
    action: string;
    module: string;
    entity_type?: string;
    entity_id?: string;
    description?: string;
    old_values?: any;
    new_values?: any;
    metadata?: any;
    source?: string;
  }) {
    // Attempt to resolve actor from session
    let actorId: string | null = null;
    try {
      actorId = await salaryService.getCurrentEmployeeId();
    } catch {
      actorId = null;
    }
    
    // IP and User agent typically collected server-side in RPC, but we do basic mock client-side if needed
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Server/Node';

    const { data, error } = await supabase
      .from('audit_logs')
      .insert({
        actor_employee_id: actorId || null,
        action: params.action,
        module: params.module,
        entity_type: params.entity_type || null,
        entity_id: params.entity_id || null,
        description: params.description || null,
        old_values: params.old_values || null,
        new_values: params.new_values || null,
        metadata: params.metadata || null,
        user_agent: userAgent,
        source: params.source || 'WEB'
      } as never)
      .select()
      .single<any>();

    return { data, error };
  }
};
