import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BarChart2, PieChart, TrendingUp, TrendingDown, Users, Calendar, 
  Clock, Download, RefreshCw, Search, Filter, Activity, X, 
  MapPin, ShieldAlert, FileText, ChevronRight, CheckCircle2,
  CalendarDays, Settings
} from 'lucide-react';

import { reportService } from '../../services/reports/reportService';
import { exportToCSV } from '../../utils/exportCsv';

const AdminReports: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Overview');
  const [toast, setToast] = useState('');
  
  // Real data state
  const [metrics, setMetrics] = useState<any>({
    totalEmployees: 0, attendanceRate: '0%', presentToday: 0, lateArrivals: 0,
    wfhEmployees: 0, onLeave: 0, avgWorkingHours: '0h 0m', payrollProcessed: '₹0'
  });
  const [attendanceReport, setAttendanceReport] = useState<any[]>([]);
  
  // Modals & Drawers
  const [exportModal, setExportModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [employeeDrawer, setEmployeeDrawer] = useState<any>(null);
  const [deptDrawer, setDeptDrawer] = useState<any>(null);

  // Filters
  const [filters, setFilters] = useState({
    dateRange: 'This Month', dept: 'All', office: 'All', search: '', shift: 'All', workMode: 'All'
  });

  const tabs = ['Overview', 'Attendance', 'Working Hours', 'WFH', 'Leave', 'Permission', 'Shifts', 'Payroll', 'Payments'];

  const fetchData = async () => {
    setLoading(true);
    
    const today = new Date();
    let start = new Date();
    let end = new Date();
    if (filters.dateRange === 'Today') {
      start.setHours(0,0,0,0);
    } else if (filters.dateRange === 'This Week') {
      start.setDate(today.getDate() - today.getDay());
    } else if (filters.dateRange === 'This Month') {
      start.setDate(1);
    } else if (filters.dateRange === 'Last Month') {
      start.setMonth(today.getMonth() - 1);
      start.setDate(1);
      end.setDate(0); 
    }
    const startDateStr = start.toISOString().split('T')[0];
    const endDateStr = end.toISOString().split('T')[0];

    const dashMetrics = await reportService.getDashboardMetrics(startDateStr, endDateStr, filters.dept, filters.office);
    setMetrics(dashMetrics);

    if (activeTab === 'Attendance') {
       const { data } = await reportService.getAttendanceReport(startDateStr, endDateStr, filters.dept);
       if (data) setAttendanceReport(data);
    }

    setLoading(false);
  };

  useEffect(() => {

    
    

    
    
    fetchData();
  }, [filters, activeTab]);

  const handleRefresh = () => {
    fetchData();
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleExport = (e: React.FormEvent) => {
    e.preventDefault();
    setExportModal(false);
    
    if (activeTab === 'Attendance' && attendanceReport.length > 0) {
       exportToCSV(
         `attendance_report_${new Date().toISOString().split('T')[0]}.csv`,
         attendanceReport,
         ['Employee Name', 'Employee Code', 'Department', 'Date', 'Clock In', 'Late Minutes'],
         ['employees.first_name', 'employees.employee_code', 'employees.departments.name', 'date', 'clock_in', 'late_minutes']
       );
    }
    
    showToast('Report generated successfully');
  };

  const renderTrend = (val: string, positive: boolean) => (
    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: positive ? 'var(--success)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: '2px' }}>
      {positive ? <TrendingUp size={14}/> : <TrendingDown size={14}/>} {val}
    </span>
  );

  // Simple CSS Bar Chart component
  const SimpleBarChart = ({ data }: { data: { label: string, val: number, color?: string }[] }) => {
    const max = Math.max(...data.map(d => d.val), 1);
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', height: '200px', padding: '1rem 0', borderBottom: '1px solid var(--gray-200)', marginTop: '1rem' }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', height: '100%' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
              <div style={{ 
                width: '100%', height: `${(d.val / max) * 100}%`, 
                backgroundColor: d.color || 'var(--primary-500)', 
                borderRadius: '4px 4px 0 0', transition: 'height 0.3s'
              }}></div>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        ))}
      </div>
    );
  };

  // Content renderers for tabs
  const renderOverview = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
        
        {/* Attendance Trend Chart */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="section-title" style={{ borderBottom: 'none', margin: 0 }}>Attendance Trend</h3>
            <select className="form-control" style={{ width: 'auto', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}><option>Weekly</option><option>Monthly</option></select>
          </div>
          <SimpleBarChart data={metrics.attendanceTrend?.length > 0 ? metrics.attendanceTrend : [
            { label: 'Mon', val: 0 }, { label: 'Tue', val: 0 }, { label: 'Wed', val: 0 }, 
            { label: 'Thu', val: 0 }, { label: 'Fri', val: 0 }
          ]} />
        </div>

        {/* Workforce Distribution */}
        <div className="card">
          <h3 className="section-title" style={{ borderBottom: 'none', margin: 0 }}>Workforce Distribution Today</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', marginTop: '1rem' }}>
            <div style={{ position: 'relative', width: '150px', height: '150px', borderRadius: '50%', background: `conic-gradient(var(--primary-500) 0% ${Math.round(((metrics.workforceDistribution?.present || 0) / ((metrics.totalEmployees || 1))) * 100)}%, var(--purple-500) ${Math.round(((metrics.workforceDistribution?.present || 0) / ((metrics.totalEmployees || 1))) * 100)}% ${Math.round((((metrics.workforceDistribution?.present || 0) + (metrics.workforceDistribution?.wfh || 0)) / ((metrics.totalEmployees || 1))) * 100)}%, var(--warning) ${Math.round((((metrics.workforceDistribution?.present || 0) + (metrics.workforceDistribution?.wfh || 0)) / ((metrics.totalEmployees || 1))) * 100)}% ${Math.round((((metrics.workforceDistribution?.present || 0) + (metrics.workforceDistribution?.wfh || 0) + (metrics.workforceDistribution?.leave || 0)) / ((metrics.totalEmployees || 1))) * 100)}%, var(--danger) ${Math.round((((metrics.workforceDistribution?.present || 0) + (metrics.workforceDistribution?.wfh || 0) + (metrics.workforceDistribution?.leave || 0)) / ((metrics.totalEmployees || 1))) * 100)}% 100%)` }}>
              <div style={{ position: 'absolute', top: '25%', left: '25%', right: '25%', bottom: '25%', backgroundColor: 'var(--bg-surface-elevated)', borderRadius: '50%' }}></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '12px', height: '12px', backgroundColor: 'var(--primary-500)', borderRadius: '2px' }}></div> Present ({metrics.workforceDistribution?.present || 0})</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '12px', height: '12px', backgroundColor: 'var(--purple-500)', borderRadius: '2px' }}></div> WFH ({metrics.workforceDistribution?.wfh || 0})</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '12px', height: '12px', backgroundColor: 'var(--warning)', borderRadius: '2px' }}></div> Leave ({metrics.workforceDistribution?.leave || 0})</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div style={{ width: '12px', height: '12px', backgroundColor: 'var(--danger)', borderRadius: '2px' }}></div> Absent ({metrics.workforceDistribution?.absent || 0})</div>
            </div>
          </div>
        </div>

        {/* Department Attendance */}
        <div className="card">
          <h3 className="section-title" style={{ borderBottom: 'none', margin: 0 }}>Department Attendance %</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
            {((metrics.departmentAttendance || []).length > 0 ? metrics.departmentAttendance : [
              { dept: 'No Data', val: 0, color: 'var(--gray-300)' }
            ]).map((d: any) => (
              <div key={d.dept} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', cursor: 'pointer' }} onClick={() => setDeptDrawer(d.dept)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', fontWeight: 500 }}>
                  <span>{d.dept}</span><span>{d.val}%</span>
                </div>
                <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--gray-100)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${d.val}%`, height: '100%', backgroundColor: d.color || 'var(--primary-500)' }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Working Hours Overview */}
        <div className="card">
          <h3 className="section-title" style={{ borderBottom: 'none', margin: 0 }}>Working Hours Overview</h3>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
            <div style={{ flex: 1, backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Required</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600 }}>8h 00m</div>
            </div>
            <div style={{ flex: 1, backgroundColor: 'var(--success-50)', padding: '1rem', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--success)' }}>Actual Avg</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--success-800)' }}>{metrics.avgWorkingHours || '0h 0m'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', fontSize: '0.875rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Overtime Avg: <strong style={{ color: 'var(--text-primary)' }}>—</strong></span>
            <span style={{ color: 'var(--text-secondary)' }}>Shortfall Avg: <strong style={{ color: 'var(--text-primary)' }}>—</strong></span>
          </div>
        </div>

      </div>

      {/* Security Analytics Mock */}
      <div className="card">
        <h3 className="section-title">Security & Verification Analytics</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          <div>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>Location Verification (Geofence)</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Verified Inside Office</span><span style={{ fontWeight: 600 }}>{metrics.securityAnalytics?.verifiedInside || '0%'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Outside Geofence Attempts</span><span style={{ fontWeight: 600, color: 'var(--warning)' }}>{metrics.securityAnalytics?.outsideAttempts || '0%'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>WFH Bypass (Authorized)</span><span style={{ fontWeight: 600 }}>{metrics.securityAnalytics?.wfhBypass || '0%'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Location Unavailable</span><span style={{ fontWeight: 600, color: 'var(--danger)' }}>{metrics.securityAnalytics?.locationUnavailable || '0%'}</span></div>
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>Face Verification (Biometrics)</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Verified Successfully</span><span style={{ fontWeight: 600 }}>{metrics.securityAnalytics?.faceVerified || '0%'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Failed Match Attempts</span><span style={{ fontWeight: 600, color: 'var(--danger)' }}>{metrics.securityAnalytics?.faceFailed || '0%'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Face Not Registered</span><span style={{ fontWeight: 600, color: 'var(--warning)' }}>{metrics.securityAnalytics?.faceNotRegistered || '0 emp'}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Not Required (Policy)</span><span style={{ fontWeight: 600 }}>{metrics.securityAnalytics?.faceNotRequired || '0%'}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAttendance = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)' }}>
          <h3 className="section-title" style={{ border: 'none', margin: 0 }}>Attendance Log</h3>
        </div>
        <div className="table-container">
          <table className="table" style={{ width: '100%' }}>
            <thead><tr><th>Employee</th><th>Date</th><th>Shift</th><th>Clock In</th><th style={{ textAlign: 'right' }}>Late Minutes</th></tr></thead>
            <tbody>
              {attendanceReport.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>No records found for the selected filters</td></tr>
              ) : attendanceReport.map((r, i) => (
                <tr key={r.id || i}>
                  <td style={{ fontWeight: 600, color: 'var(--primary-700)', cursor: 'pointer' }} onClick={() => setEmployeeDrawer({ id: r.employees?.employee_code, name: `${r.employees?.first_name} ${r.employees?.last_name}`, dept: r.employees?.departments?.name, present: 1, late: r.late_minutes > 0 ? 1 : 0, wfh: 0, leave: 0, avgHours: Math.floor((r.work_minutes || 0) / 60) + 'h' })}>{r.employees?.first_name} {r.employees?.last_name}</td>
                  <td>{r.date}</td>
                  <td>{r.shift_templates?.name || 'Standard'}</td>
                  <td>{r.clock_in ? new Date(r.clock_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: r.late_minutes > 0 ? 'var(--danger)' : 'inherit' }}>{r.late_minutes || '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

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
          <h1 className="page-title">Reports & Analytics</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Analyze attendance, working hours, leave, WFH, permissions, shifts and payroll performance.</p>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Last updated: Today, 10:42 AM</div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={handleRefresh} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><RefreshCw size={16}/> Refresh</button>
          <button onClick={() => setExportModal(true)} className="btn btn-primary" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export Report</button>
        </div>
      </div>

      {/* Global Filter Bar */}
      <div className="card" style={{ padding: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', backgroundColor: 'var(--bg-surface-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRight: '1px solid var(--border-color)', paddingRight: '1rem' }}>
          <Filter size={18} color="var(--gray-500)" />
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Global Filters</span>
        </div>
        
        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={filters.dateRange} onChange={e => setFilters({...filters, dateRange: e.target.value})}>
          <option>Today</option><option>This Week</option><option>This Month</option><option>Last Month</option><option>Custom Range</option>
        </select>
        
        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={filters.dept} onChange={e => setFilters({...filters, dept: e.target.value})}>
          <option value="All">All Departments</option>
              
        </select>
        
        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={filters.office} onChange={e => setFilters({...filters, office: e.target.value})}>
          <option value="All">All Offices</option>
              
        </select>

        <select className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }} value={filters.shift} onChange={e => setFilters({...filters, shift: e.target.value})}>
          <option value="All">All Shifts</option><option>Morning</option><option>General</option><option>Night</option>
        </select>

        <div style={{ position: 'relative', flex: 1, minWidth: '150px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input type="text" placeholder="Search employee..." className="form-control" style={{ paddingLeft: '2rem', fontSize: '0.875rem' }} value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} />
        </div>

        <button onClick={handleRefresh} className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Apply</button>
        <button onClick={() => { setFilters({ dateRange: 'This Month', dept: 'All', office: 'All', search: '', shift: 'All', workMode: 'All' }); handleRefresh(); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Reset</button>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="tracking-kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Users size={16}/> Total Employees</div>
            </div>
            <div className="sc-val" style={{ marginTop: '0.5rem' }}>{metrics.totalEmployees}</div>
          </div>
          <div className="tracking-kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={16}/> Attendance Rate</div>
            </div>
            <div className="sc-val" style={{ marginTop: '0.5rem' }}>{metrics.attendanceRate}</div>
          </div>
          <div className="tracking-kpi-card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CheckCircle2 size={16}/> Present Today</div>
            </div>
            <div className="sc-val" style={{ marginTop: '0.5rem' }}>{metrics.presentToday}</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setActiveTab('Attendance')}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)' }}><Clock size={16}/> Late Arrivals</div>
            </div>
            <div className="sc-val" style={{ marginTop: '0.5rem', color: 'var(--warning)' }}>{metrics.lateArrivals}</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setActiveTab('WFH')}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><MapPin size={16}/> WFH Employees</div>
            </div>
            <div className="sc-val" style={{ marginTop: '0.5rem' }}>{metrics.wfhEmployees}</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setActiveTab('Leave')}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary-700)' }}><CalendarDays size={16}/> On Leave</div>
            </div>
            <div className="sc-val" style={{ marginTop: '0.5rem', color: 'var(--primary-700)' }}>{metrics.onLeave}</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setActiveTab('Working Hours')}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={16}/> Avg Working Hrs</div>
            </div>
            <div className="sc-val" style={{ marginTop: '0.5rem' }}>{metrics.avgWorkingHours}</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setActiveTab('Payroll')}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div className="sc-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={16}/> Payroll Processed</div>
            </div>
            <div className="sc-val" style={{ marginTop: '0.5rem' }}>{metrics.payrollProcessed}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--gray-200)' }} className="hide-scrollbar">
        {tabs.map(v => (
          <button key={v} onClick={() => { setActiveTab(v); handleRefresh(); }} className="tab-button" style={{ 
            padding: '0.75rem 1.25rem', background: 'none', border: 'none', whiteSpace: 'nowrap',
            borderBottom: activeTab === v ? '2px solid var(--primary-600)' : '2px solid transparent',
            color: activeTab === v ? 'var(--primary-700)' : 'var(--gray-600)',
            fontWeight: activeTab === v ? 600 : 500, cursor: 'pointer'
          }}>
            {v}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ minHeight: '400px' }}>
        {loading ? (
          <div className="skeleton" style={{ height: '400px', borderRadius: 'var(--radius-lg)' }} />
        ) : (
          <>
            {activeTab === 'Overview' && renderOverview()}
            {activeTab === 'Attendance' && renderAttendance()}
            {activeTab !== 'Overview' && activeTab !== 'Attendance' && (
              <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <BarChart2 size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
                <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>{activeTab} Analytics Prototype</h3>
                <p style={{ marginTop: '0.5rem' }}>This specific reporting dimension is mocked for prototype purposes. The data structurally reflects the existing module configuration.</p>
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Scheduled Reports Config (Mock) */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 className="section-title" style={{ border: 'none', margin: 0 }}>Scheduled Reports</h3>
          <button onClick={() => setScheduleModal(true)} className="btn btn-outline" style={{ fontSize: '0.75rem' }}><Calendar size={14}/> Schedule New</button>
        </div>
        <div className="table-container">
          <table className="table" style={{ width: '100%' }}>
            <thead><tr><th>Report</th><th>Frequency</th><th>Recipients</th><th>Next Run</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td style={{ fontWeight: 500 }}>Monthly Payroll Report</td><td>Monthly (1st)</td><td>finance@workpulse.com</td><td>01 Oct 2026</td><td><span className="badge badge-success">Active</span></td></tr>
              <tr><td style={{ fontWeight: 500 }}>Weekly Attendance Summary</td><td>Weekly (Mon)</td><td>hr@workpulse.com</td><td>28 Sep 2026</td><td><span className="badge badge-success">Active</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Modal */}
      {exportModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '500px', animation: 'slideUp 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Export Report</h3>
              <button className="icon-button" onClick={() => setExportModal(false)}><X size={20}/></button>
            </div>
            
            <form onSubmit={handleExport} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <label className="form-label">Report Data</label>
                <select className="form-control">
                  <option>Current Report ({activeTab})</option>
                  <option>Full HR Report</option>
                  <option>Payroll & Payments</option>
                </select>
              </div>
              
              <div>
                <label className="form-label">Format</label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="radio" name="format" defaultChecked/> CSV</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="radio" name="format"/> Excel</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}><input type="radio" name="format"/> PDF</label>
                </div>
              </div>

              <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <h4 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Applied Filters</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span className="badge badge-gray">Date: {filters.dateRange}</span>
                  <span className="badge badge-gray">Dept: {filters.dept}</span>
                  <span className="badge badge-gray">Office: {filters.office}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="button" onClick={() => setExportModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Generate Export</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Employee Drill-Down Drawer */}
      {employeeDrawer && (
        <div className="drawer-overlay" onClick={() => setEmployeeDrawer(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ paddingBottom: '1.5rem', alignItems: 'flex-start' }}>
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{employeeDrawer.name}</h2>
                  <button className="icon-button" onClick={() => setEmployeeDrawer(null)}><X size={20} /></button>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  <span>{employeeDrawer.id}</span> • <span>{employeeDrawer.dept}</span>
                </div>
              </div>
            </div>
            <div className="drawer-body">
              <h3 className="section-title">Employee Analytics Drill-down</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                This drawer aggregates data from Attendance, Working Hours, Leave, WFH, Permission, Payroll, and Security for the selected employee based on the current global date range filter.
              </p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)', padding: '1rem' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Attendance & Time</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Present</span><span className="info-val">{employeeDrawer.present} days</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Late Arrivals</span><span className="info-val" style={{ color: 'var(--warning)' }}>{employeeDrawer.late}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Avg Hours</span><span className="info-val">{employeeDrawer.avgHours}</span></div>
                  </div>
                </div>
                
                <div className="card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)', padding: '1rem' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Exceptions & Leaves</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Leaves Taken</span><span className="info-val">{employeeDrawer.leave} days</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">WFH Days</span><span className="info-val">{employeeDrawer.wfh} days</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="info-label">Permissions</span><span className="info-val">3h 30m</span></div>
                  </div>
                </div>
              </div>
              
              <button onClick={() => { setEmployeeDrawer(null); navigate('/employee/dashboard'); }} className="btn btn-outline" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                View Full Profile <ChevronRight size={16} style={{ marginLeft: '4px' }}/>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dept Drill-Down Drawer */}
      {deptDrawer && (
        <div className="drawer-overlay" onClick={() => setDeptDrawer(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{deptDrawer} Analytics</h2>
              <button className="icon-button" onClick={() => setDeptDrawer(null)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Department-level drill-down analytics for the selected date range.</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
                <div className="tracking-kpi-card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)' }}>
                  <div className="sc-val">0</div><div className="sc-title">Employees</div>
                </div>
                <div className="tracking-kpi-card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)' }}>
                  <div className="sc-val">0%</div><div className="sc-title">Attendance Rate</div>
                </div>
                <div className="tracking-kpi-card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)' }}>
                  <div className="sc-val">0h 0m</div><div className="sc-title">Avg Working Hrs</div>
                </div>
                <div className="tracking-kpi-card" style={{ boxShadow: 'none', border: '1px solid var(--border-color)' }}>
                  <div className="sc-val">₹0</div><div className="sc-title">Payroll Total</div>
                </div>
              </div>
              
              <h3 className="section-title">Department Employees</h3>
              <div className="table-container">
                <table className="table" style={{ width: '100%' }}>
                  <thead><tr><th>Employee</th><th>Attendance</th><th>Avg Hrs</th></tr></thead>
                  <tbody>
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No department employees found</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        
        
        
        
        
        
        .info-label { color: var(--gray-500); }
        .info-val { font-weight: 600; color: var(--gray-900); }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .wide-drawer { max-width: min(520px, 100vw); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: flex-start; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        
        @media (max-width: 900px) { 
           
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

export default AdminReports;



