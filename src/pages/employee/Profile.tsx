import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { employeeService, type EmployeeWithRelations } from '../../services/employees/employeeService';
import { User, Mail, Phone, Briefcase, MapPin, Clock, Calendar, Shield, Activity, RefreshCw } from 'lucide-react';
import ChangePasswordCard from '../../components/auth/ChangePasswordCard';

const Profile: React.FC = () => {
  const { employee: authEmployee } = useAuth();
  const [profileData, setProfileData] = useState<EmployeeWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async () => {
    if (!authEmployee?.id) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    const { data, error: fetchError } = await employeeService.getEmployeeById(authEmployee.id);
    
    if (fetchError || !data) {
      setError('Unable to load your profile.');
    } else {
      setProfileData(data);
    }
    
    setLoading(false);
  };

  useEffect(() => {
    fetchProfile();
  }, [authEmployee?.id]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid var(--gray-200)', borderTopColor: 'var(--primary-600)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Loading profile...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 500 }}>{error}</p>
        <button onClick={fetchProfile} className="btn btn-outline" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <RefreshCw size={18} /> Retry
        </button>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ color: 'var(--text-primary)' }}>Employee profile not found.</h2>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>We could not find an associated employee record for your account.</p>
      </div>
    );
  }

  // Safely extract relations
  const departmentName = profileData.department?.name || 'Not assigned';
  const officeName = profileData.office?.name || 'Not assigned';
  const roleName = profileData.role?.name || 'Not assigned';
  
  // Extract shift name from assignments
  let shiftName = 'Not assigned';
  if (profileData.shift_assignments && profileData.shift_assignments.length > 0) {
    // Assuming the first assignment or the one in the relation is the active one
    const latestAssignment = profileData.shift_assignments[0];
    if (latestAssignment && latestAssignment.shift_templates) {
      shiftName = latestAssignment.shift_templates.name || 'Not assigned';
    }
  }

  // Format Join Date
  const joinDate = profileData.joining_date 
    ? new Date(profileData.joining_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'Not assigned';

  // Format Status
  const statusBadgeColor = profileData.status === 'ACTIVE' ? 'var(--success)' : 
                           profileData.status === 'INACTIVE' ? 'var(--gray-500)' : 'var(--warning)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
      
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">My Profile</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Your employee information</p>
        </div>
      </div>

      <div className="profile-layout">
        {/* Left Column: Avatar & Summary Card */}
        <div className="profile-left-col">
          <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2rem 1.5rem' }}>
            <div className="avatar-wrapper">
              <User size={48} color="var(--primary-600)" />
            </div>
            
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '1rem', textAlign: 'center', color: 'var(--text-primary)' }}>
              {profileData.first_name} {profileData.last_name}
            </h2>
            
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem', marginBottom: '1rem' }}>
              {profileData.employee_code || 'No Employee ID'}
            </div>
            
            <span className="badge" style={{ backgroundColor: `${statusBadgeColor}20`, color: statusBadgeColor, padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}>
              {profileData.status || 'UNKNOWN'}
            </span>
          </div>
        </div>

        {/* Right Column: Details */}
        <div className="profile-right-col" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              PERSONAL INFORMATION
            </h3>
            
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label"><User size={16} /> Full Name</span>
                <span className="info-value">{profileData.first_name} {profileData.last_name}</span>
              </div>
              <div className="info-item">
                <span className="info-label"><Mail size={16} /> Email</span>
                <span className="info-value">{profileData.email || 'Not assigned'}</span>
              </div>
              <div className="info-item">
                <span className="info-label"><Phone size={16} /> Phone</span>
                <span className="info-value">{profileData.phone || 'Not assigned'}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              WORK INFORMATION
            </h3>
            
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label"><Briefcase size={16} /> Employee ID</span>
                <span className="info-value">{profileData.employee_code || 'Not assigned'}</span>
              </div>
              <div className="info-item">
                <span className="info-label"><Briefcase size={16} /> Department</span>
                <span className="info-value">{departmentName}</span>
              </div>
              <div className="info-item">
                <span className="info-label"><MapPin size={16} /> Office</span>
                <span className="info-value">{officeName}</span>
              </div>
              <div className="info-item">
                <span className="info-label"><Clock size={16} /> Shift</span>
                <span className="info-value">{shiftName}</span>
              </div>
              <div className="info-item">
                <span className="info-label"><MapPin size={16} /> Work Mode</span>
                <span className="info-value">OFFICE</span>
              </div>
              <div className="info-item">
                <span className="info-label"><Shield size={16} /> Role</span>
                <span className="info-value">{roleName}</span>
              </div>
              <div className="info-item">
                <span className="info-label"><Activity size={16} /> Status</span>
                <span className="info-value">{profileData.status || 'Not assigned'}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
              EMPLOYMENT
            </h3>
            
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label"><Calendar size={16} /> Date Joined</span>
                <span className="info-value">{joinDate}</span>
              </div>
            </div>
          </div>

          <ChangePasswordCard />
          
        </div>
      </div>

      <style>{`
        .profile-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }
        
        @media (min-width: 1024px) {
          .profile-layout {
            grid-template-columns: 300px 1fr;
          }
        }

        .avatar-wrapper {
          width: 96px;
          height: 96px;
          border-radius: 50%;
          background-color: var(--primary-50);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 4px solid var(--bg-surface);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }

        .info-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 1.25rem;
        }

        @media (min-width: 640px) {
          .info-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .info-label {
          font-size: 0.75rem;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 500;
        }

        .info-value {
          font-size: 0.9375rem;
          color: var(--text-primary);
          font-weight: 500;
          word-break: break-word;
        }
      `}</style>
    </div>
  );
};

export default Profile;
