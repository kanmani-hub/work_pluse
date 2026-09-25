import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  MapPin, Clock, Home, Building2, Search, Filter, 
  RefreshCw, AlertCircle, CheckCircle2, ChevronRight, X, 
  AlertTriangle, Activity, User, Briefcase, ShieldAlert, Calendar
} from 'lucide-react';

type EmployeeStatus = 'Working' | 'On Break' | 'WFH' | 'Outside Geofence' | 'Location Unavailable' | 'Offline' | 'Clocked Out';
type WorkMode = 'Office' | 'WFH' | 'Hybrid';

interface LiveEmployee {
  id: string;
  empId: string;
  name: string;
  department: string;
  shift: string;
  workMode: WorkMode;
  status: EmployeeStatus;
  locationStatus: string;
  distance: string;
  lastUpdated: string;
  workingSince: string;
  office: string;
  x: number;
  y: number;
}

const mockEmployees: LiveEmployee[] = [
  { id: '1', empId: 'EMP001', name: 'Arun Kumar', department: 'Development', shift: 'General', workMode: 'Office', status: 'Working', locationStatus: 'Inside Geofence', distance: '85m', lastUpdated: '10:42 AM', workingSince: '09:12 AM', office: 'Chennai Main Office', x: 55, y: 45 },
  { id: '2', empId: 'EMP002', name: 'Priya Sharma', department: 'HR', shift: 'Morning', workMode: 'Office', status: 'On Break', locationStatus: 'Inside Geofence', distance: '12m', lastUpdated: '10:30 AM', workingSince: '07:55 AM', office: 'Chennai Main Office', x: 45, y: 55 },
  { id: '3', empId: 'EMP003', name: 'Ravi Teja', department: 'Sales', shift: 'General', workMode: 'Office', status: 'Outside Geofence', locationStatus: 'Outside Geofence', distance: '850m', lastUpdated: '10:41 AM', workingSince: '09:05 AM', office: 'Bangalore Office', x: 85, y: 20 },
  { id: '4', empId: 'EMP004', name: 'Anita Desai', department: 'Finance', shift: 'General', workMode: 'WFH', status: 'WFH', locationStatus: 'WFH — Geofence Bypassed', distance: 'N/A', lastUpdated: '10:35 AM', workingSince: '08:50 AM', office: 'Remote', x: 15, y: 85 },
  { id: '5', empId: 'EMP005', name: 'John Doe', department: 'Development', shift: 'Evening', workMode: 'Office', status: 'Location Unavailable', locationStatus: 'Location Unavailable', distance: 'Unknown', lastUpdated: '10:15 AM', workingSince: '09:00 AM', office: 'Chennai Main Office', x: 10, y: 10 },
  { id: '6', empId: 'EMP006', name: 'Sara Smith', department: 'Operations', shift: 'General', workMode: 'Office', status: 'Working', locationStatus: 'Inside Geofence', distance: '45m', lastUpdated: '10:42 AM', workingSince: '09:15 AM', office: 'Chennai Main Office', x: 50, y: 50 },
  { id: '7', empId: 'EMP007', name: 'Karthik Raja', department: 'Sales', shift: 'General', workMode: 'Office', status: 'Clocked Out', locationStatus: 'Outside Geofence', distance: '12km', lastUpdated: '10:00 AM', workingSince: '08:00 AM', office: 'Chennai Main Office', x: 90, y: 90 },
];

