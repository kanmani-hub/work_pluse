import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  allowedRoles?: string[]; // e.g., ['Admin', 'HR/Staff', 'Employee']
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { user, profile, role, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)' }}>
        <Loader2 size={40} className="spinner" style={{ color: 'var(--primary-500)' }} />
        <style>{`.spinner { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Not authenticated
  if (!user || !profile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check if force password change is required
  if (user.user_metadata?.force_password_change && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Check role authorization if restricted
  if (allowedRoles && allowedRoles.length > 0) {
    // Make checking case-insensitive to support DB roles (ADMIN, HR, EMPLOYEE)
    const upperAllowed = allowedRoles.map(r => r.toUpperCase());
    const upperRole = role?.toUpperCase() || '';
    
    if (!role || !upperAllowed.includes(upperRole)) {
      // Unauthorized, redirect appropriately based on what role they do have
      if (upperRole === 'ADMIN' || upperRole === 'HR' || upperRole === 'HR/STAFF') {
        return <Navigate to="/admin/dashboard" replace />;
      }
      return <Navigate to="/employee/dashboard" replace />;
    }
  }

  return <Outlet />;
};

export default ProtectedRoute;
