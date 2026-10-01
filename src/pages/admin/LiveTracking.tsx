import React, { useState, useEffect, useMemo } from 'react';
import { 
  MapPin, Clock, Search, Filter, 
  RefreshCw, AlertCircle, X, 
  AlertTriangle, ShieldAlert, Calendar
} from 'lucide-react';
import { locationService } from '../../services/location/locationService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { supabase } from '../../lib/supabase';

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
  officeId: string | null;
  officeLat: number;
  officeLng: number;
  officeRadius: number;
  x: number;
  y: number;
}

const AdminLiveTracking: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'Live View' | 'History'>('Live View');
  
  // LIVE VIEW STATES
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [employees, setEmployees] = useState<LiveEmployee[]>([]);
  const [activeOffices, setActiveOffices] = useState<any[]>([]);
  const [lastUpdatedTime, setLastUpdatedTime] = useState(new Date().toLocaleTimeString('en-US'));
  
  // Live View Filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [officeFilter, setOfficeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('Currently Working');
  
  // Drawer
  const [selectedEmp, setSelectedEmp] = useState<LiveEmployee | null>(null);

  // Auto Refresh
  const [autoRefresh, setAutoRefresh] = useState(true);

  // HISTORY STATES
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  
  // History Filters
  const [hSearch, setHSearch] = useState('');
  const [hDate, setHDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const [hOfficeFilter, setHOfficeFilter] = useState('All');
  const [hStatusFilter, setHStatusFilter] = useState('All');
  
  useEffect(() => {
    fetchOffices();
    fetchLocations();

    const channel = realtimeService.subscribeToLiveLocations(() => {
      if (activeTab === 'Live View') {
        fetchLocations();
      }
    });

    return () => {
      realtimeService.unsubscribe(channel);
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'History') {
      fetchHistory();
    }
  }, [activeTab, hDate, hOfficeFilter, hStatusFilter]);

  const fetchOffices = async () => {
    const { data } = await supabase.from('offices').select('*').eq('is_active', true).order('name');
    if (data) setActiveOffices(data);
  };

  const fetchLocations = async () => {
    setLoading(true);
    const { data } = await locationService.getAllLiveLocations();
    if (data) {
      setEmployees(data.map((l: any) => ({
        id: l.id,
        empId: l.employees?.employee_code || '-',
        name: l.employees ? `${l.employees.first_name} ${l.employees.last_name}` : 'Unknown',
        department: l.employees?.departments?.name || '-',
        shift: 'General', 
        workMode: l.location_context === 'WFH' ? 'WFH' : 'Office',
        status: l.location_status === 'OUTSIDE_GEOFENCE' ? 'Outside Geofence' : (l.location_context === 'WFH' ? 'WFH' : 'Working'),
        locationStatus: l.location_status === 'INSIDE_GEOFENCE' ? 'Inside Geofence' : (l.location_status === 'OUTSIDE_GEOFENCE' ? 'Outside Geofence' : l.location_status),
        distance: l.distance_from_office_meters ? `${Math.round(l.distance_from_office_meters)}m` : 'N/A',
        lastUpdated: new Date(l.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        workingSince: '-', 
        office: l.employees?.offices?.name || '-',
        officeId: l.employees?.offices?.id || null,
        officeLat: l.employees?.offices?.latitude || 13.0827,
        officeLng: l.employees?.offices?.longitude || 80.2707,
        officeRadius: l.employees?.offices?.geofence_radius || 200,
        x: l.longitude && l.employees?.offices?.longitude ? 50 + ((l.longitude - l.employees.offices.longitude) * 10000) : 50,
        y: l.latitude && l.employees?.offices?.latitude ? 50 - ((l.latitude - l.employees.offices.latitude) * 10000) : 50
      })));
      setLastUpdatedTime(new Date().toLocaleTimeString('en-US'));
    }
    setLoading(false);
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    let query = supabase
      .from('location_verification_events')
      .select(`
        *,
        employees (first_name, last_name, employee_code, departments(name)),
        offices (name)
      `)
      .order('verified_at', { ascending: false });

    if (hDate) {
      query = query.gte('verified_at', `${hDate}T00:00:00`).lte('verified_at', `${hDate}T23:59:59`);
    }
    if (hOfficeFilter !== 'All') {
      query = query.eq('office_id', hOfficeFilter);
    }
    if (hStatusFilter !== 'All') {
      query = query.eq('result', hStatusFilter);
    }

    const { data } = await query.limit(500);
    if (data) {
       setHistoryRecords(data);
    }
    setHistoryLoading(false);
  };

  useEffect(() => {
    if (!autoRefresh || activeTab !== 'Live View') return;
    const interval = setInterval(() => {
      fetchLocations();
    }, 15000); 
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab]);

  const handleRefresh = () => {
    fetchLocations();
  };

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const searchMatch = emp.name.toLowerCase().includes(search.toLowerCase()) || emp.empId.toLowerCase().includes(search.toLowerCase());
      if (!searchMatch) return false;
      if (statusFilter === 'Currently Working' && (emp.status === 'Clocked Out' || emp.status === 'Offline')) return false;
      if (statusFilter !== 'All' && statusFilter !== 'Currently Working' && emp.status !== statusFilter) return false;
      if (deptFilter !== 'All' && emp.department !== deptFilter) return false;
      if (officeFilter !== 'All' && emp.officeId !== officeFilter) return false;
      return true;
    });
  }, [employees, search, statusFilter, deptFilter, officeFilter]);

  const filteredHistory = useMemo(() => {
    return historyRecords.filter(rec => {
      if (!hSearch) return true;
      const empName = rec.employees ? `${rec.employees.first_name} ${rec.employees.last_name}`.toLowerCase() : '';
      const empCode = rec.employees?.employee_code?.toLowerCase() || '';
      return empName.includes(hSearch.toLowerCase()) || empCode.includes(hSearch.toLowerCase());
    });
  }, [historyRecords, hSearch]);

  const kpis = {
    working: employees.filter(e => e.status === 'Working').length,
    inOffice: employees.filter(e => e.locationStatus === 'Inside Geofence').length,
    wfh: employees.filter(e => e.status === 'WFH').length,
    outside: employees.filter(e => e.status === 'Outside Geofence').length,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {/* Privacy Notice */}
      <div style={{ backgroundColor: 'var(--primary-50)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--primary-700)' }}>
        <ShieldAlert size={16} />
        Live location is explicitly tracked strictly according to company attendance policy using real GPS hardware sensors.
      </div>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            Live Tracking
            {activeTab === 'Live View' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', padding: '0.25rem 0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-600)', borderRadius: 'var(--radius-full)', border: '1px solid var(--danger-200)' }}>
                <div className="pulse-dot-live" /> LIVE
              </div>
            )}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Monitor employees currently working and their historical GPS records.</p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: 'var(--bg-surface)', padding: '0.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
          <button 
            className={`btn ${activeTab === 'Live View' ? 'btn-primary' : 'btn-outline'}`} 
            style={activeTab !== 'Live View' ? { border: 'none', color: 'var(--text-secondary)' } : {}}
            onClick={() => setActiveTab('Live View')}
          >
            Live View
          </button>
          <button 
            className={`btn ${activeTab === 'History' ? 'btn-primary' : 'btn-outline'}`}
            style={activeTab !== 'History' ? { border: 'none', color: 'var(--text-secondary)' } : {}}
            onClick={() => setActiveTab('History')}
          >
            History
          </button>
        </div>
      </div>

      {activeTab === 'Live View' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Last updated: <strong>{lastUpdatedTime}</strong>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--primary-600)' }} />
              Auto Refresh
            </label>
            <button className="btn btn-outline" onClick={handleRefresh}>
              <RefreshCw size={16} className={loading ? 'spin-slow' : ''} /> Refresh Now
            </button>
          </div>
          
          {loading ? (
            <>
              <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '150px', height: '90px', borderRadius: 'var(--radius-md)' }} />)}
              </div>
              <div className="skeleton" style={{ height: '400px', borderRadius: 'var(--radius-md)' }} />
            </>
          ) : (
            <>
              <div className="tracking-kpi-grid">
                <div className="tracking-kpi-card">
                  <div className="sc-title">Currently Working</div>
                  <div className="sc-val" style={{ color: 'var(--success)' }}>{kpis.working}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Employees Working</div>
                </div>
                <div className="tracking-kpi-card">
                  <div className="sc-title">In Office</div>
                  <div className="sc-val">{kpis.inOffice}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Inside Office</div>
                </div>
                <div className="tracking-kpi-card">
                  <div className="sc-title">WFH</div>
                  <div className="sc-val" style={{ color: 'var(--primary-600)' }}>{kpis.wfh}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Working Remotely</div>
                </div>
                <div className="tracking-kpi-card">
                  <div className="sc-title">Outside Geofence</div>
                  <div className="sc-val" style={{ color: 'var(--danger-600)' }}>{kpis.outside}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Attention Required</div>
                </div>
              </div>

              <div className="tracking-layout">
                {/* Map Area */}
                <div className="card map-container" style={{ position: 'relative' }}>
                  <h3 className="card-title" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                    Map View
                  </h3>
                  
                  <div className="mock-map">
                    <div className="geofence-circle" style={officeFilter !== 'All' ? { width: `${(activeOffices.find(o => o.id === officeFilter)?.geofence_radius || 200)}px`, height: `${(activeOffices.find(o => o.id === officeFilter)?.geofence_radius || 200)}px`, borderRadius: '50%' } : {}}>
                      <div className="office-icon">
                        <span style={{ fontSize: '1.25rem', lineHeight: 1, color: 'var(--accent-secondary)' }}>◈</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-secondary)', marginTop: '0.1rem', letterSpacing: '0.1em' }}>OFFICE</span>
                      </div>
                    </div>
                    
                    {filteredEmployees.map(emp => {
                      if (emp.status === 'Location Unavailable' || emp.status === 'Offline') return null;
                      return (
                        <div 
                          key={emp.id}
                          className={`emp-marker emp-status-${emp.status.replace(/s+/g, '-')}`}
                          style={{ 
                            left: `${emp.x}%`, 
                            top: `${emp.y}%`,
                            backgroundColor: getStatusColor(emp.status)
                          }}
                          onClick={() => setSelectedEmp(emp)}
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
                          <option value="WFH">WFH</option>
                          <option value="Outside Geofence">Outside Geofence</option>
                        </select>
                        <select className="form-control form-select" value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}>
                          <option value="All">Office: All</option>
                          {activeOffices.map(office => (
                            <option key={office.id} value={office.id}>{office.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  <div className="table-responsive" style={{ flex: 1, overflowY: 'auto' }}>
                    {filteredEmployees.length === 0 ? (
                      <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                        <AlertCircle size={32} color="var(--gray-400)" style={{ margin: '0 auto 1rem auto' }} />
                        <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>No employees found</h3>
                      </div>
                    ) : (
                      <table className="table">
                        <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-surface)', zIndex: 10 }}>
                          <tr>
                            <th>Employee</th>
                            <th>Status</th>
                            <th>Location</th>
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
                              <td>
                                <span className="badge" style={{ 
                                  backgroundColor: `${getStatusColor(emp.status)}20`, 
                                  color: getStatusColor(emp.status),
                                  border: `1px solid ${getStatusColor(emp.status)}50`
                                }}>
                                  {emp.status}
                                </span>
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <MapPin size={14} color="var(--gray-400)" />
                                  <span style={{ fontSize: '0.875rem' }}>{emp.locationStatus}</span>
                                </div>
                                {emp.distance !== 'N/A' && emp.distance !== 'Unknown' && (
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '1.25rem' }}>{emp.distance}</div>
                                )}
                              </td>
                              <td>
                                <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => setSelectedEmp(emp)}>
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
        </>
      ) : (
        /* History Tab */
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            <div className="search-box" style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
              <Search size={18} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
              <input 
                type="text" 
                placeholder="Search History by Employee..." 
                className="form-control" 
                style={{ paddingLeft: '2.5rem' }}
                value={hSearch}
                onChange={e => setHSearch(e.target.value)}
              />
            </div>
            <input 
              type="date" 
              className="form-control" 
              value={hDate} 
              onChange={e => setHDate(e.target.value)}
            />
            <select className="form-control" value={hOfficeFilter} onChange={e => setHOfficeFilter(e.target.value)}>
              <option value="All">All Offices</option>
              {activeOffices.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <select className="form-control" value={hStatusFilter} onChange={e => setHStatusFilter(e.target.value)}>
              <option value="All">All Results</option>
              <option value="INSIDE">Inside</option>
              <option value="OUTSIDE">Outside</option>
              <option value="LOCATION_DENIED">Location Denied</option>
              <option value="LOCATION_UNAVAILABLE">Location Unavailable</option>
            </select>
          </div>

          <div className="table-container" style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
            {historyLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading history...</div>
            ) : filteredHistory.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No tracking history found for the selected criteria.
              </div>
            ) : (
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Employee</th>
                    <th>Verification Type</th>
                    <th>Result</th>
                    <th>Distance</th>
                    <th>Location (Lat/Lng)</th>
                    <th>Failure Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((rec: any) => (
                    <tr key={rec.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {new Date(rec.verified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{rec.employees ? `${rec.employees.first_name} ${rec.employees.last_name}` : 'Unknown'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{rec.employees?.employee_code}</div>
                      </td>
                      <td>{rec.verification_type}</td>
                      <td>
                        <span className="badge" style={{ 
                          backgroundColor: rec.result === 'INSIDE' ? 'var(--success-50)' : 'var(--danger-50)',
                          color: rec.result === 'INSIDE' ? 'var(--success-700)' : 'var(--danger-700)'
                        }}>
                          {rec.result}
                        </span>
                      </td>
                      <td>{rec.distance_from_office_meters ? `${Math.round(rec.distance_from_office_meters)}m` : '-'}</td>
                      <td>
                        {rec.latitude && rec.longitude ? (
                          <div style={{ fontSize: '0.75rem' }}>
                            {rec.latitude.toFixed(5)}, {rec.longitude.toFixed(5)}
                          </div>
                        ) : '-'}
                      </td>
                      <td style={{ color: 'var(--danger-600)', fontSize: '0.875rem' }}>{rec.failure_reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Drawer */}
      {selectedEmp && activeTab === 'Live View' && (
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
              {selectedEmp.status === 'Outside Geofence' && (
                <div style={{ backgroundColor: 'var(--danger-50)', border: '1px solid var(--danger-200)', borderRadius: 'var(--radius-md)', padding: '1rem', display: 'flex', gap: '0.75rem' }}>
                  <AlertCircle size={20} color="var(--danger-600)" style={{ flexShrink: 0 }} />
                  <div>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--danger-800)', marginBottom: '0.25rem' }}>Location Alert</h4>
                    <p style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{selectedEmp.empId} is currently outside the assigned office geofence.</p>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Current Status</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 600, color: getStatusColor(selectedEmp.status) }}>{selectedEmp.status}</div>
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
                  <div className="detail-item"><span className="detail-label">Geofence Radius</span><span className="detail-value">{selectedEmp.officeRadius}m</span></div>
                  <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="detail-label">Last Location Update</span><span className="detail-value">{selectedEmp.lastUpdated}</span></div>
                </div>
              </div>
            </div>
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
          content: 'RADIUS';
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
        
        .emp-marker:nth-child(even) .marker-label-container { top: 100%; flex-direction: column; }
        .emp-marker:nth-child(odd) .marker-label-container { bottom: 100%; flex-direction: column-reverse; }
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
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        
        .skeleton { background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
};

export default AdminLiveTracking;
