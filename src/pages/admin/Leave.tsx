import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar as CalendarIcon, CalendarDays, Search, Filter, 
  Download, Settings, Plus, CheckCircle2, XCircle, AlertTriangle, 
  X, Eye, Edit, Trash2, ShieldCheck, Clock, FileText, ArrowRight
} from 'lucide-react';

import { leaveService } from '../../services/leave/leaveService';
import { realtimeService } from '../../services/realtime/realtimeService';


const AdminLeave: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  const [view, setView] = useState('Requests'); // Requests, Calendar, Balances
  
  // Filters
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterType, setFilterType] = useState('All');
  
  // Modals & Drawers
  const [detailDrawer, setDetailDrawer] = useState<any>(null);
  const [rejectModal, setRejectModal] = useState<any>(null); // leave id
  const [revokeModal, setRevokeModal] = useState<any>(null); // leave id
  const [approveModal, setApproveModal] = useState<any>(null); // leave id
  const [addLeaveDrawer, setAddLeaveDrawer] = useState(false);
  const [settingsDrawer, setSettingsDrawer] = useState(false);
  
  // Forms
  const [reasonForm, setReasonForm] = useState('');
  const [requests, setRequests] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);

  const fetchRequests = async () => {
    setLoading(true);
    const { data } = await leaveService.getLeaveRequests();
    if (data) {
      setRequests(data.map((r: any) => ({
        id: r.id,
        empId: r.employees?.employee_code || '-',
        name: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : 'Unknown',
        dept: r.employees?.departments?.name || '-',
        type: r.leave_types?.name || '-',
        dates: r.start_date === r.end_date 
          ? new Date(r.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
          : `${new Date(r.start_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} - ${new Date(r.end_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`,
        duration: `${r.total_days} Days`,
        reason: r.reason,
        status: r.status,
        appliedOn: new Date(r.requested_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        office: '-',
        halfDay: r.is_half_day,
        half: r.half_day_type,
        conflicts: [],
        reviewer_remarks: r.reviewer_remarks
      })));
    }
    
    const { data: balData } = await leaveService.getAllLeaveBalances();
    if (balData) {
      setBalances(balData.map((b: any) => ({
        name: b.employees ? `${b.employees.first_name} ${b.employees.last_name}` : 'Unknown',
        dept: b.employees?.departments?.name || '-',
        empId: b.employees?.employee_code || '-',
        type: b.leave_types?.name || '-',
        allocated: b.total_days,
        used: b.used_days,
        pending: b.pending_days,
        remaining: Math.max(0, b.total_days - b.used_days - b.pending_days)
      })));
    }
    
    setLoading(false);
  };

  useEffect(() => {

    
    
    fetchRequests();

    const channel = realtimeService.subscribeToAdminLeave((payload) => {
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
    const matchDept = filterDept === 'All' || r.dept === filterDept;
    const matchStatus = filterStatus === 'All' || r.status === filterStatus;
    const matchType = filterType === 'All' || r.type === filterType;
    return matchSearch && matchDept && matchStatus && matchType;
  });

  const pendingRequests = requests.filter(r => r.status === 'PENDING');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING': return <span className="badge badge-warning">PENDING</span>;
      case 'APPROVED': return <span className="badge badge-success">APPROVED</span>;
      case 'REJECTED': return <span className="badge badge-danger">REJECTED</span>;
      case 'REVOKED': return <span className="badge" style={{ backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)' }}>REVOKED</span>;
      default: return <span className="badge badge-gray">{status}</span>;
    }
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveModal) return;
    const { error } = await leaveService.reviewLeaveRequest(approveModal, 'APPROVED', reasonForm);
    if (error) {
      alert(error.message);
      return;
    }
    setApproveModal(null);
    setReasonForm('');
    showToast('Leave approved successfully.');
    fetchRequests();
    setDetailDrawer(null);
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonForm || !rejectModal) return;
    const { error } = await leaveService.reviewLeaveRequest(rejectModal, 'REJECTED', reasonForm);
    if (error) {
      alert(error.message);
      return;
    }
    setRejectModal(null);
    setReasonForm('');
    showToast('Leave request rejected.');
    fetchRequests();
    setDetailDrawer(null);
  };

  const handleRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonForm || !revokeModal) return;
    const { error } = await leaveService.reviewLeaveRequest(revokeModal, 'CANCELLED', reasonForm);
    if (error) {
      alert(error.message);
      return;
    }
    setRevokeModal(null);
    setReasonForm('');
    showToast('Leave revoked successfully.');
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
          <h1 className="page-title">Leave Management</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Review employee leave requests, balances, policies, and leave schedules.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => setSettingsDrawer(true)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Settings size={16}/> Leave Settings</button>
          <button onClick={() => showToast('Leave report prepared successfully.')} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export</button>
          <button onClick={() => setAddLeaveDrawer(true)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Plus size={16}/> Add Leave</button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
          {[...Array(7)].map((_, i) => <div key={i} className="skeleton" style={{ height: '70px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (() => {
        const kpis = {
          total: requests.length,
          pending: pendingRequests.length,
          approvedToday: requests.filter(r => r.status === 'APPROVED' && r.appliedOn === new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })).length,
          onLeaveToday: requests.filter(r => r.status === 'APPROVED' && r.dates.includes(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }))).length,
          halfDay: requests.filter(r => r.halfDay).length,
          alerts: requests.filter(r => r.conflicts?.length > 0).length,
          rejected: requests.filter(r => r.status === 'REJECTED').length
        };
        return (
        <div className="kpi-grid">
          <div className="tracking-kpi-card">
            <div className="sc-val">{kpis.total}</div>
            <div className="sc-title">Total Requests</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => { setView('Requests'); setFilterStatus('PENDING'); }}>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{kpis.pending}</div>
            <div className="sc-title">Pending Requests</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-val" style={{ color: 'var(--success)' }}>{kpis.approvedToday}</div>
            <div className="sc-title">Approved Today</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{kpis.onLeaveToday}</div>
            <div className="sc-title">On Leave Today</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-val">{kpis.halfDay}</div>
            <div className="sc-title">Half Day</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setView('Balances')}>
            <div className="sc-val" style={{ color: 'var(--danger)' }}>{kpis.alerts}</div>
            <div className="sc-title">Balance Alerts</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => { setView('Requests'); setFilterStatus('REJECTED'); }}>
            <div className="sc-val" style={{ color: 'var(--text-secondary)' }}>{kpis.rejected}</div>
            <div className="sc-title">Rejected</div>
          </div>
        </div>
        );
      })()}

      {/* View Tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--gray-200)' }}>
        {['Requests', 'Calendar', 'Balances'].map(v => (
          <button key={v} onClick={() => setView(v)} className="tab-button" style={{ 
            padding: '0.75rem 1rem', 
            background: 'none', 
            border: 'none', 
            borderBottom: view === v ? '2px solid var(--primary-600)' : '2px solid transparent',
            color: view === v ? 'var(--primary-700)' : 'var(--gray-600)',
            fontWeight: view === v ? 600 : 500,
            cursor: 'pointer'
          }}>
            {v}
          </button>
        ))}
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
                {pendingRequests.slice(0, 3).map(r => (
                  <div key={r.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div className="badge badge-gray">{r.duration}</div>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{r.type} • {r.dates}</div>
                    
                    {r.conflicts.length > 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--danger-600)', fontWeight: 500, marginBottom: '0.75rem' }}>
                        Conflict: {r.conflicts.join(', ')}
                      </div>
                    )}
                    
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                      <button onClick={() => setApproveModal(r.id)} className="btn btn-primary" style={{ flex: 1, padding: '0.25rem 0', fontSize: '0.75rem' }}>Approve</button>
                      <button onClick={() => setRejectModal(r.id)} className="btn btn-outline" style={{ flex: 1, padding: '0.25rem 0', fontSize: '0.75rem', color: 'var(--danger-600)', borderColor: 'var(--danger-300)' }}>Reject</button>
                      <button onClick={() => setDetailDrawer(r)} className="icon-button border"><Eye size={16}/></button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Table Card */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', width: '220px' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee..." className="form-control" style={{ paddingLeft: '2.25rem', fontSize: '0.875rem' }} />
              </div>
              
              <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
                <option value="All">All Departments</option>
              
                
                
                
                
              </select>

              <select value={filterType} onChange={e => setFilterType(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
                <option value="All">All Leave Types</option>
                <option>Casual Leave</option>
                <option>Sick Leave</option>
                <option>Privilege Leave</option>
              </select>

              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
                <option value="All">All Statuses</option>
                <option>PENDING</option>
                <option>APPROVED</option>
                <option>REJECTED</option>
                <option>REVOKED</option>
              </select>
              
              <button className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}><Filter size={14} style={{ marginRight: '0.25rem' }}/> Date Range</button>
              
              {(search || filterDept !== 'All' || filterType !== 'All' || filterStatus !== 'All') && (
                <button onClick={() => { setSearch(''); setFilterDept('All'); setFilterType('All'); setFilterStatus('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Clear</button>
              )}
            </div>

            {loading ? (
              <div className="skeleton" style={{ height: '400px', margin: '1rem' }} />
            ) : filteredRequests.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <FileText size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
                <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No pending leave requests</h3>
                <p style={{ marginTop: '0.5rem' }}>All leave requests have been reviewed.</p>
              </div>
            ) : (
              <div className="table-container desktop-only">
                <table className="table" style={{ width: '100%', minWidth: '1000px' }}>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Leave Type</th>
                      <th>Dates</th>
                      <th>Duration</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Applied On</th>
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
                        <td style={{ fontWeight: 500 }}>{r.type}</td>
                        <td style={{ fontWeight: 500 }}>{r.dates}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.duration}</div>
                          {r.halfDay && <div style={{ fontSize: '0.75rem', color: 'var(--primary-600)' }}>{r.half}</div>}
                        </td>
                        <td style={{ maxWidth: '200px' }}>
                          <div style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.reason}</div>
                        </td>
                        <td>{getStatusBadge(r.status)}</td>
                        <td style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{r.appliedOn}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => setDetailDrawer(r)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>View</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && filteredRequests.length > 0 && (
              <div className="mobile-only" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filteredRequests.map(r => (
                  <div key={r.id} className="card" style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '1rem' }}>{r.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.type}</div>
                      </div>
                      <div>{getStatusBadge(r.status)}</div>
                    </div>
                    <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}><strong>{r.dates}</strong> ({r.duration})</div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                      <button onClick={() => setDetailDrawer(r)} className="btn btn-outline" style={{ flex: 1, fontSize: '0.875rem' }}>View</button>
                      {r.status === 'PENDING' && <button onClick={() => setApproveModal(r.id)} className="btn btn-primary" style={{ flex: 1, fontSize: '0.875rem' }}>Approve</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {view === 'Calendar' && (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <CalendarIcon size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
          <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>Calendar View Prototype</h3>
          <p style={{ marginTop: '0.5rem' }}>Mock visualization of approved, pending, and half-day leaves plotted on a calendar grid.</p>
          <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center', fontFamily: 'monospace', whiteSpace: 'pre-wrap', textAlign: 'left', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
{`        Mon  Tue  Wed  Thu  Fri
EmpA     —   CL   CL   —    —
EmpB     —   SL   —    —   WFH
EmpC     AL  AL   —    —    —`}
          </div>
        </div>
      )}

      {view === 'Balances' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-container">
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Leave Type</th>
                  <th style={{ textAlign: 'right' }}>Allocated</th>
                  <th style={{ textAlign: 'right' }}>Used</th>
                  <th style={{ textAlign: 'right' }}>Pending</th>
                  <th style={{ textAlign: 'right' }}>Remaining</th>
                </tr>
              </thead>
              <tbody>
                {balances.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No records found</td></tr>
                ) : (
                  balances.map((b, i) => (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{b.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{b.dept} • {b.empId}</div>
                      </td>
                      <td style={{ fontWeight: 500 }}>{b.type}</td>
                      <td style={{ textAlign: 'right' }}>{b.allocated}</td>
                      <td style={{ textAlign: 'right' }}>{b.used}</td>
                      <td style={{ textAlign: 'right' }}>{b.pending}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: b.remaining <= 1 ? 'var(--danger-600)' : 'var(--primary-700)' }}>
                        {b.remaining} {b.remaining <= 1 && <AlertTriangle size={12} style={{ marginLeft: '4px' }}/>}
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
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Leave Request</h2>
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
                  <button onClick={() => setApproveModal(detailDrawer.id)} className="btn btn-primary" style={{ flex: 1 }}>Approve Request</button>
                  <button onClick={() => setRejectModal(detailDrawer.id)} className="btn btn-outline" style={{ flex: 1, color: 'var(--danger-600)', borderColor: 'var(--danger-300)' }}>Reject Request</button>
                </div>
              )}
              {detailDrawer.status === 'APPROVED' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => setRevokeModal(detailDrawer.id)} className="btn btn-outline" style={{ color: 'var(--danger-600)', borderColor: 'var(--danger-300)' }}>Revoke Approved Leave</button>
                </div>
              )}

              {/* Conflict Warnings */}
              {detailDrawer.conflicts.length > 0 && detailDrawer.status === 'PENDING' && (
                <div style={{ backgroundColor: 'var(--warning-50)', border: '1px solid var(--warning-200)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--warning-800)', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <AlertTriangle size={16} /> Schedule Conflict Detected
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.875rem', color: 'var(--warning-900)' }}>
                    {detailDrawer.conflicts.map((c: string, i: number) => <li key={i}>{c}</li>)}
                  </ul>
                  <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.5rem' }}>Approving this request will override the existing roster assignment for these dates.</p>
                </div>
              )}

              {/* Employee & Leave Info Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <h3 className="section-title">Employee Information</h3>
                  <div className="info-block">
                    <div className="info-label">Employee</div><div className="info-val">{detailDrawer.name} ({detailDrawer.empId})</div>
                    <div className="info-label">Department</div><div className="info-val">{detailDrawer.dept}</div>
                    <div className="info-label">Office</div><div className="info-val">{detailDrawer.office} Office</div>
                  </div>
                </div>
                <div>
                  <h3 className="section-title">Leave Information</h3>
                  <div className="info-block">
                    <div className="info-label">Leave Type</div><div className="info-val">{detailDrawer.type}</div>
                    <div className="info-label">Dates</div><div className="info-val">{detailDrawer.dates}</div>
                    <div className="info-label">Duration</div>
                    <div className="info-val">{detailDrawer.duration} {detailDrawer.halfDay && <span className="badge badge-gray">{detailDrawer.half}</span>}</div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="section-title">Reason</h3>
                <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', border: '1px solid var(--gray-200)' }}>
                  {detailDrawer.reason}
                </div>
              </div>

              <div>
                <h3 className="section-title">Leave Balance ({detailDrawer.type})</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                  <div className="balance-card">
                    <div className="bc-label">Available</div><div className="bc-val">12</div>
                  </div>
                  <div className="balance-card">
                    <div className="bc-label">Used</div><div className="bc-val">4</div>
                  </div>
                  <div className="balance-card">
                    <div className="bc-label">Pending</div><div className="bc-val">2</div>
                  </div>
                  <div className="balance-card" style={{ backgroundColor: 'var(--primary-50)', border: '1px solid var(--primary-200)' }}>
                    <div className="bc-label" style={{ color: 'var(--primary-700)' }}>Remaining</div><div className="bc-val" style={{ color: 'var(--primary-800)' }}>6</div>
                  </div>
                </div>
              </div>

              {detailDrawer.status === 'APPROVED' && (
                <div>
                  <h3 className="section-title">Attendance Impact</h3>
                  <div style={{ backgroundColor: 'var(--primary-50)', padding: '1rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <ArrowRight size={20} color="var(--primary-500)" />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--primary-800)' }}>Expected Attendance: LEAVE</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--primary-600)' }}>Leave overrides normal work expectation for {detailDrawer.dates}.</div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h3 className="section-title">Request Timeline</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingLeft: '1rem', borderLeft: '2px solid var(--gray-200)' }}>
                  <div style={{ position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--gray-400)', border: '2px solid white' }}></div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Leave Requested</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>23 Sep 2026, 09:15 AM by Employee</div>
                  </div>
                  {detailDrawer.status !== 'PENDING' && (
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.35rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: detailDrawer.status === 'APPROVED' ? 'var(--success)' : 'var(--danger)', border: '2px solid white' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{detailDrawer.status}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>24 Sep 2026, 11:35 AM by Admin</div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Approval Modal */}
      {approveModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Approve Leave?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Approving this request will mark these dates as approved leave for the employee.</p>
            <form onSubmit={handleApprove} style={{ display: 'flex', gap: '1rem' }}>
              <button type="button" onClick={() => setApproveModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Approve Leave</button>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>Reject Leave Request</h3>
            <form onSubmit={handleReject} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">Rejection Reason *</label>
                <textarea required className="form-control" rows={3} placeholder="e.g. Insufficient leave balance" value={reasonForm} onChange={e => setReasonForm(e.target.value)}></textarea>
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setRejectModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Reject Leave</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke Modal */}
      {revokeModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s', borderTop: '4px solid var(--danger)' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Revoke Approved Leave?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Are you sure you want to revoke this approved leave? Historical records will remain available.</p>
            <form onSubmit={handleRevoke} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label">Revocation Reason *</label>
                <textarea required className="form-control" rows={3} placeholder="Reason for revoking..." value={reasonForm} onChange={e => setReasonForm(e.target.value)}></textarea>
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setRevokeModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, backgroundColor: 'var(--danger-600)', borderColor: 'var(--danger-600)' }}>Revoke Leave</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Drawer Placeholder */}
      {settingsDrawer && (
        <div className="drawer-overlay" onClick={() => setSettingsDrawer(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Leave Policies & Types</h2>
              <button className="icon-button" onClick={() => setSettingsDrawer(false)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>Configure leave types and company policies. Do not hard-code these as permanent system values.</p>
              
              <h3 className="section-title">Approval Workflow</h3>
              <div style={{ backgroundColor: 'var(--gray-50)', padding: '1.5rem', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'center', gap: '1rem', alignItems: 'center', marginBottom: '2rem', fontFamily: 'monospace' }}>
                <div>Employee</div><div>→</div><div>Manager</div><div>→</div><div>HR</div><div>→</div><div style={{ color: 'var(--success-600)', fontWeight: 600 }}>Approved</div>
              </div>

              <h3 className="section-title">Leave Types</h3>
              <table className="table" style={{ width: '100%', marginBottom: '2rem' }}>
                <thead><tr><th>Leave Type</th><th>Code</th><th>Paid</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td>Casual Leave</td><td>CL</td><td>Yes</td><td><span className="badge badge-success">Active</span></td></tr>
                  <tr><td>Sick Leave</td><td>SL</td><td>Yes</td><td><span className="badge badge-success">Active</span></td></tr>
                  <tr><td>Loss of Pay</td><td>LOP</td><td>No</td><td><span className="badge badge-success">Active</span></td></tr>
                </tbody>
              </table>

              <h3 className="section-title">Global Policy Settings</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Allow Half Day</span><input type="checkbox" defaultChecked /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Allow Negative Balance</span><input type="checkbox" /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: '0.875rem' }}>Allow Backdated Leave</span><input type="checkbox" defaultChecked /></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Leave Drawer Placeholder */}
      {addLeaveDrawer && (
        <div className="drawer-overlay" onClick={() => setAddLeaveDrawer(false)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Add Leave (Admin)</h2>
              <button className="icon-button" onClick={() => setAddLeaveDrawer(false)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem' }}>Submit leave on behalf of an employee.</p>
              <form onSubmit={e => { e.preventDefault(); setAddLeaveDrawer(false); showToast('Leave created successfully'); }} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div><label className="form-label">Employee</label><select className="form-control"><option>Select Employee</option></select></div>
                <div><label className="form-label">Leave Type</label><select className="form-control"><option>Casual Leave</option></select></div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div style={{ flex: 1 }}><label className="form-label">Start Date</label><input type="date" className="form-control"/></div>
                  <div style={{ flex: 1 }}><label className="form-label">End Date</label><input type="date" className="form-control"/></div>
                </div>
                <div><label className="form-label">Half Day</label><input type="checkbox" /></div>
                <div><label className="form-label">Reason</label><textarea className="form-control" rows={3}></textarea></div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary">Save Leave</button></div>
              </form>
            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        
        
        
        
        
        
        
        .info-block { display: grid; grid-template-columns: 100px 1fr; gap: 0.5rem; font-size: 0.875rem; }
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
        .mobile-only { display: none; }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        
        @media (max-width: 900px) {
          .desktop-only { display: none; }
          .mobile-only { display: block; }
          
        }
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

export default AdminLeave;


