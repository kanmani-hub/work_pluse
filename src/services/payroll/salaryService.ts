import { supabase } from '../../lib/supabase';

export interface SalaryStructure {
  id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  basic_salary: number;
  hra: number;
  transport_allowance: number;
  medical_allowance: number;
  special_allowance: number;
  other_allowances: number;
  standard_deduction: number;
  overtime_rate_per_hour: number;
  currency: string;
  is_active: boolean;
}

export const salaryService = {
  /**
   * Securely get current employee ID
   */
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

  /**
   * Get the active salary structure for an employee
   */
  async getEmployeeSalaryStructure(employeeId: string) {
    const { data, error } = await supabase
      .from('salary_structures')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    return { data, error };
  },

  /**
   * Get the correct salary structure applicable to a payroll period
   */
  async getSalaryStructureForPeriod(employeeId: string, periodStart: string, periodEnd: string) {
    // We want a salary structure where effective_from <= periodEnd
    // and (effective_to is null or effective_to >= periodStart)
    const { data, error } = await supabase
      .from('salary_structures')
      .select('*')
      .eq('employee_id', employeeId)
      .lte('effective_from', periodEnd)
      .or(`effective_to.is.null,effective_to.gte.${periodStart}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .single();

    return { data, error };
  },

  /**
   * Admin: Update employee salary structure and optionally recalculate current payroll
   */
  async updateSalaryStructure(employeeId: string, newStructure: Partial<SalaryStructure>) {
    const adminId = await this.getCurrentEmployeeId();
    if (!adminId) return { error: new Error('Unauthorized') };

    // Get current structure to preserve values not provided
    const { data: currentStructure } = await this.getEmployeeSalaryStructure(employeeId);

    // Mark current active as inactive
    await supabase
      .from('salary_structures')
      .update({ is_active: false, effective_to: new Date().toISOString() } as never)
      .eq('employee_id', employeeId)
      .eq('is_active', true);

    // Insert new structure, merging with current to preserve existing allowances/deductions
    const payload = {
      ...(currentStructure || {}),
      ...newStructure,
      employee_id: employeeId,
      effective_from: newStructure.effective_from || new Date().toISOString(),
      effective_to: null,
      is_active: true
    };
    // Ensure we don't try to insert the old ID or timestamps
    delete payload.id;
    delete (payload as any).created_at;
    delete (payload as any).updated_at;
    
    // Default values if STILL missing
    if (payload.basic_salary === undefined) payload.basic_salary = 0;
    if (payload.hra === undefined) payload.hra = 0;
    if (payload.transport_allowance === undefined) payload.transport_allowance = 0;
    if (payload.medical_allowance === undefined) payload.medical_allowance = 0;
    if (payload.special_allowance === undefined) payload.special_allowance = 0;
    if (payload.other_allowances === undefined) payload.other_allowances = 0;
    if (payload.standard_deduction === undefined) payload.standard_deduction = 0;

    const { data, error } = await supabase
      .from('salary_structures')
      .insert(payload as never)
      .select()
      .single();

    return { data, error };
  }
};
