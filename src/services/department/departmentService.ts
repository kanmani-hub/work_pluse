import { supabase } from '../../lib/supabase';

export interface Department {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const departmentService = {
  async getDepartments() {
    const { data, error } = await supabase
      .from('departments')
      .select(`
        *,
        employees:employees(id)
      `)
      .order('name');
      
    if (error) {
      console.error('Error fetching departments:', error);
      return { data: null, error };
    }
    
    // Add employee count
    const mapped = (data as any[])?.map(d => ({
      ...d,
      employeeCount: d.employees ? d.employees.length : 0
    })) || [];
    
    return { data: mapped, error: null };
  },

  async createDepartment(department: { name: string; description: string | null; is_active: boolean }) {
    const { data, error } = await supabase
      .from('departments')
      // @ts-ignore
      .insert([department] as any)
      .select()
      .single();
      
    if (error) {
      console.error('Error creating department:', error);
    }
    return { data, error };
  },

  async updateDepartment(id: string, department: { name: string; description: string | null; is_active: boolean }) {
    const { data, error } = await supabase
      .from('departments')
      // @ts-ignore
      .update(department as any)
      .eq('id', id)
      .select()
      .single();
      
    if (error) {
      console.error('Error updating department:', error);
    }
    return { data, error };
  },

  async deactivateDepartment(id: string) {
    const { data, error } = await supabase
      .from('departments')
      // @ts-ignore
      .update({ is_active: false } as any)
      .eq('id', id)
      .select()
      .single();
      
    if (error) {
      console.error('Error deactivating department:', error);
    }
    return { data, error };
  }
};
