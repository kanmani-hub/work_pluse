import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalizeRole } from '../lib/roles';
import { authService, type AuthSession } from '../services/auth/authService';
import { authEventAction } from '../services/auth/authEvents';
import type { AuthAccountErrorCode } from '../services/auth/authErrors';
import { pushNotificationService } from '../services/notifications/pushNotificationService';

interface AuthContextType extends AuthSession {
  isLoading: boolean;
  role: string | null;
  /** Set when a signed-in account cannot use the app (inactive / no profile / no role). */
  authError: AuthAccountErrorCode | null;
  clearAuthError: () => void;
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
  authError: null,
  clearAuthError: () => {},
  signOut: async () => {},
  checkAuth: async () => {},
});

// Keep the previous object when nothing changed, so a background refresh does not
// give consumers new object identities (which would re-run their effects).
const keepIfSame = <T,>(prev: T, next: T): T => {
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<any | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [employee, setEmployee] = useState<any | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<AuthAccountErrorCode | null>(null);

  // Auth user whose profile/role is currently loaded. A ref, because the Supabase
  // listener is registered once and would otherwise see stale state.
  const loadedUserIdRef = useRef<string | null>(null);

  const clearAuthState = () => {
    setSession(null);
    setUser(null);
    setProfile(null);
    setEmployee(null);
    setRole(null);
    loadedUserIdRef.current = null;
  };

  /**
   * Load session, profile, employee and role.
   * - 'full'  : initial load and a real login. Shows the loading screen.
   * - 'silent': background refresh. No loading screen, no remount; a transient
   *             lookup failure keeps the current state instead of logging the user out.
   */
  const loadAuth = async (mode: 'full' | 'silent') => {
    if (mode === 'full') setIsLoading(true);
    try {
      const currentSession = await authService.getSession();

      if (!currentSession?.user) {
        clearAuthState();
        return;
      }

      const authUserId: string = currentSession.user.id;
      const employeeData = await authService.getCurrentEmployeeProfile(authUserId);

      if (mode === 'silent' && !employeeData && loadedUserIdRef.current === authUserId) {
        // Background refresh could not reach the profile: keep what we have.
        setSession(currentSession);
        return;
      }

      setSession(currentSession);
      setUser((prev: any) => keepIfSame(prev, currentSession.user));

      if (!employeeData?.profile || !employeeData?.employee) {
        setProfile(null);
        setEmployee(null);
        setRole(null);
        setAuthError('PROFILE_MISSING');
        loadedUserIdRef.current = authUserId;
        return;
      }

      // Inactive users shouldn't have access
      if (!employeeData.profile.is_active || employeeData.employee.status !== 'ACTIVE') {
        setAuthError('INACTIVE');
        clearAuthState();
        await authService.signOut();
        return;
      }

      let resolvedRoleName: string | null = null;
      if (employeeData.profile.role_id) {
        const { data: roleData, error: roleError } = await supabase.from('roles').select('name').eq('id', employeeData.profile.role_id).single();
        if (roleError && mode === 'silent' && loadedUserIdRef.current === authUserId) {
          return; // transient failure during a background refresh: keep current role
        }
        resolvedRoleName = (roleData as { name: string } | null)?.name ?? null;
      }
      const canonicalRole = normalizeRole(resolvedRoleName);

      setProfile((prev: any) => keepIfSame(prev, employeeData.profile));
      setEmployee((prev: any) => keepIfSame(prev, employeeData.employee));
      setRole(canonicalRole);
      setAuthError(canonicalRole ? null : 'ROLE_MISSING');
      loadedUserIdRef.current = authUserId;

      if (mode === 'full') {
        // Initialize push notifications on successful login
        pushNotificationService.initPushNotifications(authUserId);

        // DEV-ONLY: Safe session diagnostics (no tokens/passwords/keys)
        if (import.meta.env.DEV) {
          console.log(
            '%c[WorkPulse Auth Session]',
            'color: #7c5cff; font-weight: bold;',
            {
              authenticated: true,
              userId: authUserId,
              email: currentSession.user.email,
              employeeId: employeeData.profile.employee_id,
              employeeStatus: employeeData.employee.status,
              profileActive: employeeData.profile.is_active,
              role: resolvedRoleName,
            }
          );
        }
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    } finally {
      if (mode === 'full') setIsLoading(false);
    }
  };

  // Public refresh (e.g. after changing the password): background, no loading screen.
  const checkAuth = () => loadAuth('silent');

  useEffect(() => {
    loadAuth('full');

    const { data: { subscription } } = authService.onAuthStateChange((event, currentSession) => {
      const action = authEventAction(event, loadedUserIdRef.current, currentSession?.user?.id);
      switch (action) {
        case 'signed-out':
          // authError is kept so the login page can explain why (e.g. inactive account)
          clearAuthState();
          break;
        case 'password-recovery':
          window.location.href = '/reset-password';
          break;
        case 'full-reload':
          // A real login. Deferred: supabase-js warns against awaiting its API inside this callback.
          setTimeout(() => { loadAuth('full'); }, 0);
          break;
        case 'session-only':
          // Tab focus / app resume / hourly token refresh: keep the page as it is.
          setSession(currentSession);
          break;
        case 'user-updated':
          setSession(currentSession);
          setUser(currentSession?.user ?? null);
          break;
        default:
          break;
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await pushNotificationService.unregisterDeviceToken();
    await authService.signOut();
  };

  const clearAuthError = () => setAuthError(null);

  return (
    <AuthContext.Provider value={{ session, user, profile, employee, role, isLoading, authError, clearAuthError, signOut: handleSignOut, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
