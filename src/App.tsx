import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ErrorBoundary from './ErrorBoundary';
import ProtectedRoute from './components/layout/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { QaControlPanel } from './components/QaControlPanel';
import './App.css';
import './responsive.css';

const AdminDashboard = React.lazy(() => import('./pages/admin/Dashboard'));
const AdminLiveTracking = React.lazy(() => import('./pages/admin/LiveTracking'));
const AdminEmployees = React.lazy(() => import('./pages/admin/Employees'));
const AdminDepartments = React.lazy(() => import('./pages/admin/Departments'));
const AdminOffices = React.lazy(() => import('./pages/admin/Offices'));
const AdminShifts = React.lazy(() => import('./pages/admin/Shifts'));
const AdminRoster = React.lazy(() => import('./pages/admin/Roster'));
const AdminAttendance = React.lazy(() => import('./pages/admin/Attendance'));
const AdminWfh = React.lazy(() => import('./pages/admin/Wfh'));
const AdminLeave = React.lazy(() => import('./pages/admin/Leave'));
const AdminPermission = React.lazy(() => import('./pages/admin/Permission'));
const AdminPayroll = React.lazy(() => import('./pages/admin/Payroll'));
const AdminReports = React.lazy(() => import('./pages/admin/Reports'));
const AdminBreaks = React.lazy(() => import('./pages/admin/Breaks'));
const AdminSettings = React.lazy(() => import('./pages/admin/Settings'));
const AuditLogs = React.lazy(() => import('./pages/admin/AuditLogs'));
const FaceRegistration = React.lazy(() => import('./pages/admin/FaceRegistration'));
const Notifications = React.lazy(() => import('./pages/Notifications'));
const Login = React.lazy(() => import('./pages/Login'));
const ResetPassword = React.lazy(() => import('./pages/ResetPassword'));
const ChangePassword = React.lazy(() => import('./pages/ChangePassword'));
const EmployeeDashboard = React.lazy(() => import('./pages/employee/Dashboard'));
const EmployeeAttendance = React.lazy(() => import('./pages/employee/Attendance'));
const EmployeeWfh = React.lazy(() => import('./pages/employee/Wfh'));
const EmployeeLeave = React.lazy(() => import('./pages/employee/Leave'));
const EmployeePermission = React.lazy(() => import('./pages/employee/Permission'));
const EmployeePayroll = React.lazy(() => import('./pages/employee/Payroll'));
const EmployeePayslip = React.lazy(() => import('./pages/employee/Payslip'));
const EmployeeBreaks = React.lazy(() => import('./pages/employee/Breaks'));
const EmployeeProfile = React.lazy(() => import('./pages/employee/Profile'));

const LoadingFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw' }}>
    <div className="spinner" style={{ border: '3px solid var(--border-color)', borderTopColor: 'var(--primary-500)', borderRadius: '50%', width: '40px', height: '40px' }}></div>
  </div>
);

function App() {
  return (
    <AuthProvider>
      <QaControlPanel />
      <BrowserRouter>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route path="/" element={<Navigate to="/login" replace />} />
            
            {/* Admin/HR Routes (Prefix /admin) */}
            <Route element={<ProtectedRoute allowedRoles={['Admin', 'HR', 'HR/Staff']} />}>
              <Route path="/admin" element={<AppLayout role="admin" />}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="live-tracking" element={<AdminLiveTracking />} />
                <Route path="employees" element={<AdminEmployees />} />
                <Route path="departments" element={<AdminDepartments />} />
                <Route path="offices" element={<AdminOffices />} />
                <Route path="shifts" element={<AdminShifts />} />
                <Route path="attendance" element={<AdminAttendance />} />
                <Route path="breaks" element={<AdminBreaks />} />
                <Route path="wfh" element={<AdminWfh />} />
                <Route path="leave" element={<AdminLeave />} />
                <Route path="payroll" element={<ErrorBoundary><AdminPayroll /></ErrorBoundary>} />
                <Route path="roster" element={<AdminRoster />} />
                <Route path="permission" element={<AdminPermission />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="audit-logs" element={<AuditLogs />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="face-registration" element={<FaceRegistration />} />
              </Route>
            </Route>

            {/* Employee Routes */}
            <Route element={<ProtectedRoute allowedRoles={['Employee']} />}>
              <Route path="/employee" element={<AppLayout role="employee" />}>
                <Route index element={<Navigate to="/employee/dashboard" replace />} />
                <Route path="dashboard" element={<EmployeeDashboard />} />
                <Route path="attendance" element={<EmployeeAttendance />} />
                <Route path="breaks" element={<EmployeeBreaks />} />
                <Route path="wfh" element={<EmployeeWfh />} />
                <Route path="leave" element={<EmployeeLeave />} />
                <Route path="permission" element={<EmployeePermission />} />
                <Route path="payroll" element={<EmployeePayroll />} />
                <Route path="payslip" element={<EmployeePayslip />} />
                <Route path="profile" element={<EmployeeProfile />} />
                <Route path="notifications" element={<Notifications />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
