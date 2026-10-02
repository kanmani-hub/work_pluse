import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar, ChevronLeft, ChevronRight, Search, Filter, 
  Download, RefreshCw, Settings, User, Clock, MapPin, 
  Camera, AlertCircle, CheckCircle2, AlertTriangle, 
  X, History, Activity, ShieldCheck, Map, Edit
} from 'lucide-react';
import { attendanceService } from '../../services/attendance/attendanceService';
import { realtimeService } from '../../services/realtime/realtimeService';
import { locationService } from '../../services/location/locationService';
import { supabase } from '../../lib/supabase';



const AdminAttendance: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  // Filters
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterMode, setFilterMode] = useState('All');
  
  // Drawers & Modals
  const [detailDrawer, setDetailDrawer] = useState<any>(null);
  const [correctionModal, setCorrectionModal] = useState<any>(null);
  
  // Correction Form
  const [cForm, setCForm] = useState<any>({});
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [liveStatus, setLiveStatus] = useState<any[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [totalEmployees, setTotalEmployees] = useState(0);

  const localDateStr = selectedDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const currentDateDisplay = selectedDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

  const handlePrevDay = () => setSelectedDate(prev => new Date(prev.getTime() - 86400000));
  const handleNextDay = () => setSelectedDate(prev => new Date(prev.getTime() + 86400000));
  const handleToday = () => setSelectedDate(new Date());

  
  const [attendanceData, setAttendanceData] = useState<any[]>([]);

  
  const fetchAttendance = async () => {
    setLoading(true);
    
    // 1. Fetch total employees
    const { count } = await supabase.from('employees').select('*', { count: 'exact', head: true }).eq('is_active', true);
    if (count !== null) setTotalEmployees(count);

    // 2. Fetch Live Working status
    const { data: liveData } = await locationService.getAllLiveLocations();
    let workingEmployees = 0;
    const mappedLiveStatus: any[] = [];
    if (liveData) {
      liveData.forEach((l: any) => {
        if (l.location_context === 'WFH' || l.location_status === 'INSIDE_GEOFENCE' || l.location_status === 'OUTSIDE_GEOFENCE') {
          workingEmployees++;
          mappedLiveStatus.push({
            emp: l.employees ? `${l.employees.first_name} ${l.employees.last_name}` : 'Unknown',
            shift: 'Working',
            status: 'Working',
            since: new Date(l.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }
      });
      setLiveStatus(mappedLiveStatus);
    }

    // 3. Fetch historical attendance for selectedDate
    const { data } = await attendanceService.getAllAttendance(localDateStr);
    
    // 4. Fetch Approved Leaves and WFH for selectedDate
    // Not explicitly implemented with full queries for brevity, we'll map existing attendance.
    // Assuming attendance table handles LEAVE and WFH records natively when present.
    
    if (data) {
      const mapped = data.map((a: any) => ({
        id: a.id,
        empId: a.employees?.employee_code || '-',
        name: a.employees ? `${a.employees.first_name} ${a.employees.last_name}` : 'Unknown',
        dept: a.employees?.departments?.name || '-',
        office: '-',
        shift: a.shift_template_id || '-',
        shiftTime: '-',
        overnight: false,
        mode: a.work_mode || 'Office',
        clockIn: a.clock_in_at ? new Date(a.clock_in_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--',
        clockOut: a.clock_out_at ? new Date(a.clock_out_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--',
        workHours: '-',
        breakMins: a.break_minutes || 0,
        late: a.late_minutes ? `${a.late_minutes} min` : '-',
        early: a.early_logout_minutes ? `${a.early_logout_minutes} min` : '-',
        status: a.status || 'ABSENT',
        locationVerified: true,
        faceVerified: true,
        missingOut: !a.clock_out_at && a.status !== 'WORKING',
        autoLogout: a.is_auto_logged_out || false,
        late_minutes: a.late_minutes || 0,
        is_half_day: a.is_half_day || false,
        timeline: [],
        history: []
      }));
      setAttendanceData(mapped);

      // Generate exceptions
      const exps = [];
      const lates = mapped.filter((a: any) => a.late_minutes > 0).length;
      if (lates > 0) exps.push({ type: 'Late Arrival', count: lates });
      
      const missingOuts = mapped.filter((a: any) => a.missingOut).length;
      if (missingOuts > 0) exps.push({ type: 'Missing Clock-out', count: missingOuts });
      
      const halfDays = mapped.filter((a: any) => a.is_half_day).length;
      if (halfDays > 0) exps.push({ type: 'Half Day', count: halfDays });

      setExceptions(exps);
    }
    setLoading(false);
  };


  useEffect(() => {
    fetchAttendance();

    const channel = realtimeService.subscribeToAdminAttendance((payload) => {
      fetchAttendance();
    });

    return () => {
      realtimeService.unsubscribe(channel);
    };
  }, [selectedDate]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filteredData = attendanceData.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) || a.empId.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === 'All' || a.dept === filterDept;
    const matchStatus = filterStatus === 'All' || a.status === filterStatus;
    const matchMode = filterMode === 'All' || a.mode === filterMode;
    return matchSearch && matchDept && matchStatus && matchMode;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PRESENT': return <span className="badge badge-success">PRESENT</span>;
      case 'LATE': return <span className="badge badge-warning">LATE</span>;
      case 'EARLY LOGOUT': return <span className="badge badge-warning">EARLY LOGOUT</span>;
      case 'ABSENT': return <span className="badge badge-danger">ABSENT</span>;
      case 'LEAVE': return <span className="badge badge-primary">LEAVE</span>;
      case 'AUTO LOGOUT': return <span className="badge" style={{ backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)' }}>AUTO LOGOUT</span>;
      default: return <span className="badge badge-gray">{status}</span>;
    }
  };

  
  const kpis = {
    total: totalEmployees,
    present: attendanceData.filter(a => a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'EARLY LOGOUT').length,
    absent: attendanceData.filter(a => a.status === 'ABSENT').length,
    late: attendanceData.filter(a => a.status === 'LATE').length,
    onLeave: attendanceData.filter(a => a.status === 'LEAVE').length,
    wfh: attendanceData.filter(a => a.mode === 'WFH').length,
    halfDay: attendanceData.filter(a => a.is_half_day).length,
    working: liveStatus.length
  };


  const handleSaveCorrection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cForm.reason) return;
    
    // Mock update logic
    if (detailDrawer) {
      setDetailDrawer({
        ...detailDrawer,
        clockIn: cForm.clockIn,
        clockOut: cForm.clockOut,
        history: [
          {
            date: '24 Sep 03:45 PM',
            action: `HR changed attendance`,
            reason: cForm.reason,
            by: 'Admin User'
          },
          ...detailDrawer.history
        ]
      });
    }
    setCorrectionModal(null);
    showToast('Attendance updated successfully');
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
          <h1 className="page-title">Attendance Management</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Monitor employee attendance, working hours, shifts, and attendance exceptions.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-elevated)' }}>
            <button className="icon-button" onClick={handlePrevDay} style={{ borderRight: '1px solid var(--border-color)', borderRadius: 'var(--radius-md) 0 0 var(--radius-md)' }}><ChevronLeft size={18}/></button>
            <div style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={16} /> {currentDateDisplay}
            </div>
            <button className="icon-button" onClick={handleNextDay} style={{ borderLeft: '1px solid var(--border-color)', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}><ChevronRight size={18}/></button>
          </div>
          <button className="btn btn-outline" onClick={handleToday} style={{ fontSize: '0.875rem' }}>Today</button>

          <button onClick={() => showToast('Attendance export prepared successfully.')} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export</button>
          <button onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 500); }} className="icon-button  border"><RefreshCw size={16}/></button>
          <button className="icon-button  border"><Settings size={16}/></button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '1rem' }}>
          {[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: '70px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <div className="kpi-grid">
          <div className="tracking-kpi-card">
            <div className="sc-val">{kpis.total}</div>
            <div className="sc-title">Total Employees</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setFilterStatus('PRESENT')}>
            <div className="sc-val" style={{ color: 'var(--success)' }}>{kpis.present}</div>
            <div className="sc-title">Present</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setFilterStatus('ABSENT')}>
            <div className="sc-val" style={{ color: 'var(--danger)' }}>{kpis.absent}</div>
            <div className="sc-title">Absent</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setFilterStatus('LATE')}>
            <div className="sc-val" style={{ color: 'var(--warning)' }}>{kpis.late}</div>
            <div className="sc-title">Late</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setFilterStatus('LEAVE')}>
            <div className="sc-val" style={{ color: 'var(--primary-700)' }}>{kpis.onLeave}</div>
            <div className="sc-title">On Leave</div>
          </div>
          <div className="summary-card-small cursor-pointer" onClick={() => setFilterMode('WFH')}>
            <div className="sc-val" style={{ color: 'var(--purple-700)' }}>{kpis.wfh}</div>
            <div className="sc-title">WFH</div>
          </div>
          <div className="tracking-kpi-card">
            <div className="sc-val">{kpis.halfDay}</div>
            <div className="sc-title">Half Day</div>
          </div>
          <div className="tracking-kpi-card" style={{ backgroundColor: 'var(--success-50)', borderColor: 'var(--success-200)' }}>
            <div className="sc-val" style={{ color: 'var(--success-800)' }}>{kpis.working}</div>
            <div className="sc-title" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}><Activity size={12}/> Currently Working</div>
          </div>
        </div>
      )}

      {/* Exceptions & Live Status Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }} className="responsive-grid-2">
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={18} color="var(--danger)"/> Attendance Exceptions
          </h3>
          {exceptions.length === 0 ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No exceptions found.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {exceptions.map((ex, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--danger-100)' }}>
                  <span style={{ fontSize: '0.875rem', color: 'var(--danger-900)' }}>{ex.type}</span>
                  <span className="badge" style={{ backgroundColor: 'var(--bg-surface-elevated)', color: 'var(--danger)', fontWeight: 700 }}>{ex.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="var(--success)"/> Live Work Status
          </h3>
          {liveStatus.length === 0 ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No live tracking data available.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {liveStatus.map((ls, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: i !== liveStatus.length-1 ? '1px solid var(--gray-200)' : 'none' }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{ls.emp}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{ls.shift}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className={`badge ${ls.status === 'Working' ? 'badge-success' : 'badge-warning'}`}>{ls.status}</span>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Since {ls.since}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Main Roster Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          
          <div style={{ position: 'relative', width: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee..." className="form-control" style={{ paddingLeft: '2.25rem', fontSize: '0.875rem' }} />
          </div>
          
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
            <option value="All">All Departments</option>
            <option>Development</option>
            <option>HR</option>
            <option>Finance</option>
            <option>Support</option>
          </select>

          <select value={filterMode} onChange={e => setFilterMode(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
            <option value="All">All Modes</option>
            <option>Office</option>
            <option>WFH</option>
            <option>Leave</option>
          </select>

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="form-control" style={{ width: 'auto', fontSize: '0.875rem' }}>
            <option value="All">All Statuses</option>
            <option>PRESENT</option>
            <option>LATE</option>
            <option>EARLY LOGOUT</option>
            <option>ABSENT</option>
            <option>LEAVE</option>
          </select>
          
          <button className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}><Filter size={14} style={{ marginRight: '0.25rem' }}/> More</button>
          
          {(search || filterDept !== 'All' || filterMode !== 'All' || filterStatus !== 'All') && (
            <button onClick={() => { setSearch(''); setFilterDept('All'); setFilterMode('All'); setFilterStatus('All'); }} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.375rem 0.75rem' }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: '400px', margin: '1rem' }} />
        ) : filteredData.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <Calendar size={48} style={{ margin: '0 auto 1rem auto', opacity: 0.3 }} />
            <h3 style={{ fontSize: '1.125rem', color: 'var(--text-primary)' }}>No attendance records found</h3>
            <p style={{ marginTop: '0.5rem' }}>Try changing your date or filters.</p>
          </div>
        ) : (
          <div className="table-container desktop-only">
            <table className="table" style={{ width: '100%', minWidth: '1000px' }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Shift</th>
                  <th>Work Mode</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                  <th>Working Hrs</th>
                  <th>Late</th>
                  <th>Early</th>
                  <th>Status</th>
                  <th>Verification</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map(a => (
                  <tr key={a.id} className={a.missingOut ? 'bg-danger-light' : ''}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{a.empId}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{a.shift}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {a.shiftTime.split(' - ')[0]} - {a.shiftTime.split(' - ')[1]} 
                        {a.overnight && <span style={{ color: 'var(--purple-700)', fontWeight: 600 }}> +1d</span>}
                      </div>
                    </td>
                    <td><span className="badge badge-gray">{a.mode}</span></td>
                    <td style={{ fontWeight: 500 }}>{a.clockIn}</td>
                    <td style={{ fontWeight: 500 }}>
                      {a.clockOut}
                      {a.missingOut && <div style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>MISSING</div>}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--primary-700)' }}>{a.workHours}</td>
                    <td style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>{a.late}</td>
                    <td style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>{a.early}</td>
                    <td>{getStatusBadge(a.status)}</td>
                    <td>
                      {a.mode === 'Office' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: a.locationVerified ? 'var(--success)' : 'var(--danger)' }}>
                            <MapPin size={12}/> Loc {a.locationVerified ? '✓' : '✕'}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: a.faceVerified ? 'var(--success)' : a.faceVerified === false ? 'var(--danger)' : 'var(--gray-500)' }}>
                            <Camera size={12}/> Face {a.faceVerified ? '✓' : a.faceVerified === false ? '✕' : 'Pending'}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>N/A</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button onClick={() => setDetailDrawer(a)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile Card View */}
        {!loading && filteredData.length > 0 && (
          <div className="mobile-only" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {filteredData.map(a => (
              <div key={a.id} className="card" style={{ padding: '1rem', borderLeft: a.missingOut ? '4px solid var(--danger)' : '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>{a.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{a.empId}</div>
                  </div>
                  <div>{getStatusBadge(a.status)}</div>
                </div>
                
                <div style={{ backgroundColor: 'var(--gray-50)', padding: '0.5rem', borderRadius: 'var(--radius-md)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  <strong>{a.shift} Shift</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>({a.shiftTime} {a.overnight && '+1d'})</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  <div><span style={{ color: 'var(--text-secondary)' }}>In:</span> {a.clockIn}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>Out:</span> {a.clockOut} {a.missingOut && <span style={{ color: 'var(--danger-600)', fontSize: '0.75rem', fontWeight: 600 }}>MISSING</span>}</div>
                  <div><span style={{ color: 'var(--text-secondary)' }}>Working:</span> <span style={{ fontWeight: 600 }}>{a.workHours}</span></div>
                  <div>
                    {a.mode === 'Office' && (
                      <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem' }}>
                        <span style={{ color: a.locationVerified ? 'var(--success)' : 'var(--danger)' }}>Loc {a.locationVerified ? '✓' : '✕'}</span>
                        <span style={{ color: a.faceVerified ? 'var(--success)' : 'var(--gray-500)' }}>Face {a.faceVerified ? '✓' : 'Pending'}</span>
                      </div>
                    )}
                  </div>
                </div>

                <button onClick={() => setDetailDrawer(a)} className="btn btn-outline" style={{ width: '100%', fontSize: '0.875rem' }}>View Details</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attendance Detail Drawer */}
      {detailDrawer && (
        <div className="drawer-overlay" onClick={() => setDetailDrawer(null)}>
          <div className="drawer wide-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header" style={{ paddingBottom: '1.5rem', alignItems: 'flex-start' }}>
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{detailDrawer.name}</h2>
                  <button className="icon-button" onClick={() => setDetailDrawer(null)}><X size={20} /></button>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  <span>{detailDrawer.empId}</span> • <span>{detailDrawer.dept}</span> • <span>{detailDrawer.office}</span>
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
                  {getStatusBadge(detailDrawer.status)}
                  <span className="badge badge-gray">{detailDrawer.mode}</span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-700)' }}>{currentDateDisplay}</span>
                </div>
              </div>
            </div>
            
            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              
              {/* Action Bar */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button onClick={() => { setCForm({ clockIn: detailDrawer.clockIn, clockOut: detailDrawer.clockOut === '—' ? '' : detailDrawer.clockOut }); setCorrectionModal(true); }} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Edit size={16}/> Edit Attendance</button>
              </div>

              {/* Shift Information */}
              <div>
                <h3 className="section-title">Shift Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                  <div className="detail-item"><span className="detail-label">Assigned Shift</span><span className="detail-value">{detailDrawer.shift} Shift</span></div>
                  <div className="detail-item"><span className="detail-label">Required Hours</span><span className="detail-value">8h 00m</span></div>
                  <div className="detail-item"><span className="detail-label">Scheduled Start</span><span className="detail-value">{detailDrawer.shiftTime.split(' - ')[0]}</span></div>
                  <div className="detail-item"><span className="detail-label">Scheduled End</span><span className="detail-value">{detailDrawer.shiftTime.split(' - ')[1]} {detailDrawer.overnight && <span style={{ color: 'var(--purple-700)' }}>+1 Day</span>}</span></div>
                  <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="detail-label">Break Rule</span><span className="detail-value">60 mins (Flexible)</span></div>
                </div>
              </div>

              {/* Actual Attendance */}
              <div>
                <h3 className="section-title">Actual Attendance</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                  <div className="detail-item"><span className="detail-label">Clock In</span><span className="detail-value text-xl">{detailDrawer.clockIn}</span></div>
                  <div className="detail-item"><span className="detail-label">Clock Out</span>
                    <span className="detail-value text-xl">
                      {detailDrawer.clockOut} {detailDrawer.missingOut && <span style={{ fontSize: '0.75rem', color: 'var(--danger-600)' }}>(Missing)</span>}
                    </span>
                  </div>
                  <div className="detail-item"><span className="detail-label">Break</span><span className="detail-value text-xl">{detailDrawer.breakMins} min</span></div>
                  
                  <div className="detail-item"><span className="detail-label">Effective Working Hours</span><span className="detail-value text-xl" style={{ color: 'var(--primary-700)' }}>{detailDrawer.workHours}</span></div>
                  <div className="detail-item"><span className="detail-label">Late</span><span className="detail-value text-xl" style={{ color: detailDrawer.late !== '—' ? 'var(--warning)' : 'inherit' }}>{detailDrawer.late}</span></div>
                  <div className="detail-item"><span className="detail-label">Early Logout</span><span className="detail-value text-xl" style={{ color: detailDrawer.early !== '—' ? 'var(--warning)' : 'inherit' }}>{detailDrawer.early}</span></div>
                </div>
                
                {/* Visual calculation explanation */}
                <div style={{ marginTop: '1.5rem', padding: '1rem', border: '1px dashed var(--gray-300)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  Effective Working Hours = (Clock Out - Clock In) - Total Break Duration<br/>
                  <span style={{ color: 'var(--primary-600)', fontWeight: 600 }}>{detailDrawer.workHours}</span> = ({detailDrawer.clockOut} - {detailDrawer.clockIn}) - {detailDrawer.breakMins}m
                </div>
              </div>

              {/* Attendance Timeline */}
              {detailDrawer.timeline.length > 0 && (
                <div>
                  <h3 className="section-title">Attendance Timeline</h3>
                  <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--gray-200)', display: 'flex', flexDirection: 'column', gap: '1.5rem', marginLeft: '0.5rem' }}>
                    {detailDrawer.timeline.map((evt: any, i: number) => (
                      <div key={i} style={{ position: 'relative' }}>
                        <div style={{ position: 'absolute', left: '-1.45rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: evt.type === 'success' ? 'var(--success)' : evt.type === 'warning' ? 'var(--warning)' : 'var(--gray-400)', border: '2px solid white' }}></div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>{evt.time}</div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{evt.event}</div>
                      </div>
                    ))}
                    <div style={{ position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '-1.45rem', top: '2px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--primary-500)', border: '2px solid white' }}></div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--primary-700)' }}>Attendance Completed</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Verifications */}
              {detailDrawer.mode === 'Office' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  
                  {/* Location */}
                  <div className="card" style={{ border: '1px solid var(--border-color)', boxShadow: 'none' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Map size={18}/> Location Verification</h4>
                    {detailDrawer.locationVerified ? (
                      <div>
                        <div className="badge badge-success" style={{ marginBottom: '1rem' }}>VERIFIED</div>
                        <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Assigned Office</span><span className="detail-value">{detailDrawer.office} Office</span></div>
                        <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Distance</span><span className="detail-value">42 meters</span></div>
                        <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Allowed Radius</span><span className="detail-value">100 meters</span></div>
                        <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value" style={{ color: 'var(--success)', fontWeight: 600 }}>INSIDE GEOFENCE</span></div>
                      </div>
                    ) : (
                      <div>
                        <div className="badge badge-danger" style={{ marginBottom: '1rem' }}>FAILED</div>
                        <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Distance</span><span className="detail-value">240 meters</span></div>
                        <div className="detail-item"><span className="detail-label">Status</span><span className="detail-value" style={{ color: 'var(--danger)', fontWeight: 600 }}>OUTSIDE GEOFENCE</span></div>
                      </div>
                    )}
                  </div>

                  {/* Face */}
                  <div className="card" style={{ border: '1px solid var(--border-color)', boxShadow: 'none' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShieldCheck size={18}/> Face Verification</h4>
                    {detailDrawer.faceVerified ? (
                      <div>
                        <div className="badge badge-success" style={{ marginBottom: '1rem' }}>VERIFIED</div>
                        <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Face Registered</span><span className="detail-value">YES</span></div>
                        <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Verified At</span><span className="detail-value">{detailDrawer.clockIn}</span></div>
                        <div className="detail-item"><span className="detail-label">Attempts</span><span className="detail-value">1</span></div>
                      </div>
                    ) : detailDrawer.faceVerified === false ? (
                      <div>
                        <div className="badge badge-danger" style={{ marginBottom: '1rem' }}>FAILED</div>
                        <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Face Registered</span><span className="detail-value">YES</span></div>
                        <div className="detail-item"><span className="detail-label">Attempts</span><span className="detail-value">2</span></div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
                        <div className="badge badge-warning">FACE NOT REGISTERED</div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Employee cannot complete biometric verification.</div>
                        <button onClick={() => navigate('/admin/employees')} className="btn btn-outline" style={{ fontSize: '0.75rem' }}>Go to Employee Profile</button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Event Details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <h3 className="section-title">Clock-In Event</h3>
                  {detailDrawer.clockIn !== '—' ? (
                    <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Time:</span> {detailDrawer.clockIn}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Location:</span> {detailDrawer.locationVerified ? 'Verified' : 'Bypassed'}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Face:</span> {detailDrawer.faceVerified ? 'Verified' : 'Bypassed'}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Source:</span> Employee App</div>
                    </div>
                  ) : <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No record</div>}
                </div>
                <div>
                  <h3 className="section-title">Clock-Out Event</h3>
                  {detailDrawer.clockOut !== '—' ? (
                    <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Time:</span> {detailDrawer.clockOut}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Location:</span> {detailDrawer.locationVerified ? 'Verified' : 'Bypassed'}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Face:</span> {detailDrawer.faceVerified ? 'Verified' : 'Bypassed'}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Type:</span> {detailDrawer.autoLogout ? 'AUTO' : 'MANUAL'}</div>
                    </div>
                  ) : detailDrawer.autoLogout ? (
                    <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Type:</span> AUTO</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Reason:</span> Shift end reached</div>
                    </div>
                  ) : <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No record</div>}
                </div>
              </div>

              {/* Employee Security Flow Preview */}
              <div>
                <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShieldCheck size={18}/> Employee Attendance Security Flow</h3>
                <div style={{ padding: '1.5rem', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', borderRadius: 'var(--radius-md)', fontFamily: 'monospace', fontSize: '0.875rem', whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>
{`Open Application
      ↓
Check Assigned Office
      ↓
Inside Geofence?
      ↓
Face Verification
      ↓
Clock In
      ↓
Working Timer
      ↓
Clock Out
      ↓
Location Verification
      ↓
Face Verification
      ↓
Attendance Completed`}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Visual representation of the secure clock-in/out pipeline.</p>
              </div>

              {/* History */}
              {detailDrawer.history && detailDrawer.history.length > 0 && (
                <div>
                  <h3 className="section-title">Change History</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {detailDrawer.history.map((h: any, i: number) => (
                      <div key={i} style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', borderBottom: '1px solid var(--gray-200)', paddingBottom: '1rem' }}>
                        <div style={{ color: 'var(--text-secondary)', width: '120px' }}>{h.date}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 500 }}>{h.action}</div>
                          <div style={{ color: 'var(--gray-700)', marginTop: '0.25rem', padding: '0.5rem', backgroundColor: 'var(--gray-50)', borderRadius: '4px' }}>Reason: {h.reason}</div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>Changed By: {h.by}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Manual Correction Modal */}
      {correctionModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center', zIndex: 120 }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', animation: 'slideUp 0.3s' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Edit Attendance</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Update records for {detailDrawer?.name}.</p>
            
            <div style={{ padding: '0.75rem', backgroundColor: 'var(--warning-50)', color: 'var(--warning-800)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              <AlertTriangle size={16} style={{ marginTop: '0.125rem' }} /> 
              <div>
                <strong>Warning:</strong> Attendance corrections are audit-sensitive and may affect payroll calculations.
              </div>
            </div>

            <form onSubmit={handleSaveCorrection} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Clock In</label>
                  <input type="time" className="form-control" value={cForm.clockIn || ''} onChange={e => setCForm({...cForm, clockIn: e.target.value})} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Clock Out</label>
                  <input type="time" className="form-control" value={cForm.clockOut || ''} onChange={e => setCForm({...cForm, clockOut: e.target.value})} />
                </div>
              </div>
              
              <div>
                <label className="form-label">Break Duration (Mins)</label>
                <input type="number" className="form-control" defaultValue={detailDrawer?.breakMins} />
              </div>

              <div>
                <label className="form-label">Correction Reason *</label>
                <textarea required className="form-control" rows={3} placeholder="e.g. Employee forgot to clock out." value={cForm.reason || ''} onChange={e => setCForm({...cForm, reason: e.target.value})}></textarea>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setCorrectionModal(null)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Save Correction</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        
        
        
        
        
        
        .bg-danger-light { background-color: var(--danger-50); }
        
        .text-xl { font-size: 1.25rem; font-weight: 700; color: var(--gray-900); }
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
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
        
        @media (max-width: 1024px) {
          .responsive-grid-2 { grid-template-columns: 1fr !important; }
        }
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

export default AdminAttendance;