const AdminLiveTracking: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [employees, setEmployees] = useState<LiveEmployee[]>([]);
  const [lastUpdatedTime, setLastUpdatedTime] = useState(new Date().toLocaleTimeString('en-US'));
  
  // Filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [officeFilter, setOfficeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('Currently Working'); // default view ignores offline/clocked out mostly, handled by logic
  const [modeFilter, setModeFilter] = useState('All');
  const [shiftFilter, setShiftFilter] = useState('All');
  
  // Drawer
  const [selectedEmp, setSelectedEmp] = useState<LiveEmployee | null>(null);
  const [simStatus, setSimStatus] = useState<EmployeeStatus>('Working');

  // Auto Refresh
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    // Initial fetch mock
    setTimeout(() => {
      setEmployees(mockEmployees);
      setLoading(false);
    }, 1500);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      handleRefresh();
    }, 5000); // 5 sec for prototype
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleRefresh = () => {
    setLastUpdatedTime(new Date().toLocaleTimeString('en-US'));
    // Randomly move some employees slightly to simulate live tracking
    setEmployees(prev => prev.map(emp => {
      if (emp.status === 'Working' || emp.status === 'On Break') {
        const dx = (Math.random() - 0.5) * 5;
        const dy = (Math.random() - 0.5) * 5;
        return {
          ...emp,
          x: Math.max(0, Math.min(100, emp.x + dx)),
          y: Math.max(0, Math.min(100, emp.y + dy)),
          lastUpdated: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        };
      }
      return emp;
    }));
  };

  const handleSimulateStatus = (newStatus: EmployeeStatus) => {
    if (!selectedEmp) return;
    
    let locationStatus = selectedEmp.locationStatus;
    let distance = selectedEmp.distance;
    let x = selectedEmp.x;
    let y = selectedEmp.y;

    if (newStatus === 'Working') {
      locationStatus = 'Inside Geofence';
      distance = '50m';
      x = 50; y = 50;
    } else if (newStatus === 'Outside Geofence') {
      locationStatus = 'Outside Geofence';
      distance = '500m';
      x = 85; y = 15;
    } else if (newStatus === 'WFH') {
      locationStatus = 'WFH — Geofence Bypassed';
      distance = 'N/A';
      x = 10; y = 90;
    } else if (newStatus === 'Location Unavailable') {
      locationStatus = 'Location Unavailable';
      distance = 'Unknown';
    }

    const updated = { ...selectedEmp, status: newStatus, locationStatus, distance, x, y, lastUpdated: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) };
    
    setEmployees(prev => prev.map(e => e.id === updated.id ? updated : e));
    setSelectedEmp(updated);
    setSimStatus(newStatus);
  };

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      // Basic Search
      const searchMatch = emp.name.toLowerCase().includes(search.toLowerCase()) || emp.empId.toLowerCase().includes(search.toLowerCase());
      if (!searchMatch) return false;

      // Status Filter logic
      if (statusFilter === 'Currently Working' && (emp.status === 'Clocked Out' || emp.status === 'Offline')) return false;
      if (statusFilter !== 'All' && statusFilter !== 'Currently Working' && emp.status !== statusFilter) return false;

      // Other filters
      if (deptFilter !== 'All' && emp.department !== deptFilter) return false;
      if (officeFilter !== 'All' && emp.office !== officeFilter) return false;
      if (modeFilter !== 'All' && emp.workMode !== modeFilter) return false;
      if (shiftFilter !== 'All' && emp.shift !== shiftFilter) return false;

      return true;
    });
  }, [employees, search, statusFilter, deptFilter, officeFilter, modeFilter, shiftFilter]);

  // KPIs
  const kpis = {
    working: employees.filter(e => e.status === 'Working').length,
    inOffice: employees.filter(e => e.locationStatus === 'Inside Geofence').length,
    wfh: employees.filter(e => e.status === 'WFH').length,
    outside: employees.filter(e => e.status === 'Outside Geofence').length,
    onBreak: employees.filter(e => e.status === 'On Break').length,
    unavailable: employees.filter(e => e.status === 'Location Unavailable').length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Working': return 'var(--success)';
      case 'On Break': return 'var(--warning)';
      case 'WFH': return 'var(--primary-500)';
      case 'Outside Geofence': return 'var(--danger)';
      case 'Location Unavailable': return 'var(--gray-500)';
      default: return 'var(--gray-400)';
    }
  };

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '1rem' }}>
        <AlertTriangle size={48} color="var(--danger)" />
        <h2>Unable to load live tracking data.</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Please try again.</p>
        <button className="btn btn-primary" onClick={() => { setError(false); setLoading(true); setTimeout(() => setLoading(false), 1000); }}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {/* Privacy Notice */}
      <div style={{ backgroundColor: 'var(--primary-50)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--primary-700)' }}>
        <ShieldAlert size={16} />
        Live location is displayed only for employees who are currently working and according to company attendance policy.
      </div>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            Live Tracking
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-600)', borderRadius: 'var(--radius-full)', border: '1px solid var(--danger-200)' }}>
              <div className="pulse-dot-live" /> LIVE
            </div>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Monitor employees currently working and their latest attendance activity.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Last updated: <strong>{lastUpdatedTime}</strong>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--primary-600)' }} />
            Auto Refresh
          </label>
          <button className="btn btn-outline" onClick={handleRefresh}>
            <RefreshCw size={16} className={autoRefresh ? 'spin-slow' : ''} /> Refresh Now
          </button>
        </div>
      </div>

      {loading ? (
        <>
          <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '150px', height: '90px', borderRadius: 'var(--radius-md)' }} />)}
          </div>
          <div className="skeleton" style={{ height: '400px', borderRadius: 'var(--radius-md)' }} />
        </>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="summary-cards-scroll">
            <div className="summary-card-small">
              <div className="sc-title">Currently Working</div>
              <div className="sc-val" style={{ color: 'var(--success)' }}>{kpis.working}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Employees Working</div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">In Office</div>
              <div className="sc-val">{kpis.inOffice}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Inside Office</div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">WFH</div>
              <div className="sc-val" style={{ color: 'var(--primary-600)' }}>{kpis.wfh}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Working Remotely</div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">Outside Geofence</div>
              <div className="sc-val" style={{ color: 'var(--danger-600)' }}>{kpis.outside}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Attention Required</div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">On Break</div>
              <div className="sc-val" style={{ color: 'var(--warning-600)' }}>{kpis.onBreak}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Currently On Break</div>
            </div>
            <div className="summary-card-small">
              <div className="sc-title">Location Unavailable</div>
              <div className="sc-val" style={{ color: 'var(--text-secondary)' }}>{kpis.unavailable}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>No Recent Location</div>
            </div>
          </div>

          <div className="tracking-layout">
            {/* Map Area */}
            <div className="card map-container">
              <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                Map View
                <span className="badge badge-gray">Prototype Mode</span>
              </h3>
              
              <div className="mock-map">
                {/* Office Geofence Circle */}
                <div className="geofence-circle">
                  <div className="office-icon">
                    <span style={{ fontSize: '1.25rem', lineHeight: 1, color: 'var(--accent-secondary)' }}>◈</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-secondary)', marginTop: '0.1rem', letterSpacing: '0.1em' }}>OFFICE</span>
                  </div>
                </div>
                
                {/* Employee Markers */}
                {filteredEmployees.map(emp => {
                  if (emp.status === 'Location Unavailable' || emp.status === 'Offline') return null;
                  return (
                    <div 
                      key={emp.id}
                      className={`emp-marker emp-status-${emp.status.replace(/\s+/g, '-')}`}
                      style={{ 
                        left: `${emp.x}%`, 
                        top: `${emp.y}%`,
                        backgroundColor: getStatusColor(emp.status)
                      }}
                      onClick={() => { setSelectedEmp(emp); setSimStatus(emp.status); }}
                      title={`${emp.name} - ${emp.status}`}
                    >
                      <div className="marker-pulse" style={{ borderColor: getStatusColor(emp.status) }} />
                      <div className="marker-label-container">
                        <div className="marker-connector" />
                        <div className="marker-label">
                          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getStatusColor(emp.status) }} />
                          {emp.name}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem', fontSize: '0.75rem', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--success)' }}></span> Working / In Office</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--primary-500)' }}></span> WFH</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--danger)' }}></span> Outside Geofence</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--warning)' }}></span> On Break</div>
              </div>
            </div>
            
            {/* List & Filters Area */}
            <div className="card list-container" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)' }}>
                <h3 className="card-title" style={{ marginBottom: '1rem' }}>Employee List</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div className="search-box" style={{ position: 'relative' }}>
                    <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                    <input 
                      type="text" 
                      placeholder="Search by Name or ID..." 
                      className="form-control" 
                      style={{ paddingLeft: '2.5rem' }}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                  </div>
                  
                  <div className="filters-grid">
                    <select className="form-control form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                      <option value="Currently Working">Status: Currently Working</option>
                      <option value="All">Status: All</option>
                      <option value="Working">Working</option>
                      <option value="On Break">On Break</option>
                      <option value="WFH">WFH</option>
                      <option value="Outside Geofence">Outside Geofence</option>
                      <option value="Location Unavailable">Location Unavailable</option>
                      <option value="Clocked Out">Clocked Out</option>
                    </select>
                    
                    <select className="form-control form-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                      <option value="All">Dept: All</option>
                      <option value="Development">Development</option>
                      <option value="HR">HR</option>
                      <option value="Finance">Finance</option>
                      <option value="Sales">Sales</option>
                      <option value="Operations">Operations</option>
                    </select>

                    <select className="form-control form-select" value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}>
                      <option value="All">Office: All</option>
                      <option value="Chennai Main Office">Chennai Main Office</option>
                      <option value="Bangalore Office">Bangalore Office</option>
                      <option value="Remote">Remote</option>
                    </select>
                  </div>
                </div>
              </div>
              
              <div className="table-responsive" style={{ flex: 1, overflowY: 'auto' }}>
                {filteredEmployees.length === 0 ? (
                  <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                    <AlertCircle size={32} color="var(--gray-400)" style={{ margin: '0 auto 1rem auto' }} />
                    <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>No employees found</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>Try changing your filters or search criteria.</p>
                    <button className="btn btn-outline" onClick={() => { setSearch(''); setStatusFilter('Currently Working'); setDeptFilter('All'); setOfficeFilter('All'); }}>Clear Filters</button>
                  </div>
                ) : (
                  <table className="table">
                    <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-surface)', zIndex: 10 }}>
                      <tr>
                        <th>Employee</th>
                        <th className="hide-mobile">Dept / Shift</th>
                        <th>Status</th>
                        <th className="hide-tablet">Location</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEmployees.map(emp => (
                        <tr key={emp.id} className={emp.status === 'Outside Geofence' ? 'row-alert' : ''}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{emp.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.empId}</div>
                          </td>
                          <td className="hide-mobile">
                            <div>{emp.department}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{emp.shift}</div>
                          </td>
                          <td>
                            <span className="badge" style={{ 
                              backgroundColor: `${getStatusColor(emp.status)}20`, 
                              color: getStatusColor(emp.status),
                              border: `1px solid ${getStatusColor(emp.status)}50`
                            }}>
                              {emp.status}
                            </span>
                          </td>
                          <td className="hide-tablet">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                              <MapPin size={14} color="var(--gray-400)" />
                              <span style={{ fontSize: '0.875rem' }}>{emp.locationStatus}</span>
                            </div>
                            {emp.distance !== 'N/A' && emp.distance !== 'Unknown' && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '1.25rem' }}>{emp.distance}</div>
                            )}
                          </td>
                          <td>
                            <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { setSelectedEmp(emp); setSimStatus(emp.status); }}>
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Employee Detail Drawer */}
      {selectedEmp && (
        <div className="drawer-overlay" onClick={() => setSelectedEmp(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{selectedEmp.name}</h2>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{selectedEmp.empId} • {selectedEmp.department}</div>
              </div>
              <button className="icon-button" onClick={() => setSelectedEmp(null)}><X size={20} /></button>
            </div>
            
            <div className="drawer-body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              
              {/* Alert for Outside Geofence */}
              {selectedEmp.status === 'Outside Geofence' && (
                <div style={{ backgroundColor: 'var(--danger-50)', border: '1px solid var(--danger-200)', borderRadius: 'var(--radius-md)', padding: '1rem', display: 'flex', gap: '0.75rem' }}>
                  <AlertCircle size={20} color="var(--danger-600)" style={{ flexShrink: 0 }} />
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--danger-800)', marginBottom: '0.25rem' }}>Location Alert</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{selectedEmp.empId} is currently outside the assigned office geofence.</p>
                  </div>
                </div>
              )}

              {/* Status Banner */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Current Status</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 600, color: getStatusColor(selectedEmp.status) }}>{selectedEmp.status}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Working Since</div>
                  <div style={{ fontSize: '1rem', fontWeight: 500 }}>{selectedEmp.workingSince}</div>
                </div>
              </div>

              {/* Sections */}
              <div className="detail-section">
                <h4 className="ds-title"><Briefcase size={16}/> Current Shift</h4>
                <div className="detail-grid">
                  <div className="detail-item"><span className="detail-label">Shift Name</span><span className="detail-value">{selectedEmp.shift}</span></div>
                  <div className="detail-item"><span className="detail-label">Work Mode</span><span className="detail-value">{selectedEmp.workMode}</span></div>
                  <div className="detail-item"><span className="detail-label">Shift Time</span><span className="detail-value">09:00 AM — 06:00 PM</span></div>
                  <div className="detail-item"><span className="detail-label">Required Hours</span><span className="detail-value">8 Hours</span></div>
                </div>
              </div>

              <div className="detail-section">
                <h4 className="ds-title"><MapPin size={16}/> Location Info</h4>
                <div className="detail-grid">
                  <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="detail-label">Assigned Office</span><span className="detail-value">{selectedEmp.office}</span></div>
                  <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="detail-label">Location Status</span>
                    <span className="detail-value" style={{ fontWeight: 600, color: selectedEmp.status === 'Outside Geofence' ? 'var(--danger-600)' : 'inherit' }}>
                      {selectedEmp.locationStatus}
                    </span>
                  </div>
                  <div className="detail-item"><span className="detail-label">Distance</span><span className="detail-value">{selectedEmp.distance}</span></div>
                  <div className="detail-item"><span className="detail-label">Geofence Radius</span><span className="detail-value">200m</span></div>
                  <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="detail-label">Last Location Update</span><span className="detail-value">{selectedEmp.lastUpdated}</span></div>
                </div>
              </div>

              <div className="detail-section">
                <h4 className="ds-title"><ShieldAlert size={16}/> Security Verifications</h4>
                <div className="detail-grid">
                  <div className="detail-item"><span className="detail-label">Face Verification</span><span className="detail-value" style={{ color: 'var(--success-600)' }}>Verified</span></div>
                  <div className="detail-item"><span className="detail-label">Location Verification</span><span className="detail-value" style={{ color: selectedEmp.status === 'Outside Geofence' ? 'var(--danger-600)' : (selectedEmp.status === 'WFH' ? 'var(--primary-600)' : 'var(--success-600)') }}>{selectedEmp.status === 'Outside Geofence' ? 'Failed' : (selectedEmp.status === 'WFH' ? 'Bypassed' : 'Verified')}</span></div>
                </div>
              </div>

              {/* Location Timeline */}
              <div className="detail-section">
                <h4 className="ds-title"><Clock size={16}/> Location Timeline (Simulated)</h4>
                <div className="timeline">
                  <div className="tl-item">
                    <div className="tl-time">{selectedEmp.lastUpdated}</div>
                    <div className="tl-content">
                      <div className="tl-title">{selectedEmp.locationStatus}</div>
                      <div className="tl-desc">{selectedEmp.distance !== 'N/A' && selectedEmp.distance !== 'Unknown' ? `${selectedEmp.distance} from Office` : 'Location check recorded'}</div>
                    </div>
                  </div>
                  <div className="tl-item">
                    <div className="tl-time">{selectedEmp.workingSince}</div>
                    <div className="tl-content">
                      <div className="tl-title">Clocked In</div>
                      <div className="tl-desc">Initial verification successful</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* PROTOTYPE TRACKING SIMULATOR */}
              <div className="detail-section" style={{ backgroundColor: 'var(--primary-50)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px dashed var(--primary-300)' }}>
                <h4 className="ds-title" style={{ color: 'var(--primary-800)', borderBottom: 'none', paddingBottom: 0, marginBottom: '1rem' }}>Prototype Tracking Simulator</h4>
                <p style={{ fontSize: '0.75rem', color: 'var(--primary-700)', marginBottom: '1rem' }}>Change the mock status below to see the UI update instantly.</p>
                <select 
                  className="form-control" 
                  value={simStatus} 
                  onChange={(e) => handleSimulateStatus(e.target.value as EmployeeStatus)}
                >
                  <option value="Working">Inside Office (Working)</option>
                  <option value="Outside Geofence">Outside Geofence</option>
                  <option value="WFH">WFH</option>
                  <option value="On Break">On Break</option>
                  <option value="Location Unavailable">Location Unavailable</option>
                  <option value="Clocked Out">Clocked Out</option>
                </select>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Reporting / Audit Snippet (Mock) */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Audit Log Integration</div>
            <div style={{ fontSize: '0.875rem' }}>Live tracking viewed by Admin</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{new Date().toLocaleTimeString()}</div>
          </div>
          <div className="card" style={{ padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Reporting Connection</div>
            <div style={{ fontSize: '0.875rem' }}>{kpis.outside} Geofence violations logged today</div>
          </div>
        </div>
      )}

      <style>{`
        .pulse-dot-live {
          width: 8px;
          height: 8px;
          background-color: var(--danger);
          border-radius: 50%;
          animation: livePulse 1.5s infinite;
        }
        @keyframes livePulse {
          0% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.4); }
          70% { box-shadow: 0 0 0 6px rgba(244, 63, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0); }
        }
        
        .spin-slow { animation: spin 2s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        .summary-cards-scroll { display: flex; gap: 1rem; overflow-x: auto; padding-bottom: 0.5rem; scrollbar-width: thin; }
        
        .summary-card-small::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%); pointer-events: none; }
        
        
        
        .tracking-layout { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
        @media (min-width: 1024px) { .tracking-layout { grid-template-columns: 380px 1fr; height: 650px; } }
        @media (min-width: 1280px) { .tracking-layout { grid-template-columns: 480px 1fr; } }
        
        .mock-map {
          position: relative;
          background-color: var(--bg-secondary);
          background-image: 
            radial-gradient(circle at 50% 50%, rgba(124, 92, 255, 0.08), transparent 70%),
            linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
          background-size: 100% 100%, 40px 40px, 40px 40px;
          height: 350px;
          border-radius: var(--radius-lg);
          overflow: hidden;
          border: 1px solid var(--border-color);
          box-shadow: inset 0 0 100px rgba(0,0,0,0.5);
        }
        @media (min-width: 1024px) { .mock-map { height: calc(100% - 70px); } }
        
        .geofence-circle {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 250px;
          height: 250px;
          border: 2px dashed rgba(56, 232, 255, 0.4);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(56, 232, 255, 0.05) 0%, transparent 70%);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: pulseGeofence 4s infinite;
        }
        .geofence-circle::after {
          content: '200m RADIUS';
          position: absolute;
          bottom: -25px;
          font-size: 0.75rem;
          color: rgba(56, 232, 255, 0.8);
          font-weight: 600;
          letter-spacing: 0.1em;
        }
        @keyframes pulseGeofence {
          0% { box-shadow: 0 0 0 0 rgba(56, 232, 255, 0.1); }
          50% { box-shadow: 0 0 0 20px rgba(56, 232, 255, 0); }
          100% { box-shadow: 0 0 0 0 rgba(56, 232, 255, 0); }
        }
        
        .office-icon {
          display: flex;
          flex-direction: column;
          align-items: center;
          background-color: var(--bg-surface-elevated);
          padding: 0.5rem 0.75rem;
          border-radius: var(--radius-md);
          box-shadow: 0 0 20px rgba(56, 232, 255, 0.2);
          border: 1px solid rgba(56, 232, 255, 0.3);
          z-index: 2;
        }
        
        .emp-marker {
          position: absolute;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 2px solid var(--bg-surface);
          transform: translate(-50%, -50%);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          box-shadow: 0 2px 10px rgba(0,0,0,0.5);
          z-index: 5;
        }
        .emp-marker:hover { transform: translate(-50%, -50%) scale(1.3); z-index: 10; }
        
        .marker-pulse {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          border: 2px solid;
          opacity: 0;
        }
        
        /* Animations based on status */
        .emp-status-Working .marker-pulse { animation: markerPulse 1.5s infinite; }
        .emp-status-WFH .marker-pulse { animation: markerPulse 3s infinite; }
        .emp-status-Outside-Geofence .marker-pulse { animation: markerPulse 1.5s infinite; }
        .emp-status-On-Break .marker-pulse { animation: markerPulse 2.5s infinite; }
        
        @keyframes markerPulse {
          0% { transform: scale(0.5); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        
        .marker-label-container {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          pointer-events: none;
          z-index: 6;
        }
        
        .marker-connector {
          width: 1px;
          background-color: var(--border-color);
        }
        
        .marker-label {
          background-color: rgba(17,23,34,0.92);
          color: #F5F7FB;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 0.7rem;
          font-weight: 600;
          white-space: nowrap;
          box-shadow: var(--shadow-md);
          border: 1px solid rgba(255,255,255,0.10);
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }

        /* Staggering labels */
        .emp-marker:nth-child(even) .marker-label-container {
          top: 100%;
          flex-direction: column;
        }
        .emp-marker:nth-child(odd) .marker-label-container {
          bottom: 100%;
          flex-direction: column-reverse;
        }
        
        .emp-marker:nth-child(3n) .marker-connector { height: 28px; }
        .emp-marker:nth-child(3n+1) .marker-connector { height: 16px; }
        .emp-marker:nth-child(3n+2) .marker-connector { height: 8px; }

        .filters-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.5rem; }
        .form-select { appearance: auto; }
        
        .row-alert { background-color: rgba(244, 63, 94, 0.1) !important; }
        .row-alert td { border-bottom-color: rgba(244, 63, 94, 0.2) !important; }
        
        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; max-width: 450px; height: 100%; display: flex; flex-direction: column; box-shadow: -10px 0 30px rgba(0,0,0,0.5); animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; border-left: 1px solid var(--border-color); }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); }
        .drawer-body { overflow-y: auto; }
        
        .detail-section { margin-bottom: 1.5rem; }
        .ds-title { font-size: 0.875rem; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .detail-value { font-size: 0.875rem; color: var(--text-primary); font-weight: 500; }
        
        .timeline { display: flex; flex-direction: column; gap: 1.25rem; position: relative; padding-left: 1rem; }
        .timeline::before { content: ''; position: absolute; left: 4px; top: 6px; bottom: 0; width: 2px; background-color: var(--border-color); }
        .tl-item { position: relative; }
        .tl-item::before { content: ''; position: absolute; left: -1rem; top: 0.25rem; width: 10px; height: 10px; border-radius: 50%; background-color: var(--cyan-500); border: 2px solid var(--bg-surface); z-index: 1; box-shadow: 0 0 10px var(--cyan-500); }
        .tl-time { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.25rem; }
        .tl-title { font-size: 0.875rem; font-weight: 600; color: var(--text-primary); }
        .tl-desc { font-size: 0.75rem; color: var(--text-secondary); }

        @media (max-width: 1024px) {
          .hide-tablet { display: none; }
        }
        @media (max-width: 768px) {
          .hide-mobile { display: none; }
          .drawer-overlay { align-items: flex-end; }
          .drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); border-left: none; border-top: 1px solid var(--border-color); animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; max-width: 100%; }
        }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminLiveTracking;


