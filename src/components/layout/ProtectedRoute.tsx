import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { decideRouteAccess } from '../../lib/routeAccess';
import AccountAccessError from '../auth/AccountAccessError';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  allowedRoles?: string[]; // canonical roles from lib/roles, e.g. ['ADMIN', 'HR'] or ['EMPLOYEE']
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { user, profile, role, isLoading, authError } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)' }}>
        <Loader2 size={40} className="spinner" style={{ color: 'var(--primary-500)' }} />
        <style>{`.spinner { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Signed in, but the account has no employee profile or no valid role:
  // show a clear error with a sign-out action instead of redirecting (which could loop).
  if (user && (authError === 'PROFILE_MISSING' || authError === 'ROLE_MISSING')) {
    return <AccountAccessError code={authError} />;
  }

  // Not authenticated
  if (!user || !profile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check if force password change is required
  if (user.user_metadata?.force_password_change && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Role authorization (canonical roles, see lib/roles + lib/routeAccess).
  // Redirects only ever target a portal the role is allowed into, so this cannot loop.
  const decision = decideRouteAccess(role, allowedRoles);
  if (decision === 'role-error') {
    return <AccountAccessError code="ROLE_MISSING" />;
  }
  if (decision === 'redirect-admin') {
    return <Navigate to="/admin/dashboard" replace />;
  }
  if (decision === 'redirect-employee') {
    return <Navigate to="/employee/dashboard" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
