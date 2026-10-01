import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import AdminDashboard from './pages/admin/Dashboard';
import AdminLiveTracking from './pages/admin/LiveTracking';
import AdminEmployees from './pages/admin/Employees';
import AdminDepartments from './pages/admin/Departments';
import AdminOffices from './pages/admin/Offices';
import AdminShifts from './pages/admin/Shifts';
import AdminRoster from './pages/admin/Roster';
import AdminAttendance from './pages/admin/Attendance';
import AdminWfh from './pages/admin/Wfh';
import AdminLeave from './pages/admin/Leave';
import AdminPermission from './pages/admin/Permission';
import AdminPayroll from './pages/admin/Payroll';
import ErrorBoundary from './ErrorBoundary';
import AdminReports from './pages/admin/Reports';
import AdminSettings from './pages/admin/Settings';
import AuditLogs from './pages/admin/AuditLogs';
import FaceRegistration from './pages/admin/FaceRegistration';
import Notifications from './pages/Notifications';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ChangePassword from './pages/ChangePassword';
import EmployeeDashboard from './pages/employee/Dashboard';
import EmployeeAttendance from './pages/employee/Attendance';
import EmployeeWfh from './pages/employee/Wfh';
import EmployeeLeave from './pages/employee/Leave';
import EmployeePermission from './pages/employee/Permission';
import EmployeePayroll from './pages/employee/Payroll';
import EmployeePayslip from './pages/employee/Payslip';
import ProtectedRoute from './components/layout/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import './App.css';
import './responsive.css';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/" element={<Navigate to="/login" replace />} />
          
          {/* Admin/HR Routes (Prefix /admin) */}
          <Route element={<ProtectedRoute allowedRoles={['Admin', 'HR/Staff']} />}>
            <Route path="/admin" element={<AppLayout role="admin" />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="live-tracking" element={<AdminLiveTracking />} />
              <Route path="employees" element={<AdminEmployees />} />
              <Route path="departments" element={<AdminDepartments />} />
              <Route path="offices" element={<AdminOffices />} />
              <Route path="shifts" element={<AdminShifts />} />
              <Route path="attendance" element={<AdminAttendance />} />
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
              <Route path="wfh" element={<EmployeeWfh />} />
              <Route path="leave" element={<EmployeeLeave />} />
              <Route path="permission" element={<EmployeePermission />} />
              <Route path="payroll" element={<EmployeePayroll />} />
              <Route path="payslip" element={<EmployeePayslip />} />
              <Route path="profile" element={<div className="page-placeholder"><h2>My Profile</h2></div>} />
              <Route path="notifications" element={<Notifications />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
