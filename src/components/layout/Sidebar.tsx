import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { 
  LayoutDashboard, 
  Users, 
  CalendarClock, 
  Home, 
  CalendarOff,
  Wallet,
  Settings,
  Activity,
  LogOut,
  Building2,
  Briefcase,
  User,
  Clock,
  MapPin,
  ShieldCheck,
  FileText
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  role: 'admin' | 'employee';
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, role }) => {
  const navigate = useNavigate();

  const { signOut } = useAuth();

  const handleLogout = async () => {
    onClose();
    await signOut();
    navigate('/login');
  };

  return (
    <>
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo-icon">
            <Activity size={26} strokeWidth={2.5} />
          </div>
          <div className="sidebar-logo-text">
            <span>◈ WorkPulse</span>
            HR Command Center
          </div>
        </div>
        
        <nav className="sidebar-nav">
          {role === 'admin' ? (
            <>
              <div className="sidebar-nav-group">
                <div className="sidebar-nav-title">Overview</div>
                <NavLink to="/admin/dashboard" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <LayoutDashboard className="nav-icon" />
                  Dashboard
                </NavLink>
                <NavLink to="/admin/live-tracking" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Activity className="nav-icon" />
                  Live Tracking
                </NavLink>
                <NavLink to="/admin/attendance" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <CalendarClock className="nav-icon" />
                  Attendance
                </NavLink>
              </div>

              <div className="sidebar-nav-group">
                <div className="sidebar-nav-title">Workforce</div>
                <NavLink to="/admin/employees" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Users className="nav-icon" />
                  Employees
                </NavLink>
                <NavLink to="/admin/departments" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Building2 className="nav-icon" />
                  Departments
                </NavLink>
                <NavLink to="/admin/offices" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <MapPin className="nav-icon" />
                  Offices
                </NavLink>
                <NavLink to="/admin/shifts" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Briefcase className="nav-icon" />
                  Shifts
                </NavLink>
                <NavLink to="/admin/roster" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <CalendarClock className="nav-icon" />
                  Shift Roster
                </NavLink>
              </div>

              <div className="sidebar-nav-group">
                <div className="sidebar-nav-title">Operations</div>
                <NavLink to="/admin/wfh" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Home className="nav-icon" />
                  WFH
                </NavLink>
                <NavLink to="/admin/leave" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <CalendarOff className="nav-icon" />
                  Leave
                </NavLink>
                <NavLink to="/admin/permission" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Clock className="nav-icon" />
                  Permissions
                </NavLink>
                <NavLink to="/admin/payroll" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Wallet className="nav-icon" />
                  Payroll
                </NavLink>
              </div>

              <div className="sidebar-nav-group">
                <div className="sidebar-nav-title">Insights</div>
                <NavLink to="/admin/reports" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <FileText className="nav-icon" />
                  Reports
                </NavLink>
                <NavLink to="/admin/audit-logs" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <ShieldCheck className="nav-icon" />
                  Audit Logs
                </NavLink>
              </div>

              <div className="sidebar-nav-group">
                <div className="sidebar-nav-title">System</div>
                <NavLink to="/admin/settings" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Settings className="nav-icon" />
                  Settings
                </NavLink>
                <NavLink to="/admin/face-registration" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                  <User className="nav-icon" />
                  Face Registration
                </NavLink>
              </div>
            </>
          ) : (
            <div className="sidebar-nav-group">
              <div className="sidebar-nav-title">Employee Portal</div>
              <NavLink to="/employee/dashboard" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <LayoutDashboard className="nav-icon" />
                Dashboard
              </NavLink>
              <NavLink to="/employee/attendance" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <CalendarClock className="nav-icon" />
                My Attendance
              </NavLink>
              <NavLink to="/employee/wfh" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Home className="nav-icon" />
                WFH Requests
              </NavLink>
              <NavLink to="/employee/leave" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <CalendarOff className="nav-icon" />
                Leave Requests
              </NavLink>
              <NavLink to="/employee/permission" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Clock className="nav-icon" />
                Permissions
              </NavLink>
              <NavLink to="/employee/payslip" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <Wallet className="nav-icon" />
                Payslips
              </NavLink>
              <NavLink to="/employee/profile" onClick={onClose} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}>
                <User className="nav-icon" />
                My Profile
              </NavLink>
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="nav-item" style={{ width: '100%', padding: '0.625rem 0' }}>
            <LogOut className="nav-icon" />
            Sign Out
          </button>
        </div>
      </aside>
      
      {/* Overlay for mobile */}
      <div className="sidebar-overlay" onClick={onClose} />
    </>
  );
};

export default Sidebar;
