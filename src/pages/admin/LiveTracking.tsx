import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  MapPin, Clock, Search, Filter, 
  RefreshCw, AlertCircle, X, 
  AlertTriangle, ShieldAlert, Calendar, Download
} from 'lucide-react';
import { realtimeService } from '../../services/realtime/realtimeService';
import { loadLiveTrackingInput } from '../../services/location/liveTrackingService';
import { buildLiveTrackingRows, liveKpiCounts, type LiveTrackingInput, type LiveTrackingKpi } from '../../services/location/liveTrackingRules';
import LiveTrackingKpiModal from '../../components/tracking/LiveTrackingKpiModal';
import { supabase } from '../../lib/supabase';
import { useDepartments } from '../../hooks/useDepartments';

import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import LeafletLiveMap from '../../components/tracking/LeafletLiveMap';
import LiveActivityLogs from '../../components/tracking/LiveActivityLogs';
type EmployeeStatus = 'Working' | 'On Break' | 'WFH' | 'Outside Geofence' | 'Location Unavailable' | 'Offline' | 'Clocked Out';
type WorkMode = 'Office' | 'WFH' | 'Hybrid';

interface LiveEmployee {
  id: string;
  empId: string;
  name: string;
  department: string;
  departmentId: string | null;
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
  officeRadius: number | null;
  lat: number | null;
  lng: number | null;
  x: number;
  y: number;
}

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

/** Adapt shared Live Tracking rows to the fields the existing list, drawer and map read. */
function toDisplayRows(input: LiveTrackingInput, nowMs: number) {
  return buildLiveTrackingRows(input, nowMs).map((r: any) => {
    const stale = !r.lastSeenAt || (nowMs - new Date(r.lastSeenAt).getTime()) / 60000 > 15;
    const locationStatus = !r.lastSeenAt ? 'No location'
      : stale ? 'STALE / LAST KNOWN'
      : r.geofence === 'INSIDE' ? 'Inside Geofence' : r.geofence === 'OUTSIDE' ? 'Outside Geofence' : (r.geofence || 'Unknown');
    const dist = r.distanceMeters != null ? `${Math.round(r.distanceMeters)}m` : 'N/A';
    const emp = input.employees.find((e: any) => e.id === r.employeeId);
    const officeLat = emp?.offices?.latitude ?? null;
    const officeLng = emp?.offices?.longitude ?? null;
    return {
      ...r,
      locationStatus,
      distance: stale && r.distanceMeters != null ? `Last known: ${dist}` : dist,
      lastUpdated: r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }) : '-',
      workingSince: r.clockInAt ? new Date(r.clockInAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '-',
      officeLat, officeLng,
      x: r.lng != null && officeLng != null ? 50 + ((r.lng - officeLng) * 10000) : 50,
      y: r.lat != null && officeLat != null ? 50 - ((r.lat - officeLat) * 10000) : 50,
    };
  });
}

