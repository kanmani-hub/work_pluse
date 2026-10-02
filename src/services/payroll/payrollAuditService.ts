import { supabase } from '../../lib/supabase';
import { salaryService } from './salaryService'; // to get current employee id

export interface PayrollAuditOptions {
  payrollId: string;
  action: 'PAYROLL_GENERATED' | 'PAYROLL_CALCULATED' | 'PAYROLL_RECALCULATED' | 'PAYROLL_SUBMITTED' | 'PAYROLL_APPROVED' | 'PAYROLL_REJECTED' | 'PAYROLL_PAID' | 'PAYROLL_LOCKED' | 'PAYROLL_UNLOCKED' | 'ADJUSTMENT_ADDED' | 'ADJUSTMENT_REMOVED' | 'DEDUCTION_ADDED' | 'DEDUCTION_UPDATED' | 'PAYMENT_UPDATED' | 'PAYMENT_CORRECTED';
  title: string;
  description: string;
  previousStatus?: string;
  newStatus?: string;
  amount?: number;
  metadata?: any;
  actorId?: string; // If system/scheduler, this might be null
  source?: 'SYSTEM' | 'WEB' | 'SCHEDULER';
}

export const payrollAuditService = {
  async logEvent(options: PayrollAuditOptions) {
    let actorId = options.actorId;
    if (!actorId && options.source !== 'SCHEDULER' && options.source !== 'SYSTEM') {
      actorId = await salaryService.getCurrentEmployeeId() || undefined;
    }

    const { error } = await supabase.from('audit_logs').insert({
      actor_employee_id: actorId,
      action: options.action,
      module: 'PAYROLL',
      entity_type: 'payroll',
      entity_id: options.payrollId,
      description: options.description,
      old_values: options.previousStatus ? { status: options.previousStatus } : null,
      new_values: options.newStatus ? { status: options.newStatus } : null,
      metadata: {
        title: options.title,
        amount: options.amount,
        ...options.metadata
      },
      source: options.source || 'WEB'
    } as any);

    if (error) {
      console.error('Failed to log payroll audit event:', error);
    }
  },

  async getTimeline(payrollId: string) {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*, actor:actor_employee_id(first_name, last_name)')
      .eq('module', 'PAYROLL')
      .eq('entity_type', 'payroll')
      .eq('entity_id', payrollId)
      .order('created_at', { ascending: false }) as any;
      
    if (error) return [];
    return data;
  }
};
