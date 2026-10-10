import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, UserCheck, Briefcase, Home, CalendarOff, AlertTriangle, UserX, 
  Clock, Filter, MapPin, Activity, CheckCircle2, X, Wallet, Building2,
  ChevronRight, CalendarDays, ShieldAlert, ArrowRight, ArrowUpRight
} from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { realtimeService } from '../../services/realtime/realtimeService';
import { companyDateStr } from '../../utils/companyDate';
import { computeDashboardStats, dashboardCardDetails, type DashboardCard } from '../../services/admin/dashboardRules';
import RecordsModal from '../../components/common/RecordsModal';
import { clickableCardProps, EMPLOYEE_COLUMNS } from '../../services/common/cardDetails';

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<string | null>(null);
  const [period, setPeriod] = useState('Today');
  const [toast, setToast] = useState('');
  
  // Modals / Drawers
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [rejectModal, setRejectModal] = useState<{type: string, id: number} | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [stats, setStats] = useState({ 
    employees: 0, wfhPending: 0, leavePending: 0, permPending: 0, 
    working: 0, fullTime: 0, partTime: 0, intern: 0, activeWfh: 0,
    onsite: 0, present: 0, attendanceExists: false, onLeave: 0, attendanceRate: null as number | null
  });
  const [wfhReqs, setWfhReqs] = useState<any[]>([]);
  const [leaveReqs, setLeaveReqs] = useState<any[]>([]);
  const [permReqs, setPermReqs] = useState<any[]>([]);
  const [liveStatus, setLiveStatus] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  // Rows behind the KPI cards (same data and sets as the counts)
  const [cardRows, setCardRows] = useState<Record<DashboardCard, any[]>>({ employees: [], working: [], pending: [], onLeave: [] });
  const [openCard, setOpenCard] = useState<DashboardCard | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      setErrorState(null);
      try {
        const today = companyDateStr();
        const queries = await Promise.all([
          // Same eligibility as Admin → Attendance / Reports: ACTIVE and role is not ADMIN (see dashboardRules)
          supabase.from('employees').select('id, status, employment_type, office_id, role:role_id(name), first_name, last_name, employee_code, departments(name), office:office_id(name)').eq('status', 'ACTIVE'),
          // Pending requests: the rows themselves (their number is the Pending Action count)
          supabase.from('wfh_requests').select('id, employee_id, request_date, status, employees!wfh_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name))').eq('status', 'PENDING'),
          supabase.from('leave_requests').select('id, employee_id, start_date, end_date, status, leave_types(name), employees!leave_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name))').eq('status', 'PENDING'),
          supabase.from('permission_requests').select('id, employee_id, permission_date, start_time, end_time, status, employees!permission_requests_employee_id_fkey(first_name, last_name, employee_code, departments(name))').eq('status', 'PENDING'),
          supabase.from('attendance').select('employee_id, status, clock_in_at, clock_out_at').eq('attendance_date', today),
          supabase.from('shift_templates').select('*').eq('is_active', true).order('start_time'),
          supabase.from('wfh_requests').select('employee_id').eq('status', 'APPROVED').eq('request_date', today),
          // Approved leave covering today (pending requests are not "on leave")
          supabase.from('leave_requests').select('employee_id, start_date, end_date, leave_types(name)').eq('status', 'APPROVED').lte('start_date', today).gte('end_date', today)
        ]);

        if (queries.some(q => q.error)) {
          throw new Error('Failed to fetch dashboard metrics from the database.');
        }

        const [
          { data: empData },
          { data: wfhPendingRows },
          { data: leavePendingRows },
          { data: permPendingRows },
          { data: attendanceData },
          { data: shiftsData },
          { data: approvedWfhData },
          { data: approvedLeaveData }
        ] = queries as any[];

        const dashInput = {
          employees: (empData as any[]) || [],
          attendance: (attendanceData as any[]) || [],
          leaves: (approvedLeaveData as any[]) || [],
          approvedWfhToday: (approvedWfhData as any[]) || [],
          today,
        };
        const d = computeDashboardStats(dashInput);
        const wfhCount = (wfhPendingRows as any[] || []).length;
        const leaveCount = (leavePendingRows as any[] || []).length;
        const permCount = (permPendingRows as any[] || []).length;
        setCardRows(dashboardCardDetails(dashInput, { leave: leavePendingRows || [], wfh: wfhPendingRows || [], permission: permPendingRows || [] }));

        setStats({
          employees: d.employees,
          wfhPending: wfhCount || 0,
          leavePending: leaveCount || 0,
          permPending: permCount || 0,
          working: d.working,
          present: d.present,
          attendanceExists: d.attendanceExists,
          fullTime: d.fullTime,
          partTime: d.partTime,
          intern: d.intern,
          activeWfh: d.activeWfh,
          onsite: d.onsite,
          onLeave: d.onLeave,
          attendanceRate: d.attendanceRate
        });
        
        if (shiftsData) {
          setShifts(shiftsData);
        }

        // We'll skip the UI list variables because we only want the counts for the dashboard
        // We aren't displaying the individual requests in this page anyway, just the counts.

      } catch (e: any) {
        console.error(e);
        setErrorState(e.message || 'An unexpected error occurred while loading dashboard data.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchDashboardData();

    const wfhSub = realtimeService.subscribeToAdminWFH(() => fetchDashboardData());
    const leaveSub = realtimeService.subscribeToAdminLeave(() => fetchDashboardData());
    const permSub = realtimeService.subscribeToAdminPermission(() => fetchDashboardData());
    const attSub = realtimeService.subscribeToAdminAttendance(() => fetchDashboardData());

    return () => {
      realtimeService.unsubscribe(wfhSub);
      realtimeService.unsubscribe(leaveSub);
      realtimeService.unsubscribe(permSub);
      realtimeService.unsubscribe(attSub);
    };
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', position: 'relative' }}>
      
      {toast && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toast}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: '2rem' }}>
            Welcome back, Admin!
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Let's manage your workforce efficiently and stay ahead of today's tasks.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <select value={period} onChange={(e) => {setLoading(true); setPeriod(e.target.value);}} className="form-control" style={{ width: 'auto', borderRadius: 'var(--radius-full)' }}>
            <option>Today</option>
            <option>This Week</option>
            <option>This Month</option>
          </select>
          <button className="btn btn-secondary"><Filter size={16} /> Filter</button>
          <button className="btn btn-primary">Export</button>
        </div>
      </div>

      {errorState ? (
        <div style={{ padding: '3rem', textAlign: 'center', background: 'var(--danger-50)', borderRadius: 'var(--radius-lg)', color: 'var(--danger)' }}>
          <AlertTriangle size={48} style={{ margin: '0 auto 1rem auto', color: 'var(--danger)' }} />
          <h2 style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Unable to load dashboard</h2>
          <p>{errorState}</p>
          <button onClick={() => setPeriod('Today')} className="btn btn-primary" style={{ marginTop: '1.5rem' }}>Retry</button>
        </div>
      ) : loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="bento-grid">
          
          {/* Top KPI row */}
          <div className="bento-col-3 kpi-card" {...clickableCardProps('Total Employees', () => setOpenCard('employees'))}>
            <div className="kpi-header">
              <div className="kpi-icon" style={{ background: 'var(--primary-50)', color: 'var(--accent-primary)' }}><Users size={16} /></div>
              Total Employees
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
              <div className="kpi-value">{stats.employees}</div>
            </div>
          </div>
          
          <div className="bento-col-3 kpi-card" {...clickableCardProps('Working Now', () => setOpenCard('working'))}>
            <div className="kpi-header">
              <div className="kpi-icon" style={{ background: 'var(--success-50)', color: 'var(--success)' }}><Activity size={16} /></div>
              Working Now
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
              <div className="kpi-value">{stats.working}</div>
            </div>
          </div>

          <div className="bento-col-3 kpi-card" {...clickableCardProps('Pending Action', () => setOpenCard('pending'))}>
            <div className="kpi-header">
              <div className="kpi-icon" style={{ background: 'var(--warning-50)', color: 'var(--warning)' }}><AlertTriangle size={16} /></div>
              Pending Action
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
              <div className="kpi-value">{(stats.leavePending + stats.permPending + stats.wfhPending)}</div>
            </div>
          </div>

          <div className="bento-col-3 kpi-card" {...clickableCardProps('On Leave', () => setOpenCard('onLeave'))}>
            <div className="kpi-header">
              <div className="kpi-icon" style={{ background: 'var(--danger-50)', color: 'var(--danger)' }}><CalendarOff size={16} /></div>
              On Leave
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
              <div className="kpi-value">{stats.onLeave || 0}</div>
            </div>
          </div>

          {/* Second Row */}
          <div className="bento-col-4 card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="card-header" style={{ width: '100%' }}>
              <h3 className="card-title">Attendance Rate</h3>
              <button className="icon-button"><Filter size={16}/></button>
            </div>
            <div style={{ position: 'relative', width: '200px', height: '100px', overflow: 'hidden', marginTop: '1rem' }}>
              <div style={{ width: '200px', height: '200px', borderRadius: '50%', border: '20px solid var(--bg-glass)', borderTopColor: 'var(--accent-primary)', borderRightColor: 'var(--accent-primary)', transform: 'rotate(-45deg)', position: 'absolute', top: 0, left: 0 }}></div>
              <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {stats.attendanceExists ? `${stats.attendanceRate ?? 0}%` : 'N/A'}
                </div>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>
              {stats.attendanceExists
                ? `Positive vibes! Attendance reached ${stats.attendanceRate ?? 0}%. Let's keep it going.`
                : 'No attendance data'}
            </p>
          </div>

          <div className="bento-col-4 card">
            <div className="card-header">
              <h3 className="card-title">Workforce Composition</h3>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', gap: '4px', height: '40px', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: '1.5rem' }}>
                <div style={{ flex: stats.fullTime || 1, background: 'var(--info)' }}></div>
                <div style={{ flex: stats.partTime || 0, background: 'var(--accent-secondary)' }}></div>
                <div style={{ flex: stats.intern || 0, background: 'var(--bg-glass)' }}></div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--info)' }}></div> Full Time Employees</div>
                  <div style={{ fontWeight: 600 }}>{stats.fullTime} <span style={{ color: 'var(--info)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>{stats.employees ? Math.round((stats.fullTime/stats.employees)*100) : 0}%</span></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-secondary)' }}></div> Part Time</div>
                  <div style={{ fontWeight: 600 }}>{stats.partTime} <span style={{ color: 'var(--accent-secondary)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>{stats.employees ? Math.round((stats.partTime/stats.employees)*100) : 0}%</span></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--bg-glass)' }}></div> Interns</div>
                  <div style={{ fontWeight: 600 }}>{stats.intern} <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: '0.5rem' }}>{stats.employees ? Math.round((stats.intern/stats.employees)*100) : 0}%</span></div>
                </div>
              </div>
            </div>
          </div>

          <div className="bento-col-4 bento-row-2 card">
            <div className="card-header">
              <h3 className="card-title">Schedule</h3>
              <button className="icon-button"><Filter size={16}/></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
              {shifts.length > 0 ? shifts.map((s, idx) => (
                <div key={s.id} className="timeline-item">
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: idx % 2 === 0 ? 'var(--accent-primary)' : 'var(--info)', border: '2px solid var(--bg-surface)', zIndex: 1, marginTop: '4px' }}></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.start_time.substring(0, 5)} - {s.end_time.substring(0, 5)} • {s.required_hours}h required</div>
                  </div>
                </div>
              )) : (
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No active shifts found.</div>
              )}
            </div>
          </div>
          
          {/* Third Row */}
          <div className="bento-col-4 card" style={{ position: 'relative', overflow: 'hidden', padding: 0 }}>
             <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)', opacity: 0.1 }}></div>
             <div style={{ padding: '1.5rem', height: '100%', display: 'flex', flexDirection: 'column' }}>
               <h3 className="card-title" style={{ marginBottom: 'auto' }}>Remote vs Onsite</h3>
               <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: '120px', marginTop: '1rem' }}>
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                   <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats.onsite}</span>
                   <div style={{ width: '40px', height: '80px', borderRadius: '20px 20px 0 0', background: 'linear-gradient(to top, var(--info), var(--cyan-400))' }}></div>
                   <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Onsite</span>
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                   <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats.activeWfh}</span>
                   <div style={{ width: '40px', height: '50px', borderRadius: '20px 20px 0 0', background: 'linear-gradient(to top, var(--accent-secondary), var(--pink-400))' }}></div>
                   <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Remote</span>
                 </div>
               </div>
             </div>
          </div>
          
          <div className="bento-col-4 card">
            <div className="card-header">
              <h3 className="card-title">Pending Approvals</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div className="icon-button" style={{ background: 'var(--warning-50)', color: 'var(--warning)' }}><Home size={16}/></div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>WFH Requests</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{stats.wfhPending} awaiting review</div>
                  </div>
                </div>
                <button onClick={() => navigate('/admin/wfh')} className="btn btn-outline" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}>View</button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div className="icon-button" style={{ background: 'var(--danger-50)', color: 'var(--danger)' }}><CalendarOff size={16}/></div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Leave Requests</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{stats.leavePending} awaiting review</div>
                  </div>
                </div>
                <button onClick={() => navigate('/admin/leave')} className="btn btn-outline" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}>View</button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <div className="icon-button" style={{ background: 'var(--primary-50)', color: 'var(--accent-primary)' }}><Clock size={16}/></div>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Permission Requests</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{stats.permPending} awaiting review</div>
                  </div>
                </div>
                <button onClick={() => navigate('/admin/permission')} className="btn btn-outline" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }}>View</button>
              </div>
            </div>
          </div>
          
        </div>
      )}
      <RecordsModal
        open={openCard !== null}
        onClose={() => setOpenCard(null)}
        title={openCard === 'employees' ? 'Total Employees' : openCard === 'working' ? 'Working Now' : openCard === 'pending' ? 'Pending Action' : 'On Leave Today'}
        subtitle={`Today (${companyDateStr()})`}
        loading={loading}
        error={errorState}
        rows={openCard ? cardRows[openCard] : []}
        columns={openCard === 'employees' ? [...EMPLOYEE_COLUMNS, { key: 'type', label: 'Employment type' }, { key: 'status', label: 'Status' }]
          : openCard === 'working' ? [...EMPLOYEE_COLUMNS, { key: 'clockIn', label: 'Clock in' }, { key: 'clockOut', label: 'Clock out' }, { key: 'status', label: 'Status' }]
          : openCard === 'pending' ? [{ key: 'type', label: 'Request' }, { key: 'employee', label: 'Employee' }, { key: 'code', label: 'Employee ID' }, { key: 'department', label: 'Department' }, { key: 'date', label: 'Date' }, { key: 'status', label: 'Status' },
              { key: 'module', label: 'Open', format: (v: string) => <button type="button" className="btn btn-outline" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={() => navigate(v)}>Review</button> }]
          : [...EMPLOYEE_COLUMNS, { key: 'leaveType', label: 'Leave type' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' }]}
        emptyMessage={openCard === 'working' ? 'Nobody is clocked in right now.' : openCard === 'pending' ? 'There are no pending requests.' : openCard === 'onLeave' ? 'Nobody is on approved leave today.' : 'No active employees were found.'}
        explanation={openCard === 'employees' ? ['Active employees whose role is not Admin (the same workforce used by Attendance and Reports).']
          : openCard === 'working' ? ['Clocked in today and not yet clocked out. Working hours are not shown until the employee clocks out.']
          : openCard === 'pending' ? ['Leave, WFH and permission requests with status PENDING. Opening this list does not approve or reject anything — use Review to open the module.']
          : ['Employees with an APPROVED leave covering today. Pending requests are not counted.']}
      />
    </div>
  );
};

export default AdminDashboard;
