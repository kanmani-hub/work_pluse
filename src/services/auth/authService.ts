import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database';

type Employee = Database['public']['Tables']['employees']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

export interface AuthSession {
  session: any | null;
  user: any | null;
  profile: Profile | null;
  employee: Employee | null;
}

export const authService = {
  // Get current auth session from Supabase
  getSession: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Error fetching session:', error.message);
      return null;
    }
    return session;
  },

  // Get current user from session
  getCurrentUser: async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error('Error fetching user:', error.message);
      return null;
    }
    return user;
  },

  // Fetch full employee profile based on auth user ID
  getCurrentEmployeeProfile: async (authUserId: string) => {
    try {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('auth_user_id', authUserId)
        .single();

      if (profileError || !data) {
        // Fallback: If profile trigger missed, try to find employee by email
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.email) {
          const { data: empData, error: empError } = await supabase
            .from('employees')
            .select('*')
            .eq('email', userData.user.email)
            .single();
            
          if (!empError && empData) {
            const employee = empData as Employee;
            // Synthesize a profile to satisfy the rest of the application
            const profile = {
              id: employee.id,
              auth_user_id: authUserId,
              employee_id: employee.id,
              role_id: employee.role_id,
              is_active: employee.status === 'ACTIVE',
              created_at: employee.created_at,
              updated_at: employee.updated_at
            } as Profile;
            
            return { profile, employee };
          }
        }
        
        console.error('Error fetching profile:', profileError?.message);
        return null;
      }
      
      const profile = data as Profile;

      if (!profile.employee_id) {
        return { profile, employee: null };
      }

      const { data: employeeData, error: employeeError } = await supabase
        .from('employees')
        .select('*')
        .eq('id', profile.employee_id)
        .single();

      if (employeeError) {
        console.error('Error fetching employee:', employeeError.message);
        return { profile, employee: null };
      }

      const employee = employeeData as Employee;

      return { profile, employee };
    } catch (err) {
      console.error('Unexpected error fetching employee profile:', err);
      return null;
    }
  },

  // Listen to auth state changes
  onAuthStateChange: (callback: (event: string, session: any) => void) => {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  },

  // Sign out (does not replace mock flow yet)
  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error.message);
    }
  }
};