const AdminLiveTracking: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'Live View' | 'History'>('Live View');
  
  // LIVE VIEW STATES
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<LiveEmployee[]>([]);
  // Last loaded Live Tracking inputs; realtime location updates rebuild rows from these (same rules as the KPIs)
  const inputRef = useRef<LiveTrackingInput | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [liveKpi, setLiveKpi] = useState<LiveTrackingKpi | null>(null);
  const [activeOffices, setActiveOffices] = useState<any[]>([]);
  const [lastUpdatedTime, setLastUpdatedTime] = useState(new Date().toLocaleTimeString('en-US'));
  
  // Live View Filters
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');
  const [officeFilter, setOfficeFilter] = useState('All');
  const { departments, loading: deptLoading } = useDepartments();
  const [statusFilter, setStatusFilter] = useState('Currently Working');
  
  // Drawer
  const [selectedEmp, setSelectedEmp] = useState<LiveEmployee | null>(null);

  // Auto Refresh
  const [autoRefresh, setAutoRefresh] = useState(true);

  // HISTORY STATES
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  
  // History Filters
  const [hSearch, setHSearch] = useState('');
  const [hDate, setHDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const [hOfficeFilter, setHOfficeFilter] = useState('All');
  const [hStatusFilter, setHStatusFilter] = useState('All');
  
  useEffect(() => {
    fetchOffices();
    fetchLocations();

    const liveChannel = realtimeService.subscribeToLiveLocations((payload) => {
      if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
        const newData = payload.new;
        if (!newData) return;

        const input = inputRef.current;
        if (!input) return;
        const others = input.liveLocations.filter((l: any) => l.employee_id !== newData.employee_id);
        inputRef.current = { ...input, liveLocations: [...others, newData] };
        setEmployees(toDisplayRows(inputRef.current, Date.now()));
      }
    });

    const historyChannel = realtimeService.subscribeToLocationHistory(async (payload) => {
      if (payload.eventType === 'INSERT') {
        const newRecord = payload.new;
        if (!newRecord) return;
        
        // Fetch the full joined record using the id
        const { data } = await supabase
          .from('employee_location_history')
          .select(`
            *,
            employees (first_name, last_name, employee_code, departments(name)),
            offices (name)
          `)
          .eq('id', newRecord.id)
          .single();
          
        if (data) {
          setHistoryRecords(prev => {
            // Avoid duplicates
            if (prev.some(r => r.id === (data as any).id)) return prev;
            return [data, ...prev];
          });
        }
      }
    });

    // Clock-in/out, break start/end and WFH approvals: refetch (debounced) so KPIs and details update in realtime
    const scheduleRefetch = () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => { fetchLocations(true); }, 800);
    };
    const attendanceChannel = realtimeService.subscribeToAdminAttendance(scheduleRefetch);
    const breaksChannel = realtimeService.subscribeToAdminBreaks(scheduleRefetch);
    const wfhChannel = realtimeService.subscribeToAdminWFH(scheduleRefetch);

    // GPS staleness depends on time passing: re-evaluate every minute from data already loaded
    const tick = setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (inputRef.current) setEmployees(toDisplayRows(inputRef.current, now));
    }, 60000);

    return () => {
      clearInterval(tick);
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      realtimeService.unsubscribe(liveChannel);
      realtimeService.unsubscribe(historyChannel);
      realtimeService.unsubscribe(attendanceChannel);
      realtimeService.unsubscribe(breaksChannel);
      realtimeService.unsubscribe(wfhChannel);
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'History') {
      fetchHistory();
    }
  }, [activeTab, hDate, hOfficeFilter, hStatusFilter]);

  const fetchOffices = async () => {
    const { data } = await supabase.from('offices').select('*').eq('is_active', true).order('name');
    if (data) setActiveOffices(data);
  };

  const fetchLocations = async (silent = false) => {
    if (!silent) setLoading(true);
    const { input, errors } = await loadLiveTrackingInput();
    if (errors.length) console.error('[Live Tracking] load errors:', errors);
    inputRef.current = input;
    const now = Date.now();
    setNowTick(now);
    setEmployees(toDisplayRows(input, now));
    setLastUpdatedTime(new Date().toLocaleTimeString('en-US'));
    if (!silent) setLoading(false);
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    let query = supabase
      .from('employee_location_history')
      .select(`
        *,
        employees (first_name, last_name, employee_code, departments(name)),
        offices (name)
      `)
      .order('recorded_at', { ascending: false });

    if (hDate) {
      const start = new Date(`${hDate}T00:00:00+05:30`).toISOString();
      const end = new Date(`${hDate}T23:59:59+05:30`).toISOString();
      query = query.gte('recorded_at', start).lte('recorded_at', end);
    }
    if (hOfficeFilter !== 'All') {
      query = query.eq('office_id', hOfficeFilter);
    }
    if (hStatusFilter !== 'All') {
      query = query.eq('location_status', hStatusFilter);
    }

    const { data, error } = await query.limit(100);
    if (error) {
       console.error('[HISTORY QUERY ERROR]', error);
       setHistoryError(error.message);
       setHistoryRecords([]);
    } else if (data) {
       setHistoryRecords(data);
    } else {
       setHistoryRecords([]);
    }
    setHistoryLoading(false);
  };

  useEffect(() => {
    // Auto-refresh is handled by Realtime now.
    // Interval removed per user request: "Do not require Refresh Now for normal tracking... realtime works without refresh".
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
      if (deptFilter !== 'All' && (deptFilter === 'Unassigned' ? emp.departmentId !== null : emp.departmentId !== deptFilter)) return false;
      if (officeFilter !== 'All' && emp.officeId !== officeFilter) return false;
      return true;
    });
  }, [employees, search, statusFilter, deptFilter, officeFilter]);

  const filteredHistory = useMemo(() => {
    const seen = new Set();
    return historyRecords.filter(rec => {
      if (seen.has(rec.id)) return false;
      seen.add(rec.id);
      
      // Client-side Date Check (fallback for realtime records)
      if (hDate) {
         const recDate = new Date(rec.recorded_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
         if (recDate !== hDate) return false;
      }
      if (hOfficeFilter !== 'All' && rec.office_id !== hOfficeFilter) return false;
      if (hStatusFilter !== 'All' && rec.location_status !== hStatusFilter) return false;

      if (!hSearch) return true;
      const empName = rec.employees ? `${rec.employees.first_name} ${rec.employees.last_name}`.toLowerCase() : '';
      const empCode = rec.employees?.employee_code?.toLowerCase() || '';
      return empName.includes(hSearch.toLowerCase()) || empCode.includes(hSearch.toLowerCase());
    });
  }, [historyRecords, hSearch, hDate, hOfficeFilter, hStatusFilter]);

  const exportHistoryPDF = () => {
    const doc = new jsPDF();
    doc.text("Live Tracking History", 14, 15);
    doc.setFontSize(10);
    doc.text(`Date: ${hDate}`, 14, 22);
    
    const tableData = filteredHistory.map(rec => [
      new Date(rec.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      rec.employees ? `${rec.employees.first_name} ${rec.employees.last_name} (${rec.employees.employee_code})` : 'Unknown',
      rec.location_status,
      rec.location_context,
      rec.distance_from_office_meters != null ? `${Math.round(rec.distance_from_office_meters)}m` : '-',
      rec.latitude && rec.longitude ? `${rec.latitude.toFixed(5)}, ${rec.longitude.toFixed(5)}` : '-'
    ]);

    (doc as any).autoTable({
      startY: 30,
      head: [['Time', 'Employee', 'Status', 'Context', 'Distance', 'Location (Lat/Lng)']],
      body: tableData,
    });
    doc.save(`Tracking_History_${hDate}.pdf`);
  };

  const exportHistoryExcel = () => {
    const data = filteredHistory.map(rec => ({
      Time: new Date(rec.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      Employee: rec.employees ? `${rec.employees.first_name} ${rec.employees.last_name}` : 'Unknown',
      'Employee ID': rec.employees?.employee_code || '',
      Status: rec.location_status,
      Context: rec.location_context,
      Distance: rec.distance_from_office_meters != null ? `${Math.round(rec.distance_from_office_meters)}m` : '',
      Latitude: rec.latitude,
      Longitude: rec.longitude,
      Source: rec.source
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'History');
    XLSX.writeFile(workbook, `Tracking_History_${hDate}.xlsx`);
  };

  // Same predicates as the KPI detail modal (liveTrackingRules.liveKpiPredicate)
  const kpiCounts = liveKpiCounts(employees, nowTick);
  const kpis = {
    working: kpiCounts.CURRENTLY_WORKING,
    inOffice: kpiCounts.IN_OFFICE,
    wfh: kpiCounts.WFH,
    outside: kpiCounts.OUTSIDE_GEOFENCE,
  };
  const liveKpiCardProps = (k: LiveTrackingKpi) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-haspopup': 'dialog' as const,
    className: `tracking-kpi-card kpi-clickable${liveKpi === k ? ' kpi-active' : ''}`,
    onClick: () => setLiveKpi(k),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLiveKpi(k); } },
  });



  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", position: "relative" }}>
      <div style={{ backgroundColor: "var(--primary-50)", padding: "0.75rem 1rem", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "var(--primary-700)" }}>
        <ShieldAlert size={16} />
        Live location is explicitly tracked strictly according to company attendance policy using real GPS hardware sensors.
      </div>

      <div className="page-header" style={{ marginBottom: 0, flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            Live Tracking
            {activeTab === "Live View" && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", padding: "0.25rem 0.5rem", backgroundColor: "rgba(239, 68, 68, 0.1)", color: "var(--danger-600)", borderRadius: "var(--radius-full)", border: "1px solid var(--danger-200)" }}>
                <div className="pulse-dot-live" /> LIVE
              </div>
            )}
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginTop: "0.25rem" }}>Monitor employees currently working and their historical GPS records.</p>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", backgroundColor: "var(--bg-surface)", padding: "0.25rem", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)" }}>
          <button 
            className={`btn ${activeTab === 'Live View' ? 'btn-primary' : 'btn-outline'}`} 
            style={activeTab !== "Live View" ? { border: "none", color: "var(--text-secondary)" } : {}}
            onClick={() => setActiveTab("Live View")}
          >
            Live View
          </button>
          <button 
            className={`btn ${activeTab === 'History' ? 'btn-primary' : 'btn-outline'}`}
            style={activeTab !== "History" ? { border: "none", color: "var(--text-secondary)" } : {}}
            onClick={() => setActiveTab("History")}
          >
            History
          </button>
        </div>
      </div>

      {activeTab === "Live View" ? (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
              Last updated: <strong>{lastUpdatedTime}</strong>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ width: "16px", height: "16px", accentColor: "var(--primary-600)" }} />
              Auto Refresh
            </label>
            <button className="btn btn-outline" onClick={handleRefresh}>
              <RefreshCw size={16} className={loading ? "spin-slow" : ""} /> Refresh Now
            </button>
          </div>
          
          {loading ? (
            <>
              <div className="skeleton-container" style={{ display: "flex", gap: "1rem", overflowX: "auto", paddingBottom: "0.5rem" }}>
                {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: "150px", height: "90px", borderRadius: "var(--radius-md)" }} />)}
              </div>
              <div className="skeleton" style={{ height: "400px", borderRadius: "var(--radius-md)" }} />
            </>
          ) : (
            <>
              <div className="responsive-grid">
                <div {...liveKpiCardProps('CURRENTLY_WORKING')}>
                  <div className="sc-title">Currently Working</div>
                  <div className="sc-val" style={{ color: "var(--success)" }}>{kpis.working}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>Employees Working</div>
                </div>
                <div {...liveKpiCardProps('IN_OFFICE')}>
                  <div className="sc-title">In Office</div>
                  <div className="sc-val">{kpis.inOffice}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>Inside Office</div>
                </div>
                <div {...liveKpiCardProps('WFH')}>
                  <div className="sc-title">WFH</div>
                  <div className="sc-val" style={{ color: "var(--primary-600)" }}>{kpis.wfh}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>Working Remotely</div>
                </div>
                <div {...liveKpiCardProps('OUTSIDE_GEOFENCE')}>
                  <div className="sc-title">Outside Geofence</div>
                  <div className="sc-val" style={{ color: "var(--danger-600)" }}>{kpis.outside}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>Attention Required</div>
                </div>
              </div>

              {liveKpi && (
                <LiveTrackingKpiModal
                  kpi={liveKpi}
                  rows={employees}
                  nowMs={nowTick}
                  expectedCount={kpiCounts[liveKpi]}
                  onClose={() => setLiveKpi(null)}
                  onViewEmployee={(row) => { setLiveKpi(null); setSelectedEmp(row as any); }}
                />
              )}

              <div className="tracking-layout">
                <div className="lt-map-activity">
                  <div className="card map-container" style={{ position: "relative", minHeight: "350px", display: "flex", flexDirection: "column" }}>
                    <h3 className="card-title" style={{ marginBottom: "1rem", display: "flex", justifyContent: "space-between" }}>
                      Map View
                    </h3>
                  
                    <div style={{ width: "100%", flex: 1, minHeight: "400px", borderRadius: "var(--radius-lg)", position: "relative", overflow: "hidden" }}>
                      <LeafletLiveMap 
                        employees={filteredEmployees}
                        office={officeFilter !== 'All' ? activeOffices.find(o => o.id === officeFilter) || activeOffices[0] : activeOffices[0]}
                        selectedEmpId={selectedEmp?.id}
                      />
                    </div>
                  
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem", fontSize: "0.75rem", justifyContent: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}><span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "var(--success)" }}></span> Working / In Office</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}><span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "var(--primary-500)" }}></span> WFH</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}><span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "var(--danger)" }}></span> Outside Geofence</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}><span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "var(--gray-500)" }}></span> Last Known (Stale)</div>
                    </div>
                  </div>
                  <LiveActivityLogs
                    onSelectEmployee={(_employeeId, employeeCode) => {
                      // Reuse the page's existing selection: opens the employee drawer and the map pans to the marker
                      const emp = employees.find(e => e.empId === employeeCode);
                      if (emp) setSelectedEmp(emp);
                    }}
                  />
                </div>

                <div className="card list-container" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "1.25rem", borderBottom: "1px solid var(--border-color)" }}>
                    <h3 className="card-title" style={{ marginBottom: "1rem" }}>Employee List</h3>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <div className="search-box" style={{ position: "relative" }}>
                        <Search size={18} style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
                        <input 
                          type="text" 
                          placeholder="Search by Name or ID..." 
                          className="form-control" 
                          style={{ paddingLeft: "2.5rem" }}
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
                  
                  <div className="table-container" style={{ flex: 1, overflowY: "auto" }}>
                    {filteredEmployees.length === 0 ? (
                      <div style={{ padding: "3rem 1rem", textAlign: "center" }}>
                        <AlertCircle size={32} color="var(--gray-400)" style={{ margin: "0 auto 1rem auto" }} />
                        <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>No employees found</h3>
                      </div>
                    ) : (
                      <table className="table">
                        <thead style={{ position: "sticky", top: 0, backgroundColor: "var(--bg-surface)", zIndex: 10 }}>
                          <tr>
                            <th>Employee</th>
                            <th>Status</th>
                            <th>Location</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEmployees.map(emp => (
                            <tr key={emp.id} className={emp.status === "Outside Geofence" ? "row-alert" : ""}>
                              <td>
                                <div style={{ fontWeight: 500 }}>{emp.name}</div>
                                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{emp.empId}</div>
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
                                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                                  <MapPin size={14} color="var(--gray-400)" />
                                  <span style={{ fontSize: "0.875rem", color: emp.locationStatus === 'STALE / LAST KNOWN' ? "var(--text-secondary)" : "inherit" }}>{emp.locationStatus}</span>
                                </div>
                                {emp.distance !== "N/A" && emp.distance !== "Unknown" && (
                                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginLeft: "1.25rem" }}>{emp.distance}</div>
                                )}
                              </td>
                              <td>
                                <button className="btn btn-outline" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }} onClick={() => setSelectedEmp(emp)} disabled={emp.lat == null || emp.lng == null}>
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
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
            <div className="search-box" style={{ position: "relative", flex: 1, minWidth: "250px" }}>
              <Search size={18} style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
              <input 
                type="text" 
                placeholder="Search History by Employee..." 
                className="form-control" 
                style={{ paddingLeft: "2.5rem" }}
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
              <option value="INSIDE_GEOFENCE">Inside Geofence</option>
              <option value="OUTSIDE_GEOFENCE">Outside Geofence</option>
            </select>
            <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
              <button className="btn btn-outline" onClick={exportHistoryPDF} disabled={filteredHistory.length === 0} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Download size={16} /> PDF
              </button>
              <button className="btn btn-outline" onClick={exportHistoryExcel} disabled={filteredHistory.length === 0} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Download size={16} /> Excel
              </button>
            </div>
          </div>

          <div className="table-container" style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)" }}>
            {historyLoading ? (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-secondary)" }}>Loading history...</div>
            ) : historyError ? (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--danger)" }}>
                Error loading history: {historyError}
              </div>
            ) : filteredHistory.length === 0 ? (
              <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-secondary)" }}>
                No tracking history found for the selected criteria.
              </div>
            ) : (
              <table className="table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Employee</th>
                    <th>Status</th>
                    <th>Context</th>
                    <th>Distance</th>
                    <th>Location (Lat/Lng)</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((rec: any) => (
                    <tr key={rec.id}>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>
                        {new Date(rec.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{rec.employees ? `${rec.employees.first_name} ${rec.employees.last_name}` : 'Unknown'}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{rec.employees?.employee_code}</div>
                      </td>
                      <td>
                        <span className="badge" style={{ 
                          backgroundColor: rec.location_status === 'INSIDE_GEOFENCE' ? 'var(--success-50)' : 'var(--danger-50)',
                          color: rec.location_status === 'INSIDE_GEOFENCE' ? 'var(--success-700)' : 'var(--danger-700)'
                        }}>
                          {rec.location_status}
                        </span>
                      </td>
                      <td>{rec.location_context}</td>
                      <td>{rec.distance_from_office_meters != null ? `${Math.round(rec.distance_from_office_meters)}m` : '-'}</td>
                      <td>
                        {rec.latitude && rec.longitude ? (
                          <div style={{ fontSize: "0.75rem" }}>
                            {rec.latitude.toFixed(5)}, {rec.longitude.toFixed(5)}
                          </div>
                        ) : '-'}
                      </td>
                      <td style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>{rec.source || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {selectedEmp && activeTab === "Live View" && (
        <div className="drawer-overlay" onClick={() => setSelectedEmp(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>{selectedEmp.name}</h2>
                <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>{selectedEmp.empId} • {selectedEmp.department}</div>
              </div>
              <button className="icon-button" onClick={() => setSelectedEmp(null)}><X size={20} /></button>
            </div>
            
            <div className="drawer-body" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {selectedEmp.status === "Outside Geofence" && (
                <div style={{ backgroundColor: "var(--danger-50)", border: "1px solid var(--danger-200)", borderRadius: "var(--radius-md)", padding: "1rem", display: "flex", gap: "0.75rem" }}>
                  <AlertCircle size={20} color="var(--danger-600)" style={{ flexShrink: 0 }} />
                  <div>
                    <h4 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--danger-800)", marginBottom: "0.25rem" }}>Location Alert</h4>
                    <p style={{ fontSize: "0.75rem", color: "var(--danger)" }}>{selectedEmp.empId} is currently outside the assigned office geofence.</p>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "var(--gray-50)", padding: "1rem", borderRadius: "var(--radius-md)" }}>
                <div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>Current Status</div>
                  <div style={{ fontSize: "1.125rem", fontWeight: 600, color: selectedEmp.locationStatus === 'STALE / LAST KNOWN' ? 'var(--gray-500)' : getStatusColor(selectedEmp.status) }}>{selectedEmp.status}</div>
                </div>
              </div>

              <div className="detail-section">
                <h4 className="ds-title"><MapPin size={16}/> Location Info</h4>
                <div className="detail-grid">
                  <div className="detail-item" style={{ gridColumn: "1 / -1" }}><span className="detail-label">Assigned Office</span><span className="detail-value">{selectedEmp.office}</span></div>
                  <div className="detail-item" style={{ gridColumn: "1 / -1" }}><span className="detail-label">Location Status</span>
                    <span className="detail-value" style={{ fontWeight: 600, color: selectedEmp.status === "Outside Geofence" ? "var(--danger-600)" : "inherit" }}>
                      {selectedEmp.locationStatus}
                    </span>
                  </div>
                  <div className="detail-item"><span className="detail-label">Distance</span><span className="detail-value">{selectedEmp.distance}</span></div>
                  <div className="detail-item"><span className="detail-label">Geofence Radius</span><span className="detail-value">{selectedEmp.officeRadius != null ? `${selectedEmp.officeRadius}m` : '-'}</span></div>
                  <div className="detail-item" style={{ gridColumn: "1 / -1" }}><span className="detail-label">Last Location Update</span><span className="detail-value">{selectedEmp.lastUpdated}</span></div>
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
        @media (min-width: 1024px) { .tracking-layout { grid-template-columns: 1fr 1.1fr; min-height: 650px; height: auto; } }
        @media (min-width: 1280px) { .tracking-layout { grid-template-columns: 1fr 1.2fr; } }
        
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
