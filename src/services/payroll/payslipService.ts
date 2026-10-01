import { supabase } from '../../lib/supabase';
import { salaryService } from './salaryService';

export const payslipService = {
  /**
   * Employee: Get their own payslips
   */
  async getMyPayslips() {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('payslips')
      .select('*, payroll!inner(payroll_year, payroll_month, net_salary)')
      .eq('employee_id', empId)
      .order('generated_at', { ascending: false });

    return { data: data as any[], error };
  },

  /**
   * Employee: Get specific payslip
   */
  async getMyPayslipById(id: string) {
    const empId = await salaryService.getCurrentEmployeeId();
    if (!empId) return { data: null, error: new Error('Unauthorized') };

    const { data, error } = await supabase
      .from('payslips')
      .select('*, payroll(*, payroll_items(*))')
      .eq('id', id)
      .eq('employee_id', empId)
      .single<any>();

    return { data, error };
  },

  /**
   * Admin: Get all payslips
   */
  async getPayslips() {
    const { data, error } = await supabase
      .from('payslips')
      .select('*, employees!payslips_employee_id_fkey(first_name, last_name, employee_code), payroll(payroll_year, payroll_month, net_salary)')
      .order('generated_at', { ascending: false });

    return { data: data as any[], error };
  },

  /**
   * Admin: Get payslip by payroll ID
   */
  async getAdminPayslipByPayrollId(payrollId: string) {
    const { data, error } = await supabase
      .from('payslips')
      .select('*, payroll(*, payroll_items(*))')
      .eq('payroll_id', payrollId)
      .single<any>();

    return { data, error };
  },

  /**
   * Admin: Generate payslip for a locked/paid payroll
   * PDF GENERATION PENDING: Supabase Storage and PDF rendering are not yet implemented.
   * This simply creates the DB record.
   */
  async generatePayslip(payrollId: string, employeeId: string, periodStr: string) {
    const adminId = await salaryService.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    // Check if payroll is in PAID or CLOSED status
    const { data: payroll } = await supabase
      .from('payroll')
      .select('status')
      .eq('id', payrollId)
      .single<any>();

    if (!payroll || (payroll.status !== 'PAID' && payroll.status !== 'CLOSED')) {
      return { error: new Error('Payslip can only be generated for PAID or CLOSED payrolls.') };
    }

    // Basic unique identifier
    const payslipNumber = `PS-${Date.now()}-${employeeId.slice(0, 4)}`;

    const { data, error } = await supabase
      .from('payslips')
      .insert({
        payroll_id: payrollId,
        employee_id: employeeId,
        payslip_number: payslipNumber,
        payslip_period: periodStr,
        file_url: null, // PENDING implementation
        generated_at: new Date().toISOString(),
        generated_by: adminId
      } as any)
      .select()
      .single();

    return { data, error };
  }
};
