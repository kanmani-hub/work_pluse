import { useDepartments } from '../../hooks/useDepartments';
import React, { useState, useEffect } from 'react';
import { exportService } from '../../services/export/exportService';
import { useNavigate } from 'react-router-dom';
import { 
  Clock, Search, Filter, Download, Settings, Plus, 
  CheckCircle2, XCircle, AlertTriangle, X, Eye, 
  Calendar, ChevronLeft, ChevronRight, BarChart2,
  Activity, ArrowRight, ShieldAlert, History
} from 'lucide-react';

import { permissionService } from '../../services/permission/permissionService';
import { realtimeService } from '../../services/realtime/realtimeService';

const mockUsage: any[] = [];

const AdminPermission: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  const [view, setView] = useState('Requests'); // Requests, Timeline, Usage
  
  // Filters
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const { departments, loading: deptLoading } = useDepartments();
  
  // Modals & Drawers
  const [detailDrawer, setDetailDrawer] = useState<any>(null);
  const [rejectModal, setRejectModal] = useState<any>(null);
  const [revokeModal, setRevokeModal] = useState<any>(null);
  const [approveModal, setApproveModal] = useState<any>(null);
  const [addDrawer, setAddDrawer] = useState(false);
  const [settingsDrawer, setSettingsDrawer] = useState(false);
  
  // Forms
  const [reasonForm, setReasonForm] = useState('');
  const [requests, setRequests] = useState<any[]>([]);

  const fetchRequests = async () => {
    setLoading(true);
    const { data } = await permissionService.getPermissionRequests();
    if (data) {
      setRequests(data.map((r: any) => {
        const hDur = Math.floor(r.duration_minutes / 60);
        const mDur = r.duration_minutes % 60;
        
        const formatTime = (t: string) => {
          if(!t) return '';
          const [hh, mm] = t.split(':');
          let hours = parseInt(hh, 10);
          const ampm = hours >= 12 ? 'PM' : 'AM';
          hours = hours % 12 || 12;
          return `${hours.toString().padStart(2, '0')}:${mm} ${ampm}`;
        };

        return {
          id: r.id,
          empId: r.employees?.employee_code || '-',
          name: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : 'Unknown',
          dept: r.employees?.departments?.name || '-',
            department_id: r.employees?.department_id || null,
          date: new Date(r.permission_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          startTime: formatTime(r.start_time),
          endTime: formatTime(r.end_time),
          duration: `${hDur}h ${mDur}m`,
          reason: r.reason,
          status: r.status,
          shift: '-', // Mocks
          conflict: 'None',
          appliedOn: new Date(r.requested_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          reviewer_remarks: r.reviewer_remarks
        };
      }));
    }
    setLoading(false);
  };

  useEffect(() => {

    
    
    fetchRequests();

    const channel = realtimeService.subscribeToAdminPermission((payload) => {
      fetchRequests();
    });

    return () => {
      realtimeService.unsubscribe(channel);
    };
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filteredRequests = requests.filter(r => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase()) || r.empId.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? r.department_id === null : r.department_id === filterDept;
    const matchStatus = filterStatus === 'All' || r.status === filterStatus;
    return matchSearch && matchDept && matchStatus;
  });

  const pendingRequests = requests.filter(r => r.status === 'PENDING');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING': return <span className="badge badge-warning">PENDING</span>;
      case 'APPROVED': return <span className="badge badge-success">APPROVED</span>;
      case 'REJECTED': return <span className="badge badge-danger">REJECTED</span>;
      case 'CANCELLED': 
      case 'REVOKED': return <span className="badge badge-gray">{status}</span>;
      case 'ACTIVE': return <span className="badge badge-primary">ACTIVE</span>;
      case 'COMPLETED': return <span className="badge badge-success">COMPLETED</span>;
      default: return <span className="badge badge-gray">{status}</span>;
    }
  };

  const calculateDuration = (start: string, end: string) => {
    if (!start || !end) return '0h 0m';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) return 'Invalid';
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}h ${m}m`;
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveModal) return;
    const { error } = await permissionService.reviewPermissionRequest(approveModal, 'APPROVED', reasonForm);
    if (error) {
      alert(error.message);
      return;
    }
    setApproveModal(null);
    setReasonForm('');
    showToast('Permission approved successfully.');
    fetchRequests();
    setDetailDrawer(null);
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonForm || !rejectModal) return;
    const { error } = await permissionService.reviewPermissionRequest(rejectModal, 'REJECTED', reasonForm);
    if (error) {
      alert(error.message);
      return;
    }
    setRejectModal(null);
    setReasonForm('');
    showToast('Permission request rejected.');
    fetchRequests();
    setDetailDrawer(null);
  };

  const handleRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonForm || !revokeModal) return;
    const { error } = await permissionService.reviewPermissionRequest(revokeModal, 'CANCELLED', reasonForm);
    if (error) {
      alert(error.message);
      return;
    }
    setRevokeModal(null);
    setReasonForm('');
    showToast('Permission revoked successfully.');
    fetchRequests();
    setDetailDrawer(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {toast && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Permission Management</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Review employee permission requests, working-hour exceptions, limits, and attendance impact.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setSettingsDrawer(true)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Settings size={16}/> Permission Settings</button>
          <button onClick={() => exportService.excel(filteredRequests.map(r => ({ employee: r.employees ? `${(r.employees as any).first_name} ${(r.employees as any).last_name}` : '-', permission_date: r.permission_date, start_time: r.start_time, end_time: r.end_time, duration: r.duration_minutes, status: r.status, reason: r.reason })), [{ header: 'Employee', key: 'employee', width: 22 }, { header: 'Date', key: 'permission_date', width: 14 }, { header: 'Start', key: 'start_time', width: 10 }, { header: 'End', key: 'end_time', width: 10 }, { header: 'Minutes', key: 'duration', width: 10 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Reason', key: 'reason', width: 30 }], `permission_export_${new Date().toISOString().split('T')[0]}`)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export Excel</button>
          <button onClick={() => setAddDrawer(true)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Plus size={16}/> Add Permission</button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
          {[...Array(7)].map((_, i) => <div key={i} className="skeleton" style={{ height: '70px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (() => {
        let totalMinutes = 0;
        requests.forEach(r => {
          if (r.status === 'APPROVED') {
             const m = r.duration.match(/(\d+)h (\d+)m/);
             if (m) {
               totalMinutes += parseInt(m[1]) * 60 + parseInt(m[2]);
             }
          }
        });
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        const kpis = {
          total: requests.length,
          pending: pendingRequests.length,
          approvedToday: requests.filter(r => r.status === 'APPROVED' && r.appliedOn === new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })).length,
          activeToday: requests.filter(r => r.status === 'APPROVED' && r.date === new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })).length,
          rejected: requests.filter(r => r.status === 'REJECTED').length,
          totalHours: `${h}h ${m}m`,
          alerts: 0 // usage alerts not implemented in mock
        };
        return (
        <div className="kpi-grid">
          <div className="tracking-kpi-card">
            <div className="sc-val">{kpis.total}</div>
            <div className="sc-title">Total Requests</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => { setView('Requests'); setFilterStatus('PENDING'); }}>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{kpis.pending}</div>
            <div className="sc-title">Pending</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-val" style={{ color: 'var(--success)' }}>{kpis.approvedToday}</div>
            <div className="sc-title">Approved Today</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{kpis.activeToday}</div>
            <div className="sc-title">Active Today</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => { setView('Requests'); setFilterStatus('REJECTED'); }}>
            <div className="sc-val" style={{ color: 'var(--text-secondary)' }}>{kpis.rejected}</div>
            <div className="sc-title">Rejected</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-val">{kpis.totalHours}</div>
            <div className="sc-title">Total Hours</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setView('Usage')}>
            <div className="sc-val" style={{ color: 'var(--danger)' }}>{kpis.alerts}</div>
            <div className="sc-title">Limit Alerts</div>
          </div>
        </div>
        );
      })()}

      {/* Date & View Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--gray-200)', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem' }}>
          {['Requests', 'Timeline', 'Usage'].map(v => (
            <button key={v} onClick={() => setView(v)} className="tab-button" style={{ 
              padding: '0.75rem 1rem', background: 'none', border: 'none', 
              borderBottom: view === v ? '2px solid var(--primary-600)' : '2px solid transparent',
              color: view === v ? 'var(--primary-700)' : 'var(--gray-600)',
              fontWeight: view === v ? 600 : 500, cursor: 'pointer'
            }}>
              {v}
            </button>
          ))}
        </div>
        
        <div style={{ display: 'flex', gap: '0.5rem', paddingBottom: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-elevated)' }}>
            <button className="icon-button" style={{ borderRight: '1px solid var(--border-color)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)' }}><ChevronLeft size={16}/></button>
            <div style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem', fontWeight: 600 }}>24 Sep 2026</div>
            <button className="icon-button" style={{ borderLeft: '1px solid var(--border-color)', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}><ChevronRight size={16}/></button>
          </div>
          <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem', padding: '0.375rem 1rem' }}>
            <option>Today</option><option>This Week</option><option>This Month</option><option>Custom Range</option>
          </select>
        </div>
      </div>

      {view === 'Requests' && (
        <>
          {/* Pending Priority Block */}
          {pendingRequests.length > 0 && !loading && filterStatus === 'All' && (
            <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--warning)' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={18} color="var(--warning-600)" /> Pending Approval ({pendingRequests.length})
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '1rem' }}>
                {pendingRequests.map(r => (
                  <div key={r.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div className="badge badge-gray">{r.duration}</div>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                      <Clock size={12} style={{ display: 'inline', marginRight: '4px' }}/>{r.date} • {r.startTime} - {r.endTime}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontStyle: 'italic' }}>"{r.reason}"</div>
                    
                    {r.conflict !== 'None' && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--danger)', backgroundColor: 'var(--danger-50)', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 500, marginBottom: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <ShieldAlert size={12} /> {r.conflict}
                      </div>
                    )}
                    
                    <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem', paddingTop: '0.75rem' }}>
                      <button onClick={() => setApproveModal(r.id)} className="btn btn-primary" style={{ flex: 1, padding: '0.25rem 0', fontSize: '0.75rem' }}>Approve</button>
                      <button onClick={() => setRejectModal(r.id)} className="btn btn-outline" style={{ flex: 1, padding: '0.25rem 0', fontSize: '0.75rem', color: 'var(--danger-600)', borderColor: 'var(--danger-300)' }}>Reject</button>
                      <button onClick={() => setDetailDrawer(r)} className="icon-button border"><Eye size={16}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Table */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: '220px' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee..." className="form-control" style={{ paddingLeft: '2.25rem', fontSize: '0.875rem' }} />
              </div>
              
              <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
                  <option value="All">All Departments</option>
                  {deptLoading ? (
                    <option disabled>Loading...</option>
                  ) : (
                    <>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                      <option value="Unassigned">Unassigned</option>
                    </>
                  )}
                </select>

              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
                <option value="All">All Statuses</option><option>PENDING</option><option>APPROVED</option><option>REJECTED</option><option>REVOKED</option>
              </select>
              
              <button className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}><Filter size={14} style={{ marginRight: '0.25rem' }}/> More</button>
              
              {(search || filterDept !== 'All' || filterStatus !== 'All') && (
                <button onClick={() => { setSearch(''); setFilterDept('All'); setFilterStatus('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Clear</button>
              )}
            </div>

            {loading ? (
              <div className="skeleton" style={{ height: '400px', margin: '1rem' }} />
            ) : filteredRequests.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <Clock size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
                <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No permissions found</h3>
              </div>
            ) : (
              <div className="table-container desktop-only">
                <table className="table" style={{ width: '100%', minWidth: '1000px' }}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Duration</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Attendance Impact</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map(r => (
                      <tr key={r.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.empId} • {r.dept}</div>
                        </td>
                        <td style={{ fontWeight: 500 }}>{r.date}</td>
                        <td style={{ fontWeight: 500 }}>{r.startTime} - {r.endTime}</td>
                        <td><div style={{ fontWeight: 600, color: 'var(--primary-700)' }}>{r.duration}</div></td>
                        <td style={{ maxWidth: '200px' }}><div style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.reason}</div></td>
                        <td>{getStatusBadge(r.status)}</td>
                        <td>
                          {r.status === 'APPROVED' ? <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Authorized Absence</span> : <span style={{ fontSize: '0.75rem', color: 'var(--warning-600)' }}>Pending</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => setDetailDrawer(r)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            {/* Mobile Cards omitted for brevity, represented identically to leave module via desktop-only class */}
          </div>
        </>
      )}

      {view === 'Timeline' && (
        <div className="card" style={{ padding: '2rem' }}>
          <h3 className="section-title">Permission Timeline (24 Sep 2026)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ position: 'relative', borderTop: '2px dashed var(--gray-300)', paddingTop: '1rem', marginTop: '1rem' }}>
              <div style={{ position: 'absolute', top: '-12px', left: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-elevated)', padding: '0 4px' }}>09:00 AM</div>
              <div style={{ position: 'absolute', top: '-12px', right: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-elevated)', padding: '0 4px' }}>06:00 PM</div>
              
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>No timeline data available.</div>
            </div>
          </div>
        </div>
      )}

      {view === 'Usage' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-container">
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th style={{ textAlign: 'right' }}>Allowed</th>
                  <th style={{ textAlign: 'right' }}>Used</th>
                  <th style={{ textAlign: 'right' }}>Pending</th>
                  <th style={{ textAlign: 'right' }}>Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {mockUsage.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No usage data available</td></tr>
                ) : (
                  mockUsage.map((u, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{u.name} <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>({u.empId})</span></td>
                      <td style={{ textAlign: 'right' }}>{u.allowed}</td>
                      <td style={{ textAlign: 'right' }}>{u.used}</td>
                      <td style={{ textAlign: 'right' }}>{u.pending}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: u.remaining === '0h' ? 'var(--danger-600)' : 'var(--primary-700)' }}>{u.remaining}</td>
                      <td>
                        {u.status === 'Limit Alert' ? <span className="badge badge-danger">LIMIT ALERT</span> : <span className="badge badge-success">NORMAL</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {detailDrawer && (
        <div className="drawer-overlay" onClick={() => setDetailDrawer(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ alignItems: 'flex-start' }}>
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Permission Request</h2>
                  <button className="icon-button" onClick={() => setDetailDrawer(null)}><X size={20} /></button>
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
                  {getStatusBadge(detailDrawer.status)}
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Applied on {detailDrawer.appliedOn}</span>
                </div>
              </div>
            </div>
            
            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* Actions */}
              {detailDrawer.status === 'PENDING' && (
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button onClick={() => setApproveModal(detailDrawer.id)} className="btn btn-primary" style={{ flex: 1 }}>Approve Permission</button>
                  <button onClick={() => setRejectModal(detailDrawer.id)} className="btn btn-outline" style={{ flex: 1, color: 'var(--danger-600)', borderColor: 'var(--danger-300)' }}>Reject</button>
                </div>
              )}
              {detailDrawer.status === 'APPROVED' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setRevokeModal(detailDrawer.id)} className="btn btn-outline" style={{ color: 'var(--danger-600)', borderColor: 'var(--danger-300)' }}>Revoke Permission</button>
                </div>
              )}

              {/* Conflict Warnings */}
              {detailDrawer.conflict !== 'None' && detailDrawer.status === 'PENDING' && (
                <div style={{ backgroundColor: 'var(--warning-50)', border: '1px solid var(--warning-200)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--warning-800)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <ShieldAlert size={16} /> {detailDrawer.conflict.includes('LEAVE') ? 'Leave Conflict' : detailDrawer.conflict === 'WFH' ? 'WFH Schedule' : 'Shift Schedule Conflict'}
                  </h4>
                  <p style={{ fontSize: '0.875rem', color: 'var(--warning-900)' }}>
                    {detailDrawer.conflict === 'Outside Scheduled Shift' && 'Permission period is outside the assigned shift.'}
                    {detailDrawer.conflict === 'WFH' && 'Employee is scheduled for WFH on this date.'}
                    {detailDrawer.conflict.includes('LEAVE') && 'Permission overlaps with approved leave.'}
                  </p>
                </div>
              )}
              {detailDrawer.conflict === 'None' && detailDrawer.status === 'PENDING' && (
                <div style={{ backgroundColor: 'var(--success-50)', border: '1px solid var(--success-200)', padding: '0.75rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', color: 'var(--success-800)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={16} /> Within Scheduled Shift
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <h3 className="section-title">Employee</h3>
                  <div className="info-block">
                    <div className="info-label">Name</div><div className="info-val">{detailDrawer.name}</div>
                    <div className="info-label">Shift</div><div className="info-val">{detailDrawer.shift}</div>
                  </div>
                </div>
                <div>
                  <h3 className="section-title">Request</h3>
                  <div className="info-block">
                    <div className="info-label">Date</div><div className="info-val">{detailDrawer.date}</div>
                    <div className="info-label">Time</div><div className="info-val" style={{ color: 'var(--primary-700)', fontWeight: 600 }}>{detailDrawer.startTime} - {detailDrawer.endTime}</div>
                    <div className="info-label">Duration</div><div className="info-val">{detailDrawer.duration}</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="section-title">Reason</h3>
                <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', border: '1px solid var(--gray-200)' }}>{detailDrawer.reason}</div>
              </div>

              <div>
                <h3 className="section-title">Attendance Impact</h3>
                <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px dashed var(--gray-300)' }}>
                  <div style={{ fontSize: '0.875rem' }}>Approved permission represents an authorized absence during the specified period.</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    Scheduled Shift: {detailDrawer.shift}<br/>
                    Permission: {detailDrawer.startTime} → {detailDrawer.endTime}<br/>
                    Permission Duration: <span style={{ color: 'var(--primary-600)', fontWeight: 600 }}>{detailDrawer.duration}</span>
                  </div>
                  {detailDrawer.status === 'APPROVED' && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <CheckCircle2 size={12}/> Authorized for attendance processing.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="section-title">Usage & Limits (Monthly)</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                  <div className="balance-card"><div className="bc-label">Allowed</div><div className="bc-val">Policy</div></div>
                  <div className="balance-card"><div className="bc-label">Used</div><div className="bc-val">-</div></div>
                  <div className="balance-card"><div className="bc-label">Pending</div><div className="bc-val">-</div></div>
                  <div className="balance-card" style={{ backgroundColor: 'var(--primary-50)', border: '1px solid var(--primary-200)' }}><div className="bc-label" style={{ color: 'var(--primary-700)' }}>Remaining</div><div className="bc-val" style={{ color: 'var(--primary-800)' }}>-</div></div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Approve Modal */}
      {approveModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Approve Permission?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Approving this request will record the approved permission period for attendance processing.</p>
            <form onSubmit={handleApprove} style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setApproveModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Approve Permission</button>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>Reject Permission</h3>
            <form onSubmit={handleReject} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div><label className="form-label">Rejection Reason *</label><textarea required className="form-control" rows={3} value={reasonForm} onChange={e => setReasonForm(e.target.value)}></textarea></div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setRejectModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Reject</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke Modal */}
      {revokeModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>Revoke Permission</h3>
            <form onSubmit={handleRevoke} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div><label className="form-label">Reason *</label><textarea required className="form-control" rows={3} value={reasonForm} onChange={e => setReasonForm(e.target.value)}></textarea></div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setRevokeModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Revoke</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Permission Drawer */}
      {addDrawer && (
        <div className="drawer-overlay" onClick={() => setAddDrawer(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Add Permission (Admin)</h2>
              <button className="icon-button" onClick={() => setAddDrawer(false)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <form onSubmit={e => { e.preventDefault(); setAddDrawer(false); showToast('Permission added successfully'); }} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div><label className="form-label">Employee</label><select className="form-control"><option>Select Employee</option></select></div>
                <div><label className="form-label">Date</label><input type="date" className="form-control"/></div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}><label className="form-label">Start Time</label><input type="time" className="form-control" defaultValue="14:00" id="pt_start"/></div>
                  <div style={{ flex: 1 }}><label className="form-label">End Time</label><input type="time" className="form-control" defaultValue="15:30" id="pt_end"/></div>
                </div>
                <div><label className="form-label">Duration</label><input type="text" className="form-control" disabled value="1h 30m" style={{ backgroundColor: 'var(--gray-100)' }}/></div>
                <div><label className="form-label">Reason *</label><textarea required className="form-control" rows={3}></textarea></div>
                <div><label className="form-label">Status</label><select className="form-control"><option>Approved</option><option>Pending</option></select></div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="submit" className="btn btn-primary">Save Permission</button></div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Settings Drawer */}
      {settingsDrawer && (
        <div className="drawer-overlay" onClick={() => setSettingsDrawer(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Permission Rules</h2>
              <button className="icon-button" onClick={() => setSettingsDrawer(false)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontWeight: 600 }}>Enable Permission Requests</div><div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Allow employees to request permissions.</div></div>
                  <input type="checkbox" defaultChecked />
                </div>
                <div>
                  <label className="form-label">Max Permissions Per Month (Hours)</label>
                  <input type="number" className="form-control" defaultValue={10} />
                </div>
                <div>
                  <label className="form-label">Max Duration Per Request (Hours)</label>
                  <input type="number" className="form-control" defaultValue={2} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontWeight: 600 }}>Require Manager Approval</div></div>
                  <input type="checkbox" defaultChecked />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        
        
        
        
        
        
        .info-block { display: grid; grid-template-columns: 80px 1fr; gap: 0.5rem; font-size: 0.875rem; }
        .info-label { color: var(--gray-500); }
        .info-val { font-weight: 500; color: var(--gray-900); }
        
        .balance-card { background-color: var(--gray-50); padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--gray-200); text-align: center; }
        .bc-label { font-size: 0.75rem; color: var(--gray-500); margin-bottom: 0.25rem; }
        .bc-val { font-size: 1.25rem; font-weight: 700; color: var(--gray-900); }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: flex-start; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        .desktop-only { display: block; }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        
        @media (max-width: 900px) {  }
        @media (max-width: 600px) {
          
          .drawer-overlay { align-items: flex-end; }
          .drawer, .wide-drawer { height: 95vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminPermission;



