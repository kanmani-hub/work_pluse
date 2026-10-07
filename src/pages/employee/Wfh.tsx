import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Home, Plus, Info, Calendar, X, AlertCircle, CheckCircle2, ChevronDown, 
  MapPin, LogOut, Coffee, ArrowRight, ShieldAlert
} from 'lucide-react';
import { wfhService } from '../../services/wfh/wfhService';
import { useGlobalSettings } from '../../services/settings/globalSettingsService';
import { useAuth } from '../../context/AuthContext';
import { qaTimeService } from '../../services/qa/qaTimeService';

const EmployeeWfh: React.FC = () => {
  const { settings } = useGlobalSettings();
  const appSettings = settings.app;

  const { employee } = useAuth();
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState('');
    
  // WFH Request Form State
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [reqDate, setReqDate] = useState('');
  const [reqType, setReqType] = useState('Full Day');
  const [reqHalf, setReqHalf] = useState('First Half');
  const [reqReason, setReqReason] = useState('');
  const [reqError, setReqError] = useState('');
  
  // Attendance Prototype State (If today is WFH)
  const [isWfhToday, setIsWfhToday] = useState(false);
  const [metrics, setMetrics] = useState({ used: 0, pending: 0, approved: 0, rejected: 0, remaining: 0 });
  const [upcomingWfh, setUpcomingWfh] = useState<any[]>([]);
  
  const [todayAttendanceState, setTodayAttendanceState] = useState<'not_started' | 'working' | 'on_break' | 'clocked_out'>('not_started');
  const [showWfhClockModal, setShowWfhClockModal] = useState(false);
  const [workTime, setWorkTime] = useState(0);

  const fetchWfh = async () => {
    if (!employee?.id) return;
    setLoading(true);
    

    const { data, error } = await wfhService.getMyWFHRequests(employee.id);
    
    if (data) {
      const mapped = data.map((h: any) => ({
        id: h.id,
        date: new Date(h.request_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        rawDate: h.request_date,
        type: h.is_half_day ? 'Half Day' : 'Full Day',
        shift: (employee as any)?.shifts?.name || 'General Shift',
        hours: '-',
        reason: h.reason,
        requestedOn: new Date(h.requested_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        status: h.status.charAt(0).toUpperCase() + h.status.slice(1).toLowerCase(),
        approvedBy: h.reviewed_by ? 'Reviewer' : '-',
        rejectReason: h.reviewer_remarks
      }));
      setHistory(mapped);

      const now = qaTimeService.getDate();
      // Ensure YYYY-MM-DD format regardless of locale
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const currentMonthStr = todayStr.substring(0, 7);
      
      let used = 0;
      let pending = 0;
      let approvedTotal = 0;
      let rejected = 0;
      
      const upcoming: any[] = [];
      let todayWfh: any = null;

      mapped.forEach((h: any) => {
        if (h.status === 'Pending') pending++;
        if (h.status === 'Rejected') rejected++;
        if (h.status === 'Approved') approvedTotal++;
        
        if (h.status === 'Approved') {
          // Used in current calendar month AND date has occurred (<= today)
          if (h.rawDate.substring(0, 7) === currentMonthStr && h.rawDate <= todayStr) {
            used += (h.type === 'Half Day' ? 0.5 : 1);
          }
          // Today's WFH
          if (h.rawDate === todayStr) {
            todayWfh = h;
          }
          // Upcoming
          if (h.rawDate > todayStr) {
            upcoming.push(h);
          }
        }
      });

      upcoming.sort((a, b) => a.rawDate.localeCompare(b.rawDate));
      
      const maxMonthlyWfhDays = appSettings?.wfhMaxDaysPerMonth !== undefined ? Number(appSettings.wfhMaxDaysPerMonth) : 2;
      const remaining = Math.max(0, maxMonthlyWfhDays - used);
      
      setMetrics({ used, pending, approved: approvedTotal, rejected, remaining });
      setUpcomingWfh(upcoming);
      setIsWfhToday(!!todayWfh);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchWfh();
  }, [employee?.id, appSettings?.wfhMaxDaysPerMonth]);

  useEffect(() => {
    let interval: any;
    if (todayAttendanceState === 'working') {
      interval = setInterval(() => setWorkTime(t => t + 1), qaTimeService.getRealToSimulatedInterval(1000));
    }
    return () => clearInterval(interval);
  }, [todayAttendanceState]);

  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
  };

  const getStatusBadge = (status: string) => {
    switch(status.toUpperCase()) {
      case 'APPROVED': return 'badge-success';
      case 'PENDING': return 'badge-warning';
      case 'REJECTED': return 'badge-danger';
      case 'CANCELLED': return 'badge-gray';
      default: return 'badge-gray';
    }
  };

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqError('');
    if (!reqDate) { setReqError('Please select a date.'); return; }
    if (!reqReason) { setReqError('Please provide a reason.'); return; }
    if (!employee?.id) { setReqError('Unauthorized session.'); return; }
    
    if (!appSettings?.wfhEnabled) {
      setReqError('WFH is currently disabled by company policy.');
      return;
    }
    const maxMonthlyWfhDays = appSettings?.wfhMaxDaysPerMonth !== undefined ? Number(appSettings.wfhMaxDaysPerMonth) : 2;
    if (metrics.used + (reqType === 'Half Day' ? 0.5 : 1) > maxMonthlyWfhDays) {
      setReqError(`You have reached the maximum WFH limit of ${maxMonthlyWfhDays} days per month.`);
      return;
    }
    
    // Disable submit implicitly by showing loading / closing modal later
    const { error } = await wfhService.createWFHRequest({
      employee_id: employee.id,
      request_date: reqDate,
      reason: reqReason
    });

    if (error) {
      // DEV: Log and display structured Supabase error for debugging
      if (import.meta.env.DEV) {
        const structured = {
          message: error.message,
          code: (error as any).code,
          details: (error as any).details,
          hint: (error as any).hint,
        };
        console.error('%c[WFH Submit Error]', 'color: #e74c3c; font-weight: bold;', structured);
        setReqError(
          `${error.message}` +
          ((error as any).code ? ` [code: ${(error as any).code}]` : '') +
          ((error as any).hint ? ` — hint: ${(error as any).hint}` : '')
        );
      } else {
        setReqError(error.message);
      }
      return;
    }

    setShowRequestModal(false);
    showToast('WFH request submitted successfully');
    
    // Reset
    setReqDate(''); setReqReason(''); setReqType('Full Day');
    fetchWfh();
  };

  const handleCancelRequest = async (id: string) => {
    if (!employee?.id) return;
    if (confirm('Are you sure you want to cancel this WFH request?')) {
      const { error } = await wfhService.cancelWFHRequest(id, employee.id);
      if (error) {
        alert(error.message);
        return;
      }
      setSelectedDetail(null);
      showToast('WFH request cancelled');
      fetchWfh();
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const now = qaTimeService.getDate();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const startEmptyCells = (firstDay + 6) % 7;
  const currentMonthStr = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}`;
  
  const calendarDays = Array.from({length: daysInMonth}, (_, i) => i + 1);
  const emptyCells = Array.from({length: startEmptyCells}, (_, i) => i);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
      
      {toastMessage && (
        <div style={{ position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '0.75rem 1.5rem', borderRadius: 'var(--radius-full)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: 'var(--shadow-lg)', animation: 'slideDown 0.3s forwards' }}>
          <CheckCircle2 size={18} color="var(--success)" />
          {toastMessage}
        </div>
      )}

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0, flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">Work From Home</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Request, track and manage your work-from-home days.</p>
        </div>
        {!appSettings?.wfhEnabled ? (
          <div style={{ color: 'var(--danger)', fontSize: '0.875rem', fontWeight: 500, padding: '0.5rem 1rem', backgroundColor: 'var(--danger-50)', borderRadius: 'var(--radius-md)' }}>
            WFH is currently disabled.
          </div>
        ) : metrics.remaining <= 0 ? (
          <div style={{ color: 'var(--warning)', fontSize: '0.875rem', fontWeight: 500, padding: '0.5rem 1rem', backgroundColor: 'var(--warning-50)', borderRadius: 'var(--radius-md)' }}>
            WFH monthly limit reached.
          </div>
        ) : (
          <button onClick={() => setShowRequestModal(true)} className="btn btn-primary">
            <Plus size={18} /> Request WFH
          </button>
        )}
      </div>

      {loading ? (
        <div className="skeleton-container" style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ minWidth: '150px', height: '90px', borderRadius: 'var(--radius-md)' }} />)}
        </div>
      ) : (
        <>
          <div className="tracking-kpi-grid">
            <div className="tracking-kpi-card">
              <div className="sc-title">WFH Used</div>
              <div className="sc-val">{metrics.used} Days</div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">WFH Remaining</div>
              <div className="sc-val">{metrics.remaining} Days</div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Pending Requests</div>
              <div className="sc-val" style={{ color: 'var(--warning)' }}>{metrics.pending}</div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Approved</div>
              <div className="sc-val" style={{ color: 'var(--success)' }}>{metrics.approved}</div>
            </div>
            <div className="tracking-kpi-card">
              <div className="sc-title">Rejected</div>
              <div className="sc-val" style={{ color: 'var(--danger)' }}>{metrics.rejected}</div>
            </div>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '-1rem' }}>
            * WFH limits and eligibility are controlled by company policy.
          </div>
        </>
      )}

      <div className="two-col-grid">
        {/* Left Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Today WFH Attendance Proto */}
          {/* Today Work Mode */}
          <div className="card" style={{ borderTop: `4px solid ${isWfhToday ? 'var(--primary-600)' : 'var(--gray-400)'}` }}>
            <h3 className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
              Today's Work Mode: {isWfhToday ? 'WFH' : 'OFFICE'}
              <span className={`badge ${isWfhToday ? 'badge-primary' : 'badge-gray'}`}>{isWfhToday ? 'WFH' : 'OFFICE'}</span>
            </h3>
            
            {isWfhToday ? (
              <>
                <div style={{ margin: '1.5rem 0', textAlign: 'center' }}>
                  {todayAttendanceState === 'not_started' && (
                    <button onClick={() => setShowWfhClockModal(true)} className="btn btn-primary" style={{ padding: '1rem 2rem', fontSize: '1.125rem', borderRadius: 'var(--radius-full)' }}>
                      Start Work
                    </button>
                  )}
                  
                  {todayAttendanceState === 'working' && (
                    <>
                      <div style={{ color: 'var(--success)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div className="pulse-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)' }} />
                        Working from Home
                      </div>
                      <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', marginBottom: '1.5rem' }}>
                        {formatTime(workTime)}
                      </div>
                      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                        <button onClick={() => setTodayAttendanceState('on_break')} className="btn btn-outline" style={{ borderRadius: 'var(--radius-full)' }}><Coffee size={18}/> Start Break</button>
                        <button onClick={() => setTodayAttendanceState('clocked_out')} className="btn" style={{ backgroundColor: 'var(--danger)', color: 'var(--bg-primary)', borderRadius: 'var(--radius-full)' }}><LogOut size={18}/> Clock Out</button>
                      </div>
                    </>
                  )}

                  {todayAttendanceState === 'on_break' && (
                    <>
                      <div style={{ color: 'var(--warning)', fontWeight: 600, marginBottom: '1rem' }}>ON BREAK</div>
                      <button onClick={() => setTodayAttendanceState('working')} className="btn btn-primary" style={{ borderRadius: 'var(--radius-full)' }}>Resume Work</button>
                    </>
                  )}

                  {todayAttendanceState === 'clocked_out' && (
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Clocked Out. Shift Completed.</div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <div>Clock In: <strong>{todayAttendanceState !== 'not_started' ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}</strong></div>
                  <div>Shift: <strong>{(employee as any)?.shifts?.name || 'General Shift'}</strong></div>
                </div>
              </>
            ) : (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                You are scheduled for Office today.<br/>
                Please use the standard Attendance dashboard to Clock In.
              </div>
            )}
          </div>

          {/* Upcoming WFH */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Upcoming WFH</h3>
            {loading ? (
              <div className="skeleton" style={{ height: '100px' }} />
            ) : upcomingWfh.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No upcoming WFH
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {upcomingWfh.map(u => (
                  <div key={u.id} style={{ backgroundColor: 'var(--gray-50)', padding: '1.25rem', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                      <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{u.date}</div>
                      <span className="badge badge-success">APPROVED</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                      <div><span style={{ color: 'var(--text-secondary)' }}>Duration:</span> <strong>{u.type}</strong></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>Assigned Shift:</span> <strong>{u.shift}</strong></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>Timing:</span> <strong>9:00 AM — 6:00 PM</strong></div>
                      <div><span style={{ color: 'var(--text-secondary)' }}>Required:</span> <strong>8 Hours</strong></div>
                    </div>
                    <button onClick={() => setSelectedDetail(u)} className="btn btn-outline" style={{ marginTop: '1rem', width: '100%', fontSize: '0.875rem' }}>
                      View Details
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rules info */}
          <div className="card" style={{ backgroundColor: 'var(--primary-50)', border: '1px solid var(--primary-100)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Info size={18} color="var(--primary-600)" />
              WFH Attendance Relationship
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--gray-700)', lineHeight: 1.5 }}>
              WFH removes the office-location requirement, but your <strong>assigned shift</strong> and <strong>attendance rules</strong> still apply. Required working hours, late logins, early logouts, breaks, and auto-logout rules remain active exactly as if you were in the office.
            </p>
          </div>
          
          <div className="card">
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
              WFH Policy <span className="badge badge-gray" style={{ fontSize: '0.75rem' }}>COMPANY-CONFIGURED</span>
            </h3>
            <ul style={{ fontSize: '0.875rem', color: 'var(--gray-700)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>Maximum WFH:</span> <strong>{appSettings?.wfhMaxDaysPerMonth !== undefined ? Number(appSettings.wfhMaxDaysPerMonth) : 2} days/month</strong></li>
              <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>Maximum Consecutive:</span> <strong>3 days</strong></li>
              <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>Half-Day WFH:</span> <strong>Allowed</strong></li>
              <li style={{ display: 'flex', justifyContent: 'space-between' }}><span>Approval:</span> <strong>Required</strong></li>
            </ul>
          </div>
        </div>

        {/* Right Col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Calendar View */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 className="card-title">Calendar View</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--success)' }}/> Appr</div>
                <div className="cal-legend"><span style={{ backgroundColor: 'var(--warning)' }}/> Pend</div>
              </div>
            </div>
            {loading ? (
              <div className="skeleton" style={{ height: '200px' }} />
            ) : (
              <div className="calendar-grid">
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
                  <div key={d} className="cal-head">{d}</div>
                ))}
                {emptyCells.map(i => <div key={`empty-${i}`} className="cal-day empty"></div>)}
                {calendarDays.map(day => {
                  const req = history.find(h => h.rawDate === `${currentMonthStr}-${day.toString().padStart(2, '0')}`);
                  return (
                    <div key={day} onClick={() => req && setSelectedDetail(req)} className={`cal-day ${!req ? 'future' : ''}`} style={{ cursor: req ? 'pointer' : 'default' }}>
                      <span className="cal-date">{day}</span>
                      {req && <div className="cal-dot" style={{ backgroundColor: req.status === 'Approved' ? 'var(--success)' : req.status === 'Pending' ? 'var(--warning)' : 'var(--danger)' }} />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* History */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="card-header" style={{ padding: '1.5rem 1.5rem 0 1.5rem', marginBottom: '1rem' }}>
              <h3 className="card-title">WFH History</h3>
            </div>
            
            {history.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
                <Home size={32} color="var(--gray-400)" style={{ margin: '0 auto 1rem auto' }} />
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>No WFH requests yet</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>Your submitted WFH requests will appear here.</p>
                <button onClick={() => setShowRequestModal(true)} className="btn btn-outline">Request WFH</button>
              </div>
            ) : (
              <>
                <div className="mobile-cards">
                  {history.map(row => (
                    <div key={row.id} className="mobile-hist-card" onClick={() => setSelectedDetail(row)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '0.875rem' }}>{row.date}</strong>
                        <span className={`badge ${getStatusBadge(row.status)}`}>{row.status}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{row.type} • {row.shift}</div>
                      <div style={{ fontSize: '0.875rem' }}>{row.reason}</div>
                    </div>
                  ))}
                </div>
                
                <div className="table-container desktop-table">
                  <table className="table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Reason</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedDetail(row)}>
                          <td style={{ fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.date}</td>
                          <td>
                            <div>{row.type}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.shift}</div>
                          </td>
                          <td style={{ maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.reason}</td>
                          <td><span className={`badge ${getStatusBadge(row.status)}`}>{row.status}</span></td>
                          <td><ArrowRight size={16} color="var(--gray-400)" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Request WFH Modal */}
      {showRequestModal && (
        <div className="drawer-overlay">
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '450px', maxHeight: '90vh', overflowY: 'auto', animation: 'slideUp 0.3s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Request WFH</h2>
              <button className="icon-button" onClick={() => setShowRequestModal(false)}><X size={20}/></button>
            </div>
            
            <form onSubmit={handleRequestSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {reqError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
                  <AlertCircle size={16} /> {reqError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Date *</label>
                <input type="date" value={reqDate} onChange={e => setReqDate(e.target.value)} className="form-control" />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Request Type *</label>
                <select value={reqType} onChange={e => setReqType(e.target.value)} className="form-control">
                  <option value="Full Day">Full Day</option>
                  <option value="Half Day">Half Day</option>
                </select>
              </div>

              {reqType === 'Half Day' && (
                <div style={{ backgroundColor: 'var(--gray-50)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Half-Day Period</label>
                  <select value={reqHalf} onChange={e => setReqHalf(e.target.value)} className="form-control">
                    <option value="First Half">First Half (9:00 AM — 1:00 PM)</option>
                    <option value="Second Half">Second Half (2:00 PM — 6:00 PM)</option>
                  </select>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Assigned Shift: 9:00 AM — 6:00 PM</div>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Reason *</label>
                <textarea value={reqReason} onChange={e => setReqReason(e.target.value)} className="form-control" rows={3} placeholder="Please provide a valid reason..."></textarea>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Optional Note</label>
                <input type="text" className="form-control" placeholder="Any additional info..." />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" onClick={() => setShowRequestModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Submit Request</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WFH Clock-in Proto Modal */}
      {showWfhClockModal && (
        <div className="drawer-overlay" style={{ alignItems: 'center' }}>
          <div className="card" style={{ margin: 'auto', width: '100%', maxWidth: '400px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', textAlign: 'center' }}>WFH Attendance</h3>
            <div style={{ backgroundColor: 'var(--primary-50)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Work Mode:</span><span className="badge badge-primary">WFH</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Location:</span><span style={{ fontWeight: 500 }}>Not Required</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Assigned Shift:</span><span style={{ fontWeight: 500 }}>09:00 AM — 06:00 PM</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Required Hours:</span><span style={{ fontWeight: 500 }}>8 Hours</span></div>
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setShowWfhClockModal(false)} className="btn btn-outline" style={{ flex: 1 }}>Cancel</button>
              <button onClick={() => { setShowWfhClockModal(false); setTodayAttendanceState('working'); }} className="btn btn-primary" style={{ flex: 1 }}>Start Work</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {selectedDetail && (
        <div className="drawer-overlay" onClick={() => setSelectedDetail(null)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Request Details</h2>
              <button className="icon-button" onClick={() => setSelectedDetail(null)}><X size={20} /></button>
            </div>
            <div className="drawer-body">
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{selectedDetail.date}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedDetail.id}</div>
                </div>
                <span className={`badge ${getStatusBadge(selectedDetail.status)}`}>{selectedDetail.status}</span>
              </div>

              {selectedDetail.status === 'Rejected' && (
                <div style={{ display: 'flex', gap: '0.5rem', backgroundColor: 'var(--danger-50)', color: 'var(--danger)', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                  <ShieldAlert size={18} style={{ flexShrink: 0 }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Rejection Reason</strong>
                    {selectedDetail.rejectReason}
                  </div>
                </div>
              )}

              <div className="detail-grid">
                <div className="detail-item highlight">
                  <span className="detail-label">Request Type</span>
                  <span className="detail-value">{selectedDetail.type}</span>
                </div>
                <div className="detail-item highlight">
                  <span className="detail-label">Requested On</span>
                  <span className="detail-value">{selectedDetail.requestedOn}</span>
                </div>
                
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="detail-label">Reason</span>
                  <span className="detail-value">{selectedDetail.reason}</span>
                </div>

                <div className="detail-item" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                  <span className="detail-label">Assigned Shift Settings</span>
                </div>

                <div className="detail-item">
                  <span className="detail-label">Assigned Shift</span>
                  <span className="detail-value">{selectedDetail.shift}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Shift Time</span>
                  <span className="detail-value">{selectedDetail.hours}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Required Hours</span>
                  <span className="detail-value">8 Hours</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Approved By</span>
                  <span className="detail-value">{selectedDetail.approvedBy}</span>
                </div>
              </div>
              
              {selectedDetail.status === 'Pending' && (
                <button onClick={() => handleCancelRequest(selectedDetail.id)} className="btn btn-outline" style={{ width: '100%', marginTop: '2rem', color: 'var(--danger-600)', borderColor: 'var(--danger-200)' }}>
                  Cancel Request
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        
        
        
        
        
        
        

        .two-col-grid { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
        @media (min-width: 1024px) { .two-col-grid { grid-template-columns: 1fr 1fr; } }
        
        /* Calendar */
        .cal-legend { display: flex; alignItems: center; gap: 0.25rem; font-size: 0.75rem; color: var(--gray-500); }
        .cal-legend span { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
        .cal-head { text-align: center; font-size: 0.75rem; font-weight: 600; color: var(--gray-500); padding-bottom: 0.5rem; }
        .cal-day { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: var(--radius-md); transition: all 0.2s; position: relative; }
        .cal-day:not(.empty):not(.future):hover { background-color: var(--gray-100); }
        .cal-day.future { color: var(--gray-300); }
        .cal-date { font-size: 0.875rem; font-weight: 500; }
        .cal-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 4px; }
        
        .desktop-table { display: block; }
        .mobile-cards { display: none; }
        @media (max-width: 768px) {
          .desktop-table { display: none; }
          .mobile-cards { display: flex; flex-direction: column; }
          .mobile-hist-card { padding: 1rem; border-bottom: 1px solid var(--border-color); cursor: pointer; }
          .mobile-hist-card:active { background-color: var(--gray-50); }
        }

        .drawer-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.4); z-index: 100; display: flex; justify-content: flex-end; }
        .drawer { background-color: var(--bg-surface); width: 100%; max-width: 400px; height: 100%; display: flex; flex-direction: column; box-shadow: var(--shadow-xl); animation: slideInRight 0.3s forwards; }
        .drawer-header { padding: 1.5rem; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; alignItems: center; }
        .drawer-body { padding: 1.5rem; overflow-y: auto; flex: 1; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .detail-item { display: flex; flex-direction: column; gap: 0.25rem; }
        .detail-item.highlight { background-color: var(--gray-50); padding: 0.75rem; border-radius: var(--radius-md); }
        .detail-label { font-size: 0.75rem; color: var(--gray-500); }
        .detail-value { font-size: 0.875rem; font-weight: 500; color: var(--gray-900); }
        
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @media (max-width: 768px) {
          .drawer-overlay { align-items: flex-end; }
          .drawer { height: 90vh; border-top-left-radius: var(--radius-xl); border-top-right-radius: var(--radius-xl); animation: slideUp 0.3s forwards; }
        }
        
        .pulse-dot { animation: pulseTimeline 2s infinite; }
        @keyframes pulseTimeline {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        .skeleton {
          background: linear-gradient(90deg, var(--gray-200) 25%, var(--gray-100) 50%, var(--gray-200) 75%);
          background-size: 200% 100%;
          animation: skeleton-loading 1.5s infinite;
        }
        @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes slideDown { from { transform: translate(-50%, -100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
      `}</style>
    </div>
  );
};

export default EmployeeWfh;


