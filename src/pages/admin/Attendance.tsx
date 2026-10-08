import React, { useState, useEffect } from 'react';
import { exportService } from '../../services/export/exportService';
import { useNavigate } from 'react-router-dom';
import { 
  Calendar, ChevronLeft, ChevronRight, Search, Filter, 
  Download, RefreshCw, Settings, User, Clock, MapPin, 
  Camera, AlertCircle, CheckCircle2, AlertTriangle, 
  X, History, Activity, ShieldCheck, Map, Edit
} from 'lucide-react';
import { adminAttendanceService } from '../../services/attendance/adminAttendanceService';
import { formatMinutes, formatTime } from '../../services/attendance/adminAttendanceRules';
import { realtimeService } from '../../services/realtime/realtimeService';
import { supabase } from '../../lib/supabase';
import { useDepartments } from '../../hooks/useDepartments';



const AdminAttendance: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  
  // Filters
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterMode, setFilterMode] = useState('All');
  const { departments, loading: deptLoading } = useDepartments();
  
  // Drawers & Modals
  const [detailDrawer, setDetailDrawer] = useState<any>(null);
  const [correctionModal, setCorrectionModal] = useState<any>(null);
  
  // Correction Form
  const [cForm, setCForm] = useState<any>({});
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [liveStatus, setLiveStatus] = useState<any[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [kpis, setKpis] = useState({ total: 0, present: 0, absent: 0, late: 0, onLeave: 0, wfh: 0, halfDay: 0, working: 0, notClockedIn: 0 });
  const [isTodaySelected, setIsTodaySelected] = useState(true);

  const localDateStr = selectedDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const currentDateDisplay = selectedDate.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

  const handlePrevDay = () => setSelectedDate(prev => new Date(prev.getTime() - 86400000));
  const handleNextDay = () => setSelectedDate(prev => new Date(prev.getTime() + 86400000));
  const handleToday = () => setSelectedDate(new Date());

  
  const [attendanceData, setAttendanceData] = useState<any[]>([]);

  
  const fetchAttendance = async () => {
    setLoading(true);
    // All values come from Supabase via adminAttendanceService (rules documented in adminAttendanceRules.ts)
    const day = await adminAttendanceService.getDay(localDateStr);
    if (day.errors.length) console.error('[Admin Attendance] Some data could not be loaded:', day.errors);
    if (day.duplicateAttendance.length) console.warn('[Admin Attendance] Duplicate attendance records ignored:', day.duplicateAttendance);
    setAttendanceData(day.rows);
    setKpis(day.kpis);
    setExceptions(day.exceptions);
    setIsTodaySelected(day.isToday);
    setLiveStatus(day.rows.filter((r: any) => r.currentlyWorking));
    setLoading(false);
  };


  useEffect(() => {

    
    
    fetchAttendance();

    const channel = realtimeService.subscribeToAdminAttendance((payload) => {
      fetchAttendance();
    });

    const channelGeofence = realtimeService.subscribeToGeofenceEvents((payload) => {
      if (payload.new) {
        if (payload.new.event_type === 'EXITED') {
          showToast(`🔴 Geofence Alert: Employee went outside office.`);
        } else if (payload.new.event_type === 'ENTERED') {
          showToast(`🟢 Geofence Update: Employee returned to office.`);
        }
      }
    });

    return () => {
      realtimeService.unsubscribe(channel);
      realtimeService.unsubscribe(channelGeofence);
    };
  }, [selectedDate]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const filteredData = attendanceData.filter(a => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) || a.empId.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === 'All' ? true : filterDept === 'Unassigned' ? a.department_id === null : a.department_id === filterDept;
    const matchStatus = filterStatus === 'All'
      || (filterStatus === 'PRESENT' ? a.present
        : filterStatus === 'LATE' ? a.late_minutes > 0
        : filterStatus === 'EARLY LOGOUT' ? a.early_minutes > 0
        : a.status === filterStatus);
    const matchMode = filterMode === 'All' || a.mode === filterMode;
    return matchSearch && matchDept && matchStatus && matchMode;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PRESENT': return <span className="badge badge-success">PRESENT</span>;
      case 'WORKING': return <span className="badge badge-success">WORKING</span>;
      case 'COMPLETED': return <span className="badge badge-success">COMPLETED</span>;
      case 'ON_BREAK': return <span className="badge badge-warning">ON BREAK</span>;
      case 'HALF_DAY': return <span className="badge badge-warning">HALF DAY</span>;
      case 'LATE': return <span className="badge badge-warning">LATE</span>;
      case 'EARLY LOGOUT': return <span className="badge badge-warning">EARLY LOGOUT</span>;
      case 'ABSENT': return <span className="badge badge-danger">ABSENT</span>;
      case 'LEAVE': return <span className="badge badge-primary">LEAVE</span>;
      case 'AUTO LOGOUT': return <span className="badge" style={{ backgroundColor: 'var(--gray-200)', color: 'var(--gray-800)' }}>AUTO LOGOUT</span>;
      default: return <span className="badge badge-gray">{status}</span>;
    }
  };

  

  const locationLabel = (r: any) => {
    switch (r.locationResult) {
      case 'INSIDE': return 'Inside';
      case 'OUTSIDE': return 'Outside';
      case 'WFH': return 'WFH';
      case 'LOW_ACCURACY': return 'Low accuracy';
      case 'LOCATION_DENIED': return 'Denied';
      case 'LOCATION_UNAVAILABLE': return 'Unavailable';
      case 'NOT RECORDED': return 'Not recorded';
      case null: case undefined: return '-';
      default: return r.locationResult;
    }
  };
  const faceLabel = (r: any) => r.faceResult === 'SUCCESS' ? 'Verified' : r.faceResult === 'NOT REQUIRED' ? 'Not required' : r.faceResult === 'NOT VERIFIED' ? 'Not verified' : (r.faceResult || '-');
  const verificationColor = (ok: boolean | null) => ok === true ? 'var(--success)' : ok === false ? 'var(--danger)' : 'var(--gray-500)';

  const handleViewDetail = async (a: any) => {
    try {
      const { data: events } = await supabase
        .from('geofence_events')
        .select('*')
        .eq('employee_id', a.employee_uuid)
        .gte('occurred_at', localDateStr + 'T00:00:00+05:30')
        .lte('occurred_at', localDateStr + 'T23:59:59+05:30')
        .order('occurred_at', { ascending: true });
        
      let history: any[] = [];
      if (events && events.length > 0) {
        history = events.map((e: any) => ({
          date: new Date(e.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          action: e.event_type === 'ENTERED' ? '🟢 Returned' : '🔴 Left Office',
          reason: e.distance_from_office_meters ? `Dist: ${Math.round(e.distance_from_office_meters)}m` : '',
          by: 'System'
        }));
      }
      setDetailDrawer({ ...a, history: [...a.history, ...history] });
    } catch (err) {
      setDetailDrawer(a); // fallback
    }
  };

  const handleSaveCorrection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cForm.reason) return;
    
    // Corrections are not persisted yet: do not show edited values or a success message.
    setCorrectionModal(null);
    showToast('Correction NOT saved: attendance corrections are not available yet.');
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

          <button onClick={() => exportService.excel(filteredData.map(a => ({ empId: a.empId, name: a.name, dept: a.dept, shift: a.shiftTime, mode: a.mode, clockIn: a.clockIn, clockOut: a.clockOut, break: a.breakMins, status: a.status, late: a.late })), [{ header: 'Code', key: 'empId', width: 10 }, { header: 'Name', key: 'name', width: 22 }, { header: 'Department', key: 'dept', width: 16 }, { header: 'Shift Time', key: 'shift', width: 16 }, { header: 'Mode', key: 'mode', width: 10 }, { header: 'In', key: 'clockIn', width: 10 }, { header: 'Out', key: 'clockOut', width: 10 }, { header: 'Break (m)', key: 'break', width: 10 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Late', key: 'late', width: 10 }], `attendance_export_${currentDateDisplay}`)} className="btn btn-outline" style={{ fontSize: '0.875rem' }}><Download size={16}/> Export Excel</button>
          <button onClick={() => fetchAttendance()} className="icon-button  border"><RefreshCw size={16}/></button>
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
          {!isTodaySelected ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Live work status is shown for today only.</div>
          ) : liveStatus.length === 0 ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No employees are currently working.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {liveStatus.map((ls, i) => {
                // Working status comes from attendance; location is shown separately and may be stale.
                let locBadge = 'badge-gray';
                let locText = 'NO LOCATION TODAY';
                if (ls.lastLocationAt) {
                  if (ls.locationStale) { locText = 'LOCATION STALE'; }
                  else if (ls.lastLocationStatus === 'INSIDE_GEOFENCE') { locBadge = 'badge-success'; locText = 'Inside Office'; }
                  else if (ls.lastLocationStatus === 'OUTSIDE_GEOFENCE') { locBadge = 'badge-danger'; locText = 'Outside Office'; }
                  else if (ls.lastLocationStatus === 'WFH') { locBadge = 'badge-primary'; locText = 'WFH'; }
                  else if (ls.lastLocationStatus === 'LOW_ACCURACY') { locBadge = 'badge-warning'; locText = 'Low GPS Accuracy'; }
                  else { locText = ls.lastLocationStatus || 'UNKNOWN'; }
                }

                return (
                  <div key={ls.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderBottom: i !== liveStatus.length-1 ? '1px solid var(--gray-200)' : 'none' }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{ls.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span className={`badge ${locBadge}`} style={{ fontSize: '0.65rem' }}>{locText}</span>
                        {ls.lastLocationDistance !== null && ls.lastLocationAt && !ls.locationStale && <span>Dist: {Math.round(ls.lastLocationDistance)}m</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="badge badge-success">Working</span>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                        {ls.lastLocationAt ? `Last location: ${formatTime(ls.lastLocationAt)} (${ls.lastLocationMinutesAgo === 0 ? 'just now' : `${ls.lastLocationMinutesAgo}m ago`})` : 'No location update today'}
                      </div>
                    </div>
                  </div>
                );
              })}
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
                  <th style={{ textAlign: 'left' }}>Employee</th>
                    <th style={{ textAlign: 'left' }}>Shift</th>
                    <th style={{ textAlign: 'center' }}>Work Mode</th>
                    <th style={{ textAlign: 'center' }}>Clock In</th>
                    <th style={{ textAlign: 'center' }}>Clock Out</th>
                    <th style={{ textAlign: 'center' }}>Source</th>
                    <th style={{ textAlign: 'center' }}>Working Hrs</th>
                    <th style={{ textAlign: 'center' }}>Late</th>
                    <th style={{ textAlign: 'center' }}>Early</th>
                    <th style={{ textAlign: 'center' }}>Status</th>
                    <th style={{ textAlign: 'center' }}>Verification</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
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
                    <td style={{ textAlign: 'center' }}><span className="badge badge-gray">{a.mode}</span></td>
                    <td style={{ fontWeight: 500, textAlign: 'center' }}>{a.clockIn}</td>
                    <td style={{ fontWeight: 500, textAlign: 'center' }}>
                        {a.clockOut}
                      {a.missingOut && <div style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>MISSING</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {a.clockOutSource === 'AUTO' ? <span className="badge badge-warning">AUTO</span> : a.clockOutSource === 'MANUAL' ? <span className="badge badge-gray">MANUAL</span> : <span style={{ color: 'var(--text-secondary)' }}>-</span>}
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--primary-700)', textAlign: 'center' }}>{a.workHours}</td>
                    <td style={{ color: 'var(--warning)', fontSize: '0.875rem', textAlign: 'center' }}>{a.late}</td>
                    <td style={{ color: 'var(--warning)', fontSize: '0.875rem', textAlign: 'center' }}>{a.early}</td>
                    <td style={{ textAlign: 'center' }}>{getStatusBadge(a.status)}</td>
                    <td style={{ textAlign: 'center' }}>
                        {a.attendanceId ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: verificationColor(a.locationVerified) }}>
                            <MapPin size={12}/> Loc: {locationLabel(a)}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: verificationColor(a.faceVerified) }}>
                            <Camera size={12}/> Face: {faceLabel(a)}{!a.faceRegistered && ' (not registered)'}
                          </span>
                          {a.lastLocationAt && (
                            <span style={{ color: 'var(--text-secondary)' }}>Last loc: {formatTime(a.lastLocationAt)}{a.locationStale ? ' (stale)' : ''}</span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{a.leave ? a.leave.type : 'N/A'}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button onClick={() => handleViewDetail(a)} className="btn btn-outline" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>View</button>
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
                    {a.attendanceId && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem' }}>
                        <span style={{ color: verificationColor(a.locationVerified) }}>Loc: {locationLabel(a)}</span>
                        <span style={{ color: verificationColor(a.faceVerified) }}>Face: {faceLabel(a)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <button onClick={() => handleViewDetail(a)} className="btn btn-outline" style={{ width: '100%', fontSize: '0.875rem' }}>View Details</button>
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
                  <div className="detail-item"><span className="detail-label">Required Hours</span><span className="detail-value">{detailDrawer.requiredHours !== null ? formatMinutes(Number(detailDrawer.requiredHours) * 60) : '-'}</span></div>
                  <div className="detail-item"><span className="detail-label">Scheduled Start</span><span className="detail-value">{detailDrawer.shiftTime.split(' - ')[0]}</span></div>
                  <div className="detail-item"><span className="detail-label">Scheduled End</span><span className="detail-value">{detailDrawer.shiftTime.split(' - ')[1]} {detailDrawer.overnight && <span style={{ color: 'var(--purple-700)' }}>+1 Day</span>}</span></div>
                  <div className="detail-item" style={{ gridColumn: '1 / -1' }}><span className="detail-label">Break Rule</span><span className="detail-value">{detailDrawer.breakRuleMins !== null ? `${detailDrawer.breakRuleMins} mins allowed` : '-'}</span></div>
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
              {detailDrawer.attendanceId && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  
                  {/* Location (clock-in verification from location_verification_events) */}
                  <div className="card" style={{ border: '1px solid var(--border-color)', boxShadow: 'none' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Map size={18}/> Location Verification</h4>
                    <div className={`badge ${detailDrawer.locationVerified === true ? 'badge-success' : detailDrawer.locationVerified === false ? 'badge-danger' : 'badge-gray'}`} style={{ marginBottom: '1rem' }}>{locationLabel(detailDrawer).toUpperCase()}</div>
                    <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Assigned Office</span><span className="detail-value">{detailDrawer.office}</span></div>
                    <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Distance</span><span className="detail-value">{detailDrawer.locationDistance !== null ? `${Math.round(detailDrawer.locationDistance)} meters` : '-'}</span></div>
                    <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Allowed Radius</span><span className="detail-value">{detailDrawer.locationRadius !== null ? `${detailDrawer.locationRadius} meters` : '-'}</span></div>
                    <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">GPS Accuracy</span><span className="detail-value">{detailDrawer.locationAccuracy !== null ? `±${Math.round(detailDrawer.locationAccuracy)} m` : '-'}</span></div>
                    <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Checked At</span><span className="detail-value">{detailDrawer.locationVerifiedAt ? formatTime(detailDrawer.locationVerifiedAt) : '-'}</span></div>
                    {detailDrawer.locationFailureReason && <div className="detail-item"><span className="detail-label">Reason</span><span className="detail-value">{detailDrawer.locationFailureReason}</span></div>}
                    <div className="detail-item" style={{ marginTop: '0.5rem' }}><span className="detail-label">Last Known Location</span><span className="detail-value">{detailDrawer.lastLocationAt ? `${formatTime(detailDrawer.lastLocationAt)}${detailDrawer.locationStale ? ' (stale)' : ''}` : 'None on this date'}</span></div>
                  </div>

                  {/* Face (face_registrations / face_verification_events) */}
                  <div className="card" style={{ border: '1px solid var(--border-color)', boxShadow: 'none' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShieldCheck size={18}/> Face Verification</h4>
                    <div className={`badge ${detailDrawer.faceVerified === true ? 'badge-success' : detailDrawer.faceVerified === false ? 'badge-danger' : 'badge-gray'}`} style={{ marginBottom: '1rem' }}>{faceLabel(detailDrawer).toUpperCase()}</div>
                    <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Face Registered</span><span className="detail-value">{detailDrawer.faceRegistered ? 'YES' : 'NO'}</span></div>
                    <div className="detail-item" style={{ marginBottom: '0.5rem' }}><span className="detail-label">Verified At</span><span className="detail-value">{detailDrawer.faceVerifiedAt ? formatTime(detailDrawer.faceVerifiedAt) : '-'}</span></div>
                    {!detailDrawer.faceRegistered && (
                      <button onClick={() => navigate('/admin/face-registration')} className="btn btn-outline" style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>Go to Face Registration</button>
                    )}
                  </div>
                </div>
              )}

              {/* Event Details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <h3 className="section-title">Clock-In Event</h3>
                  {detailDrawer.clockInAt ? (
                    <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Time:</span> {detailDrawer.clockIn}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Location:</span> {locationLabel(detailDrawer)}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Face:</span> {faceLabel(detailDrawer)}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Source:</span> {detailDrawer.clockInSource || '-'}</div>
                    </div>
                  ) : <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No record</div>}
                </div>
                <div>
                  <h3 className="section-title">Clock-Out Event</h3>
                  {detailDrawer.clockOutAt ? (
                    <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Time:</span> {detailDrawer.clockOut}</div>
                      <div><span style={{ color: 'var(--text-secondary)', display: 'inline-block', width: '80px' }}>Location:</span> Not linked to clock-out</div>
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



