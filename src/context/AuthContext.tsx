import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { authService, type AuthSession } from '../services/auth/authService';

interface AuthContextType extends AuthSession {
  isLoading: boolean;
  role: string | null;
  signOut: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  employee: null,
  role: null,
  isLoading: true,
  signOut: async () => {},
  checkAuth: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<any | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [employee, setEmployee] = useState<any | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const resolveRole = async (roleId: string) => {
    const { data, error } = await supabase.from('roles').select('name').eq('id', roleId).single();
    if (!error && data) {
      setRole((data as { name: string }).name);
    } else {
      setRole(null);
    }
  };

  const checkAuth = async () => {
    setIsLoading(true);
    try {
      const currentSession = await authService.getSession();
      setSession(currentSession);
      
      if (currentSession?.user) {
        setUser(currentSession.user);
        const employeeData = await authService.getCurrentEmployeeProfile(currentSession.user.id);
        
        if (employeeData?.profile && employeeData?.employee) {
          // Check profile/employee active status
          if (!employeeData.profile.is_active || employeeData.employee.status !== 'ACTIVE') {
             // Inactive users shouldn't have access
             setProfile(null);
             setEmployee(null);
             setRole(null);
             await authService.signOut();
             setIsLoading(false);
             return;
          }

          setProfile(employeeData.profile);
          setEmployee(employeeData.employee);
          
          let resolvedRoleName: string | null = null;
          if (employeeData.profile.role_id) {
            const { data: roleData } = await supabase.from('roles').select('name').eq('id', employeeData.profile.role_id).single();
            resolvedRoleName = (roleData as { name: string } | null)?.name ?? null;
            setRole(resolvedRoleName);
          }

          // DEV-ONLY: Safe session diagnostics (no tokens/passwords/keys)
          if (import.meta.env.DEV) {
            console.log(
              '%c[WorkPulse Auth Session]',
              'color: #7c5cff; font-weight: bold;',
              {
                authenticated: true,
                userId: currentSession.user.id,
                email: currentSession.user.email,
                employeeId: employeeData.profile.employee_id,
                employeeStatus: employeeData.employee.status,
                profileActive: employeeData.profile.is_active,
                role: resolvedRoleName,
              }
            );
          }
        } else {
          setProfile(null);
          setEmployee(null);
          setRole(null);
        }
      } else {
        setUser(null);
        setProfile(null);
        setEmployee(null);
        setRole(null);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();

    const { data: { subscription } } = authService.onAuthStateChange(async (event, currentSession) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setProfile(null);
        setEmployee(null);
        setRole(null);
      } else if (event === 'PASSWORD_RECOVERY') {
        window.location.href = '/reset-password';
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        checkAuth();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await authService.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, employee, role, isLoading, signOut: handleSignOut, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
