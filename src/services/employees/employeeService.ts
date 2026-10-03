import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';

export type EmployeeRow = Database['public']['Tables']['employees']['Row'];
export type EmployeeInsert = Database['public']['Tables']['employees']['Insert'];
export type EmployeeUpdate = Database['public']['Tables']['employees']['Update'];

export interface EmployeeWithRelations extends EmployeeRow {
  department: { name: string } | null;
  office: { name: string } | null;
  role: { name: string } | null;
  shift_assignments?: any[];
  salary_structures?: any[];
}

export const employeeService = {
  /**
   * Get all employees with their related department, office, and role.
   */
  async getEmployees(): Promise<{ data: EmployeeWithRelations[] | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select(`
          *,
          department:department_id (name),
          office:office_id (name),
          role:role_id (name),
          shift_assignments!shift_assignments_employee_id_fkey(effective_date, shift_templates(name, start_time, end_time)),
          salary_structures(id, is_active, basic_salary)
        `)
        .order('first_name', { ascending: true });

      if (error) {
        console.error('Error fetching employees:', error.message);
        return { data: null, error: new Error('Failed to load employees') };
      }

      const filtered = data ? data.filter((e: any) => e.email !== 'admin@gmail.com' && e.role?.name !== 'System Admin') : [];
      
      // Supabase's generated types don't inherently know the joined structure well, 
      // but at runtime, this maps perfectly to EmployeeWithRelations.
      return { data: filtered as unknown as EmployeeWithRelations[], error: null };
    } catch (err) {
      console.error('Unexpected error fetching employees:', err);
      return { data: null, error: new Error('Unexpected network error') };
    }
  },

  /**
   * Get a single employee by ID.
   */
  async getEmployeeById(id: string): Promise<{ data: EmployeeWithRelations | null; error: Error | null }> {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select(`
          *,
          department:department_id (name),
          office:office_id (name),
          role:role_id (name),
          shift_assignments!shift_assignments_employee_id_fkey(effective_date, shift_templates(name, start_time, end_time))
        `)
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching employee:', error.message);
        return { data: null, error: new Error('Employee not found or access denied') };
      }

      return { data: data as unknown as EmployeeWithRelations, error: null };
    } catch (err) {
      console.error('Unexpected error fetching employee:', err);
      return { data: null, error: new Error('Unexpected network error') };
    }
  },

  /**
   * Create a new employee.
   */
  async createEmployee(input: EmployeeInsert & { password?: string }): Promise<{ data: EmployeeRow | null; error: Error | null }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        return { data: null, error: new Error('Admin session expired. Please log in again.') };
      }

      const { data, error } = await supabase.functions.invoke('create-employee', {
        body: input,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        console.error('Error invoking create-employee edge function:', error);
        return { data: null, error: new Error(error.message || 'Failed to communicate with provisioning service') };
      }

      if (data?.error || data?.success === false) {
        let errorMessage = data.details ? `${data.error}: ${data.details}` : data.error || 'Unknown error occurred';
        if (data.diagnostics) {
          errorMessage += ' | DIAG: ' + JSON.stringify(data.diagnostics);
        }
        return { data: null, error: new Error(errorMessage) };
      }

      return { data: data.employee, error: null };
    } catch (err) {
      console.error('Unexpected error creating employee via edge function:', err);
      return { data: null, error: new Error('Unexpected network error') };
    }
  },

  /**
   * Update an existing employee.
   */
  async updateEmployee(id: string, input: EmployeeUpdate): Promise<{ data: EmployeeRow | null; error: Error | null }> {
    try {
      // Strip non-column fields: id, timestamps, and joined relation objects from getEmployees
      const {
        id: _,
        created_at: __,
        updated_at: ___,
        department: ____,
        office: _____,
        role: ______,
        shift_assignments: _______,
        password: ________,
        confirm_password: _________,
        ...safeInput
      } = input as any;

      const { data, error } = await supabase
        .from('employees')
        // @ts-ignore: Supabase types can be overly strict here
        .update(safeInput as EmployeeUpdate)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error updating employee:', error);
        let errorMsg = `Update failed: ${error.message} | code=${error.code} | details=${error.details} | hint=${error.hint}`;
        if (error.code === '23505') {
          if (error.message.includes('employee_code')) {
            errorMsg = 'This Employee Code is already in use.';
          } else if (error.message.includes('email')) {
            errorMsg = 'This email is already in use by another employee.';
          }
        }
        return { data: null, error: new Error(errorMsg) };
      }

      return { data, error: null };
    } catch (err) {
      console.error('Unexpected error updating employee:', err);
      return { data: null, error: new Error('Unexpected network error') };
    }
  },

  /**
   * Deactivate an employee (soft delete).
   */
  async deactivateEmployee(id: string): Promise<{ data: EmployeeRow | null; error: Error | null }> {
    return this.updateEmployee(id, { status: 'Inactive' });
  },

  /**
   * Hard Delete an employee via edge function to ensure safety and auth user deletion.
   */
  async deleteEmployee(id: string): Promise<{ success: boolean; error: Error | null }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        return { success: false, error: new Error('Admin session expired. Please log in again.') };
      }

      const { data, error } = await supabase.functions.invoke('delete-employee', {
        body: { employeeId: id },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        console.error('Error invoking delete-employee edge function:', error);
        return { success: false, error: new Error(error.message || 'Failed to communicate with deletion service') };
      }

      if (data?.error || data?.success === false) {
        return { success: false, error: new Error(data.error || 'Unknown error occurred') };
      }

      return { success: true, error: null };
    } catch (err) {
      console.error('Unexpected error deleting employee via edge function:', err);
      return { success: false, error: new Error('Unexpected network error') };
    }
  },

  /**
   * Search and Filter employees (Server-side)
   */
  async searchEmployees(
    searchTerm?: string,
    filters?: { department_id?: string; office_id?: string; role_id?: string; status?: string }
  ): Promise<{ data: EmployeeWithRelations[] | null; error: Error | null }> {
    try {
      let query = supabase
        .from('employees')
        .select(`
          *,
          department:department_id (name),
          office:office_id (name),
          role:role_id (name)
        `)
        .order('first_name', { ascending: true });

      if (searchTerm) {
        // ILIKE search across multiple text fields. Or query syntax: or(field.ilike.%term%,field.ilike.%term%)
        query = query.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,employee_code.ilike.%${searchTerm}%`);
      }

      if (filters) {
        if (filters.department_id) query = query.eq('department_id', filters.department_id);
        if (filters.office_id) query = query.eq('office_id', filters.office_id);
        if (filters.role_id) query = query.eq('role_id', filters.role_id);
        if (filters.status && filters.status !== 'All') query = query.eq('status', filters.status);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error searching employees:', error.message);
        return { data: null, error: new Error('Failed to search employees') };
      }

      return { data: data as unknown as EmployeeWithRelations[], error: null };
    } catch (err) {
      console.error('Unexpected error searching employees:', err);
      return { data: null, error: new Error('Unexpected network error') };
    }
  },

  /**
   * Helpers to get departments, offices, roles for forms
   */
  async getDepartments() {
    const { data, error } = await supabase.from('departments').select('*').eq('is_active', true).order('name');
    return { data, error };
  },

  async getOffices() {
    const { data, error } = await supabase.from('offices').select('*').eq('is_active', true).order('name');
    return { data, error };
  },

  async getRoles() {
    const { data, error } = await supabase.from('roles').select('*').order('name');
    return { data, error };
  },

  async getShifts() {
    const { data, error } = await supabase.from('shift_templates').select('*').eq('is_active', true).order('name');
    return { data, error };
  },

  async getShiftAssignments() {
    const { data, error } = await supabase
      .from('shift_assignments')
      .select(`
        id,
        employee_id,
        shift_template_id,
        effective_date,
        assignment_type,
        shift_templates ( id, name, start_time, end_time, shift_type )
      `)
      .order('effective_date', { ascending: false });
    return { data, error };
  },

  async assignShift(employeeId: string, shiftTemplateId: string, effectiveDate: string) {
    // Check if an assignment already exists for this date
    const { data: existing, error: checkError } = await supabase
      .from('shift_assignments')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('effective_date', effectiveDate)
      .single();

    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from('shift_assignments')
        // @ts-ignore
        .update({ shift_template_id: shiftTemplateId })
        // @ts-ignore
        .eq('id', existing.id);
      return { data, error };
    } else {
      // Insert new
      const { data, error } = await supabase
        .from('shift_assignments')
        .insert({
          employee_id: employeeId,
          shift_template_id: shiftTemplateId,
          effective_date: effectiveDate,
          assignment_type: 'PERMANENT'
        } as any);
      return { data, error };
    }
  }
};
