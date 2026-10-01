import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, UserCheck, Briefcase, Home, CalendarOff, AlertTriangle, UserX, 
  Clock, Filter, MapPin, Activity, CheckCircle2, X, Wallet, Building2,
  ChevronRight, CalendarDays, ShieldAlert, ArrowRight, ArrowUpRight
} from 'lucide-react';

import { supabase } from '../../lib/supabase';

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('Today');
  const [toast, setToast] = useState('');
  
  // Modals / Drawers
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [rejectModal, setRejectModal] = useState<{type: string, id: number} | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Real state
  const [stats, setStats] = useState({ employees: 0, wfhPending: 0, leavePending: 0, permPending: 0, working: 0 });
  const [wfhReqs, setWfhReqs] = useState<any[]>([]);
  const [leaveReqs, setLeaveReqs] = useState<any[]>([]);
  const [permReqs, setPermReqs] = useState<any[]>([]);
  const [liveStatus, setLiveStatus] = useState<any[]>([]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        const [
          { count: empCount },
          { data: wfhData },
          { data: leaveData },
          { data: permData },
          { count: workingCount }
        ] = await Promise.all([
          supabase.from('employees').select('*', { count: 'exact', head: true }),
          supabase.from('wfh_requests').select(`*, employees(first_name, last_name, employee_code, departments(name))`).eq('status', 'PENDING').limit(5),
          supabase.from('leave_requests').select(`*, employees(first_name, last_name, employee_code, departments(name)), leave_types(name)`).eq('status', 'PENDING').limit(5),
          supabase.from('permission_requests').select(`*, employees(first_name, last_name, employee_code, departments(name))`).eq('status', 'PENDING').limit(5),
          supabase.from('attendance').select('*', { count: 'exact', head: true }).eq('date', new Date().toISOString().split('T')[0]).not('clock_in', 'is', null).is('clock_out', null)
        ]);
        
        setStats({
          employees: empCount || 0,
          wfhPending: wfhData?.length || 0,
          leavePending: leaveData?.length || 0,
          permPending: permData?.length || 0,
          working: workingCount || 0
        });

        if (wfhData) {
          setWfhReqs(wfhData.map((r: any) => ({
            id: r.id,
            emp: `${r.employees?.first_name} ${r.employees?.last_name}`,
            type: r.is_half_day ? 'Half Day' : 'Full Day',
            date: new Date(r.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            reason: r.reason,
            requested: new Date(r.requested_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
          })));
        }

        if (leaveData) {
          setLeaveReqs(leaveData.map((r: any) => ({
            id: r.id,
            emp: `${r.employees?.first_name} ${r.employees?.last_name}`,
            type: r.leave_types?.name,
            days: r.total_days,
            from: new Date(r.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            to: new Date(r.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            reason: r.reason
          })));
        }

        if (permData) {
          setPermReqs(permData.map((r: any) => ({
            id: r.id,
            emp: `${r.employees?.first_name} ${r.employees?.last_name}`,
            type: 'Permission',
            date: new Date(r.permission_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            start: r.start_time,
            end: r.end_time,
            duration: `${Math.floor(r.duration_minutes / 60)}h ${r.duration_minutes % 60}m`
          })));
        }

      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardData();
  }, [period]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleApprove = (type: string, id: number) => {
    if (type === 'wfh') setWfhReqs(prev => prev.filter(r => r.id !== id));
    if (type === 'leave') setLeaveReqs(prev => prev.filter(r => r.id !== id));
    if (type === 'perm') setPermReqs(prev => prev.filter(r => r.id !== id));
    showToast(`${type.toUpperCase()} request approved successfully.`);
  };

  const handleRejectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModal) return;
    const { type, id } = rejectModal;
    if (type === 'wfh') setWfhReqs(prev => prev.filter(r => r.id !== id));
    if (type === 'leave') setLeaveReqs(prev => prev.filter(r => r.id !== id));
    if (type === 'perm') setPermReqs(prev => prev.filter(r => r.id !== id));
    
    setRejectModal(null);
    setRejectReason('');
    showToast(`${type.toUpperCase()} request rejected.`);
  };

  const getStatusBadge = (status: string) => {
    switch(status.toUpperCase()) {
      case 'WORKING': return 'badge-success';
      case 'ON BREAK': return 'badge-warning';
      case 'LATE': return 'badge-danger';
      case 'OFFLINE': return 'badge-gray';
      default: return 'badge-primary';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {toast && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toast}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Good morning, Admin <span className="badge badge-primary" style={{ fontSize: '0.75rem' }}>COMMAND CENTER</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Here's what's happening across your workforce.</p>
        </div>
        
        <select value={period} onChange={(e) => {setLoading(true); setPeriod(e.target.value);}} className="form-control" style={{ width: 'auto', backgroundColor: 'var(--bg-surface)' }}>
          <option>Today</option>
          <option>This Week</option>
          <option>This Month</option>
          <option>Custom Range</option>
        </select>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          {[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="dashboard-stats">
          <div className="stat-card" onClick={() => navigate('/admin/employees')} style={{ cursor: 'pointer' }}>
            <div className="stat-header">Workforce <div className="stat-icon"><Users size={16} /></div></div>
            <div className="stat-value">{stats.employees}</div>
            <div className="stat-footer"><span className="stat-trend">{stats.employees}</span> total active</div>
          </div>
          <div className="stat-card" onClick={() => navigate('/admin/attendance')} style={{ cursor: 'pointer' }}>
            <div className="stat-header">Working <div className="stat-icon success"><Briefcase size={16} /></div></div>
            <div className="stat-value">{stats.working}</div>
            <div className="stat-footer"><span className="stat-trend">{stats.working}</span> clocked in today</div>
          </div>
          <div className="stat-card" onClick={() => navigate('/admin/wfh')} style={{ cursor: 'pointer' }}>
            <div className="stat-header">WFH <div className="stat-icon"><Home size={16} /></div></div>
            <div className="stat-value">{stats.wfhPending}</div>
            <div className="stat-footer"><span className="stat-trend">{stats.wfhPending} pending</span> requests</div>
          </div>
          <div className="stat-card" onClick={() => navigate('/admin/attendance')} style={{ cursor: 'pointer', borderColor: 'var(--warning)', boxShadow: '0 0 15px rgba(255, 181, 71, 0.1)' }}>
            <div className="stat-header" style={{ color: 'var(--warning)' }}>Attention <div className="stat-icon warning"><AlertTriangle size={16} /></div></div>
            <div className="stat-value">{(stats.leavePending + stats.permPending) || 0}</div>
            <div className="stat-footer" style={{ color: 'var(--warning)' }}>{stats.leavePending} Leave, {stats.permPending} Perm reqs</div>
          </div>
        </div>
      )}

      {/* Main Content Grid */}
      <div className="dashboard-grid">
        
        {/* Left Column (Main) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', gridColumn: 'span 8' }}>
          
          {/* Live Workforce Signals */}
          <div className="card" style={{ padding: '1.5rem', overflow: 'hidden' }}>
            <div className="card-header" style={{ marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <h2 className="card-title" style={{ fontSize: '1.25rem', color: 'var(--cyan-500)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  <Activity size={20} style={{ marginRight: '0.5rem' }} /> Live Workforce Signals
                </h2>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Real-time telemetry across all locations</span>
              </div>
              <button onClick={() => navigate('/admin/live-tracking')} className="btn btn-outline" style={{ fontSize: '0.75rem' }}>Open Live Tracking <ArrowUpRight size={14} /></button>
            </div>
            
            {loading ? (
              <div className="skeleton" style={{ height: '250px' }} />
            ) : liveStatus.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No live workforce data available.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                {liveStatus.map(emp => (
                  <div key={emp.id} className="stat-card" onClick={() => setSelectedEmp(emp)} style={{ padding: '1rem', cursor: 'pointer', border: emp.status === 'Working' ? '1px solid var(--border-accent)' : '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div className="avatar" style={{ width: '36px', height: '36px', fontSize: '0.8rem' }}>{emp.name.substring(0,2).toUpperCase()}</div>
                        <div>
                          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{emp.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{emp.dept} • {emp.shift}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600, color: emp.status === 'Working' ? 'var(--success)' : emp.status === 'On Break' ? 'var(--warning)' : 'var(--danger)', padding: '2px 6px', borderRadius: '12px', backgroundColor: 'var(--bg-surface-elevated)' }}>
                        {emp.status === 'Working' && <div className="status-dot" style={{ animation: 'pulseDot 2s infinite' }}></div>}
                        {emp.status.toUpperCase()}
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Working Time</span>
                        <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary-400)', lineHeight: 1 }}>{emp.time}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Clock In</span>
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{emp.in}</span>
                      </div>
                    </div>
                    
                    <div style={{ marginTop: '1rem', height: '4px', width: '100%', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: emp.status === 'Working' ? '65%' : emp.status === 'On Break' ? '45%' : '15%', backgroundColor: emp.status === 'Working' ? 'var(--success)' : emp.status === 'On Break' ? 'var(--warning)' : 'var(--danger)', boxShadow: emp.status === 'Working' ? '0 0 10px var(--success)' : 'none' }}></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Requests */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={18} color="var(--warning-600)" /> Needs Attention (Pending Requests)
            </h3>
            
            {loading ? (
              <div className="skeleton" style={{ height: '300px' }} />
            ) : wfhReqs.length === 0 && leaveReqs.length === 0 && permReqs.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No pending requests require your attention.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                {/* WFH Requests */}
                {wfhReqs.map(r => (
                  <div key={`wfh-${r.id}`} className="req-card">
                    <div className="req-header">
                      <span className="badge badge-primary">WFH Request</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.requested}</span>
                    </div>
                    <div className="req-body">
                      <div><strong>{r.emp}</strong> requested {r.type} WFH on <strong>{r.date}</strong> for "{r.reason}".</div>
                      <div className="req-actions">
                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => setRejectModal({type: 'wfh', id: r.id})}>Reject</button>
                        <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => handleApprove('wfh', r.id)}>Approve</button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Leave Requests */}
                {leaveReqs.map(r => (
                  <div key={`lv-${r.id}`} className="req-card">
                    <div className="req-header">
                      <span className="badge badge-gray" style={{ backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)' }}>Leave Request</span>
                    </div>
                    <div className="req-body">
                      <div><strong>{r.emp}</strong> applied for {r.type} ({r.days} days) from <strong>{r.from}</strong> to <strong>{r.to}</strong>. Reason: "{r.reason}".</div>
                      <div className="req-actions">
                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => setRejectModal({type: 'leave', id: r.id})}>Reject</button>
                        <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => handleApprove('leave', r.id)}>Approve</button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Permission Requests */}
                {permReqs.map(r => (
                  <div key={`perm-${r.id}`} className="req-card">
                    <div className="req-header">
                      <span className="badge badge-warning" style={{ backgroundColor: 'var(--warning-100)', color: 'var(--warning-800)' }}>Permission Request</span>
                    </div>
                    <div className="req-body">
                      <div><strong>{r.emp}</strong> requested {r.type} on <strong>{r.date}</strong> from {r.start} to {r.end} ({r.duration}).</div>
                      <div className="req-actions">
                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => setRejectModal({type: 'perm', id: r.id})}>Reject</button>
                        <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => handleApprove('perm', r.id)}>Approve</button>
                      </div>
                    </div>
                  </div>
                ))}

              </div>
            )}
          </div>

          <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
            
            {/* Offices Overview */}
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Office Attendance
                <button onClick={() => navigate('/admin/offices')} className="icon-button" style={{ color: 'var(--primary-600)' }}><ArrowRight size={18}/></button>
              </h3>
              {loading ? (
                <div className="skeleton" style={{ height: '120px' }} />
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No office attendance available.</div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: '1rem' }}>Quick Actions</h3>
              {loading ? (
                <div className="skeleton" style={{ height: '120px' }} />
              ) : (
                <div className="quick-actions-grid">
                  <button onClick={() => navigate('/admin/employees')} className="btn btn-outline quick-action" style={{ fontSize: '0.75rem', padding: '0.5rem', justifyContent: 'flex-start' }}><Users size={14}/> <span>Add Employee</span></button>
                  <button onClick={() => navigate('/admin/shifts')} className="btn btn-outline quick-action" style={{ fontSize: '0.75rem', padding: '0.5rem', justifyContent: 'flex-start' }}><Briefcase size={14}/> <span>Manage Shifts</span></button>
                  <button onClick={() => navigate('/admin/payroll')} className="btn btn-outline quick-action" style={{ fontSize: '0.75rem', padding: '0.5rem', justifyContent: 'flex-start' }}><Wallet size={14}/> <span>Process Payroll</span></button>
                  <button onClick={() => navigate('/admin/reports')} className="btn btn-outline quick-action" style={{ fontSize: '0.75rem', padding: '0.5rem', justifyContent: 'flex-start' }}><Activity size={14}/> <span>View Reports</span></button>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Right Column (Sidebar) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', gridColumn: 'span 4' }}>
          
          {/* Today's Attendance Visual */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
              Attendance Today
              <button onClick={() => navigate('/admin/attendance')} className="icon-button" style={{ color: 'var(--primary-600)' }}><ArrowUpRight size={18}/></button>
            </h3>
            {loading ? (
              <div className="skeleton" style={{ height: '180px' }} />
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No attendance data available for today.</div>
            )}
          </div>

          {/* Shift Distribution */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
              Shift Distribution
              <button onClick={() => navigate('/admin/shifts')} className="icon-button" style={{ color: 'var(--primary-600)' }}><ArrowUpRight size={18}/></button>
            </h3>
            {loading ? (
              <div className="skeleton" style={{ height: '150px' }} />
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No shift assignments available.</div>
            )}
          </div>

          {/* Payroll Overview */}
          <div className="card" style={{ borderTop: '4px solid var(--primary-600)' }}>
            <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
              Payroll Status
              <button onClick={() => navigate('/admin/payroll')} className="icon-button" style={{ color: 'var(--primary-600)' }}><ArrowUpRight size={18}/></button>
            </h3>
            {loading ? (
              <div className="skeleton" style={{ height: '180px' }} />
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No payroll records found.</div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Recent Activity</h3>
            {loading ? (
              <div className="skeleton" style={{ height: '200px' }} />
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No audit activity available.</div>
            )}
          </div>

        </div>
      </div>

      {/* Employee Detail Drawer */}
      {selectedEmp && (
        <div className="drawer-overlay" onClick={() => setSelectedEmp(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Live Status Detail</h2>
              <button className="icon-button" onClick={() => setSelectedEmp(null)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <div className="avatar">{selectedEmp.name.substring(0,2).toUpperCase()}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{selectedEmp.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedEmp.id} • {selectedEmp.dept}</div>
                </div>
              </div>

              <div className="detail-grid">
                <div className="detail-item highlight">
                  <span className="detail-label">Status</span>
                  <span className={`badge ${getStatusBadge(selectedEmp.status)}`} style={{ width: 'fit-content', marginTop: '0.25rem' }}>{selectedEmp.status}</span>
                </div>
                <div className="detail-item highlight">
                  <span className="detail-label">Work Mode</span>
                  <span className="detail-value" style={{ fontWeight: 600 }}>{selectedEmp.mode}</span>
                </div>
                
                <div className="detail-item">
                  <span className="detail-label">Assigned Shift</span>
                  <span className="detail-value">{selectedEmp.shift}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Scheduled</span>
                  <span className="detail-value">{selectedEmp.scheduled}</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Clock In</span>
                  <span className="detail-value">{selectedEmp.in}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Location Verification</span>
                  <span className="detail-value" style={{ color: selectedEmp.loc === 'Verified' ? 'var(--success-600)' : 'var(--gray-500)' }}>{selectedEmp.loc}</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Live Working Time</span>
                  <span className="detail-value" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary-700)' }}>{selectedEmp.time}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Break Duration</span>
                  <span className="detail-value" style={{ fontSize: '1.25rem', fontWeight: 700 }}>{selectedEmp.break}</span>
                </div>
              </div>
              
              <button onClick={() => navigate('/admin/attendance')} className="btn btn-outline" style={{ width: '100%', marginTop: '2rem' }}>
                View Full Attendance Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldAlert size={20} color="var(--danger-600)" /> Reject Request
            </h3>
            <form onSubmit={handleRejectSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Reason for Rejection *</label>
                <textarea 
                  value={rejectReason} 
                  onChange={e => setRejectReason(e.target.value)} 
                  className="form-control" 
                  rows={3} 
                  placeholder="Provide a mandatory reason..." 
                  required
                ></textarea>
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setRejectModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Reject</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        .summary-card-small:hover { transform: translateY(-2px); box-shadow: var(--shadow-sm); }
        
        
        
        
        
        .dashboard-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 1.5rem; }
        @media (max-width: 1024px) { .dashboard-grid > div { grid-column: span 12 !important; } }
        
        .desktop-table { display: block; }
        .mobile-cards { display: none; }
        @media (max-width: 768px) {
          .desktop-table { display: none; }
          .mobile-cards { display: flex; flex-direction: column; padding: 0 1rem 1rem 1rem; }
          .mobile-hist-card { padding: 1rem; border-bottom: 1px solid var(--border-color); cursor: pointer; }
          .mobile-hist-card:active { background-color: var(--gray-50); }
        }

        .req-card { border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; }
        .req-header { background-color: var(--gray-50); padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); }
        .req-body { padding: 1rem; font-size: 0.875rem; color: var(--gray-700); display: flex; flex-direction: column; gap: 1rem; }
        .req-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }

        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; max-width: 450px; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: center; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-item.highlight { background-color: var(--gray-50); padding: 0.75rem; border-radius: var(--radius-md); }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
        .pulse-dot { animation: pulseTimeline 2s infinite; }
        @keyframes pulseTimeline { 0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); } 70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); } 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @media (max-width: 768px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminDashboard;



